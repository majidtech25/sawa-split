#!/usr/bin/env bash
# Verifies migration 0007: a producer's and a driver's REAL Supabase session JWTs
# (whose `phone` claim has no leading '+') resolve to their own rows under RLS.
# verify_0002_rls.sh missed this because it hand-writes claims with the '+'; this
# script logs in through the API instead and replays each token's actual claims via
# SET ROLE + request.jwt.claims (the same session variables PostgREST sets).
# Read-only: every query runs in a transaction that is rolled back.
#
# Requires: the API running locally and the stage-3 producer/driver fixtures.
# Usage (from backend/): (set -a; source .env; set +a; bash migrations/verify_0007_rls_phone.sh)
set -uo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:8000}"
PRODUCER_PHONE="${PRODUCER_PHONE:-+254708374149}"
PRODUCER_PIN="${PRODUCER_PIN:-1111}"
DRIVER_PHONE="${DRIVER_PHONE:-+254799999003}"
DRIVER_PIN="${DRIVER_PIN:-2222}"

PASS=0
FAIL=0

check() {
  local desc="$1" actual="$2" expected="$3"
  if [ "$actual" = "$expected" ]; then
    echo "PASS  $desc ($actual)"
    PASS=$((PASS+1))
  else
    echo "FAIL  $desc (expected '$expected', got '$actual')"
    FAIL=$((FAIL+1))
  fi
}

# Logs in and prints the access token's decoded claims as JSON.
claims_for() {
  curl -s -m 60 -X POST "$BASE_URL/auth/login" -H "Content-Type: application/json" \
    -d "{\"phone\":\"$1\",\"pin\":\"$2\"}" | python3 -c "
import base64, json, sys
p = json.load(sys.stdin)['access_token'].split('.')[1]
print(json.dumps(json.loads(base64.urlsafe_b64decode(p + '=' * (-len(p) % 4)))))"
}

# as_user "claims json" "select returning one value"
as_user() {
  psql "$DATABASE_URL" -qtAX -v ON_ERROR_STOP=1 -v claims="$1" <<EOF
begin;
select set_config('request.jwt.claims', :'claims', true) \g /dev/null
set local role authenticated;
$2;
rollback;
EOF
}

for role in producer driver; do
  if [ "$role" = producer ]; then phone=$PRODUCER_PHONE pin=$PRODUCER_PIN table=producers rtype=maker
  else phone=$DRIVER_PHONE pin=$DRIVER_PIN table=drivers rtype=driver; fi

  echo "== $role ($phone) =="
  CLAIMS=$(claims_for "$phone" "$pin")
  [ -n "$CLAIMS" ] || { echo "FATAL: could not log in $role"; exit 1; }
  check "$role JWT phone claim has no '+' (the case 0007 fixes)" \
    "$(echo "$CLAIMS" | python3 -c "import json,sys; print(json.load(sys.stdin)['phone'].startswith('+'))")" "False"

  ID=$(psql "$DATABASE_URL" -tAc "select id from $table where phone = '$phone';")
  check "$role sees exactly their own $table row" "$(as_user "$CLAIMS" "select count(*) from $table")" "1"
  check "...and it is theirs" "$(as_user "$CLAIMS" "select id from $table")" "$ID"

  EXPECTED_LEDGER=$(psql "$DATABASE_URL" -tAc "select count(*) from wallet_ledger_entries where recipient_type = '$rtype' and recipient_id = '$ID';")
  check "$role sees all of their own ledger entries" "$(as_user "$CLAIMS" "select count(*) from wallet_ledger_entries")" "$EXPECTED_LEDGER"
done

echo
echo "== unrelated phone still sees nothing =="
NOBODY='{"role": "authenticated", "phone": "254700000000"}'
check "producers" "$(as_user "$NOBODY" "select count(*) from producers")" "0"
check "drivers" "$(as_user "$NOBODY" "select count(*) from drivers")" "0"
check "wallet_ledger_entries" "$(as_user "$NOBODY" "select count(*) from wallet_ledger_entries")" "0"

echo
echo "== Summary: $PASS passed, $FAIL failed =="
[ "$FAIL" -eq 0 ]
