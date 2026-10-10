#!/usr/bin/env bash
# Verifies the security lockdown (migration 0012, CLAUDE.md section 5) with no STK Push:
#   1. No browser writes: as a signed-in maker, driver and coordinator (and anonymous),
#      straight to Supabase with the publishable key exactly as a browser would, every
#      insert/update/delete on every table is refused, a maker/driver can't change their
#      own status, split, phone or amounts, and none of it changes the database.
#   2. checkout_request_id and tourist_confirm_token can't be read from the browser,
#      and aren't in any table Realtime streams.
#   3. Forged STK callbacks: no token, a wrong token or another sale's token is refused;
#      the right token with the wrong Amount is refused and flagged. A correct one is
#      credited (flag mode) and Safaricom's STK Push Query then flags it as a mismatch,
#      since a simulated sale never went through M-Pesa.
#   4. STK_QUERY_MODE=enforce, through the same functions the callback route and the
#      scheduler call: nothing is credited until Safaricom confirms; a query that never
#      answers leaves the sale "Payment being verified", flagged; a "no" fails it.
# The API must run locally in STK_QUERY_MODE=flag (the default). Needs frontend/.env
# for the Supabase URL and publishable key.
# Usage (from backend/): (set -a; source .env; set +a; bash scripts/verify_security.sh)
set -uo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:8000}"
PRODUCER_PHONE="${PRODUCER_PHONE:-+254708374149}"
PRODUCER_PIN="${PRODUCER_PIN:-1111}"
DRIVER_PHONE="${DRIVER_PHONE:-+254799999003}"
DRIVER_PIN="${DRIVER_PIN:-2222}"
COORDINATOR_PHONE="${COORDINATOR_PHONE:-+254799999001}"
COORDINATOR_PIN="${COORDINATOR_PIN:-9999}"
SB_URL=$(grep -E "^VITE_SUPABASE_URL=" ../frontend/.env | cut -d= -f2- | tr -d '"' | sed -E 's#(https://[^/]+).*#\1#')
SB_KEY=$(grep -E "^VITE_SUPABASE_PUBLISHABLE_KEY=" ../frontend/.env | cut -d= -f2- | tr -d '"')

PASS=0
FAIL=0
TXN_IDS=()

