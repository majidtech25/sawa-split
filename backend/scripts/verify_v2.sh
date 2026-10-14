#!/usr/bin/env bash
# Verifies SCOPE_V2 (migration 0017) on the TEST project, with no STK Push and no B2C:
# cash sales through the real API, M-Pesa through a simulated callback.
#   - referral codes (case-insensitive, old QR code still works) and stall codes;
#   - a maker's open sale: create, one at a time, whole shillings, photo fee;
#   - the stall page's public view and the server-computed breakdown, with and without
#     a referral code, and the rounding rule (referrer rounded down, parts add up);
#   - paying: cash with a code (Case A), cash without (Case B, maker 100%), M-Pesa
#     (simulated); a sale is held while paying and can't be paid twice;
#   - paid / cancelled / expired sales refuse payment and say why; a failed payment
#     releases the sale;
#   - reconciliation's sales count and commission per referrer;
#   - registration generates the codes, and a coordinator-registered account can log in
#     with the PIN it was registered with (SCOPE_V2 MUST 11).
# Usage (from backend/): (set -a; source .env; set +a; bash scripts/verify_v2.sh)
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
TEMP_MAKER_PHONE="+254799999091"
TEMP_DRIVER_PHONE="+254799999092"

PASS=0
FAIL=0
q() { psql "$DATABASE_URL" -tAc "$1"; }
json() { python3 -c "import json,sys; d=json.load(sys.stdin); print(d$1 if isinstance(d, dict) else '')" 2>/dev/null; }
source scripts/sim_mpesa.sh
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
login() {
  local r i
  for i in 1 2 3; do
    r=$(curl -s -m 60 -X POST "$BASE_URL/auth/login" -H "Content-Type: application/json" -d "{\"phone\":\"$1\",\"pin\":\"$2\"}")
    [[ "$r" == *access_token* ]] && break
    sleep 2
  done
  echo "$r"
}
# call <METHOD> <path> [token|-] [json body] -> "<http code> <body>"
call() {
  local auth=() body="${4:-}"
  [ "${3:--}" != "-" ] && auth=(-H "Authorization: Bearer $3")
  curl -s -m 60 -w '\n%{http_code}' -X "$1" "$BASE_URL$2" "${auth[@]}" -H "Content-Type: application/json" ${body:+-d "$body"} \
    | python3 -c "import sys; b,c=sys.stdin.read().rsplit('\n',1); print(c, b)"
}
code_of() { echo "${1%% *}"; }
body_of() { echo "${1#* }"; }
detail() { body_of "$1" | json "['detail']"; }
cleanup() {
  echo
  echo "== Cleanup: this run's sales, payments, ledger rows, debts and temporary accounts =="
  local temp_users
  temp_users=$(q "select string_agg(auth_user_id::text, ' ') from auth_credentials where phone in ('$TEMP_MAKER_PHONE', '$TEMP_DRIVER_PHONE');")
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -c "
    begin;
    delete from wallet_ledger_entries where transaction_id in (select id from transactions where open_sale_id in (select id from open_sales where created_at >= '$STARTED_AT'))
      or settlement_id in (select id from cash_debts where transaction_id in (select id from transactions where open_sale_id in (select id from open_sales where created_at >= '$STARTED_AT')));
    delete from cash_debts where transaction_id in (select id from transactions where open_sale_id in (select id from open_sales where created_at >= '$STARTED_AT'));
    delete from transactions where open_sale_id in (select id from open_sales where created_at >= '$STARTED_AT');
    delete from open_sales where created_at >= '$STARTED_AT';
    delete from producers where phone = '$TEMP_MAKER_PHONE';
    delete from drivers where phone = '$TEMP_DRIVER_PHONE';
    delete from auth_credentials where phone in ('$TEMP_MAKER_PHONE', '$TEMP_DRIVER_PHONE');
    delete from login_failures where at >= '$STARTED_AT';
    commit;" && CLEANUP_OK=1 && echo "database cleanup ok" || echo "database cleanup FAILED — test rows may still be present"
  for u in $temp_users; do
    curl -s -m 30 -o /dev/null -X DELETE "$(echo "$SUPABASE_URL" | sed -E 's#(https://[^/]+).*#\1#')/auth/v1/admin/users/$u" \
      -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY"
  done
  [ -n "$temp_users" ] && echo "temporary auth users removed"
  echo
  echo "== Summary: $PASS passed, $FAIL failed =="
  if [ -n "$SETUP_FAILED" ]; then
    echo "== RUN INVALID: setup step failed ($SETUP_FAILED). Checks after it prove nothing. =="; exit 1
  fi
  [ "$CLEANUP_OK" = 1 ] || { echo "== RUN FAILED: cleanup failed, test rows may be left in the database =="; exit 1; }
  [ "$FAIL" -eq 0 ] && exit 0 || exit 1
}

