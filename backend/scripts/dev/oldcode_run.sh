#!/usr/bin/env bash
# Runs scripts/dev/oldcode_check.py: setup (branch code), check + probe (main's code), then cleans up
# this run's rows. Needs no API on :8000. Make the worktree first: git worktree add --detach <path> main
# Usage (from backend/): (set -a; source .env; set +a; bash scripts/dev/oldcode_run.sh <worktree of main>)
set -uo pipefail
case "${DATABASE_URL:-}" in *postgres.jmbktbcnwyshwobbkohl:*) ;; *) echo "FATAL: not the TEST project."; exit 1;; esac
if curl -s -m 3 -o /dev/null http://127.0.0.1:8000/health; then echo "FATAL: an API is running on :8000."; exit 1; fi
REPO=$(cd "$(dirname "$0")/../../.." && pwd)
WT=${1:?usage: oldcode_run.sh <worktree of main>}
export OLDCODE_STATE=$(mktemp)
export SB_URL=$(sed -n 's/^VITE_SUPABASE_URL=//p' $REPO/frontend/.env) SB_KEY=$(sed -n 's/^VITE_SUPABASE_PUBLISHABLE_KEY=//p' $REPO/frontend/.env)
q() { psql "$DATABASE_URL" -tAc "$1"; }
P=$(q "select id from producers where phone = '+254708374149'"); D=$(q "select id from drivers where phone = '+254799999003'")
STARTED_AT=$(q "select now()")
cleanup() {
  echo; echo "== Cleanup (rows since $STARTED_AT) =="
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -c "
    begin;
    create temp table run_txns on commit drop as
      select id from transactions where producer_id = '$P' and (created_at >= '$STARTED_AT'
        or open_sale_id in (select id from open_sales where producer_id = '$P' and created_at >= '$STARTED_AT'));
    delete from wallet_ledger_entries where transaction_id in (select id from run_txns)
      or settlement_id in (select id from cash_debts where transaction_id in (select id from run_txns));
    delete from cash_debts where transaction_id in (select id from run_txns);
    delete from transactions where id in (select id from run_txns);
    delete from open_sales where producer_id = '$P' and created_at >= '$STARTED_AT';
    delete from tour_joins where tour_id in (select id from tours where driver_id = '$D' and started_at >= '$STARTED_AT');
    delete from tours where driver_id = '$D' and started_at >= '$STARTED_AT';
    delete from login_failures where at >= '$STARTED_AT';
    commit;" && echo "cleanup ok" || echo "cleanup FAILED"
}
trap cleanup EXIT
echo "== setup (branch code) =="
(cd $REPO/backend && PYTHONPATH=. .venv/bin/python -u scripts/dev/oldcode_check.py setup) || { echo "setup FAILED"; exit 1; }
echo "== check (main's code) =="
(cd $WT/backend && PYTHONPATH=. $REPO/backend/.venv/bin/python -u $REPO/backend/scripts/dev/oldcode_check.py check); RC=$?
echo "== probe (main's code, rolled back) =="
(cd $WT/backend && PYTHONPATH=. $REPO/backend/.venv/bin/python -u $REPO/backend/scripts/dev/oldcode_check.py probe)
exit $RC
