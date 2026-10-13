-- B2C correlation key out of the browser's reach (CLAUDE.md section 5, added 2026-10-13).
--
-- withdrawal_requests.idempotency_key is the OriginatorConversationID we send with each
-- B2C payout, and Daraja echoes it back in the result callback, which is how the callback
-- finds its payout. Makers and drivers could read it on their own withdrawals (and
-- receive it over Realtime). With it, someone could post a fake "failed" callback while
-- the real payout was still in flight: the automatic retry would send a second payout,
-- and the real success would then be ignored, a double payment. It moves to
-- withdrawal_secrets, which no browser role can read and Realtime doesn't stream, the
-- same as transaction_secrets did for the STK CheckoutRequestID (migration 0012).
-- Signing the B2C result URL per payout is the further fix, listed as post-pitch work.

begin;

create table withdrawal_secrets (
  withdrawal_id   uuid primary key references withdrawal_requests(id) on delete cascade,
  idempotency_key uuid unique not null   -- sent to Daraja as OriginatorConversationID
);
insert into withdrawal_secrets (withdrawal_id, idempotency_key)
  select id, idempotency_key from withdrawal_requests;
alter table withdrawal_requests drop column idempotency_key;

revoke all on withdrawal_secrets from anon, authenticated;
alter table withdrawal_secrets enable row level security;  -- no policies: deny all

commit;
