#!/usr/bin/env bash
# Verifies stage 5 end to end against the real Daraja sandbox: a real STK push, its
# real async callback, the ledger entry landing in 'available', then a real B2C
# payout and its real async callback landing the ledger entry in 'paid'.
#
# The STK payer defaults to Safaricom's sandbox test MSISDN (254708374149), but the
# sandbox no longer reliably auto-completes STK for it — requests sit "under
# processing" and never call back. Set STK_PAYER_MSISDN to a real Safaricom number
# and enter its M-Pesa PIN when the prompt arrives (sandbox charges nothing).
# Requires: the API running locally with DARAJA_CALLBACK_BASE_URL pointed at a live
# ngrok tunnel to this machine, and the stage-3 producer/driver fixtures.
#
# Usage (from backend/): (set -a; source .env; set +a; bash scripts/verify_stage5.sh)
# Exits non-zero if any check fails. If piping through tee, set -o pipefail first, or
# tee's own exit status replaces this script's.
set -uo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:8000}"
# The producer fixture's phone is the sandbox test MSISDN too: Test 3's B2C pays the
# producer's own phone, and the sandbox rejects any other number (ResultCode 2040).
PRODUCER_PHONE="${PRODUCER_PHONE:-+254708374149}"
PRODUCER_PIN="${PRODUCER_PIN:-1111}"
DRIVER_PHONE="${DRIVER_PHONE:-+254799999003}"
DRIVER_PIN="${DRIVER_PIN:-2222}"
STK_PAYER_MSISDN="${STK_PAYER_MSISDN:-254708374149}"  # STK payer leg only
WITHDRAWAL_ID=""

PASS=0
FAIL=0

# Price-card links are signed (app/links.py); sign each test sale's stall, prices and driver.
sig() { PYTHONPATH=. .venv/bin/python scripts/sign_link.py --sig "$@"; }

login() {
  curl -s -X POST "$BASE_URL/auth/login" -H "Content-Type: application/json" \
    -d "{\"phone\":\"$1\",\"pin\":\"$2\"}"
}

q() { psql "$DATABASE_URL" -tAc "$1"; }
json() { python3 -c "import json,sys; d=json.load(sys.stdin); print(d$1 if isinstance(d, dict) else '')" 2>/dev/null; }
source scripts/sim_mpesa.sh
check() {
  local desc="$1" actual="$2" expected="$3"
  if [ "$actual" = "$expected" ]; then
    echo "PASS  $desc"
    PASS=$((PASS+1))
  else
    echo "FAIL  $desc (expected '$expected', got '$actual')"
    FAIL=$((FAIL+1))
  fi
}

wait_for() {
  # wait_for "description" "sql" "expected value" max_seconds
  local desc="$1" sql="$2" expected="$3" max="$4" waited=0
  while [ "$waited" -lt "$max" ]; do
    actual=$(psql "$DATABASE_URL" -tAc "$sql")
    [ "$actual" = "$expected" ] && { check "$desc" "$actual" "$expected"; return; }
    sleep 3
    waited=$((waited+3))
  done
  check "$desc (timed out after ${max}s)" "$actual" "$expected"
}

echo "== Logging in fixtures =="
PRODUCER_LOGIN=$(login "$PRODUCER_PHONE" "$PRODUCER_PIN")
DRIVER_LOGIN=$(login "$DRIVER_PHONE" "$DRIVER_PIN")
PRODUCER_TOKEN=$(echo "$PRODUCER_LOGIN" | python3 -c "import json,sys; print(json.load(sys.stdin).get('access_token',''))")
PRODUCER_ID=$(echo "$PRODUCER_LOGIN" | python3 -c "import json,sys; print(json.load(sys.stdin).get('producer_id',''))")
DRIVER_ID=$(echo "$DRIVER_LOGIN" | python3 -c "import json,sys; print(json.load(sys.stdin).get('driver_id',''))")
DRIVER_QR=$(psql "$DATABASE_URL" -tAc "select qr_code from drivers where id = '$DRIVER_ID';")
[ -n "$PRODUCER_TOKEN" ] && [ -n "$PRODUCER_ID" ] && [ -n "$DRIVER_ID" ] || { echo "FATAL: could not log in fixtures — run this after stage 3's accounts exist."; exit 1; }

echo
echo "== Test 1: real STK push (product+photo, with driver) =="
echo ">>> Sending STK push to ${STK_PAYER_MSISDN:0:6}***${STK_PAYER_MSISDN: -3} now — enter the M-Pesa PIN when the prompt arrives."
TXN=$(curl -s -X POST "$BASE_URL/transactions/initiate" -H "Content-Type: application/json" \
  -d "{\"producer_id\":\"$PRODUCER_ID\",\"driver_id\":\"$DRIVER_ID\",\"payment_method\":\"mpesa\",\"phone\":\"$STK_PAYER_MSISDN\",\"product_enabled\":true,\"product_amount\":50,\"photo_enabled\":true,\"photo_amount\":10,\"link_sig\":\"$(sig "$PRODUCER_ID" 50 10 "$DRIVER_QR")\"}")
