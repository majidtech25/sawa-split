-- Cash-sale money gap (CLAUDE.md section 4 rules 10 and 12, as revised 2026-10-09).
--
-- Before: a confirmed cash sale credited the maker's and driver's shares as
-- 'available', so B2C paid them out of the M-Pesa account although the cash never
-- reached it: the maker kept the notes and was paid again, and a faked cash sale
-- drew on other tourists' M-Pesa money.
--
-- After: only M-Pesa money is ever payable.
--   - The maker's share of a cash sale is recorded as 'cash_held': the maker already
--     holds it, so it never enters their payable balance.
--   - The driver's share becomes a maker -> driver debt (cash_debts). It is settled
--     internally, never by B2C: whole available M-Pesa-sourced entries of the maker's
--     are marked 'transferred', and new entries (all amounts still > 0) credit the
--     driver and return the maker's change. Settled at confirmation if the maker
--     has enough, otherwise as soon as they do (STK credit, payout attempt, or sweep).
-- So the sum of payable entries (pending/available/frozen/paid) always equals the
-- M-Pesa money collected, and reconciliation compares like with like.

begin;

create table cash_debts (
  id             uuid primary key default gen_random_uuid(),
  transaction_id uuid unique not null references transactions(id),  -- one debt per cash sale
  producer_id    uuid not null references producers(id),             -- owes
  driver_id      uuid not null references drivers(id),               -- is owed
  amount         numeric not null check (amount > 0),                -- the sale's driver_amount
  status         text not null default 'outstanding' check (status in ('outstanding', 'settled')),
  created_at     timestamptz not null default now(),
  settled_at     timestamptz,
  constraint cash_debts_settled_at check ((status = 'settled') = (settled_at is not null))
);

create index cash_debts_producer_outstanding_idx on cash_debts (producer_id) where status = 'outstanding';
create index cash_debts_driver_outstanding_idx on cash_debts (driver_id) where status = 'outstanding';

alter table wallet_ledger_entries drop constraint wallet_ledger_entries_status_check;
alter table wallet_ledger_entries add constraint wallet_ledger_entries_status_check
  check (status in ('pending', 'available', 'paid', 'frozen', 'cash_held', 'transferred'));

-- Which settlement spent ('transferred') or created (the driver's credit and the
-- maker's change) an entry. Null for every other entry.
alter table wallet_ledger_entries add column settlement_id uuid references cash_debts(id);

-- RLS: a maker reads the debts they owe, a driver the debts owed to them; only the
-- API (direct connection, bypasses RLS) writes.
alter table cash_debts enable row level security;

create policy cash_debts_select_own_or_admin on cash_debts
  for select using (
    producer_id = public.own_producer_id()
    or driver_id = public.own_driver_id()
    or public.is_admin()
  );

alter publication supabase_realtime add table cash_debts;

commit;
