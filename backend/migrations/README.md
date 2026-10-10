Plain numbered SQL files applied by hand via `psql`, run in order. No migration framework — matches CLAUDE.md's "prefer boring and correct."

Apply against Supabase (`DATABASE_URL` in `backend/.env`, Supabase's own `postgresql://...` string, no substitution needed for `psql`):

```
cd backend
set -a; source .env; set +a
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f migrations/0001_initial_schema.sql
```

Verify a migration's constraints actually hold (inserts one valid row per table, then deliberately violates the named check constraints and confirms they're rejected, then cleans up after itself):

```
bash migrations/verify_0001.sh
```

`DATABASE_URL` must be Supabase's **Session pooler** string (port 5432), not the
Transaction pooler (port 6543) — the latter can't support prepared statements at
all (SQLAlchemy's asyncpg dialect always issues real `PREPARE`s), which breaks
`app/db.py` outright. See `app/db.py`'s comments for the full story, including an
SSL-context construction gotcha that's easy to reintroduce.

0002 adds RLS policies matching CLAUDE.md section 5's permission matrix, plus the
`qr-codes` storage bucket (public read, coordinator-only write). Verify with:

```
bash migrations/verify_0002_rls.sh
```

This simulates each role via `SET ROLE` + `request.jwt.claims` (the same session
variables PostgREST sets from a real JWT) rather than needing an actual publishable
key or running server — seeds its own fixtures and cleans up after itself.

0007 fixes 0002's phone matching: real Supabase session JWTs carry `phone` without
the leading `+`, while `producers.phone` / `drivers.phone` store it with one, so every
producer/driver JWT matched nothing under RLS. 0007 compares with the `+` stripped on
both sides. `verify_0002_rls.sh` couldn't catch this — it hand-writes claims with the
`+` — so 0007's check logs in through the API (server must be running) and replays
each real token's claims instead:

```
bash migrations/verify_0007_rls_phone.sh
```

0008 adds `withdrawal_requests.retry_of`, linking a payout retry to the failed
withdrawal it replaces (rule 11: one automatic retry, then manual coordinator
retries). Exercised end to end by `scripts/verify_stage6.sh`.

0010 fixes the cash-sale money gap (CLAUDE.md rules 10 and 12, revised 2026-10-09):
a confirmed cash sale's maker share becomes a `cash_held` ledger entry (never
payable), and the driver's share a `cash_debts` row the maker owes, settled from
their M-Pesa-sourced balance (entries marked `transferred`, new entries for the
driver and the maker's change). Exercised by `scripts/verify_stage4.sh` (no Daraja
calls) and `scripts/verify_stage6.sh` (real sandbox B2C, simulated M-Pesa funding).

0011 adds account closure and suspension (CLAUDE.md rule 17): `account_status` on
producers and drivers (`active` becomes a generated column derived from it, so every
existing "is it active" check now also refuses suspended, closing and closed
accounts), `closure_requests`, `account_suspensions`, and `account_audit_log`, which
triggers make append-only for every role, the API's own connection included.
Exercised by `scripts/verify_lifecycle.sh` (simulated M-Pesa funding, real sandbox
B2C for two final payouts). Each run leaves its audit entries behind, reasons
prefixed "[test]": they can't be deleted, by design.

0012 is the security lockdown (CLAUDE.md section 5): browser roles (`anon`,
`authenticated`) keep SELECT only on every table and every write policy is dropped,
so no browser writes the database for any role (the API's direct connection is the
only writer); default privileges keep future tables the same. `checkout_request_id`
and `tourist_confirm_token` move to `transaction_secrets` (unreadable from the
browser, not in Realtime). It also adds the `verifying` status and
`stk_verifications` for STK Push Query (`STK_QUERY_MODE`). Proven by
`scripts/verify_security.sh`.
