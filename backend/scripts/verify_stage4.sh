#!/usr/bin/env bash
# Verifies cash dual confirmation (CLAUDE.md rule 12) and the cash money rules from
# migration 0010, with no Daraja call at all: M-Pesa sales are simulated
# (scripts/simulate_mpesa_sale.py + a simulated callback to the real
# /daraja/stk-callback), cash sales go through the real API.
#   - A confirmed cash sale records the maker's share as 'cash_held', never payable,
#     and the driver's share as a debt the maker owes (Case A); Case B has no debt.
#   - The debt settles from the maker's M-Pesa earnings as soon as they cover it.
#   - No double payment: payable balances add up to M-Pesa money, never cash.
#   - A fake Case A cash sale nets the maker + driver pair zero.
#   - B2C is refused, loudly, if it would pay more than M-Pesa collected.
#   - An unconfirmed cash sale past its deadline writes nothing.
# Assumes the API is running locally and the stage-3 fixtures exist; refuses to run
# if the producer or driver fixture already holds a balance or debt.
#
# Usage (from backend/): (set -a; source .env; set +a; bash scripts/verify_stage4.sh)
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
TXN_IDS=()

q() { psql "$DATABASE_URL" -tAc "$1"; }
json() { python3 -c "import json,sys; d=json.load(sys.stdin); print(d$1 if isinstance(d, dict) else '')" 2>/dev/null; }
sig() { PYTHONPATH=. .venv/bin/python scripts/sign_link.py --sig "$@"; }
login() { curl -s -m 60 -X POST "$BASE_URL/auth/login" -H "Content-Type: application/json" -d "{\"phone\":\"$1\",\"pin\":\"$2\"}"; }
check() {
  local desc="$1" actual="$2" expected="$3"
  if [ "$actual" = "$expected" ]; then echo "PASS  $desc"; PASS=$((PASS+1))
  else echo "FAIL  $desc (expected '$expected', got '$actual')"; FAIL=$((FAIL+1)); fi
}
me() { curl -s -m 60 "$BASE_URL/accounts/me" -H "Authorization: Bearer $1" | json "['$2']"; }
recon() { curl -s -m 60 "$BASE_URL/admin/reconciliation" -H "Authorization: Bearer $COORD_TOKEN" | json "['totals']['$1']"; }
add() { python3 -c "from decimal import Decimal as D; import sys; print(sum(D(a) for a in sys.argv[1:]))" "$@"; }

