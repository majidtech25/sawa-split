-- Fixes 0002's phone matching: Supabase Auth puts `phone` in the session JWT without
-- the leading '+' (e.g. "254708374149"), but producers.phone / drivers.phone are stored
-- with it ("+254708374149"), so every producer/driver JWT matched no row and RLS hid
-- their own producer row, transactions, ledger entries and withdrawals. The API was
-- unaffected (it reads with the service role, and app/caller.py already strips the
-- '+'), but direct reads with the user's JWT — the frontend and Realtime — saw nothing.
--
-- Compares with the '+' stripped on both sides, mirroring app/caller.py's
-- normalize_phone, so it matches whether or not either side carries the '+'. The
-- transactions / wallet_ledger_entries / withdrawal_requests policies all go through
-- own_producer_id() / own_driver_id(), so redefining those two fixes them too.

begin;

create or replace function public.own_producer_id() returns uuid
language sql stable
as $$
  select id from producers where ltrim(phone, '+') = ltrim(auth.jwt() ->> 'phone', '+') limit 1;
$$;

create or replace function public.own_driver_id() returns uuid
language sql stable
as $$
  select id from drivers where ltrim(phone, '+') = ltrim(auth.jwt() ->> 'phone', '+') limit 1;
$$;

alter policy producers_select_own_or_admin on producers
  using (ltrim(phone, '+') = ltrim(auth.jwt() ->> 'phone', '+') or public.is_admin());

alter policy drivers_select_own_or_admin on drivers
  using (ltrim(phone, '+') = ltrim(auth.jwt() ->> 'phone', '+') or public.is_admin());

commit;