q() { psql "$DATABASE_URL" -tAc "$1"; }
json() { python3 -c "import json,sys; d=json.load(sys.stdin); print(d$1 if isinstance(d, dict) else '')" 2>/dev/null; }
source scripts/sim_mpesa.sh
# A setup step that produced nothing (an id, a token) stops the run: every check after
# it would be testing the wrong state. cleanup() then reports the run as invalid.
SETUP_FAILED=""
CLEANUP_OK=0
need() { [ -n "$2" ] && return 0; SETUP_FAILED="$1"; echo "FATAL: setup step failed: $1" >&2; exit 1; }
check() {
  local desc="$1" actual="$2" expected="$3"
  if [ "$actual" = "$expected" ]; then echo "PASS  $desc"; PASS=$((PASS+1))
  else echo "FAIL  $desc (expected '$expected', got '$actual')"; FAIL=$((FAIL+1)); fi
}
login() {
  local r i
  for i in 1 2 3; do
    r=$(curl -s -m 60 -X POST "$BASE_URL/auth/login" -H "Content-Type: application/json" -d "{\"phone\":\"$1\",\"pin\":\"$2\"}")
    [[ "$r" == *access_token* ]] && break
    sleep 2
  done
  echo "$r"
}
# rest <METHOD> <path?query> <jwt or "anon"> [json body] -> "<http code> <postgres error code>"
rest() {
  local auth="$SB_KEY" body="${4:-}" out code pg i
  [ "$3" != "anon" ] && auth="$3"
  for i in 1 2 3; do  # retry only when no response came back at all (this dev network)
    out=$(curl -s -m 60 -o /dev/stdout -w '\n%{http_code}' -X "$1" "$SB_URL/rest/v1/$2" \
      -H "apikey: $SB_KEY" -H "Authorization: Bearer $auth" -H "Content-Type: application/json" \
      -H "Prefer: return=representation" ${body:+-d "$body"})
    code=$(echo "$out" | tail -1)
    [ "$code" != "000" ] && break
  done
  pg=$(echo "$out" | sed '$d' | json "['code']")
  echo "$code ${pg:-none}"
}
refused() {  # refused <description> <"code pgcode">: permission denied (42501) from PostgREST
  local desc="$1" got="$2"
  if [[ "$got" == 401\ 42501 || "$got" == 403\ 42501 ]]; then echo "PASS  $desc"; PASS=$((PASS+1))
  else echo "FAIL  $desc (expected permission denied, got '$got')"; FAIL=$((FAIL+1)); fi
}
cleanup() {
  echo
  echo "== Cleanup: this run's sales, their ledger entries and debts =="
  local ids="" t
  for t in "${TXN_IDS[@]}"; do [ -n "$t" ] && ids="$ids,'$t'"; done
  ids="${ids#,}"
  if [ -z "$ids" ]; then echo "nothing to clean"; CLEANUP_OK=1; else
  # transaction_secrets and stk_verifications go with their transaction (on delete cascade).
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -c "
    begin;
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
COORD_TOKEN=$(login "$COORDINATOR_PHONE" "$COORDINATOR_PIN" | json "['access_token']")
MAKER=$(echo "$PRODUCER_LOGIN" | json "['access_token']")
PRODUCER_ID=$(echo "$PRODUCER_LOGIN" | json "['producer_id']")
DRIVER=$(echo "$DRIVER_LOGIN" | json "['access_token']")
DRIVER_ID=$(echo "$DRIVER_LOGIN" | json "['driver_id']")
[ -n "$MAKER" ] && [ -n "$DRIVER" ] && [ -n "$COORD_TOKEN" ] && [ -n "$SB_URL" ] && [ -n "$SB_KEY" ] || { echo "FATAL: could not log in the fixtures or read frontend/.env."; exit 1; }
BUSY=$(q "select count(*) from wallet_ledger_entries where recipient_id in ('$PRODUCER_ID','$DRIVER_ID') and status in ('pending','available','frozen')")
[ "$BUSY" = "0" ] || { echo "FATAL: the fixtures already hold a balance; this script needs them at zero."; exit 1; }
trap cleanup EXIT

# One real sale of the maker's own, so updates have a row they could otherwise reach.
OWN=$(mpesa_sale "$PRODUCER_ID" 100 - "$DRIVER_ID"); need "the maker's own M-Pesa sale" "$OWN"; TXN_IDS+=("$OWN")
check "setup: the maker has a confirmed M-Pesa sale of their own" "$(q "select status from transactions where id = '$OWN';")" "confirmed"
BEFORE=$(q "select md5(string_agg(t::text, '|' order by t::text)) from (
  select row(p.*)::text as t from producers p union all select row(d.*)::text from drivers d
  union all select row(x.*)::text from transactions x union all select row(e.*)::text from wallet_ledger_entries e
  union all select row(w.*)::text from withdrawal_requests w) s;")

echo
echo "== Test 1: no browser writes, to any table =="
TABLES="transactions wallet_ledger_entries withdrawal_requests cash_debts producers drivers closure_requests account_suspensions account_audit_log auth_credentials transaction_secrets stk_verifications sync_queue_items"
key_of() { case $1 in transaction_secrets|stk_verifications) echo transaction_id ;; auth_credentials) echo auth_user_id ;; *) echo id ;; esac; }
# The column a PATCH tries to set: the key, except the audit log's generated identity id,
# which Postgres refuses to set before it even checks permissions (428C9).
set_of() { [ "$1" = account_audit_log ] && echo reason || key_of "$1"; }
for label in maker driver coordinator anonymous; do
  case $label in maker) jwt="$MAKER" ;; driver) jwt="$DRIVER" ;; coordinator) jwt="$COORD_TOKEN" ;; *) jwt="anon" ;; esac
  fails_before=$FAIL
  for t in $TABLES; do
    k=$(key_of "$t")
    for m in POST PATCH DELETE; do
      case $m in
        POST) got=$(rest POST "$t" "$jwt" '{}') ;;
        PATCH) got=$(rest PATCH "$t?$k=not.is.null" "$jwt" "{\"$(set_of "$t")\":null}") ;;
        DELETE) got=$(rest DELETE "$t?$k=not.is.null" "$jwt") ;;
      esac
      if [[ "$got" != 401\ 42501 && "$got" != 403\ 42501 ]]; then
        echo "FAIL  $label: $m $t was not refused ($got)"; FAIL=$((FAIL+1))
      fi
    done
  done
  [ "$FAIL" -eq "$fails_before" ] && { echo "PASS  $label: insert, update and delete refused on all 13 tables"; PASS=$((PASS+1)); }
