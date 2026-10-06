#!/usr/bin/env bash
# Verifies migration 0001: inserts one valid row per table (FK order), then
# deliberately violates the three named constraints to confirm they hold.
# Usage: (set -a; source ../.env; set +a); ./verify_0001.sh
set -uo pipefail

PASS=0
FAIL=0

run_ok() {
  local desc="$1" sql="$2"
  local out status
  out=$(psql "$DATABASE_URL" -tAX -v ON_ERROR_STOP=1 -c "$sql" 2>&1)
  status=$?
  if [ "$status" -eq 0 ]; then
    echo "PASS  $desc"
    PASS=$((PASS+1))
  else
    echo "FAIL  $desc (expected success, got error):"
    echo "      $out"
    FAIL=$((FAIL+1))
  fi
}

run_fails() {
  local desc="$1" sql="$2" expect_substr="$3"
  local out status
  out=$(psql "$DATABASE_URL" -tAX -c "$sql" 2>&1)
  status=$?
  if [ "$status" -ne 0 ] && echo "$out" | grep -q "$expect_substr"; then
    echo "PASS  $desc -> correctly rejected: $(echo "$out" | grep "$expect_substr")"
    PASS=$((PASS+1))
  elif [ "$status" -eq 0 ]; then
    echo "FAIL  $desc (expected rejection, but insert SUCCEEDED)"
    FAIL=$((FAIL+1))
  else
    echo "FAIL  $desc (rejected, but not for the expected reason):"
    echo "      $out"
    FAIL=$((FAIL+1))
  fi
}

# IDs generated client-side so inserts don't need RETURNING (whose output is
# awkward to parse reliably alongside psql's own command-status lines).
PRODUCER_ID=$(uuidgen)
DRIVER_ID=$(uuidgen)
TXN_ID=$(uuidgen)
LEDGER_ID=$(uuidgen)
WITHDRAWAL_ID=$(uuidgen)
SYNC_ID=$(uuidgen)

echo "== Valid inserts, one per table (FK dependency order) =="

run_ok "insert producers" \
  "insert into producers (id, name, phone, till, site, default_split_driver_pct, charges_product, charges_photo) values ('$PRODUCER_ID', 'Wanjiru Beadwork', '+254700000001', '000001', 'Talek gate', 30, true, true);"

run_ok "insert drivers" \
  "insert into drivers (id, name, phone, till, qr_code) values ('$DRIVER_ID', 'James Driver', '+254700000002', '000002', 'QR-VERIFY-0001');"

run_ok "insert transactions" \
  "insert into transactions (id, producer_id, driver_id, payment_method, product_enabled, product_amount, product_maker_amount, product_driver_amount, photo_enabled, photo_amount, total_amount, maker_amount, driver_amount, status) values ('$TXN_ID', '$PRODUCER_ID', '$DRIVER_ID', 'mpesa', true, 100, 70, 30, true, 10, 110, 80, 30, 'confirmed');"

run_ok "insert wallet_ledger_entries" \
  "insert into wallet_ledger_entries (id, recipient_type, recipient_id, amount, status, transaction_id) values ('$LEDGER_ID', 'maker', '$PRODUCER_ID', 80, 'pending', '$TXN_ID');"

run_ok "insert withdrawal_requests" \
  "insert into withdrawal_requests (id, recipient_type, recipient_id, amount, idempotency_key, status) values ('$WITHDRAWAL_ID', 'maker', '$PRODUCER_ID', 80, gen_random_uuid(), 'requested');"

run_ok "insert sync_queue_items" \
  "insert into sync_queue_items (id, payload, idempotency_key) values ('$SYNC_ID', '{\"note\": \"manual verification row\"}'::jsonb, gen_random_uuid());"

echo
echo "== Constraint checks: deliberately invalid inserts should be rejected =="

run_fails "producers_at_least_one_component" \
  "insert into producers (name, phone, till, default_split_driver_pct, charges_product, charges_photo) values ('No Component Producer', '+254700000099', '000099', 20, false, false);" \
  "producers_at_least_one_component"

run_fails "producers default_split_driver_pct <= 40" \
  "insert into producers (name, phone, till, default_split_driver_pct, charges_product, charges_photo) values ('Over Cap Producer', '+254700000098', '000098', 45, true, false);" \
  "producers_default_split_driver_pct_check"

run_fails "transactions_at_least_one_component" \
  "insert into transactions (producer_id, driver_id, payment_method, product_enabled, photo_enabled, total_amount, maker_amount, driver_amount, status) values ('$PRODUCER_ID', '$DRIVER_ID', 'mpesa', false, false, 100, 100, 0, 'confirmed');" \
  "transactions_at_least_one_component"

echo
echo "== Cleanup: removing the test rows inserted above =="
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "
delete from wallet_ledger_entries where id = '$LEDGER_ID';
delete from withdrawal_requests where id = '$WITHDRAWAL_ID';
delete from transactions where id = '$TXN_ID';
delete from sync_queue_items where id = '$SYNC_ID';
delete from drivers where id = '$DRIVER_ID';
delete from producers where id = '$PRODUCER_ID';
" >/dev/null && echo "cleanup ok" || echo "cleanup FAILED — test rows may still be present"

echo
echo "== Summary: $PASS passed, $FAIL failed =="
[ "$FAIL" -eq 0 ]
