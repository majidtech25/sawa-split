-- STK payments with no final result (2026-10-16). A held open sale whose M-Pesa payment
-- has no final answer after 10 minutes is released so the maker can carry on, and the
-- payment is kept as a payment check that Safaricom is still asked about:
--
--   unresolved   no final answer yet: no callback (still 'initiated'), or, in enforce
--                mode, a callback Safaricom hasn't confirmed ('verifying'). Shown in
--                Payment checks; queried in the background.
--   paid_late    a later query said paid: credited as normal (split, ledger). Shown in
--                Payment checks, since the tourist may have paid that sale again.
--   failed_late  a later query said not paid: the payment is closed as failed.
--
-- Additive only: the state check gains three values and the due-check index covers
-- unresolved rows. Nothing that exists changes meaning, so the code before this keeps
-- working beside it.

begin;

alter table stk_verifications drop constraint stk_verifications_state_check;
alter table stk_verifications add constraint stk_verifications_state_check
  check (state in ('pending', 'verified', 'mismatch', 'unanswered', 'amount_mismatch',
                   'unresolved', 'paid_late', 'failed_late'));

create index stk_verifications_unresolved_due_idx on stk_verifications (next_check_at) where state = 'unresolved';

commit;
