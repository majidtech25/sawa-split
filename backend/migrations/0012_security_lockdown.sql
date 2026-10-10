-- Security lockdown (2026-10-09, CLAUDE.md section 5).
--
-- 1. No direct writes from the browser, for anyone. Supabase grants anon and
--    authenticated full INSERT/UPDATE/DELETE/TRUNCATE on every public table by
--    default, so the only barrier was RLS, and 0002 had left write policies that let a
--    maker or driver UPDATE any column of their own transactions (amounts included)
--    and INSERT their own withdrawal rows, and let a coordinator's browser write
--    money tables directly. The frontend never writes a table itself: every legitimate
--    change goes through the API, which connects directly and isn't affected. So the
--    privileges themselves are revoked, the write policies dropped, and the default
--    privileges for future tables changed to match. Storage is unchanged: the
--    qr-codes bucket stays coordinator-only write (0003).
-- 2. Secrets out of the browser's reach. checkout_request_id (enough to aim a forged
--    STK callback) and tourist_confirm_token (Case B confirmation) move from
--    transactions, which makers and drivers read and receive over Realtime, to
--    transaction_secrets, which no browser role can read at all.
-- 3. STK Push Query verification (STK_QUERY_MODE): 'verifying' transaction status,
--    and stk_verifications to track each check and flag mismatches.

begin;

-- 2. Secrets ----------------------------------------------------------------------

create table transaction_secrets (
  transaction_id        uuid primary key references transactions(id) on delete cascade,
  checkout_request_id   text unique,   -- M-Pesa: Daraja's id for the STK Push, matched by the callback
  tourist_confirm_token text unique    -- cash Case B: the tourist's confirmation token
);
insert into transaction_secrets (transaction_id, checkout_request_id, tourist_confirm_token)
  select id, checkout_request_id, tourist_confirm_token from transactions
  where checkout_request_id is not null or tourist_confirm_token is not null;
alter table transactions drop column checkout_request_id;
alter table transactions drop column tourist_confirm_token;

-- 3. STK Push Query verification ----------------------------------------------------

alter table transactions drop constraint transactions_status_check;
alter table transactions add constraint transactions_status_check
  check (status in ('initiated', 'verifying', 'confirmed', 'failed', 'disputed',
                    'cash_unconfirmed', 'cash_confirmed', 'cash_expired'));

create table stk_verifications (
  transaction_id  uuid primary key references transactions(id) on delete cascade,
  mode            text not null check (mode in ('flag', 'enforce')),   -- STK_QUERY_MODE when the callback arrived
  state           text not null default 'pending'
                    check (state in ('pending', 'verified', 'mismatch', 'unanswered', 'amount_mismatch')),
  attempts        int not null default 0,
  next_check_at   timestamptz not null default now(),
  callback_amount numeric,              -- the Amount the callback claimed
  last_result     jsonb,                -- Safaricom's last answer, for the coordinator
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index stk_verifications_due_idx on stk_verifications (next_check_at) where state = 'pending';

-- 1. No browser writes ----------------------------------------------------------------

drop policy transactions_admin_insert on transactions;
drop policy transactions_update_own_or_admin on transactions;
drop policy transactions_tourist_confirm on transactions;
drop policy transactions_tourist_confirm_select on transactions;
drop policy transactions_admin_delete on transactions;
drop policy wallet_ledger_entries_admin_insert on wallet_ledger_entries;
drop policy wallet_ledger_entries_admin_update on wallet_ledger_entries;
drop policy wallet_ledger_entries_admin_delete on wallet_ledger_entries;
drop policy withdrawal_requests_create_own_or_admin on withdrawal_requests;
drop policy withdrawal_requests_admin_update on withdrawal_requests;
drop policy withdrawal_requests_admin_delete on withdrawal_requests;
drop policy producers_admin_write on producers;
drop policy producers_admin_update on producers;
drop policy producers_admin_delete on producers;
drop policy drivers_admin_write on drivers;
drop policy drivers_admin_update on drivers;
drop policy drivers_admin_delete on drivers;
drop policy sync_queue_items_admin_only on sync_queue_items;
create policy sync_queue_items_select_admin on sync_queue_items for select using (public.is_admin());
-- Only the dropped tourist policies used this (the Case B token is checked by the API).
drop function public.cash_confirm_transaction_id();

revoke insert, update, delete, truncate, references, trigger on all tables in schema public from anon, authenticated;
-- Secrets and credentials can't even be read.
revoke all on transaction_secrets, auth_credentials from anon, authenticated;
-- Tables created later by migrations (run as postgres) start with no browser writes.
alter default privileges for role postgres in schema public
  revoke insert, update, delete, truncate, references, trigger on tables from anon, authenticated;

alter table transaction_secrets enable row level security;  -- no policies: deny all
alter table stk_verifications enable row level security;
create policy stk_verifications_select_admin on stk_verifications for select using (public.is_admin());

commit;