done
refused "maker can't change their own account_status" "$(rest PATCH "producers?id=eq.$PRODUCER_ID" "$MAKER" '{"account_status":"active"}')"
refused "maker can't change their own split percentage" "$(rest PATCH "producers?id=eq.$PRODUCER_ID" "$MAKER" '{"default_split_driver_pct":0}')"
refused "maker can't change their own phone" "$(rest PATCH "producers?id=eq.$PRODUCER_ID" "$MAKER" '{"phone":"+254700000001"}')"
refused "maker can't change their sale's amounts" "$(rest PATCH "transactions?id=eq.$OWN" "$MAKER" '{"maker_amount":100000,"total_amount":100000}')"
refused "maker can't change their sale's status" "$(rest PATCH "transactions?id=eq.$OWN" "$MAKER" '{"status":"initiated"}')"
refused "maker can't change a ledger entry's amount" "$(rest PATCH "wallet_ledger_entries?transaction_id=eq.$OWN" "$MAKER" '{"amount":100000}')"
refused "maker can't mark entries available or paid" "$(rest PATCH "wallet_ledger_entries?recipient_id=eq.$PRODUCER_ID" "$MAKER" '{"status":"available"}')"
refused "maker can't insert a withdrawal" "$(rest POST withdrawal_requests "$MAKER" "{\"recipient_type\":\"maker\",\"recipient_id\":\"$PRODUCER_ID\",\"amount\":1,\"idempotency_key\":\"$(python3 -c 'import uuid; print(uuid.uuid4())')\",\"status\":\"requested\"}")"
refused "maker can't settle or erase a cash debt" "$(rest PATCH "cash_debts?producer_id=eq.$PRODUCER_ID" "$MAKER" '{"status":"settled"}')"
refused "maker can't approve their own closure" "$(rest PATCH "closure_requests?party_id=eq.$PRODUCER_ID" "$MAKER" '{"status":"approved"}')"
refused "driver can't change their own account_status" "$(rest PATCH "drivers?id=eq.$DRIVER_ID" "$DRIVER" '{"account_status":"active"}')"
refused "driver can't change their own phone" "$(rest PATCH "drivers?id=eq.$DRIVER_ID" "$DRIVER" '{"phone":"+254700000002"}')"
refused "driver can't change their share of a sale" "$(rest PATCH "transactions?id=eq.$OWN" "$DRIVER" '{"driver_amount":100000}')"
refused "driver can't lift a suspension" "$(rest DELETE "account_suspensions?party_id=eq.$DRIVER_ID" "$DRIVER")"
AFTER=$(q "select md5(string_agg(t::text, '|' order by t::text)) from (
  select row(p.*)::text as t from producers p union all select row(d.*)::text from drivers d
  union all select row(x.*)::text from transactions x union all select row(e.*)::text from wallet_ledger_entries e
  union all select row(w.*)::text from withdrawal_requests w) s;")
check "none of it changed producers, drivers, transactions, ledger or withdrawals" "$AFTER" "$BEFORE"
UPLOAD=$(curl -s -o /dev/null -w '%{http_code}' -m 60 -X POST "$SB_URL/storage/v1/object/qr-codes/security-probe.png" \
  -H "apikey: $SB_KEY" -H "Authorization: Bearer $MAKER" -H "Content-Type: image/png" --data-binary 'x')
