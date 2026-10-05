#!/usr/bin/env bash
# Verifies the cash dual-confirmation path (CLAUDE.md rule 12) still writes ledger
# entries split per section 4, now landing directly in 'available' (section 6 step 3,
# resolved in stage 5 — see app/ledger.py). Originally also covered the fake M-Pesa
# confirm from stage 4 — stage 5 replaced fake-confirm with the real Daraja STK
# callback, so that coverage moved to verify_stage5.sh instead. Assumes the API is
# running locally (uvicorn app.main:app on :8000) and that the stage-3
# coordinator/producer/driver fixtures exist (phones below) — override via env vars
# if yours differ.
#
# Usage: (set -a; source ../.env; set +a); bash scripts/verify_stage4.sh
set -uo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:8000}"
PRODUCER_PHONE="${PRODUCER_PHONE:-+254799999002}"
PRODUCER_PIN="${PRODUCER_PIN:-1111}"
DRIVER_PHONE="${DRIVER_PHONE:-+254799999003}"
DRIVER_PIN="${DRIVER_PIN:-2222}"

PASS=0
FAIL=0

login() {
  curl -s -X POST "$BASE_URL/auth/login" -H "Content-Type: application/json" \
    -d "{\"phone\":\"$1\",\"pin\":\"$2\"}" | python3 -c "import json,sys; print(json.load(sys.stdin).get('access_token',''))"
}

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

echo "== Logging in fixtures =="
PRODUCER_TOKEN=$(login "$PRODUCER_PHONE" "$PRODUCER_PIN")
DRIVER_TOKEN=$(login "$DRIVER_PHONE" "$DRIVER_PIN")
[ -n "$PRODUCER_TOKEN" ] && [ -n "$DRIVER_TOKEN" ] || { echo "FATAL: could not log in one or more fixtures — run this after stage 3's accounts exist."; exit 1; }

# Resolve producer_id / driver_id from their own login responses.
PRODUCER_ID=$(curl -s -X POST "$BASE_URL/auth/login" -H "Content-Type: application/json" -d "{\"phone\":\"$PRODUCER_PHONE\",\"pin\":\"$PRODUCER_PIN\"}" | python3 -c "import json,sys; print(json.load(sys.stdin)['producer_id'])")
DRIVER_ID=$(curl -s -X POST "$BASE_URL/auth/login" -H "Content-Type: application/json" -d "{\"phone\":\"$DRIVER_PHONE\",\"pin\":\"$DRIVER_PIN\"}" | python3 -c "import json,sys; print(json.load(sys.stdin)['driver_id'])")

echo
echo "== Test 1: Case A cash (driver + maker) =="
TXN1=$(curl -s -X POST "$BASE_URL/transactions/initiate" -H "Content-Type: application/json" \
  -d "{\"producer_id\":\"$PRODUCER_ID\",\"driver_id\":\"$DRIVER_ID\",\"payment_method\":\"cash\",\"product_enabled\":true,\"product_amount\":200}")
TXN1_ID=$(echo "$TXN1" | python3 -c "import json,sys; print(json.load(sys.stdin)['id'])")
check "Case A: created cash_unconfirmed" "$(echo "$TXN1" | python3 -c "import json,sys; print(json.load(sys.stdin)['status'])")" "cash_unconfirmed"

R=$(curl -s -X POST "$BASE_URL/transactions/$TXN1_ID/confirm" -H "Authorization: Bearer $DRIVER_TOKEN" -H "Content-Type: application/json" -d '{}')
check "Case A: driver alone does not complete it" "$(echo "$R" | python3 -c "import json,sys; print(json.load(sys.stdin)['status'])")" "cash_unconfirmed"
R=$(curl -s -X POST "$BASE_URL/transactions/$TXN1_ID/confirm" -H "Authorization: Bearer $PRODUCER_TOKEN" -H "Content-Type: application/json" -d '{}')
check "Case A: maker completes it" "$(echo "$R" | python3 -c "import json,sys; print(json.load(sys.stdin)['status'])")" "cash_confirmed"
LEDGER_STATUSES=$(psql "$DATABASE_URL" -tAc "select distinct status from wallet_ledger_entries where transaction_id = '$TXN1_ID';")
check "Case A: ledger entries land directly in 'available'" "$LEDGER_STATUSES" "available"