echo "== Logging in fixtures =="
P=$(login "$PRODUCER_PHONE" "$PRODUCER_PIN"); D=$(login "$DRIVER_PHONE" "$DRIVER_PIN"); C=$(login "$COORDINATOR_PHONE" "$COORDINATOR_PIN")
MAKER=$(echo "$P" | json "['access_token']"); PRODUCER_ID=$(echo "$P" | json "['producer_id']")
DRIVER=$(echo "$D" | json "['access_token']"); DRIVER_ID=$(echo "$D" | json "['driver_id']")
COORD=$(echo "$C" | json "['access_token']")
[ -n "$MAKER" ] && [ -n "$DRIVER" ] && [ -n "$COORD" ] || { echo "FATAL: could not log in the fixtures."; exit 1; }
BUSY=$(q "select (select count(*) from open_sales where producer_id = '$PRODUCER_ID' and status in ('open','paying'))
  + (select count(*) from wallet_ledger_entries where recipient_id in ('$PRODUCER_ID','$DRIVER_ID') and status in ('pending','available','frozen'))
  + (select count(*) from cash_debts where status = 'outstanding');")
[ "$BUSY" = "0" ] || { echo "FATAL: the fixtures already hold an open sale, a balance or a debt."; exit 1; }
STARTED_AT=$(q "select now();")
trap cleanup EXIT
REF_BEFORE=$(call GET /admin/reconciliation "$COORD" | cut -d' ' -f2- | python3 -c "import json,sys; d=json.load(sys.stdin); r=next(x for x in d['referrers'] if x['referral_code']=='JAMES'); print(r['sales'], r['commission'])")
need "reconciliation's referrer totals before" "$REF_BEFORE"

echo
echo "== Test 1: referral and stall codes =="
check "a referral code works in any case: james -> James (JAMES)" "$(body_of "$(call GET /public/drivers/james)" | json "['first_name']") $(body_of "$(call GET /public/drivers/james)" | json "['referral_code']")" "James JAMES"
check "the old QR code still works, and gives the referral code" "$(body_of "$(call GET /public/drivers/QR-DRIVER-001)" | json "['referral_code']")" "JAMES"
check "an unknown code is refused (404)" "$(code_of "$(call GET /public/drivers/NOBODY9)")" "404"
check "the driver's account shows their code" "$(body_of "$(call GET /accounts/me "$DRIVER")" | json "['referral_code']")" "JAMES"
check "the maker's account shows their stall code and photo fee" "$(body_of "$(call GET /accounts/me "$MAKER")" | json "['stall_code']") $(body_of "$(call GET /accounts/me "$MAKER")" | json "['photo_fee']")" "WANJIRU 10"

echo
echo "== Test 2: the maker creates an open sale =="
check "only a maker can create one (driver -> 403)" "$(code_of "$(call POST /sales "$DRIVER" '{"amount":100}')")" "403"
check "cents are refused (422)" "$(code_of "$(call POST /sales "$MAKER" '{"amount":100.5}')")" "422"
check "below KSh 50 is refused (422, rule 5)" "$(code_of "$(call POST /sales "$MAKER" '{"amount":30}')")" "422"
S1=$(call POST /sales "$MAKER" '{"amount":1000,"description":"Beaded necklace","photo":true}'); S1_ID=$(body_of "$S1" | json "['id']")
need "first open sale" "$S1_ID"
check "created: KSh 1000 + photo 10 = 1010, open" "$(code_of "$S1") $(body_of "$S1" | json "['total_amount']") $(body_of "$S1" | json "['status']")" "201 1010 open"
check "a second open sale is refused (409)" "$(code_of "$(call POST /sales "$MAKER" '{"amount":200}')")" "409"
STALL=$(call GET /public/stalls/wanjiru)
check "the stall page (any case) shows it" "$(body_of "$STALL" | json "['sale']['id']") $(body_of "$STALL" | json "['sale']['description']")" "$S1_ID Beaded necklace"
check "an unknown stall is 404" "$(code_of "$(call GET /public/stalls/NOSTALL)")" "404"

echo
echo "== Test 3: the server-computed breakdown =="
QJ=$(body_of "$(call GET "/public/sales/$S1_ID?ref=james")")
check "with JAMES (30%): referrer 300, maker 700 + photo 10, total 1010, first name only" \
  "$(echo "$QJ" | json "['driver']['name']") $(echo "$QJ" | json "['product']['driver_amount']") $(echo "$QJ" | json "['maker_amount']") $(echo "$QJ" | json "['photo']['amount']") $(echo "$QJ" | json "['total_amount']")" "James 300 710 10 1010"
QN=$(body_of "$(call GET "/public/sales/$S1_ID")")
check "no code: maker 100% (1010), referrer 0" "$(echo "$QN" | json "['maker_amount']") $(echo "$QN" | json "['driver_amount']") $(echo "$QN" | json "['driver']")" "1010 0 None"
QX=$(body_of "$(call GET "/public/sales/$S1_ID?ref=NOBODY9")")
check "an unknown code is reported, not applied" "$(echo "$QX" | json "['referral_error']" | cut -c1-30) $(echo "$QX" | json "['maker_amount']")" "That guide code isn't register 1010"

echo
echo "== Test 4: cash with a code (Case A); one payment at a time; paid can't be paid again =="
PAY=$(call POST "/public/sales/$S1_ID/pay" - '{"payment_method":"cash","referral_code":"james"}'); T1=$(body_of "$PAY" | json "['id']")
need "cash payment for the first sale" "$T1"
check "payment started: waiting for both confirmations, 300 to the referrer" "$(code_of "$PAY") $(body_of "$PAY" | json "['status']") $(body_of "$PAY" | json "['driver_amount']")" "201 cash_unconfirmed 300"
check "the sale is held while paying" "$(body_of "$(call GET /public/stalls/WANJIRU)" | json "['sale']['status']")" "paying"
check "a second payment is refused, and says why (409)" "$(code_of "$(call POST "/public/sales/$S1_ID/pay" - '{"payment_method":"cash"}')") $(detail "$(call POST "/public/sales/$S1_ID/pay" - '{"payment_method":"cash"}')")" "409 A payment for this sale is already in progress."
check "the maker can't cancel it mid-payment (409)" "$(code_of "$(call POST "/sales/$S1_ID/cancel" "$MAKER")")" "409"
check "the maker's screen: payment in progress, by James, cash" "$(body_of "$(call GET /sales/current "$MAKER")" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['status'], d['referrer_first_name'], d['payment_method'])")" "paying James cash"
call POST "/transactions/$T1/confirm" "$DRIVER" '{}' >/dev/null
check "driver + maker confirm the cash" "$(body_of "$(call POST "/transactions/$T1/confirm" "$MAKER" '{}')" | json "['status']")" "cash_confirmed"
check "the sale is paid; the stall waits for the next one" "$(body_of "$(call GET "/public/sales/$S1_ID")" | json "['sale']['status']") $(body_of "$(call GET /public/stalls/WANJIRU)" | json "['sale']")" "paid None"
check "a paid sale can't be paid again, and says so" "$(detail "$(call POST "/public/sales/$S1_ID/pay" - '{"payment_method":"cash"}')")" "This sale has already been paid."
check "cash rules unchanged: maker holds 710 in cash, owes James 300" \
  "$(q "select amount from wallet_ledger_entries where transaction_id = '$T1' and status = 'cash_held';") $(q "select amount from cash_debts where transaction_id = '$T1';")" "710 300"