# A simulated M-Pesa sale: created as STK initiate would, then confirmed by a
# simulated Daraja callback to the real endpoint. Prints the transaction id.
mpesa_sale() {
  local sale crid id
  sale=$(PYTHONPATH=. .venv/bin/python scripts/simulate_mpesa_sale.py "$@")
  id=$(echo "$sale" | json "['id']"); crid=$(echo "$sale" | json "['checkout_request_id']")
  stk_callback "$crid" "SIM${id:0:8}" >/dev/null
  echo "$id"
}
stk_callback() {
  curl -s -m 60 -X POST "$BASE_URL/daraja/stk-callback" -H "Content-Type: application/json" -d "{
    \"Body\": {\"stkCallback\": {\"CheckoutRequestID\": \"$1\", \"ResultCode\": 0, \"CallbackMetadata\": {\"Item\": [
      {\"Name\": \"MpesaReceiptNumber\", \"Value\": \"$2\"}]}}}}"
}
cash_sale() {  # cash_sale <product|-> <photo|-> [driver_id driver_qr] -> initiate response
  local driver_part="" product_part photo_part
  [ $# -ge 4 ] && driver_part="\"driver_id\":\"$3\","
  product_part=$([ "$1" = "-" ] && echo '"product_enabled":false' || echo "\"product_enabled\":true,\"product_amount\":$1")
  photo_part=$([ "$2" = "-" ] && echo '"photo_enabled":false' || echo "\"photo_enabled\":true,\"photo_amount\":$2")
  curl -s -m 60 -X POST "$BASE_URL/transactions/initiate" -H "Content-Type: application/json" \
    -d "{\"producer_id\":\"$PRODUCER_ID\",$driver_part\"payment_method\":\"cash\",$product_part,$photo_part,\"link_sig\":\"$(sig "$PRODUCER_ID" "$1" "$2" ${4:-})\"}"
}
confirm() {  # confirm <txn_id> <bearer token>
  curl -s -m 60 -X POST "$BASE_URL/transactions/$1/confirm" -H "Authorization: Bearer $2" -H "Content-Type: application/json" -d '{}' | json "['status']"
}
cleanup() {
  echo
  echo "== Cleanup: this run's ledger entries, debts, transactions and withdrawals =="
  local ids="" t
  for t in "${TXN_IDS[@]}"; do ids="$ids,'$t'"; done
  ids="${ids#,}"
  [ -z "$ids" ] && { echo "nothing to clean"; return; }
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -c "
    begin;
    delete from wallet_ledger_entries where transaction_id in ($ids)
      or settlement_id in (select id from cash_debts where transaction_id in ($ids));
    delete from cash_debts where transaction_id in ($ids);
    delete from transactions where id in ($ids);
    commit;" && echo "cleanup ok" || echo "cleanup FAILED — test rows may still be present"
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
[ "$(q "select default_split_driver_pct from producers where id = '$PRODUCER_ID';")" = "30" ] || { echo "FATAL: expected the producer fixture's driver split to be 30%."; exit 1; }
HELD=$(q "select count(*) from wallet_ledger_entries where recipient_id in ('$PRODUCER_ID','$DRIVER_ID') and status in ('pending','available','frozen')")
DEBTS=$(q "select count(*) from cash_debts where status = 'outstanding' and (producer_id = '$PRODUCER_ID' or driver_id = '$DRIVER_ID')")
[ "$HELD$DEBTS" = "00" ] || { echo "FATAL: the fixtures already hold a balance or debt; this script needs them at zero."; exit 1; }
COLLECTED_BEFORE=$(recon collected)
CASH_BEFORE=$(recon cash_recorded)
trap cleanup EXIT

echo
echo "== Test 1: Case A cash (driver + maker), product 200 at a 30% driver split =="
T1=$(cash_sale 200 - "$DRIVER_ID" "$DRIVER_QR"); T1_ID=$(echo "$T1" | json "['id']"); TXN_IDS+=("$T1_ID")
check "created cash_unconfirmed" "$(echo "$T1" | json "['status']")" "cash_unconfirmed"
check "driver alone does not complete it" "$(confirm "$T1_ID" "$DRIVER_TOKEN")" "cash_unconfirmed"
check "maker completes it" "$(confirm "$T1_ID" "$PRODUCER_TOKEN")" "cash_confirmed"
check "maker's 140 is recorded as cash held, not payable" "$(q "select status || ' ' || amount from wallet_ledger_entries where transaction_id = '$T1_ID' and recipient_type = 'maker';")" "cash_held 140.00"
check "no entry from the cash sale is payable" "$(q "select count(*) from wallet_ledger_entries where transaction_id = '$T1_ID' and status <> 'cash_held';")" "0"
check "driver's 60 is a debt the maker owes (nothing to settle it from yet)" "$(q "select status || ' ' || amount from cash_debts where transaction_id = '$T1_ID';")" "outstanding 60.00"
check "maker's payable is 0" "$(me "$PRODUCER_TOKEN" payable)" "0"
check "driver's payable is 0; the 60 is shown as owed by makers" "$(me "$DRIVER_TOKEN" payable) $(me "$DRIVER_TOKEN" owed_by_makers)" "0 60.00"
check "maker can't withdraw while owing a driver (422, no B2C call)" \
  "$(curl -s -o /dev/null -w '%{http_code}' -m 60 -X POST "$BASE_URL/withdrawals/request" -H "Authorization: Bearer $PRODUCER_TOKEN")" "422"

echo
echo "== Test 2: Case B cash (tourist + maker, no driver), product 150 + photo 20 =="
T2=$(cash_sale 150 20); T2_ID=$(echo "$T2" | json "['id']"); TXN_IDS+=("$T2_ID")
TOURIST_TOKEN=$(echo "$T2" | json "['tourist_confirm_token']")
check "maker_amount is the full 170 (no driver)" "$(echo "$T2" | json "['maker_amount']")" "170"
check "wrong tourist token rejected" "$(curl -s -o /dev/null -w '%{http_code}' -m 60 -X POST "$BASE_URL/transactions/$T2_ID/confirm" -H "Content-Type: application/json" -d '{"tourist_token":"wrong"}')" "403"
check "tourist token alone does not complete it" "$(curl -s -m 60 -X POST "$BASE_URL/transactions/$T2_ID/confirm" -H "Content-Type: application/json" -d "{\"tourist_token\":\"$TOURIST_TOKEN\"}" | json "['status']")" "cash_unconfirmed"
check "maker completes it" "$(confirm "$T2_ID" "$PRODUCER_TOKEN")" "cash_confirmed"
check "maker's 170 is cash held" "$(q "select status || ' ' || amount from wallet_ledger_entries where transaction_id = '$T2_ID';")" "cash_held 170"
check "Case B opens no debt" "$(q "select count(*) from cash_debts where transaction_id = '$T2_ID';")" "0"

echo
echo "== Test 3: the debt settles once the maker earns by M-Pesa (product 100, no driver) =="
M1_ID=$(mpesa_sale "$PRODUCER_ID" 100 -); TXN_IDS+=("$M1_ID")
check "simulated callback confirmed the M-Pesa sale" "$(q "select status from transactions where id = '$M1_ID';")" "confirmed"
check "the debt is settled" "$(q "select status from cash_debts where transaction_id = '$T1_ID';")" "settled"
check "the maker's 100 entry was transferred" "$(q "select status from wallet_ledger_entries where transaction_id = '$M1_ID' and settlement_id is not null and amount = 100;")" "transferred"
check "driver now has 60 payable, nothing owed" "$(me "$DRIVER_TOKEN" payable) $(me "$DRIVER_TOKEN" owed_by_makers)" "60.00 0"
check "maker keeps the 40 change" "$(me "$PRODUCER_TOKEN" payable)" "40.00"
M1_CRID=$(q "select checkout_request_id from transactions where id = '$M1_ID';")
stk_callback "$M1_CRID" "REPLAYED" >/dev/null
check "a redelivered callback credits nothing more (rule 7)" "$(me "$PRODUCER_TOKEN" payable) $(me "$DRIVER_TOKEN" payable)" "40.00 60.00"

echo
echo "== Test 4: no double payment: payable money is M-Pesa money only =="
COLLECTED=$(recon collected)
check "reconciliation 'collected' grew by the M-Pesa 100 only" "$COLLECTED" "$(add "$COLLECTED_BEFORE" 100)"
check "cash recorded separately: 200 + 170" "$(recon cash_recorded)" "$(add "$CASH_BEFORE" 370)"
check "maker + driver payable (40 + 60) equals the M-Pesa 100, not M-Pesa + cash" "$(add "$(me "$PRODUCER_TOKEN" payable)" "$(me "$DRIVER_TOKEN" payable)")" "100.00"
check "reconciliation balanced" "$(recon balanced)" "True"

echo
echo "== Test 5: a fake Case A cash sale nets the maker + driver pair zero =="
PAIR_BEFORE=$(add "$(me "$PRODUCER_TOKEN" payable)" "$(me "$DRIVER_TOKEN" payable)")
F=$(cash_sale 100 - "$DRIVER_ID" "$DRIVER_QR"); F_ID=$(echo "$F" | json "['id']"); TXN_IDS+=("$F_ID")
confirm "$F_ID" "$DRIVER_TOKEN" >/dev/null
check "colluding driver + maker confirm the fake sale" "$(confirm "$F_ID" "$PRODUCER_TOKEN")" "cash_confirmed"
check "its 30 debt settled at once from the maker's 40" "$(q "select status from cash_debts where transaction_id = '$F_ID';")" "settled"
check "driver gained 30 (60 -> 90), maker lost 30 (40 -> 10)" "$(me "$DRIVER_TOKEN" payable) $(me "$PRODUCER_TOKEN" payable)" "90.00 10.00"
check "the pair's combined payable is unchanged: net gain 0" "$(add "$(me "$PRODUCER_TOKEN" payable)" "$(me "$DRIVER_TOKEN" payable)")" "$PAIR_BEFORE"
check "M-Pesa collected unchanged by the fake sale" "$(recon collected)" "$COLLECTED"
check "still balanced" "$(recon balanced)" "True"

echo
echo "== Test 6: B2C refused, loudly, beyond what M-Pesa collected (no Daraja call) =="
CAP=$(PYTHONPATH=. .venv/bin/python - "$DRIVER_ID" <<'PY'
import asyncio, sys
from decimal import Decimal
from app.db import async_session
from app import payouts
async def attempt(amount):
    async with async_session() as s:
        await payouts.lock_money(s)
        try:
            await payouts._check_mpesa_cover(s, "driver", sys.argv[1], Decimal(amount))
            return "allowed"
        except payouts.PayoutCapExceeded:
            return "refused"
async def main():
    print(await attempt("90"), await attempt("91"), await attempt("1000000"))
asyncio.run(main())
PY
)
check "90 (the driver's own balance) allowed; 91 and 1,000,000 refused" "$CAP" "allowed refused refused"
check "no withdrawal rows were created" "$(q "select count(*) from withdrawal_requests where recipient_id in ('$PRODUCER_ID','$DRIVER_ID');")" "0"

echo
echo "== Test 7: an expired cash sale writes nothing =="
T3=$(cash_sale 100 -); T3_ID=$(echo "$T3" | json "['id']"); TXN_IDS+=("$T3_ID")
T3_TOKEN=$(echo "$T3" | json "['tourist_confirm_token']")
q "update transactions set confirmation_deadline = now() - interval '1 minute' where id = '$T3_ID';" >/dev/null
check "confirm after the deadline rejected" "$(curl -s -o /dev/null -w '%{http_code}' -m 60 -X POST "$BASE_URL/transactions/$T3_ID/confirm" -H "Content-Type: application/json" -d "{\"tourist_token\":\"$T3_TOKEN\"}")" "409"
check "flipped to cash_expired" "$(q "select status from transactions where id = '$T3_ID';")" "cash_expired"
check "no ledger entries, no debt" "$(q "select (select count(*) from wallet_ledger_entries where transaction_id = '$T3_ID') + (select count(*) from cash_debts where transaction_id = '$T3_ID');")" "0"

echo
echo "== Summary: $PASS passed, $FAIL failed =="
[ "$FAIL" -eq 0 ]