check "maker can't upload to the qr-codes bucket" "$([[ "$UPLOAD" == 4* ]] && echo refused || echo "allowed ($UPLOAD)")" "refused"
check "no browser role holds any privilege but SELECT on any table" \
  "$(q "select count(*) from information_schema.role_table_grants where table_schema = 'public' and grantee in ('anon','authenticated') and privilege_type <> 'SELECT';")" "0"
check "no write policy is left on any table" "$(q "select count(*) from pg_policies where schemaname = 'public' and cmd <> 'SELECT';")" "0"

echo
echo "== Test 2: the secrets can't be read from the browser, Realtime included =="
check "transactions has no checkout_request_id or tourist_confirm_token column any more" \
  "$(q "select count(*) from information_schema.columns where table_name = 'transactions' and column_name in ('checkout_request_id','tourist_confirm_token');")" "0"
refused "maker can't read transaction_secrets" "$(rest GET "transaction_secrets?select=*" "$MAKER")"
refused "coordinator's browser can't read transaction_secrets" "$(rest GET "transaction_secrets?select=*" "$COORD_TOKEN")"
refused "nobody can read auth_credentials" "$(rest GET "auth_credentials?select=*" "$MAKER")"
OWN_ROW=$(curl -s -m 60 "$SB_URL/rest/v1/transactions?select=*&id=eq.$OWN" -H "apikey: $SB_KEY" -H "Authorization: Bearer $MAKER")
check "the maker still reads their own sale (select *), with no secret in it" \
  "$(echo "$OWN_ROW" | python3 -c "import json,sys; r=json.load(sys.stdin)[0]; print('ok' if 'checkout_request_id' not in r and 'tourist_confirm_token' not in r else 'leak')")" "ok"
check "Realtime streams no table that holds a secret" \
  "$(q "select count(*) from pg_publication_tables where pubname = 'supabase_realtime' and tablename in ('transaction_secrets','auth_credentials','stk_verifications');")" "0"

echo
echo "== Test 3: forged STK callbacks =="
SALE=$(PYTHONPATH=. .venv/bin/python scripts/simulate_mpesa_sale.py "$PRODUCER_ID" 200 -)
F_ID=$(echo "$SALE" | json "['id']"); need "sale to forge callbacks against" "$F_ID"; TXN_IDS+=("$F_ID")
F_CRID=$(echo "$SALE" | json "['checkout_request_id']"); F_TOKEN=$(echo "$SALE" | json "['callback_token']")
OLD=$(curl -s -o /dev/null -w '%{http_code}' -m 60 -X POST "$BASE_URL/daraja/stk-callback" -H "Content-Type: application/json" \
  -d "{\"Body\":{\"stkCallback\":{\"CheckoutRequestID\":\"$F_CRID\",\"ResultCode\":0,\"CallbackMetadata\":{\"Item\":[{\"Name\":\"Amount\",\"Value\":200}]}}}}")
check "the old unsigned URL no longer exists (404)" "$OLD" "404"
code_of() { curl -s -o /dev/null -w '%{http_code}' -m 60 -X POST "$BASE_URL/daraja/stk-callback/$1" -H "Content-Type: application/json" \
  -d "{\"Body\":{\"stkCallback\":{\"CheckoutRequestID\":\"$2\",\"ResultCode\":0,\"CallbackMetadata\":{\"Item\":[{\"Name\":\"Amount\",\"Value\":$3},{\"Name\":\"MpesaReceiptNumber\",\"Value\":\"FORGED\"}]}}}}"; }