echo "$TXN"
TXN_ID=$(echo "$TXN" | python3 -c "import json,sys; print(json.load(sys.stdin)['id'])")
check "initiate: accepted, status initiated" "$(echo "$TXN" | python3 -c "import json,sys; print(json.load(sys.stdin)['status'])")" "initiated"
check "initiate: product_maker_amount" "$(echo "$TXN" | python3 -c "import json,sys; print(json.load(sys.stdin)['product_maker_amount'])")" "35.00"
check "initiate: product_driver_amount" "$(echo "$TXN" | python3 -c "import json,sys; print(json.load(sys.stdin)['product_driver_amount'])")" "15.00"

echo "Waiting for Daraja's real async callback (up to 90s)..."
wait_for "stk-callback: transaction reaches 'confirmed'" "select status from transactions where id = '$TXN_ID';" "confirmed" 90

RECEIPT=$(psql "$DATABASE_URL" -tAc "select stk_receipt from transactions where id = '$TXN_ID';")
echo "M-Pesa receipt: $RECEIPT"
check "stk-callback: a real receipt was recorded" "$([ -n "$RECEIPT" ] && echo yes || echo no)" "yes"

LEDGER_STATUSES=$(psql "$DATABASE_URL" -tAc "select distinct status from wallet_ledger_entries where transaction_id = '$TXN_ID';")
check "ledger entries landed in 'available' (section 6 step 3)" "$LEDGER_STATUSES" "available"
MAKER_AMOUNT=$(psql "$DATABASE_URL" -tAc "select amount from wallet_ledger_entries where transaction_id = '$TXN_ID' and recipient_type = 'maker';")
DRIVER_AMOUNT=$(psql "$DATABASE_URL" -tAc "select amount from wallet_ledger_entries where transaction_id = '$TXN_ID' and recipient_type = 'driver';")
check "ledger: maker amount (35 product + 10 photo)" "$MAKER_AMOUNT" "45.00"
check "ledger: driver amount" "$DRIVER_AMOUNT" "15.00"

echo
echo "== Test 2: idempotency — a redelivered callback must not double-credit (rule 7) =="
if [ -z "$RECEIPT" ]; then
  # Without a real callback first, this "redelivery" would be the first delivery —
  # it would confirm and credit the transaction itself, proving nothing about rule 7.
  echo "SKIP  no real STK callback landed in Test 1, so there is nothing to redeliver"
else
CHECKOUT_ID=$(psql "$DATABASE_URL" -tAc "select checkout_request_id from transaction_secrets where transaction_id = '$TXN_ID';")
# Replayed to the sale's own signed callback URL, as a genuine redelivery would be.
stk_callback "$(callback_token "$TXN_ID")" "$CHECKOUT_ID" 60 "REPLAYED" >/dev/null
LEDGER_COUNT=$(psql "$DATABASE_URL" -tAc "select count(*) from wallet_ledger_entries where transaction_id = '$TXN_ID';")
check "redelivered callback did not create extra ledger entries" "$LEDGER_COUNT" "2"
RECEIPT_AFTER=$(psql "$DATABASE_URL" -tAc "select stk_receipt from transactions where id = '$TXN_ID';")
check "redelivered callback did not overwrite the original receipt" "$RECEIPT_AFTER" "$RECEIPT"
fi

echo
echo "== Test 3: real B2C payout + callback (producer withdraws the balance just earned) =="
if [ -z "$RECEIPT" ]; then
  # Test 1 credited nothing, so a withdrawal here would only pay out pre-existing
  # balance — a real sandbox payout that proves nothing about this run's split.
  echo "SKIP  Test 1 credited nothing, so there is no just-earned balance to withdraw"
else
WITHDRAWAL=$(curl -s -X POST "$BASE_URL/withdrawals/request" -H "Authorization: Bearer $PRODUCER_TOKEN")
echo "$WITHDRAWAL"
WITHDRAWAL_ID=$(echo "$WITHDRAWAL" | python3 -c "import json,sys; print(json.load(sys.stdin)['id'])")
check "withdrawal accepted, status processing" "$(echo "$WITHDRAWAL" | python3 -c "import json,sys; print(json.load(sys.stdin)['status'])")" "processing"

echo "Waiting for Daraja's real async B2C callback (up to 90s)..."
wait_for "b2c-callback: withdrawal reaches 'paid'" "select status from withdrawal_requests where id = '$WITHDRAWAL_ID';" "paid" 90
B2C_RECEIPT=$(psql "$DATABASE_URL" -tAc "select b2c_receipt from withdrawal_requests where id = '$WITHDRAWAL_ID';")
check "b2c-callback: a real receipt was recorded" "$([ -n "$B2C_RECEIPT" ] && echo yes || echo no)" "yes"
MAKER_LEDGER_STATUS=$(psql "$DATABASE_URL" -tAc "select status from wallet_ledger_entries where transaction_id = '$TXN_ID' and recipient_type = 'maker';")
check "the maker's ledger entry reached 'paid'" "$MAKER_LEDGER_STATUS" "paid"
fi

echo
echo "== Cleanup: removing this run's transaction, ledger entries, and withdrawal =="
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "
$([ -n "$WITHDRAWAL_ID" ] && echo "delete from withdrawal_requests where id = '$WITHDRAWAL_ID';")
delete from wallet_ledger_entries where transaction_id = '$TXN_ID';
delete from transactions where id = '$TXN_ID';
" >/dev/null && echo "cleanup ok" || echo "cleanup FAILED — test rows may still be present"

echo
echo "== Summary: $PASS passed, $FAIL failed =="
[ "$FAIL" -eq 0 ]
