#!/usr/bin/env bash
# Verifies account closure, suspension and the audit log (CLAUDE.md rule 17,
# migration 0011). No STK Push: M-Pesa money comes from simulated callbacks
# (scripts/simulate_mpesa_sale.py), cash sales go through the real API. Exactly one
# real sandbox B2C is sent (the producer's final payout); two final payouts are tested:
#   - the driver fixture's, which fails without reaching Daraja (app/daraja.py refuses a
#     sandbox B2C to any number but the test MSISDN), proving a failed final payout
#     leaves the account open ('closing');
#   - the producer fixture's, to the sandbox test number, which succeeds and closes it.
# A temporary driver (created and deleted here) covers closing with nothing to pay.
#
# The fixtures are reopened at the end. Audit log rows can't be deleted (that's the
# point), so each run leaves its entries there, every reason prefixed "[test]".
#
# Requires: the API running locally with DARAJA_CALLBACK_BASE_URL pointed at a live
# ngrok tunnel to it, and the stage-3 fixtures with no balance, debt, or open request.
# Usage (from backend/): (set -a; source .env; set +a; bash scripts/verify_lifecycle.sh)
set -uo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:8000}"
PRODUCER_PHONE="${PRODUCER_PHONE:-+254708374149}"
PRODUCER_PIN="${PRODUCER_PIN:-1111}"
DRIVER_PHONE="${DRIVER_PHONE:-+254799999003}"
DRIVER_PIN="${DRIVER_PIN:-2222}"
COORDINATOR_PHONE="${COORDINATOR_PHONE:-+254799999001}"
COORDINATOR_PIN="${COORDINATOR_PIN:-9999}"
TEMP_PHONE="+254799999077"
TEMP_PIN="7777"

PASS=0
FAIL=0
TXN_IDS=()
TEMP_DRIVER_ID=""

