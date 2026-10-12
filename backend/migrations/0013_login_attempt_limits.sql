-- Login attempt limiting (CLAUDE.md section 5, added 2026-10-11).
--
-- A PIN has 4 digits, so without a limit anyone could try all 10,000 against a phone.
-- Kept in the database, not in memory: Render's free instance restarts when it wakes,
-- which would wipe an in-memory counter. app/login_limits.py applies the rules:
--   - 5 failed attempts for one phone within 15 minutes lock that phone for 15 minutes;
--   - 20 failed attempts from one IP within 15 minutes lock that IP for 15 minutes, so
--     one person can't spray guesses across many phones;
--   - a successful login clears that phone's failures;
--   - while locked, the PIN isn't even checked; the answer is a plain "Too many
--     attempts, try again in 15 minutes", the same whether or not the phone exists.

begin;

create table login_failures (
  id    bigint generated always as identity primary key,
  phone text not null,          -- as normalised by the API (254XXXXXXXXX), registered or not
  ip    text not null,
  at    timestamptz not null default now()
);
create index login_failures_phone_idx on login_failures (phone, at);
create index login_failures_ip_idx on login_failures (ip, at);

-- One row per lockout, kept as history; a lock is in force while locked_until > now().
create table login_lockouts (
  id           bigint generated always as identity primary key,
  kind         text not null check (kind in ('phone', 'ip')),
  key          text not null,   -- the phone (254XXXXXXXXX) or the IP
  locked_until timestamptz not null,
  created_at   timestamptz not null default now()
);
create index login_lockouts_active_idx on login_lockouts (kind, key, locked_until);

-- Lockouts go in the audit log too. A locked phone may be a coordinator's or not
-- registered at all, and an IP lock has no account, so those rows have no maker/driver.
alter table account_audit_log drop constraint account_audit_log_action_check;
alter table account_audit_log add constraint account_audit_log_action_check check (action in (
  'closure_requested', 'closure_cancelled', 'closure_approved', 'closure_rejected',
  'account_closed', 'suspended', 'unsuspended', 'login_locked'));
alter table account_audit_log drop constraint account_audit_log_party_type_check;
alter table account_audit_log add constraint account_audit_log_party_type_check
  check (party_type in ('maker', 'driver', 'coordinator', 'unknown', 'ip'));
alter table account_audit_log alter column party_id drop not null;

-- Nothing here is for the browser: no grants, and RLS with no policies.
revoke all on login_failures, login_lockouts from anon, authenticated;
alter table login_failures enable row level security;
alter table login_lockouts enable row level security;

commit;
