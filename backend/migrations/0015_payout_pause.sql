-- Payout circuit breaker (CLAUDE.md section 2.1 / rule 11, added 2026-10-13).
--
-- Daraja locks the B2C initiator (ResultCode 8006) after repeated failures, and every
-- attempt against a locked initiator can extend the lock. So the first B2C callback
-- that says the credential or initiator is unusable (8006 locked, 2001 invalid) pauses
-- all payouts: no automatic retry, no sweep, no on-demand withdrawal, until a
-- coordinator resumes them after fixing the credential. Kept in the database, not in
-- memory, so a restart (Render's free instance restarts on wake) doesn't un-pause it.
-- Rows are history; a pause is in force while resumed_at is null.

begin;

create table payout_pauses (
  id          bigint generated always as identity primary key,
  result_code text not null,          -- the Daraja ResultCode that tripped it
  reason      text not null,          -- Daraja's ResultDesc
  paused_at   timestamptz not null default now(),
  resumed_at  timestamptz,
  resumed_by  uuid                    -- coordinator's auth user id; null if resumed from the terminal
);
create unique index payout_pauses_one_active on payout_pauses ((true)) where resumed_at is null;

revoke all on payout_pauses from anon, authenticated;
alter table payout_pauses enable row level security;

commit;
