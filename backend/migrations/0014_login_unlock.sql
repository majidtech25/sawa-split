-- A coordinator (or the terminal script) can clear a login lockout before its 15
-- minutes are up, e.g. during the pitch. Each unlock is audit-logged as login_unlocked.

begin;

alter table account_audit_log drop constraint account_audit_log_action_check;
alter table account_audit_log add constraint account_audit_log_action_check check (action in (
  'closure_requested', 'closure_cancelled', 'closure_approved', 'closure_rejected',
  'account_closed', 'suspended', 'unsuspended', 'login_locked', 'login_unlocked'));

commit;
