-- Sawa Split — Row Level Security, matching the permission matrix in CLAUDE.md section 5.
-- Enforced twice: this is the data layer; app/security.py + the routers are the API layer.
--
-- Identity model (no schema change needed — see docs/BACKEND_SCHEMA_AUTH.md section 3/4):
--   - Producer/Driver: matched by phone. auth.users.phone is set at onboarding time
--     (app/routers/auth.py, POST /auth/onboard), and Supabase includes `phone` as a
--     top-level claim in the session JWT for phone-authenticated users.
--   - Coordinator: no domain row at all — just an auth.users account with
--     app_metadata.is_admin = true, checked via public.is_admin() below.
--   - Tourist (Case B cash confirm, rule 12): the real path (stage 4's
--     POST /transactions/:id/confirm) ended up using a stored opaque token
--     (transactions.tourist_confirm_token, migration 0005) rather than a minted
--     Supabase JWT claim, to avoid needing the project's raw JWT signing secret.
--     The cash_confirm_transaction_id policy below is unused by that path but left
--     in place as defense-in-depth for a hypothetical future direct-PostgREST route.

create or replace function public.is_admin() returns boolean
language sql stable
as $$
  select coalesce((auth.jwt() -> 'app_metadata' ->> 'is_admin')::boolean, false);
$$;

create or replace function public.own_producer_id() returns uuid
language sql stable
as $$
  select id from producers where phone = (auth.jwt() ->> 'phone') limit 1;
$$;

create or replace function public.own_driver_id() returns uuid
language sql stable
as $$
  select id from drivers where phone = (auth.jwt() ->> 'phone') limit 1;
$$;

create or replace function public.cash_confirm_transaction_id() returns uuid
language sql stable
as $$
  select nullif(auth.jwt() ->> 'cash_confirm_transaction_id', '')::uuid;
$$;

-- producers ------------------------------------------------------------

alter table producers enable row level security;

create policy producers_select_own_or_admin on producers
  for select using (phone = (auth.jwt() ->> 'phone') or public.is_admin());

create policy producers_admin_write on producers
  for insert with check (public.is_admin());

create policy producers_admin_update on producers
  for update using (public.is_admin());

create policy producers_admin_delete on producers
  for delete using (public.is_admin());

-- drivers --------------------------------------------------------------

alter table drivers enable row level security;

create policy drivers_select_own_or_admin on drivers
  for select using (phone = (auth.jwt() ->> 'phone') or public.is_admin());

create policy drivers_admin_write on drivers
  for insert with check (public.is_admin());

create policy drivers_admin_update on drivers
  for update using (public.is_admin());

create policy drivers_admin_delete on drivers
  for delete using (public.is_admin());

-- transactions -----------------------------------------------------------
-- Tourist creation is "via pay endpoint only" (service-role, bypasses RLS) — no
-- direct insert policy for anon. The Case B confirm right below is the one place
-- an anonymous, token-scoped caller gets a real (if narrow) RLS grant.

alter table transactions enable row level security;

create policy transactions_select_own_or_admin on transactions
  for select using (
    producer_id = public.own_producer_id()
    or driver_id = public.own_driver_id()
    or public.is_admin()
  );

create policy transactions_admin_insert on transactions
  for insert with check (public.is_admin());

create policy transactions_update_own_or_admin on transactions
  for update using (
    producer_id = public.own_producer_id()
    or driver_id = public.own_driver_id()
    or public.is_admin()
  );

-- UPDATE in Postgres RLS also requires SELECT-level visibility on the targeted row
-- (confirmed empirically — the UPDATE policy alone left the row untargetable), so the
-- tourist's scoped right needs both: a narrow SELECT limited to exactly her one
-- transaction, and the UPDATE itself.
create policy transactions_tourist_confirm_select on transactions
  for select using (id = public.cash_confirm_transaction_id());

create policy transactions_tourist_confirm on transactions
  for update using (id = public.cash_confirm_transaction_id())
  with check (id = public.cash_confirm_transaction_id());

create policy transactions_admin_delete on transactions
  for delete using (public.is_admin());

-- wallet_ledger_entries --------------------------------------------------
-- Append-only from the client's perspective: no producer/driver write policy at all.

alter table wallet_ledger_entries enable row level security;

create policy wallet_ledger_entries_select_own_or_admin on wallet_ledger_entries
  for select using (
    (recipient_type = 'maker' and recipient_id = public.own_producer_id())
    or (recipient_type = 'driver' and recipient_id = public.own_driver_id())
    or public.is_admin()
  );

create policy wallet_ledger_entries_admin_insert on wallet_ledger_entries
  for insert with check (public.is_admin());

create policy wallet_ledger_entries_admin_update on wallet_ledger_entries
  for update using (public.is_admin());

create policy wallet_ledger_entries_admin_delete on wallet_ledger_entries
  for delete using (public.is_admin());

-- withdrawal_requests -----------------------------------------------------

alter table withdrawal_requests enable row level security;

create policy withdrawal_requests_select_own_or_admin on withdrawal_requests
  for select using (
    (recipient_type = 'maker' and recipient_id = public.own_producer_id())
    or (recipient_type = 'driver' and recipient_id = public.own_driver_id())
    or public.is_admin()
  );

create policy withdrawal_requests_create_own_or_admin on withdrawal_requests
  for insert with check (
    (recipient_type = 'maker' and recipient_id = public.own_producer_id())
    or (recipient_type = 'driver' and recipient_id = public.own_driver_id())
    or public.is_admin()
  );

create policy withdrawal_requests_admin_update on withdrawal_requests
  for update using (public.is_admin());

create policy withdrawal_requests_admin_delete on withdrawal_requests
  for delete using (public.is_admin());

-- sync_queue_items ---------------------------------------------------------
-- Not in the permission matrix (unbuilt, per docs/APP_FLOW.md section 5's note) —
-- default-deny except coordinator, purely for defense in depth.

alter table sync_queue_items enable row level security;

create policy sync_queue_items_admin_only on sync_queue_items
  for all using (public.is_admin()) with check (public.is_admin());