echo
echo "== Test 5: no code -> maker 100% (cash Case B) =="
S2_ID=$(body_of "$(call POST /sales "$MAKER" '{"amount":333}')" | json "['id']"); need "second open sale" "$S2_ID"
Q2=$(body_of "$(call GET "/public/sales/$S2_ID?ref=JAMES")")
check "rounding: 30% of 333 -> referrer 99 (rounded down), maker 234; they add up" \
  "$(echo "$Q2" | json "['product']['driver_amount']") $(echo "$Q2" | json "['product']['maker_amount']") $(echo "$Q2" | json "['total_amount']")" "99 234 333"
P2=$(call POST "/public/sales/$S2_ID/pay" - '{"payment_method":"cash"}'); T2=$(body_of "$P2" | json "['id']"); TOK=$(body_of "$P2" | json "['tourist_confirm_token']")
need "cash payment without a code" "$T2"
curl -s -m 60 -X POST "$BASE_URL/transactions/$T2/confirm" -H "Content-Type: application/json" -d "{\"tourist_token\":\"$TOK\"}" >/dev/null
check "tourist + maker confirm" "$(body_of "$(call POST "/transactions/$T2/confirm" "$MAKER" '{}')" | json "['status']")" "cash_confirmed"
check "no referrer, maker gets all 333" "$(q "select coalesce(driver_id::text,'none') || ' ' || maker_amount || ' ' || driver_amount from transactions where id = '$T2';")" "none 333 0"

