# Sawa Split — Technical Requirements Document

**Status:** Locked for MVP build

## 1. Stack

| Layer | Choice | Why |
|---|---|---|
| Backend | FastAPI, async SQLAlchemy + asyncpg | Proven pattern, already deployed on a prior project (Operix) |
| Database | Supabase (managed Postgres + Auth + Realtime + Storage) | Same asyncpg connection path; Auth and Realtime replace custom build work |
| Frontend | React + Vite + Tailwind, `HashRouter` | Matches prior deployment experience; avoids Render SPA-routing issue from day one |
| Hosting | Render (both services) | Known-working deployment target |
| Payments | Daraja STK Push (collection) + Daraja B2C (payout) for M-Pesa; cash via an in-app dual-confirmation flow | Only realistic M-Pesa integration path; cash needed as a parallel first-class method, not an offline fallback |
| Scheduling | In-process APScheduler inside the FastAPI service | Render's free tier has no native cron jobs |

## 2. Non-functional requirements

- **Low-end device support:** primary UI must run acceptably on budget Android phones over patchy 2G/3G. No heavy web fonts pulled from full-family CDN loads without subsetting; minimize payload on the core payment flow.
- **Cash dual confirmation:** a cash sale settles online, via both required parties tapping confirm (driver+maker for a referred sale, tourist+maker for a walk-up sale) — not via a self-reported offline log. An unconfirmed cash sale that misses its confirmation window expires visibly in the ledger rather than silently retrying or entering the payout pipeline. True offline/no-connectivity capture (IndexedDB-queued, synced later) remains a separate, unbuilt, still-hypothetical concern — not how cash is tracked.
- **Idempotency:** every payout (on-demand or batch) carries a generated idempotency key; every Daraja webhook is checked against the transaction reference before writing — a duplicate delivery must be a no-op.
- **Auditability:** wallet balances are never a single mutable field — they are computed from append-only ledger entries, so the maker-checker audit claim in the pitch is literally true.
- **Security boundary:** clients read wallet/ledger data via Supabase Row Level Security (read-only); only the FastAPI service, using the service-role key, may write to money-affecting tables.
- **Secrets handling:** Daraja consumer keys and the Supabase service-role key live only in Render environment variables — never committed, never pasted into chat or code.
- **Rate limiting:** the public, no-auth payment-initiate endpoint is rate-limited per phone number.

## 3. Known deployment gotchas (carried over from prior deployment experience — avoid rediscovering under deadline)

- asyncpg's `ssl` connect arg accepts only `True` (boolean) or an `ssl.SSLContext` — not the string `"require"`.
- Pin Python via a `.python-version` file (e.g. 3.12.3) on Render to avoid pydantic-core Rust build failures on newer versions.
- SQLAlchemy enums need `values_callable=lambda x: [e.value for e in x]` so enum *values* are stored, not key names.
- Use `HashRouter`, not a `_redirects` file, for SPA routing on Render.
- Avoid custom service-worker changes for anything beyond static asset caching — a prior PWA service-worker edit broke the installed app and had to be reverted. Offline queueing lives in plain IndexedDB + app JS, not the service worker.
- Render's free tier has no shell access — any one-off admin bootstrap needs its own API endpoint, not a manual console command.

## 4. Integration requirements

### Daraja (M-Pesa)
- STK Push: collection leg, triggered from `POST /transactions/initiate`.
- Callback: `POST /daraja/stk-callback`, idempotent on transaction reference.
- B2C: payout leg, triggered by on-demand withdrawal or the 18:00 EAT batch sweep.
- B2C callback: `POST /daraja/b2c-callback`, updates `WithdrawalRequest` status.
- Local dev: ngrok for a public callback URL. Production: the deployed Render URL satisfies this directly.
- Production B2C requires a separate Safaricom business approval process (Initiator Name, Security Credential, B2C shortcode) — tracked in parallel, not a build blocker for the pilot demo.

### Supabase
- Postgres via SQLAlchemy/asyncpg (same connection pattern as prior deployment).
- Auth: coordinator-created accounts only, no public signup; phone number + PIN for producers/drivers.
- Realtime: frontend ledger/dashboard subscribes directly to table changes — no custom websocket layer needed.
- Storage: one bucket, `qr-codes` (public read, coordinator-only write).
- Row Level Security: enforced per the permission matrix in `BACKEND_SCHEMA_AUTH.md`.

## 5. Performance & scale targets (pilot scope, not production scale)

- Single-digit concurrent transactions at pilot scale (one site, a handful of producers/drivers) — no load-testing requirement at this stage.
- Batch sweep must complete well within its daily window even if every eligible balance is processed at once.
- Dashboard reads (via Realtime) should reflect a new transaction within a few seconds, not require a manual refresh.

## 6. Deferred / explicitly out of scope technically

- Production B2C float management (B2B transfer from collection Till to B2C utility account) — documented as a real operational step, not built for the demo.
- Multi-region or multi-currency infrastructure.
- Automated load balancing / horizontal scaling beyond Render's default service tier.
