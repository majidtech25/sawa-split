#!/usr/bin/env bash
# Verifies migration 0002's RLS policies actually enforce CLAUDE.md section 5's
# permission matrix. Seeds its own fixtures, simulates each role via SET ROLE +
# request.jwt.claims (the same session variables PostgREST sets from a real JWT),
# and cleans up after itself.
# Usage: (set -a; source ../.env; set +a); ./verify_0002_rls.sh
set -uo pipefail

PASS=0
FAIL=0

run_psql() {
  psql "$DATABASE_URL" -tAX -v ON_ERROR_STOP=1 -c "$1" 2>&1
}

check_count() {
  # check_count "description" "sql returning rows" expected_row_count
  # sql is a multi-statement -c string (set role; set request.jwt.claims; select ...) —
  # the leading SET/SET status lines have to be stripped before counting data rows.
  local desc="$1" sql="$2" expected="$3"
  local out data actual
  out=$(psql "$DATABASE_URL" -tAX -c "$sql" 2>&1)
  data=$(echo "$out" | grep -v '^SET$' | grep -v '^\s*$')
  actual=$(echo "$data" | grep -c '|' || true)
  if [ "$actual" -eq 0 ] && [ -n "$data" ]; then
    actual=$(echo "$data" | wc -l)
  fi
  if [ "$actual" -eq "$expected" ]; then
    echo "PASS  $desc (got $actual row(s))"
    PASS=$((PASS+1))
  else
    echo "FAIL  $desc (expected $expected row(s), got $actual): $out"
    FAIL=$((FAIL+1))
  fi
}

check_error_contains() {
  local desc="$1" sql="$2" expect_substr="$3"
  local out status
  out=$(psql "$DATABASE_URL" -tAX -c "$sql" 2>&1)
  status=$?
  if [ "$status" -ne 0 ] && echo "$out" | grep -q "$expect_substr"; then
    echo "PASS  $desc -> correctly rejected"
    PASS=$((PASS+1))
  else
    echo "FAIL  $desc (expected rejection containing '$expect_substr'): $out"
    FAIL=$((FAIL+1))
  fi
}

PRODUCER_ID=$(uuidgen)
PRODUCER_PHONE="+254700000100"
OTHER_PRODUCER_ID=$(uuidgen)
DRIVER_ID=$(uuidgen)
TXN_ID=$(uuidgen)
LEDGER_ID=$(uuidgen)

echo "== Seeding fixtures =="
run_psql "insert into producers (id, name, phone, till, default_split_driver_pct, charges_product, charges_photo) values ('$PRODUCER_ID', 'RLS Test Producer', '$PRODUCER_PHONE', '000100', 30, true, false);" >/dev/null
run_psql "insert into producers (id, name, phone, till, default_split_driver_pct, charges_product, charges_photo) values ('$OTHER_PRODUCER_ID', 'RLS Other Producer', '+254700000199', '000199', 30, true, false);" >/dev/null
run_psql "insert into drivers (id, name, phone, till, qr_code) values ('$DRIVER_ID', 'RLS Test Driver', '+254700000101', '000101', 'QR-RLS-TEST');" >/dev/null
run_psql "insert into transactions (id, producer_id, driver_id, payment_method, product_enabled, product_amount, product_maker_amount, product_driver_amount, total_amount, maker_amount, driver_amount, status) values ('$TXN_ID', '$PRODUCER_ID', '$DRIVER_ID', 'mpesa', true, 100, 70, 30, 100, 70, 30, 'confirmed');" >/dev/null
run_psql "insert into wallet_ledger_entries (id, recipient_type, recipient_id, amount, status, transaction_id) values ('$LEDGER_ID', 'maker', '$PRODUCER_ID', 70, 'available', '$TXN_ID');" >/dev/null

echo
echo "== producers: anon denied, owner sees self, coordinator sees all =="
check_count "anon sees 0 producers" "set role anon; select id from producers;" 0
check_count "owner sees exactly their own row" "set role authenticated; set request.jwt.claims = '{\"phone\": \"$PRODUCER_PHONE\"}'; select id from producers;" 1
out=$(psql "$DATABASE_URL" -tAX -c "set role authenticated; set request.jwt.claims = '{\"phone\": \"nobody\", \"app_metadata\": {\"is_admin\": true}}'; select id from producers;" 2>&1)
count=$(echo "$out" | grep -v '^SET$' | grep -vc '^\s*$')
if [ "$count" -ge 2 ]; then
  echo "PASS  coordinator sees all producers (got $count, includes both seeded rows)"
  PASS=$((PASS+1))
else
  echo "FAIL  coordinator sees too few producers (got $count, expected >= 2): $out"
  FAIL=$((FAIL+1))