echo
echo "== Test 6: cancelled and expired sales refuse payment, and say why =="
S3_ID=$(body_of "$(call POST /sales "$MAKER" '{"amount":200}')" | json "['id']"); need "sale to cancel" "$S3_ID"
check "the maker cancels it" "$(body_of "$(call POST "/sales/$S3_ID/cancel" "$MAKER")" | json "['status']")" "cancelled"
check "...then paying it is refused" "$(detail "$(call POST "/public/sales/$S3_ID/pay" - '{"payment_method":"cash"}')")" "The seller cancelled this sale."
S4_ID=$(body_of "$(call POST /sales "$MAKER" '{"amount":200}')" | json "['id']"); need "sale to expire" "$S4_ID"
q "update open_sales set expires_at = now() - interval '1 second' where id = '$S4_ID';" >/dev/null
check "after 30 minutes paying is refused" "$(detail "$(call POST "/public/sales/$S4_ID/pay" - '{"payment_method":"cash"}')")" "This sale has expired. Ask the seller to enter it again."
check "...and it's marked expired" "$(q "select status from open_sales where id = '$S4_ID';")" "expired"

echo
echo "== Test 7: a failed payment releases the sale =="
S5_ID=$(body_of "$(call POST /sales "$MAKER" '{"amount":200}')" | json "['id']"); need "sale for the release test" "$S5_ID"
T5=$(body_of "$(call POST "/public/sales/$S5_ID/pay" - '{"payment_method":"cash","referral_code":"JAMES"}')" | json "['id']"); need "payment to let expire" "$T5"
q "update transactions set confirmation_deadline = now() - interval '1 second' where id = '$T5';" >/dev/null
PYTHONPATH=. .venv/bin/python -c "import asyncio; from app.payouts import expire_unconfirmed_cash; asyncio.run(expire_unconfirmed_cash())"
check "the unconfirmed cash payment expired and the sale is open again" "$(q "select status from transactions where id = '$T5';") $(q "select status from open_sales where id = '$S5_ID';")" "cash_expired open"
check "the maker can cancel it now" "$(body_of "$(call POST "/sales/$S5_ID/cancel" "$MAKER")" | json "['status']")" "cancelled"

