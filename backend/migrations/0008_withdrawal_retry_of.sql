-- Rule 11 (payout failure: funds stay available, one automatic retry, then manual
-- coordinator retry) needs to know whether a failed withdrawal was already a retry.
-- retry_of links a retry back to the withdrawal it replaces; that original then moves
-- to status 'retried'. unique: each withdrawal is retried at most once, so a chain is
-- original -> automatic retry -> (each manual retry) — never two retries of one row.

alter table withdrawal_requests
  add column retry_of uuid unique references withdrawal_requests(id);