fi

echo
echo "== transactions: owner sees own, stranger sees none, tourist token is scoped =="
check_count "owner (producer) sees their transaction" "set role authenticated; set request.jwt.claims = '{\"phone\": \"$PRODUCER_PHONE\"}'; select id from transactions;" 1
check_count "unrelated phone sees nothing" "set role authenticated; set request.jwt.claims = '{\"phone\": \"+254700000000\"}'; select id from transactions;" 0
check_count "tourist with correct scoped claim sees exactly that txn" "set role authenticated; set request.jwt.claims = '{\"cash_confirm_transaction_id\": \"$TXN_ID\"}'; select id from transactions;" 1
check_count "tourist with wrong scoped claim sees nothing" "set role authenticated; set request.jwt.claims = '{\"cash_confirm_transaction_id\": \"00000000-0000-0000-0000-000000000000\"}'; select id from transactions;" 0

out=$(psql "$DATABASE_URL" -tAX -c "set role authenticated; set request.jwt.claims = '{\"cash_confirm_transaction_id\": \"$TXN_ID\"}'; update transactions set status = 'disputed' where id = '$TXN_ID';" 2>&1)
if echo "$out" | grep -q "UPDATE 1"; then
  echo "PASS  tourist with correct scoped claim can update exactly that txn"
  PASS=$((PASS+1))
else
  echo "FAIL  tourist scoped update did not affect 1 row: $out"
  FAIL=$((FAIL+1))
fi
run_psql "update transactions set status = 'confirmed' where id = '$TXN_ID';" >/dev/null

echo
echo "== wallet_ledger_entries: owner sees own, stranger sees none =="
check_count "owner sees their ledger entry" "set role authenticated; set request.jwt.claims = '{\"phone\": \"$PRODUCER_PHONE\"}'; select id from wallet_ledger_entries;" 1
check_count "unrelated phone sees nothing" "set role authenticated; set request.jwt.claims = '{\"phone\": \"+254700000000\"}'; select id from wallet_ledger_entries;" 0

echo
echo "== withdrawal_requests: owner can create own, not for someone else =="
out=$(psql "$DATABASE_URL" -tAX -c "set role authenticated; set request.jwt.claims = '{\"phone\": \"$PRODUCER_PHONE\"}'; insert into withdrawal_requests (recipient_type, recipient_id, amount, idempotency_key, status) values ('maker', '$PRODUCER_ID', 70, gen_random_uuid(), 'requested');" 2>&1)
if echo "$out" | grep -q "INSERT 0 1"; then
  echo "PASS  owner can create their own withdrawal_request"
  PASS=$((PASS+1))
else
  echo "FAIL  owner's own withdrawal_request insert failed: $out"
  FAIL=$((FAIL+1))
fi
check_error_contains "cannot create withdrawal_request for someone else's recipient_id" \
  "set role authenticated; set request.jwt.claims = '{\"phone\": \"$PRODUCER_PHONE\"}'; insert into withdrawal_requests (recipient_type, recipient_id, amount, idempotency_key, status) values ('maker', '$OTHER_PRODUCER_ID', 500, gen_random_uuid(), 'requested');" \
  "row-level security"

echo
echo "== qr-codes storage bucket: public read, coordinator-only write =="
out=$(psql "$DATABASE_URL" -tAX -c "set role anon; select bucket_id from storage.objects where bucket_id = 'qr-codes' limit 1;" 2>&1)
if [ $? -eq 0 ]; then
  echo "PASS  anon can read storage.objects for qr-codes without error"
  PASS=$((PASS+1))
else
  echo "FAIL  anon read of qr-codes was rejected: $out"
  FAIL=$((FAIL+1))
fi
check_error_contains "non-admin cannot write to qr-codes" \
  "set role authenticated; set request.jwt.claims = '{\"phone\": \"$PRODUCER_PHONE\"}'; insert into storage.objects (bucket_id, name) values ('qr-codes', 'verify-0002-test.png');" \
  "row-level security"

echo
echo "== Cleanup =="
run_psql "
delete from withdrawal_requests where recipient_id in ('$PRODUCER_ID','$OTHER_PRODUCER_ID');
delete from wallet_ledger_entries where id = '$LEDGER_ID';
delete from transactions where id = '$TXN_ID';
delete from drivers where id = '$DRIVER_ID';
delete from producers where id in ('$PRODUCER_ID','$OTHER_PRODUCER_ID');
" >/dev/null && echo "cleanup ok" || echo "cleanup FAILED — test rows may still be present"

echo
echo "== Summary: $PASS passed, $FAIL failed =="
[ "$FAIL" -eq 0 ]