echo
echo "== Test 8: M-Pesa for an open sale (simulated callback) =="
S6_ID=$(body_of "$(call POST /sales "$MAKER" '{"amount":500}')" | json "['id']"); need "sale for M-Pesa" "$S6_ID"
SIM=$(PYTHONPATH=. .venv/bin/python - "$S6_ID" "$DRIVER_ID" <<'PY'
# What POST /public/sales/<id>/pay does for M-Pesa, minus the STK Push.
import asyncio, json, sys, uuid
from decimal import Decimal
from sqlalchemy import text
from app import links, sales
from app.db import async_session
async def main():
    async with async_session() as s:
        sale = (await s.execute(text("select * from open_sales where id = :id"), {"id": sys.argv[1]})).one()
        pct = (await s.execute(text("select default_split_driver_pct from producers where id = :id"), {"id": sale.producer_id})).scalar_one()
        split = sales.compute_sale_split(sale.amount, sale.photo_fee, Decimal(pct), True)
        await s.execute(text("update open_sales set status = 'paying' where id = :id"), {"id": sale.id})
        tid = (await s.execute(text(
            "insert into transactions (producer_id, driver_id, payment_method, product_enabled, product_amount, product_maker_amount, "
            "product_driver_amount, photo_enabled, total_amount, maker_amount, driver_amount, status, open_sale_id) values "
            "(:p, :d, 'mpesa', true, :a, :pm, :pd, false, :t, :m, :dd, 'initiated', :s) returning id"),
            {"p": sale.producer_id, "d": sys.argv[2], "a": sale.amount, "pm": split["product_maker_amount"], "pd": split["product_driver_amount"],
             "t": split["total_amount"], "m": split["maker_amount"], "dd": split["driver_amount"], "s": sale.id})).scalar_one()
        crid = f"SIM-{uuid.uuid4()}"
        await s.execute(text("insert into transaction_secrets (transaction_id, checkout_request_id) values (:t, :c)"), {"t": tid, "c": crid})
        await s.commit()
        print(json.dumps({"id": str(tid), "crid": crid, "token": links.callback_token(tid)}))
asyncio.run(main())
PY
)
T6=$(echo "$SIM" | json "['id']"); need "simulated M-Pesa payment" "$T6"
stk_callback "$(echo "$SIM" | json "['token']")" "$(echo "$SIM" | json "['crid']")" 500 "SIM${T6:0:8}" >/dev/null
check "the callback credits it and the sale is paid" "$(q "select status from transactions where id = '$T6';") $(q "select status from open_sales where id = '$S6_ID';")" "confirmed paid"
check "M-Pesa split written: maker 350, referrer 150" "$(q "select maker_amount || ' ' || driver_amount from transactions where id = '$T6';")" "350 150"
# Rule 12, unchanged: this M-Pesa income covers the 300 Wanjiru owed James from Test 4's cash sale.
check "...and it settles Wanjiru's 300 cash debt to James at once (maker keeps 50 change)" \
  "$(q "select status from cash_debts where transaction_id = '$T1';") $(q "select amount from wallet_ledger_entries where transaction_id = '$T6' and recipient_type = 'maker' and status = 'available';")" "settled 50"

echo
echo "== Test 9: reconciliation per referrer =="
REF_AFTER=$(call GET /admin/reconciliation "$COORD" | cut -d' ' -f2- | python3 -c "import json,sys; d=json.load(sys.stdin); r=next(x for x in d['referrers'] if x['referral_code']=='JAMES'); print(r['sales'], r['commission'])")
check "JAMES: +2 sales (cash 300, M-Pesa 150), +450 commission" "$REF_AFTER" "$(python3 -c "from decimal import Decimal as D; s,c='$REF_BEFORE'.split(); print(int(s)+2, D(c)+450)")"
check "open_sales can't be read from the browser" "$(curl -s -m 60 "$SB_URL/rest/v1/open_sales?select=*" -H "apikey: $SB_KEY" -H "Authorization: Bearer $MAKER" | json "['code']")" "42501"

echo
echo "== Test 10: registration makes the codes; the account logs in with its PIN =="
RM=$(call POST /auth/onboard "$COORD" "{\"role\":\"producer\",\"phone\":\"$TEMP_MAKER_PHONE\",\"pin\":\"3434\",\"name\":\"Amani Test\",\"till\":\"91\",\"default_split_driver_pct\":25,\"charges_photo\":true,\"photo_fee\":20}")
check "a maker registered with a photo fee gets a stall code" "$(code_of "$RM") $(body_of "$RM" | json "['stall_code']")" "200 AMANI"
RD=$(call POST /auth/onboard "$COORD" "{\"role\":\"driver\",\"phone\":\"$TEMP_DRIVER_PHONE\",\"pin\":\"5656\",\"name\":\"James Test\",\"till\":\"92\",\"qr_code\":\"SAWA-DRV-V2TEST\"}")
check "a second James gets JAMES2 (codes stay unique)" "$(code_of "$RD") $(body_of "$RD" | json "['referral_code']")" "200 JAMES2"
check "the new maker logs in with the PIN they were registered with" "$(login "$TEMP_MAKER_PHONE" 3434 | json "['role']")" "producer"
check "the new driver logs in with theirs" "$(login "$TEMP_DRIVER_PHONE" 5656 | json "['role']")" "driver"
check "a photo fee without photo consent is refused (422)" \
  "$(code_of "$(call POST /auth/onboard "$COORD" "{\"role\":\"producer\",\"phone\":\"+254799999093\",\"pin\":\"1212\",\"name\":\"X\",\"till\":\"9\",\"default_split_driver_pct\":10,\"photo_fee\":5}")")" "422"