NO_TOKEN=$(code_of "" "$F_CRID" 200)
check "no token at all is refused" "$([ "$NO_TOKEN" != 200 ] && echo refused || echo accepted) $(q "select status from transactions where id = '$F_ID';")" "refused initiated"
check "a made-up token is refused (403)" "$(code_of "$(python3 -c 'import secrets; print(secrets.token_hex(32))')" "$F_CRID" 200)" "403"
check "another sale's valid token is refused (403)" "$(code_of "$(callback_token "$OWN")" "$F_CRID" 200)" "403"
check "...and the sale is still unpaid, nothing credited" "$(q "select status from transactions where id = '$F_ID';") $(q "select count(*) from wallet_ledger_entries where transaction_id = '$F_ID';")" "initiated 0"
check "the right token with the wrong Amount is refused (400)" "$(code_of "$F_TOKEN" "$F_CRID" 20000)" "400"
check "...still unpaid, nothing credited, flagged" "$(q "select status from transactions where id = '$F_ID';") $(q "select count(*) from wallet_ledger_entries where transaction_id = '$F_ID';") $(q "select state from stk_verifications where transaction_id = '$F_ID';")" "initiated 0 amount_mismatch"
check "the right token and Amount is accepted (flag mode: credited)" "$(code_of "$F_TOKEN" "$F_CRID" 200) $(q "select status from transactions where id = '$F_ID';")" "200 confirmed"
echo "Waiting for the STK Push Query job to ask Safaricom (up to 90s)..."
for i in $(seq 1 30); do [ "$(q "select state from stk_verifications where transaction_id = '$F_ID';")" = "mismatch" ] && break; sleep 3; done
check "Safaricom says it doesn't exist, so it's flagged as a mismatch" "$(q "select state from stk_verifications where transaction_id = '$F_ID';")" "mismatch"
RECON=$(curl -s -m 60 "$BASE_URL/admin/reconciliation" -H "Authorization: Bearer $COORD_TOKEN")
check "the coordinator sees it under payment checks" "$(echo "$RECON" | python3 -c "import json,sys; print(any(c['transaction_id']=='$F_ID' and c['state']=='mismatch' for c in json.load(sys.stdin)['payment_checks']))")" "True"
check "a non-coordinator can't trigger a check (403)" "$(curl -s -o /dev/null -w '%{http_code}' -m 60 -X POST "$BASE_URL/admin/transactions/$F_ID/check-payment" -H "Authorization: Bearer $MAKER")" "403"