q() { psql "$DATABASE_URL" -tAc "$1"; }
json() { python3 -c "import json,sys; d=json.load(sys.stdin); print(d$1 if isinstance(d, dict) else '')" 2>/dev/null; }
sig() { PYTHONPATH=. .venv/bin/python scripts/sign_link.py --sig "$@"; }
# Retries a login that fails outright: this dev network's pooler sometimes stalls a
# connection past app/db.py's 10s timeout (CLAUDE.md section 2). A refusal (401/403)
# is returned as is.
login() {
  local r i
  for i in 1 2 3; do
    r=$(curl -s -m 60 -X POST "$BASE_URL/auth/login" -H "Content-Type: application/json" -d "{\"phone\":\"$1\",\"pin\":\"$2\"}")
    [[ "$r" == *access_token* || "$r" == *detail* && "$r" != *"Internal"* ]] && break
    sleep 2
  done
  echo "$r"
}
code() { curl -s -o /dev/null -w '%{http_code}' -m 60 "$@"; }
source scripts/sim_mpesa.sh
# A setup step that produced nothing (an id, a token) stops the run: every check after
# it would be testing the wrong state. cleanup() then reports the run as invalid.
SETUP_FAILED=""
CLEANUP_OK=0
need() { [ -n "$2" ] && return 0; SETUP_FAILED="$1"; echo "FATAL: setup step failed: $1" >&2; exit 1; }
check() {
  local desc="$1" actual="$2" expected="$3"
  if [ -z "$actual" ] && [ -z "$expected" ]; then
    echo "FAIL  $desc (both sides empty: a call failed)"; FAIL=$((FAIL+1))
  elif [ "$actual" = "$expected" ]; then echo "PASS  $desc"; PASS=$((PASS+1))
  else echo "FAIL  $desc (expected '$expected', got '$actual')"; FAIL=$((FAIL+1)); fi
}
contains() {
  local desc="$1" haystack="$2" needle="$3"
  if [[ "$haystack" == *"$needle"* ]]; then echo "PASS  $desc"; PASS=$((PASS+1))
  else echo "FAIL  $desc (no '$needle' in: $haystack)"; FAIL=$((FAIL+1)); fi
}
wait_for() {
  local desc="$1" sql="$2" expected="$3" max="$4" waited=0 actual=""
  while [ "$waited" -lt "$max" ]; do
    actual=$(q "$sql")
    [ "$actual" = "$expected" ] && { check "$desc" "$actual" "$expected"; return; }
    sleep 3; waited=$((waited+3))
  done
  check "$desc (timed out after ${max}s)" "$actual" "$expected"
}
post() {  # post <path> <token> [json body] -> response body
  local body="${3:-}"; [ -n "$body" ] || body='{}'
  curl -s -m 60 -X POST "$BASE_URL$1" -H "Authorization: Bearer $2" -H "Content-Type: application/json" -d "$body"
}
post_code() {
  local body="${3:-}"; [ -n "$body" ] || body='{}'
  code -X POST "$BASE_URL$1" -H "Authorization: Bearer $2" -H "Content-Type: application/json" -d "$body"
}
me() { curl -s -m 60 "$BASE_URL/accounts/me" -H "Authorization: Bearer $1"; }
admin_accounts() { curl -s -m 60 "$BASE_URL/admin/accounts" -H "Authorization: Bearer $COORD_TOKEN"; }
open_request() { q "select id from closure_requests where party_id = '$1' and status in ('pending','approved');"; }
unban() {  # unban <phone>: lift the Supabase Auth ban a closure leaves
  PYTHONPATH=. .venv/bin/python - "$1" <<'PY'
import asyncio, sys
from app.db import async_session
from app import lifecycle
async def main():
    async with async_session() as s:
        await lifecycle.set_login_banned(s, sys.argv[1], False)
asyncio.run(main())
PY
}
cleanup() {
  echo
  echo "== Cleanup: reopen the fixtures, remove this run's rows and the temporary driver =="
  local ids="" t
  for t in "${TXN_IDS[@]}"; do [ -n "$t" ] && ids="$ids,'$t'"; done
  ids="${ids#,}"
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -c "
    begin;
    update producers set account_status = 'active' where id = '$PRODUCER_ID';
    update drivers set account_status = 'active' where id = '$DRIVER_ID';
    delete from closure_requests where party_id in ('$PRODUCER_ID', '$DRIVER_ID') and requested_at >= '$STARTED_AT';
    delete from account_suspensions where party_id in ('$PRODUCER_ID', '$DRIVER_ID') and suspended_at >= '$STARTED_AT';
    update withdrawal_requests set retry_of = null where recipient_id in ('$PRODUCER_ID', '$DRIVER_ID') and requested_at >= '$STARTED_AT';
    delete from withdrawal_requests where recipient_id in ('$PRODUCER_ID', '$DRIVER_ID') and requested_at >= '$STARTED_AT';
    $([ -n "$ids" ] && echo "
    delete from wallet_ledger_entries where transaction_id in ($ids)
      or settlement_id in (select id from cash_debts where transaction_id in ($ids));
    delete from cash_debts where transaction_id in ($ids);
    delete from transactions where id in ($ids);")
    $([ -n "$TEMP_DRIVER_ID" ] && echo "
    delete from closure_requests where party_id = '$TEMP_DRIVER_ID';
    delete from drivers where id = '$TEMP_DRIVER_ID';")
    commit;" && CLEANUP_OK=1 && echo "database cleanup ok" || echo "database cleanup FAILED — test rows may still be present"
  unban "$PRODUCER_PHONE"; unban "$DRIVER_PHONE"
  if [ -n "$TEMP_DRIVER_ID" ]; then
    local temp_user
    temp_user=$(q "select auth_user_id from auth_credentials where phone = '$TEMP_PHONE';")
    q "delete from auth_credentials where phone = '$TEMP_PHONE';" >/dev/null
    [ -n "$temp_user" ] && curl -s -m 30 -X DELETE "$(echo "$SUPABASE_URL" | sed -E 's#(https://[^/]+).*#\1#')/auth/v1/admin/users/$temp_user" \
      -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" >/dev/null
    echo "temporary driver removed"
  fi
  check "fixtures can log in again after cleanup" \
    "$(login "$PRODUCER_PHONE" "$PRODUCER_PIN" | json "['role']") $(login "$DRIVER_PHONE" "$DRIVER_PIN" | json "['role']")" "producer driver"
  echo
  echo "== Summary: $PASS passed, $FAIL failed =="
  if [ -n "$SETUP_FAILED" ]; then
    echo "== RUN INVALID: setup step failed ($SETUP_FAILED). Checks after it prove nothing. =="; exit 1
  fi
  [ "$CLEANUP_OK" = 1 ] || { echo "== RUN FAILED: cleanup failed, test rows may be left in the database =="; exit 1; }
  [ "$FAIL" -eq 0 ] && exit 0 || exit 1
}

echo "== Logging in fixtures =="
PRODUCER_LOGIN=$(login "$PRODUCER_PHONE" "$PRODUCER_PIN")
DRIVER_LOGIN=$(login "$DRIVER_PHONE" "$DRIVER_PIN")
COORD_TOKEN=$(login "$COORDINATOR_PHONE" "$COORDINATOR_PIN" | json "['access_token']")
PRODUCER_TOKEN=$(echo "$PRODUCER_LOGIN" | json "['access_token']")
PRODUCER_ID=$(echo "$PRODUCER_LOGIN" | json "['producer_id']")
DRIVER_TOKEN=$(echo "$DRIVER_LOGIN" | json "['access_token']")
DRIVER_ID=$(echo "$DRIVER_LOGIN" | json "['driver_id']")
DRIVER_QR=$(q "select qr_code from drivers where id = '$DRIVER_ID';")
[ -n "$PRODUCER_TOKEN" ] && [ -n "$DRIVER_TOKEN" ] && [ -n "$COORD_TOKEN" ] || { echo "FATAL: could not log in the stage-3 fixtures."; exit 1; }
BUSY=$(q "select (select count(*) from wallet_ledger_entries where recipient_id in ('$PRODUCER_ID','$DRIVER_ID') and status in ('pending','available','frozen'))
  + (select count(*) from cash_debts where status = 'outstanding')
  + (select count(*) from closure_requests where status in ('pending','approved'))
  + (select count(*) from account_suspensions where lifted_at is null);")
[ "$BUSY" = "0" ] || { echo "FATAL: the fixtures already hold a balance, debt, open closure request or suspension."; exit 1; }
[ "$(q "select count(*) from payout_pauses where resumed_at is null;")" = "0" ] || { echo "FATAL: payouts are paused (a locked B2C credential); fix it and resume before running this."; exit 1; }
STARTED_AT=$(q "select now();")
trap cleanup EXIT

echo
echo "== Test 1: a driver requests closure, then cancels it =="
check "a request with no reason is refused (422)" "$(post_code /accounts/me/closure "$DRIVER_TOKEN" '{"reason":"  "}')" "422"
R=$(post /accounts/me/closure "$DRIVER_TOKEN" '{"reason":"[test] moving to another site"}')
check "request accepted as pending" "$(echo "$R" | json "['status']")" "pending"
check "a second open request is refused (409)" "$(post_code /accounts/me/closure "$DRIVER_TOKEN" '{"reason":"[test] again"}')" "409"
check "the driver sees it on their account" "$(me "$DRIVER_TOKEN" | json "['closure']['status']")" "pending"
check "cancelled while pending" "$(post /accounts/me/closure/cancel "$DRIVER_TOKEN" '{"reason":"[test] changed my mind"}' | json "['status']")" "cancelled"
check "nothing left to cancel (409)" "$(post_code /accounts/me/closure/cancel "$DRIVER_TOKEN")" "409"

echo
echo "== Test 2: approval is refused while anything is still in motion, then rejected =="
REQ=$(post /accounts/me/closure "$DRIVER_TOKEN" '{"reason":"[test] retiring"}' | json "['id']"); need "driver's closure request" "$REQ"
check "a non-coordinator can't approve (403)" "$(post_code "/admin/closure-requests/$REQ/approve" "$DRIVER_TOKEN")" "403"
CASH=$(curl -s -m 60 -X POST "$BASE_URL/transactions/initiate" -H "Content-Type: application/json" \
  -d "{\"producer_id\":\"$PRODUCER_ID\",\"driver_id\":\"$DRIVER_ID\",\"payment_method\":\"cash\",\"product_enabled\":true,\"product_amount\":200,\"link_sig\":\"$(sig "$PRODUCER_ID" 200 - "$DRIVER_QR")\"}")
CASH_ID=$(echo "$CASH" | json "['id']"); need "cash sale" "$CASH_ID"; TXN_IDS+=("$CASH_ID")
R=$(post "/admin/closure-requests/$REQ/approve" "$COORD_TOKEN")
contains "blocked: a cash sale waiting for confirmation" "$R" "waiting for confirmation"
contains "the coordinator's list shows the same blocker" "$(admin_accounts)" "waiting for confirmation"
post "/transactions/$CASH_ID/confirm" "$DRIVER_TOKEN" >/dev/null
check "cash sale confirmed by driver + maker" "$(post "/transactions/$CASH_ID/confirm" "$PRODUCER_TOKEN" | json "['status']")" "cash_confirmed"
contains "blocked: the maker still owes this driver 60" "$(post "/admin/closure-requests/$REQ/approve" "$COORD_TOKEN")" "still owed to this driver"
M_ID=$(mpesa_sale "$PRODUCER_ID" 100 -); need "simulated M-Pesa sale" "$M_ID"; TXN_IDS+=("$M_ID")
check "a simulated M-Pesa sale settles the debt (driver payable 60)" "$(me "$DRIVER_TOKEN" | json "['payable']")" "60.00"
post "/admin/transactions/$CASH_ID/dispute" "$COORD_TOKEN" >/dev/null
contains "blocked: an open dispute" "$(post "/admin/closure-requests/$REQ/approve" "$COORD_TOKEN")" "open dispute"
check "the dispute freezes the driver's 60 (rule 13)" "$(me "$DRIVER_TOKEN" | json "['payable']")" "0"
post "/admin/transactions/$CASH_ID/resolve" "$COORD_TOKEN" >/dev/null
q "insert into withdrawal_requests (recipient_type, recipient_id, amount, idempotency_key, status) values ('driver', '$DRIVER_ID', 60, gen_random_uuid(), 'processing');" >/dev/null
contains "blocked: a payout in progress" "$(post "/admin/closure-requests/$REQ/approve" "$COORD_TOKEN")" "payout is in progress"
q "delete from withdrawal_requests where recipient_id = '$DRIVER_ID' and status = 'processing' and b2c_receipt is null and requested_at >= '$STARTED_AT';" >/dev/null
check "reject without a reason is refused (422)" "$(post_code "/admin/closure-requests/$REQ/reject" "$COORD_TOKEN" '{"reason":""}')" "422"
check "rejected with a reason" "$(post "/admin/closure-requests/$REQ/reject" "$COORD_TOKEN" '{"reason":"[test] finish the season first"}' | json "['status']")" "rejected"
check "the driver sees why" "$(me "$DRIVER_TOKEN" | json "['closure']['decision_reason']")" "[test] finish the season first"
check "the driver is still active" "$(q "select account_status from drivers where id = '$DRIVER_ID';")" "active"

echo
echo "== Test 3: suspension =="
check "a non-coordinator can't suspend (403)" "$(post_code "/admin/accounts/driver/$DRIVER_ID/suspend" "$DRIVER_TOKEN" '{"reason":"x"}')" "403"
check "suspend without a reason is refused (422)" "$(post_code "/admin/accounts/driver/$DRIVER_ID/suspend" "$COORD_TOKEN" '{"reason":" "}')" "422"
S=$(post "/admin/accounts/driver/$DRIVER_ID/suspend" "$COORD_TOKEN" '{"reason":"[test] two unconfirmed cash sales"}')
check "suspended" "$(echo "$S" | json "['account_status']")" "suspended"
check "review date defaults to 7 days ahead" "$(echo "$S" | json "['suspension']['review_on']")" "$(TZ=Africa/Nairobi date -d '+7 days' +%F)"
R=$(login "$DRIVER_PHONE" "$DRIVER_PIN")
contains "login refused, with the reason shown" "$R" "suspended: [test] two unconfirmed cash sales"
contains "an existing session is refused too, with the reason" "$(me "$DRIVER_TOKEN")" "two unconfirmed cash sales"
check "the driver's QR page says not registered (404)" "$(code "$BASE_URL/public/drivers/$DRIVER_QR")" "404"
check "no new sale with this driver (422)" "$(code -X POST "$BASE_URL/transactions/initiate" -H "Content-Type: application/json" \
  -d "{\"producer_id\":\"$PRODUCER_ID\",\"driver_id\":\"$DRIVER_ID\",\"payment_method\":\"cash\",\"product_enabled\":true,\"product_amount\":200,\"link_sig\":\"$(sig "$PRODUCER_ID" 200 - "$DRIVER_QR")\"}")" "422"
check "honestly earned money stays owed: payable still 60, entry still available" \
  "$(admin_accounts | python3 -c "import json,sys; print(next(a['payable'] for a in json.load(sys.stdin)['accounts'] if a['id']=='$DRIVER_ID'))") $(q "select status from wallet_ledger_entries where recipient_id = '$DRIVER_ID' and settlement_id is not null;")" "60.00 available"
check "a second suspension is refused (409)" "$(post_code "/admin/accounts/driver/$DRIVER_ID/suspend" "$COORD_TOKEN" '{"reason":"[test] again"}')" "409"
q "update account_suspensions set review_on = current_date - 1 where party_id = '$DRIVER_ID' and lifted_at is null;" >/dev/null
check "a review date in the past is flagged overdue" "$(admin_accounts | json "['overdue_reviews']")" "1"
check "unsuspend without a reason is refused (422)" "$(post_code "/admin/accounts/driver/$DRIVER_ID/unsuspend" "$COORD_TOKEN" '{"reason":""}')" "422"
check "unsuspended" "$(post "/admin/accounts/driver/$DRIVER_ID/unsuspend" "$COORD_TOKEN" '{"reason":"[test] confirmed with the site"}' | json "['account_status']")" "active"
DRIVER_TOKEN=$(login "$DRIVER_PHONE" "$DRIVER_PIN" | json "['access_token']")
check "the driver can log in again" "$([ -n "$DRIVER_TOKEN" ] && echo yes || echo no)" "yes"
check "the QR page works again" "$(code "$BASE_URL/public/drivers/$DRIVER_QR")" "200"
check "a suspended maker can't take new sales either (422)" "$(
  post "/admin/accounts/maker/$PRODUCER_ID/suspend" "$COORD_TOKEN" '{"reason":"[test] maker suspension"}' >/dev/null
  code -X POST "$BASE_URL/transactions/initiate" -H "Content-Type: application/json" \
    -d "{\"producer_id\":\"$PRODUCER_ID\",\"payment_method\":\"cash\",\"product_enabled\":true,\"product_amount\":100,\"link_sig\":\"$(sig "$PRODUCER_ID" 100 -)\"}"
  post "/admin/accounts/maker/$PRODUCER_ID/unsuspend" "$COORD_TOKEN" '{"reason":"[test] lifted"}' >/dev/null)" "422"
PRODUCER_TOKEN=$(login "$PRODUCER_PHONE" "$PRODUCER_PIN" | json "['access_token']")

echo
echo "== Test 4: a failed final payout leaves the account open (driver, refused before sending) =="
REQ=$(post /accounts/me/closure "$DRIVER_TOKEN" '{"reason":"[test] leaving"}' | json "['id']"); need "driver's second closure request" "$REQ"
A=$(post "/admin/closure-requests/$REQ/approve" "$COORD_TOKEN" '{"note":"[test] approved"}')
check "approved, account closing" "$(echo "$A" | json "['status']") $(echo "$A" | json "['account_status']")" "approved closing"
check "final payout is the payable 60, below KES 500" "$(echo "$A" | json "['payout']['amount']")" "60.00"
W1=$(echo "$A" | json "['payout']['id']")
wait_for "the payout fails and gets its one automatic retry" "select status from withdrawal_requests where id = '$W1';" "retried" 120
W2=$(q "select id from withdrawal_requests where retry_of = '$W1';")
wait_for "the retry fails too and waits for a coordinator" "select status from withdrawal_requests where id = '$W2';" "failed" 120
check "the account stays closing, the request approved" "$(q "select account_status from drivers where id = '$DRIVER_ID';") $(q "select status from closure_requests where id = '$REQ';")" "closing approved"
check "a closing account can still log in to follow its payout" "$(login "$DRIVER_PHONE" "$DRIVER_PIN" | json "['role']")" "driver"
check "the funds never left 'available'" "$(q "select status from wallet_ledger_entries where recipient_id = '$DRIVER_ID' and settlement_id is not null;")" "available"

echo
echo "== Test 5: a final payout to the sandbox number closes the account (producer) =="
TXNS_BEFORE=$(q "select count(*) from transactions where producer_id = '$PRODUCER_ID';")
REQ=$(post /accounts/me/closure "$PRODUCER_TOKEN" '{"reason":"[test] closing the stall"}' | json "['id']"); need "producer's closure request" "$REQ"
A=$(post "/admin/closure-requests/$REQ/approve" "$COORD_TOKEN")
check "approved, final payout of the payable 40" "$(echo "$A" | json "['status']") $(echo "$A" | json "['payout']['amount']")" "approved 40.00"
check "no new sales while closing (checkout refuses)" "$(code "$BASE_URL/public/checkout/$PRODUCER_ID?product=100&sig=$(sig "$PRODUCER_ID" 100 -)")" "422"
W=$(echo "$A" | json "['payout']['id']")
wait_for "the real B2C payout is paid" "select status from withdrawal_requests where id = '$W';" "paid" 120
wait_for "then the account is closed" "select account_status from producers where id = '$PRODUCER_ID';" "closed" 30
check "the request is closed" "$(q "select status from closure_requests where id = '$REQ';")" "closed"
contains "login refused: closed" "$(login "$PRODUCER_PHONE" "$PRODUCER_PIN")" "This account is closed"
check "history kept: every transaction is still there" "$(q "select count(*) from transactions where producer_id = '$PRODUCER_ID';")" "$TXNS_BEFORE"
check "nothing left to pay" "$(q "select coalesce(sum(amount),0) from wallet_ledger_entries where recipient_id = '$PRODUCER_ID' and status = 'available';")" "0"

echo
echo "== Test 6: closing with nothing to pay closes at once (temporary driver) =="
TEMP_QR="SAWA-DRV-TEST$(date +%s | tail -c 5)"
T=$(post /auth/onboard "$COORD_TOKEN" "{\"role\":\"driver\",\"phone\":\"$TEMP_PHONE\",\"pin\":\"$TEMP_PIN\",\"name\":\"Temp Test\",\"till\":\"000000\",\"qr_code\":\"$TEMP_QR\"}")
TEMP_DRIVER_ID=$(echo "$T" | json "['id']"); need "temporary driver" "$TEMP_DRIVER_ID"
TEMP_TOKEN=$(login "$TEMP_PHONE" "$TEMP_PIN" | json "['access_token']"); need "temporary driver login" "$TEMP_TOKEN"
REQ=$(post /accounts/me/closure "$TEMP_TOKEN" '{"reason":"[test] temporary account"}' | json "['id']"); need "temporary driver's closure request" "$REQ"
A=$(post "/admin/closure-requests/$REQ/approve" "$COORD_TOKEN")
check "closed immediately, no payout" "$(echo "$A" | json "['status']") $(echo "$A" | json "['payout']")" "closed None"
check "its QR page now says not registered (404)" "$(code "$BASE_URL/public/drivers/$TEMP_QR")" "404"
contains "login refused: closed" "$(login "$TEMP_PHONE" "$TEMP_PIN")" "This account is closed"
check "the row is kept, not deleted" "$(q "select account_status from drivers where id = '$TEMP_DRIVER_ID';")" "closed"

echo
echo "== Test 7: the audit log =="
ACTIONS=$(q "select string_agg(distinct action, ',' order by action) from account_audit_log where at >= '$STARTED_AT';")
check "every kind of action was recorded" "$ACTIONS" "account_closed,closure_approved,closure_cancelled,closure_rejected,closure_requested,suspended,unsuspended"
check "coordinator actions record who (their phone)" "$(q "select count(*) from account_audit_log where at >= '$STARTED_AT' and actor_role = 'coordinator' and actor_phone is null;")" "0"
check "the rejection's reason is recorded" "$(q "select reason from account_audit_log where at >= '$STARTED_AT' and action = 'closure_rejected';")" "[test] finish the season first"
contains "the coordinator can read it" "$(admin_accounts | json "['audit']")" "closure_rejected"
check "an entry can't be edited" "$(psql "$DATABASE_URL" -tAc "update account_audit_log set reason = 'x' where at >= '$STARTED_AT';" 2>&1 | grep -c 'append-only')" "1"
check "or deleted" "$(psql "$DATABASE_URL" -tAc "delete from account_audit_log where at >= '$STARTED_AT';" 2>&1 | grep -c 'append-only')" "1"
