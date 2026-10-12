#!/usr/bin/env bash
# Verifies stage 6 against the real Daraja sandbox, with no STK Push (so no real
# money): a simulated M-Pesa sale (scripts/simulate_mpesa_sale.py + a simulated
# callback to the real /daraja/stk-callback) funds both parties. Cash sales can't fund
# a payout any more (rule 12, migration 0010: only M-Pesa money is payable; see
# verify_stage4.sh for the cash rules). Then:
#   - the 18:00 sweep (run now via scripts/run_sweep.py) pays the producer by real B2C
#     and the M-Pesa-sourced ledger entry reaches 'paid' (rule 10);
#   - the driver's payout fails for real (ResultCode 2040: the sandbox only pays its
#     test MSISDN, and the driver fixture's phone isn't it), gets exactly one
#     automatic retry, which also fails and waits for a coordinator (rule 11);
#   - a redelivered failure callback doesn't start a second retry (rule 7);
#   - a second sweep the same day skips both; the coordinator's manual retry pays the
#     same amount again and, failing, gets no automatic retry of its own;
#   - funds never leave 'available' on failure; an unconfirmed cash sale past its
#     deadline is expired by the background job and writes no ledger entries.
# Makes 3 failing B2C calls (driver) and 1 succeeding one (producer).
#
# Requires: the API running locally with DARAJA_CALLBACK_BASE_URL pointed at a live
# ngrok tunnel, and the stage-3 fixtures. Cleans up this run's rows at the end.
# Usage (from backend/): (set -a; source .env; set +a; bash scripts/verify_stage6.sh)
# Exits non-zero if any check fails (with tee, set -o pipefail first).
set -uo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:8000}"
PRODUCER_PHONE="${PRODUCER_PHONE:-+254708374149}"
PRODUCER_PIN="${PRODUCER_PIN:-1111}"
DRIVER_PHONE="${DRIVER_PHONE:-+254799999003}"
DRIVER_PIN="${DRIVER_PIN:-2222}"
COORDINATOR_PHONE="${COORDINATOR_PHONE:-+254799999001}"
COORDINATOR_PIN="${COORDINATOR_PIN:-9999}"

PASS=0
FAIL=0

# Price-card links are signed (app/links.py); sign each test sale's stall, prices and driver.
sig() { PYTHONPATH=. .venv/bin/python scripts/sign_link.py --sig "$@"; }
TXN_IDS=()

q() { psql "$DATABASE_URL" -tAc "$1"; }
json() { python3 -c "import json,sys; d=json.load(sys.stdin); print(d$1 if isinstance(d, dict) else '')" 2>/dev/null; }
login() {
  curl -s -m 60 -X POST "$BASE_URL/auth/login" -H "Content-Type: application/json" \
    -d "{\"phone\":\"$1\",\"pin\":\"$2\"}"
}
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
wait_for() {
  local desc="$1" sql="$2" expected="$3" max="$4" waited=0 actual=""
  while [ "$waited" -lt "$max" ]; do
    actual=$(q "$sql")
    [ "$actual" = "$expected" ] && { check "$desc" "$actual" "$expected"; return; }
    sleep 3; waited=$((waited+3))
  done
  check "$desc (timed out after ${max}s)" "$actual" "$expected"
}
cleanup() {
  echo
  echo "== Cleanup: this run's transactions, ledger entries and withdrawals =="
  local ids="" t
  for t in "${TXN_IDS[@]}"; do ids="$ids,'$t'"; done
  ids="${ids#,}"
  if [ -z "$ids" ]; then echo "nothing to clean"; CLEANUP_OK=1; else
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -c "
    begin;
    -- retries reference the withdrawal they replace, so clear the links first
    update withdrawal_requests set retry_of = null where recipient_id in ('$PRODUCER_ID', '$DRIVER_ID') and requested_at >= '$STARTED_AT';
    delete from withdrawal_requests where recipient_id in ('$PRODUCER_ID', '$DRIVER_ID') and requested_at >= '$STARTED_AT';
    delete from wallet_ledger_entries where transaction_id in ($ids)
      or settlement_id in (select id from cash_debts where transaction_id in ($ids));
    delete from cash_debts where transaction_id in ($ids);
    delete from transactions where id in ($ids);
    commit;" && CLEANUP_OK=1 && echo "cleanup ok" || echo "cleanup FAILED — test rows may still be present"
  fi
  if [ -n "$SETUP_FAILED" ]; then
    echo "== RUN INVALID: setup step failed ($SETUP_FAILED). Checks after it prove nothing. =="; exit 1
  fi
  [ "$CLEANUP_OK" = 1 ] || { echo "== RUN FAILED: cleanup failed, test rows may be left in the database =="; exit 1; }
  [ "$FAIL" -eq 0 ] && exit 0 || exit 1
}