echo
echo "== Test 2: Case B cash (tourist + maker, no driver) =="
TXN2=$(curl -s -X POST "$BASE_URL/transactions/initiate" -H "Content-Type: application/json" \
  -d "{\"producer_id\":\"$PRODUCER_ID\",\"payment_method\":\"cash\",\"product_enabled\":true,\"product_amount\":150,\"photo_enabled\":true,\"photo_amount\":20}")
TXN2_ID=$(echo "$TXN2" | python3 -c "import json,sys; print(json.load(sys.stdin)['id'])")
TOURIST_TOKEN=$(echo "$TXN2" | python3 -c "import json,sys; print(json.load(sys.stdin)['tourist_confirm_token'])")
check "Case B: product_driver_amount is 0 (no driver)" "$(echo "$TXN2" | python3 -c "import json,sys; print(json.load(sys.stdin)['product_driver_amount'])")" "0"
check "Case B: maker_amount includes full product + photo" "$(echo "$TXN2" | python3 -c "import json,sys; print(json.load(sys.stdin)['maker_amount'])")" "170"

STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE_URL/transactions/$TXN2_ID/confirm" -H "Content-Type: application/json" -d '{"tourist_token":"wrong"}')
check "Case B: wrong tourist token rejected" "$STATUS" "403"
R=$(curl -s -X POST "$BASE_URL/transactions/$TXN2_ID/confirm" -H "Content-Type: application/json" -d "{\"tourist_token\":\"$TOURIST_TOKEN\"}")
check "Case B: correct tourist token alone does not complete it" "$(echo "$R" | python3 -c "import json,sys; print(json.load(sys.stdin)['status'])")" "cash_unconfirmed"
R=$(curl -s -X POST "$BASE_URL/transactions/$TXN2_ID/confirm" -H "Authorization: Bearer $PRODUCER_TOKEN" -H "Content-Type: application/json" -d '{}')
check "Case B: maker completes it" "$(echo "$R" | python3 -c "import json,sys; print(json.load(sys.stdin)['status'])")" "cash_confirmed"

echo
echo "== Test 3: expired cash transaction writes no ledger entries =="
TXN3=$(curl -s -X POST "$BASE_URL/transactions/initiate" -H "Content-Type: application/json" \
  -d "{\"producer_id\":\"$PRODUCER_ID\",\"payment_method\":\"cash\",\"product_enabled\":true,\"product_amount\":100}")
TXN3_ID=$(echo "$TXN3" | python3 -c "import json,sys; print(json.load(sys.stdin)['id'])")
TOURIST_TOKEN3=$(echo "$TXN3" | python3 -c "import json,sys; print(json.load(sys.stdin)['tourist_confirm_token'])")
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "update transactions set confirmation_deadline = now() - interval '1 minute' where id = '$TXN3_ID';" >/dev/null
STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE_URL/transactions/$TXN3_ID/confirm" -H "Content-Type: application/json" -d "{\"tourist_token\":\"$TOURIST_TOKEN3\"}")
check "expired: confirm attempt rejected" "$STATUS" "409"
DB_STATUS=$(psql "$DATABASE_URL" -tAc "select status from transactions where id = '$TXN3_ID';")
check "expired: flipped to cash_expired in DB" "$DB_STATUS" "cash_expired"
LEDGER_COUNT=$(psql "$DATABASE_URL" -tAc "select count(*) from wallet_ledger_entries where transaction_id = '$TXN3_ID';")
check "expired: zero ledger entries written" "$LEDGER_COUNT" "0"

echo
echo "== Cleanup: removing this run's test transactions and ledger entries =="
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "
delete from wallet_ledger_entries where transaction_id in ('$TXN1_ID','$TXN2_ID','$TXN3_ID');
delete from transactions where id in ('$TXN1_ID','$TXN2_ID','$TXN3_ID');
" >/dev/null && echo "cleanup ok" || echo "cleanup FAILED — test rows may still be present"

echo
echo "== Summary: $PASS passed, $FAIL failed =="
[ "$FAIL" -eq 0 ]
