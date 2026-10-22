-- The fixed split and the Conservation fund (2026-10-22, SCOPE_V2 MUST 21, CLAUDE.md rule 4).
-- With SPLIT_MODEL=fixed an open sale's product price splits 80% creator, 15% site
-- intermediary, 5% Conservation fund (95/5 with no intermediary); photo consent stays 100%
-- creator. The fund is ring-fenced: its ledger entries are never paid out by B2C.
--
--   transactions.split_model  'legacy' (the coordinator-set %) or 'fixed', stored when the
--                             sale is created, so a late credit never re-splits it
--   transactions.fund_amount  the fund's share; 0 for every legacy sale
--   wallet_ledger_entries     a third recipient, 'fund', always with the one fund id below
--   cash_debts                a cash sale can now owe two creditors: the intermediary
--                             (creditor_type 'driver', driver_id set) and the fund
--                             (creditor_type 'fund', driver_id null); one debt per creditor
--
-- Additive only: every new column has a default that keeps today's meaning, so the code
-- before this keeps working beside it. The browser roles still read only (migration 0012);
-- RLS is unchanged, so fund rows are visible to coordinators only.

begin;

alter table transactions
  add column split_model text not null default 'legacy' check (split_model in ('legacy', 'fixed')),
  add column fund_amount numeric not null default 0 check (fund_amount >= 0);

alter table wallet_ledger_entries drop constraint wallet_ledger_entries_recipient_type_check;
alter table wallet_ledger_entries add constraint wallet_ledger_entries_recipient_type_check
  check (recipient_type in ('maker', 'driver', 'fund'));
-- There is one fund, with a fixed id (app/ledger.py FUND_ID).
alter table wallet_ledger_entries add constraint wallet_ledger_entries_fund_id
  check (recipient_type <> 'fund' or recipient_id = '00000000-0000-0000-0000-00000000f00d');

alter table cash_debts
  add column creditor_type text not null default 'driver' check (creditor_type in ('driver', 'fund')),
  alter column driver_id drop not null;
alter table cash_debts add constraint cash_debts_creditor
  check ((creditor_type = 'driver') = (driver_id is not null));
alter table cash_debts drop constraint cash_debts_transaction_id_key;
alter table cash_debts add constraint cash_debts_transaction_creditor_key unique (transaction_id, creditor_type);

commit;