echo "== Logging in fixtures =="
PRODUCER_LOGIN=$(login "$PRODUCER_PHONE" "$PRODUCER_PIN")
DRIVER_LOGIN=$(login "$DRIVER_PHONE" "$DRIVER_PIN")
COORD_LOGIN=$(login "$COORDINATOR_PHONE" "$COORDINATOR_PIN")
PRODUCER_TOKEN=$(echo "$PRODUCER_LOGIN" | json "['access_token']")
PRODUCER_ID=$(echo "$PRODUCER_LOGIN" | json "['producer_id']")
DRIVER_TOKEN=$(echo "$DRIVER_LOGIN" | json "['access_token']")
DRIVER_ID=$(echo "$DRIVER_LOGIN" | json "['driver_id']")
DRIVER_QR=$(psql "$DATABASE_URL" -tAc "select qr_code from drivers where id = '$DRIVER_ID';")
COORD_TOKEN=$(echo "$COORD_LOGIN" | json "['access_token']")
[ -n "$PRODUCER_TOKEN" ] && [ -n "$DRIVER_TOKEN" ] && [ -n "$COORD_TOKEN" ] || { echo "FATAL: could not log in the stage-3 fixtures."; exit 1; }

# The sweep pays everyone eligible, so refuse to run if anyone else would be swept.
OTHERS=$(q "select count(*) from (select recipient_id from wallet_ledger_entries where status = 'available' group by recipient_id having sum(amount) >= 500) s;")
[ "$OTHERS" = "0" ] || { echo "FATAL: $OTHERS recipient(s) already hold >= KES 500 available; the sweep would pay them too."; exit 1; }
STARTED_AT=$(q "select now();")
trap cleanup EXIT

echo
echo "== Setup: simulated M-Pesa sale, product 2000 + photo 10 (maker 1410, driver 600) =="
TXN_ID=$(mpesa_sale "$PRODUCER_ID" 2000 10 "$DRIVER_ID"); need "simulated M-Pesa sale" "$TXN_ID"
TXN_IDS+=("$TXN_ID")
check "simulated callback confirmed the M-Pesa sale" "$(q "select status from transactions where id = '$TXN_ID';")" "confirmed"
check "maker 1410 available" "$(q "select amount from wallet_ledger_entries where transaction_id = '$TXN_ID' and recipient_type = 'maker' and status = 'available';")" "1410.00"
check "driver 600 available" "$(q "select amount from wallet_ledger_entries where transaction_id = '$TXN_ID' and recipient_type = 'driver' and status = 'available';")" "600.00"

echo
echo "== Test 1: the 18:00 sweep, run now =="
PYTHONPATH=. .venv/bin/python scripts/run_sweep.py
P_W1=$(q "select id from withdrawal_requests where recipient_id = '$PRODUCER_ID' and requested_at >= '$STARTED_AT' order by requested_at limit 1;")
D_W1=$(q "select id from withdrawal_requests where recipient_id = '$DRIVER_ID' and requested_at >= '$STARTED_AT' and retry_of is null order by requested_at limit 1;")
check "sweep created a full-balance producer withdrawal" "$(q "select amount from withdrawal_requests where id = '$P_W1';")" "1410.00"
check "sweep created a full-balance driver withdrawal" "$(q "select amount from withdrawal_requests where id = '$D_W1';")" "600.00"

echo "Waiting for the real B2C callbacks (up to 120s)..."
wait_for "producer payout reaches 'paid'" "select status from withdrawal_requests where id = '$P_W1';" "paid" 120
check "producer payout has a real B2C receipt" "$([ -n "$(q "select b2c_receipt from withdrawal_requests where id = '$P_W1';")" ] && echo yes || echo no)" "yes"
check "M-Pesa-sourced maker ledger entry reached 'paid'" "$(q "select status from wallet_ledger_entries where transaction_id = '$TXN_ID' and recipient_type = 'maker';")" "paid"

echo
echo "== Test 2: driver payout fails (2040), one automatic retry, then waits (rule 11) =="
wait_for "driver's first payout is marked 'retried'" "select status from withdrawal_requests where id = '$D_W1';" "retried" 120
D_W2=$(q "select id from withdrawal_requests where retry_of = '$D_W1';")
check "the automatic retry pays the same amount" "$(q "select amount from withdrawal_requests where id = '$D_W2';")" "600.00"
wait_for "the automatic retry also fails and stays 'failed'" "select status from withdrawal_requests where id = '$D_W2';" "failed" 120
sleep 10
check "no second automatic retry (2 driver withdrawals in total)" "$(q "select count(*) from withdrawal_requests where recipient_id = '$DRIVER_ID' and requested_at >= '$STARTED_AT';")" "2"
check "driver funds never left 'available'" "$(q "select status from wallet_ledger_entries where transaction_id = '$TXN_ID' and recipient_type = 'driver';")" "available"