echo
echo "== Test 4: STK_QUERY_MODE=enforce =="
COLLECTED_BEFORE=$(curl -s -m 60 "$BASE_URL/admin/reconciliation" -H "Authorization: Bearer $COORD_TOKEN" | json "['totals']['collected']")
E1=$(PYTHONPATH=. .venv/bin/python scripts/simulate_mpesa_sale.py "$PRODUCER_ID" 100 -); E1_ID=$(echo "$E1" | json "['id']"); need "enforce-mode sale 1" "$E1_ID"; TXN_IDS+=("$E1_ID")
E2=$(PYTHONPATH=. .venv/bin/python scripts/simulate_mpesa_sale.py "$PRODUCER_ID" 100 -); E2_ID=$(echo "$E2" | json "['id']"); need "enforce-mode sale 2" "$E2_ID"; TXN_IDS+=("$E2_ID")
E3=$(PYTHONPATH=. .venv/bin/python scripts/simulate_mpesa_sale.py "$PRODUCER_ID" 100 -); E3_ID=$(echo "$E3" | json "['id']"); need "enforce-mode sale 3" "$E3_ID"; TXN_IDS+=("$E3_ID")
ENFORCE=$(PYTHONPATH=. .venv/bin/python - "$E1" "$E2" "$E3" <<'PY'
import asyncio, json, sys
from sqlalchemy import text
from app import verification
from app.db import async_session

sales = [json.loads(a) for a in sys.argv[1:]]

async def paid(_crid):        return {"ResultCode": "0", "ResultDesc": "The service request is processed successfully."}
async def processing(_crid):  return {"errorCode": "500.001.1001", "errorMessage": "The transaction is being processed"}

def payload(sale):
    return {"Body": {"stkCallback": {"CheckoutRequestID": sale["checkout_request_id"], "ResultCode": 0,
            "CallbackMetadata": {"Item": [{"Name": "Amount", "Value": int(float(sale["total_amount"]))},
                                          {"Name": "MpesaReceiptNumber", "Value": "SIM" + sale["id"][:8]}]}}}}

async def state(s, txn_id):
    return (await s.execute(text(
        "select t.status || ' ' || coalesce(v.state, '-') || ' ' || "
        "(select count(*) from wallet_ledger_entries e where e.transaction_id = t.id) "
        "from transactions t left join stk_verifications v on v.transaction_id = t.id where t.id = :id"), {"id": txn_id})).scalar_one()

async def main():
    out = []
    async with async_session() as s:
        for sale in sales:  # the callback, as the route handles it, in enforce mode
            code, _ = await verification.handle_stk_callback(s, sale["callback_token"], payload(sale), mode="enforce")
            # Keep the running API's scheduler off these: this script does each check itself.
            await s.execute(text("update stk_verifications set next_check_at = now() + interval '1 hour' "
                                 "where transaction_id = :id"), {"id": sale["id"]})
            await s.commit()
            out.append(f"{code} {await state(s, sale['id'])}")
        await s.commit()
        # 1: Safaricom confirms -> credited
        out.append(await verification.check_payment(s, sales[0]["id"], query=paid))
        out.append(await state(s, sales[0]["id"]))
        # 2: Safaricom never answers -> stays verifying, unanswered, nobody credited
        for _ in range(len(verification.RETRY_DELAYS) + 1):
            await verification.check_payment(s, sales[1]["id"], query=processing)
        out.append(await state(s, sales[1]["id"]))
        # 3: the real Daraja query: a simulated sale doesn't exist -> failed, nobody credited.
        # The sandbox rate-limits (429), which is "no answer yet": ask again, as the scheduler would.
        for _ in range(5):
            r3 = await verification.check_payment(s, sales[2]["id"])
            if r3 != "pending":
                break
            await asyncio.sleep(10)
        out.append(r3)
        out.append(await state(s, sales[2]["id"]))
    print("|".join(out))

asyncio.run(main())
PY
)
IFS='|' read -r CB1 CB2 CB3 R1 S1 S2 R3 S3 <<<"$ENFORCE"
check "enforce: a valid callback credits nobody yet ('verifying', 0 entries)" "$CB1 / $CB2 / $CB3" "200 verifying pending 0 / 200 verifying pending 0 / 200 verifying pending 0"
check "enforce: Safaricom confirms -> confirmed and credited" "$R1 $S1" "verified confirmed verified 1"
check "enforce: Safaricom never answers -> still verifying, unanswered, nobody credited" "$S2" "verifying unanswered 0"
check "enforce: Safaricom says no -> failed, nobody credited" "$R3 $S3" "mismatch failed mismatch 0"
RECON=$(curl -s -m 60 "$BASE_URL/admin/reconciliation" -H "Authorization: Bearer $COORD_TOKEN")
check "the coordinator sees the unanswered sale as 'Payment being verified'" "$(echo "$RECON" | python3 -c "import json,sys; print(any(c['transaction_id']=='$E2_ID' and c['transaction_status']=='verifying' and c['state']=='unanswered' for c in json.load(sys.stdin)['payment_checks']))")" "True"
check "collected counts only the confirmed one (+100), not the verifying or failed ones" \
  "$(echo "$RECON" | json "['totals']['collected']")" "$(python3 -c "from decimal import Decimal as D; print(D('$COLLECTED_BEFORE') + 100)")"
for i in 1 2 3 4; do  # a sandbox 429 or a stalled DB connection is "try again", as a coordinator would
  CHECK=$(curl -s -m 150 -X POST "$BASE_URL/admin/transactions/$E2_ID/check-payment" -H "Authorization: Bearer $COORD_TOKEN")
  [ "$(echo "$CHECK" | json "['state']")" = "mismatch" ] && break
  sleep 10
done
check "coordinator's Check again asks Safaricom: no such payment -> failed, nobody credited" \
  "$(echo "$CHECK" | json "['state']") $(echo "$CHECK" | json "['transaction_status']") $(q "select count(*) from wallet_ledger_entries where transaction_id = '$E2_ID';")" "mismatch failed 0"

echo
echo "== Summary: $PASS passed, $FAIL failed =="
[ "$FAIL" -eq 0 ]
