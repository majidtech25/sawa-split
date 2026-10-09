-- Account closure (stakeholder-requested, coordinator-approved) and suspension, plus an
-- append-only audit log of both (CLAUDE.md section 4 rule 17, added 2026-10-09).
--
-- Accounts are closed, never deleted: transactions and ledger history stay. A maker's or
-- driver's state is account_status; the old `active` flag becomes derived from it, so
-- every existing check (checkout, initiate, the driver QR page) now also rejects
-- suspended, closing and closed accounts with no code change.
--   active    - normal
--   suspended - by a coordinator, with a reason and a review date: no new sales, no login
--   closing   - closure approved, final payout in progress: no new sales, login still works
--   closed    - final payout done (or nothing to pay): no sales, no login

begin;

alter table producers add column account_status text not null default 'active'
  check (account_status in ('active', 'suspended', 'closing', 'closed'));
alter table producers drop column active;
alter table producers add column active boolean generated always as (account_status = 'active') stored;

alter table drivers add column account_status text not null default 'active'
  check (account_status in ('active', 'suspended', 'closing', 'closed'));
alter table drivers drop column active;
alter table drivers add column active boolean generated always as (account_status = 'active') stored;

-- One row per closure request. party_type/party_id follow wallet_ledger_entries'
-- recipient_type/recipient_id ('maker' = producers.id, 'driver' = drivers.id).
create table closure_requests (
  id              uuid primary key default gen_random_uuid(),
  party_type      text not null check (party_type in ('maker', 'driver')),
  party_id        uuid not null,
  reason          text not null check (length(btrim(reason)) > 0),
  status          text not null default 'pending'
                    check (status in ('pending', 'cancelled', 'rejected', 'approved', 'closed')),
  requested_at    timestamptz not null default now(),
  decided_at      timestamptz,               -- cancelled, rejected or approved
  decided_by      uuid,                      -- coordinator's auth user id (null when the stakeholder cancelled)
  decision_reason text,                      -- required to reject
  closed_at       timestamptz,               -- final payout done
  constraint closure_requests_reject_reason
    check (status <> 'rejected' or length(btrim(coalesce(decision_reason, ''))) > 0)
);
-- At most one open (pending, or approved and paying out) request per account.
create unique index closure_requests_one_open on closure_requests (party_type, party_id)
  where status in ('pending', 'approved');

create table account_suspensions (
  id           uuid primary key default gen_random_uuid(),
  party_type   text not null check (party_type in ('maker', 'driver')),
  party_id     uuid not null,
  reason       text not null check (length(btrim(reason)) > 0),  -- shown to the suspended person
  review_on    date not null,                                    -- default: 7 days after suspension
  suspended_by uuid not null,                                    -- coordinator's auth user id
  suspended_at timestamptz not null default now(),
  lifted_at    timestamptz,
  lifted_by    uuid,
  lift_reason  text,
  constraint account_suspensions_lift check ((lifted_at is null) = (lifted_by is null))
);
create unique index account_suspensions_one_open on account_suspensions (party_type, party_id)
  where lifted_at is null;

-- Every request, cancel, approve, reject, closure, suspend and unsuspend: who, when, why.
create table account_audit_log (
  id          bigint generated always as identity primary key,
  at          timestamptz not null default now(),
  action      text not null check (action in (
                'closure_requested', 'closure_cancelled', 'closure_approved', 'closure_rejected',
                'account_closed', 'suspended', 'unsuspended')),
  party_type  text not null check (party_type in ('maker', 'driver')),
  party_id    uuid not null,
  actor_role  text not null check (actor_role in ('maker', 'driver', 'coordinator', 'system')),
  actor_id    uuid,        -- coordinator: auth user id; maker/driver: their own id; system: null
  actor_phone text,
  reason      text,
  details     jsonb not null default '{}'::jsonb
);
create index account_audit_log_party_idx on account_audit_log (party_type, party_id, at);

-- Append-only for everyone, the API's own connection included: no update, delete or
-- truncate gets past these triggers.
create function account_audit_log_append_only() returns trigger
language plpgsql as $$
begin
  raise exception 'account_audit_log is append-only: % is not allowed', tg_op;
end;
$$;
create trigger account_audit_log_no_update_delete
  before update or delete on account_audit_log
  for each row execute function account_audit_log_append_only();
create trigger account_audit_log_no_truncate
  before truncate on account_audit_log
  for each statement execute function account_audit_log_append_only();
revoke update, delete, truncate on account_audit_log from anon, authenticated, service_role;

-- RLS: makers and drivers read their own closure requests; coordinators read all three
-- tables. Only the API (direct connection) writes.
alter table closure_requests enable row level security;
alter table account_suspensions enable row level security;
alter table account_audit_log enable row level security;

create policy closure_requests_select_own_or_admin on closure_requests
  for select using (
    (party_type = 'maker' and party_id = public.own_producer_id())
    or (party_type = 'driver' and party_id = public.own_driver_id())
    or public.is_admin()
  );
create policy account_suspensions_select_admin on account_suspensions
  for select using (public.is_admin());
create policy account_audit_log_select_admin on account_audit_log
  for select using (public.is_admin());

commit;