echo
echo "== Test 3: a redelivered failure callback is a no-op (rule 7) =="
D_W1_KEY=$(q "select idempotency_key from withdrawal_requests where id = '$D_W1';")
curl -s -X POST "$BASE_URL/daraja/b2c-callback" -H "Content-Type: application/json" \
  -d "{\"Result\": {\"ResultCode\": 2040, \"ResultDesc\": \"replayed\", \"OriginatorConversationID\": \"$D_W1_KEY\"}}" >/dev/null
sleep 5
check "replay started no new retry" "$(q "select count(*) from withdrawal_requests where recipient_id = '$DRIVER_ID' and requested_at >= '$STARTED_AT';")" "2"
check "replay left the original 'retried'" "$(q "select status from withdrawal_requests where id = '$D_W1';")" "retried"

echo
echo "== Test 4: guards on further withdrawals =="
PYTHONPATH=. .venv/bin/python scripts/run_sweep.py >/dev/null
check "a second sweep today pays no one" "$(q "select count(*) from withdrawal_requests where recipient_id in ('$PRODUCER_ID', '$DRIVER_ID') and requested_at >= '$STARTED_AT';")" "3"
check "producer on-demand withdrawal below KES 500 is refused (422)" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE_URL/withdrawals/request" -H "Authorization: Bearer $PRODUCER_TOKEN")" "422"
check "driver on-demand withdrawal waits for the coordinator (409)" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE_URL/withdrawals/request" -H "Authorization: Bearer $DRIVER_TOKEN")" "409"
check "a non-coordinator can't retry (403)" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE_URL/admin/withdrawals/$D_W2/retry" -H "Authorization: Bearer $DRIVER_TOKEN")" "403"

echo
echo "== Test 5: coordinator's manual retry (rule 11) =="
MANUAL=$(curl -s -X POST "$BASE_URL/admin/withdrawals/$D_W2/retry" -H "Authorization: Bearer $COORD_TOKEN")
if [ -z "$(echo "$MANUAL" | json "['id']")" ] && [ "$(q "select status from withdrawal_requests where id = '$D_W2';")" = "failed" ]; then
  # Nothing changed (this dev network's pooler occasionally drops a connection), so
  # the coordinator would simply press retry again.
  echo "manual retry didn't go through ($MANUAL); retrying once"
  MANUAL=$(curl -s -X POST "$BASE_URL/admin/withdrawals/$D_W2/retry" -H "Authorization: Bearer $COORD_TOKEN")
fi
D_W3=$(echo "$MANUAL" | json "['id']")
check "manual retry pays the same amount" "$(echo "$MANUAL" | json "['amount']")" "600.00"
check "manual retry links to the failed retry" "$(echo "$MANUAL" | json "['retry_of']")" "$D_W2"
check "the failed retry is now 'retried'" "$(q "select status from withdrawal_requests where id = '$D_W2';")" "retried"
wait_for "manual retry fails for real (2040) and stays 'failed'" "select status from withdrawal_requests where id = '$D_W3';" "failed" 120
sleep 10
check "a failed manual retry gets no automatic retry" "$(q "select count(*) from withdrawal_requests where retry_of = '$D_W3';")" "0"
check "driver funds still 'available'" "$(q "select status from wallet_ledger_entries where transaction_id = '$TXN_ID' and recipient_type = 'driver';")" "available"

echo
echo "== Test 6: unconfirmed cash past its deadline expires (rule 12) =="
EXP=$(curl -s -X POST "$BASE_URL/transactions/initiate" -H "Content-Type: application/json" \
  -d "{\"producer_id\":\"$PRODUCER_ID\",\"driver_id\":\"$DRIVER_ID\",\"payment_method\":\"cash\",\"product_enabled\":true,\"product_amount\":100,\"photo_enabled\":true,\"photo_amount\":10,\"link_sig\":\"$(sig "$PRODUCER_ID" 100 10 "$DRIVER_QR")\"}")
EXP_ID=$(echo "$EXP" | json "['id']"); need "cash sale to expire" "$EXP_ID"
TXN_IDS+=("$EXP_ID")
# Move the deadline into the past rather than waiting out the real 10-minute window.
q "update transactions set confirmation_deadline = now() - interval '1 second' where id = '$EXP_ID';" >/dev/null
PYTHONPATH=. .venv/bin/python -c "import asyncio; from app.payouts import expire_unconfirmed_cash; asyncio.run(expire_unconfirmed_cash())"
check "past-deadline cash sale is 'cash_expired'" "$(q "select status from transactions where id = '$EXP_ID';")" "cash_expired"
check "an expired cash sale writes no ledger entries" "$(q "select count(*) from wallet_ledger_entries where transaction_id = '$EXP_ID';")" "0"

echo
echo "== Summary: $PASS passed, $FAIL failed =="
[ "$FAIL" -eq 0 ]
