# Sawa Split — Project Brief for Claude Code

**Purpose of this file:** everything locked during planning, consolidated into one build-ready brief. This file lives at the repo root as `CLAUDE.md`, so Claude Code loads it automatically at the start of every session in this repo — no need to re-paste it. Where this brief says "locked," treat it as non-negotiable — those are explicit decisions the team already made, not defaults to reconsider mid-build.

**Full detail behind this brief lives in `/docs`:** `PRD.md` (personas, user stories, success metrics), `TRD.md` (full non-functional requirements), `APP_FLOW.md` (step-by-step per persona), `UI_UX_DESIGN.md`, `BACKEND_SCHEMA_AUTH.md`, `IMPLEMENTATION_PLAN.md`, `DEMO_SCRIPT.md`, `CASH_TRACKING_UPDATE.md` (cash dual-confirmation design — read this before touching anything cash-related). This brief is the condensed, always-loaded version — read the relevant doc in `/docs` if something here is ambiguous or you need the fuller reasoning behind a rule.

## 0. What this is

**What we're building:** a transparent value-split payment app. A tourist pays once via M-Pesa or cash; the payment automatically splits between the woman/PWD producer who made the value and the driver who referred the sale — and separately compensates the producer for photo consent. Every shilling collected is the maker's, the driver's or (with the fixed split, rule 4) the ring-fenced Conservation fund's — **Sawa Split keeps nothing; there is no platform fee, ever.**

**Who it's for:** four users, in order of who touches it most: the tourist (no account, pays once), the producer/maker (a woman or PWD artisan/cook/performer, wants a guaranteed transparent share with no dependency on a driver handing over cash), the driver/guide (wants a disclosed, guaranteed referral fee instead of pressuring a sale), and the coordinator (onboards people, watches the ledger, resolves disputes).

**Visual style we're aiming for:** minimal, fintech-restrained — quiet confidence, not startup energy. Two accent colors with single jobs (green for confirmed/success, ochre for the one "Pay" button, terracotta for errors only), one type family for words (Inter) and one for numbers (IBM Plex Mono, tabular), one 8px radius everywhere, one 8px spacing grid. No gradients, no stock tourist photography, no icon without a text label, nothing that reads as generated-in-five-minutes. Full spec in section 7 and the published Design Reference artifact.

**The core it needs to prove, end to end, by the demo:** a real tourist payment splits automatically and correctly between maker and driver (with photo consent as its own component), the ledger updates live, and at least one withdrawal actually pays out — on real (sandbox) Daraja, not mocked. Cash payments prove the same split via dual confirmation instead of Daraja, as a record: the cash stays with the maker and is never paid out again by B2C (see section 4 rule 12).

This is an MVP for the Future Leaders Challenge Eastern Africa, built for a live demo, not a production system yet.

## 0.1 Your role and working constraints

You are the engineer implementing this MVP. Treat section 4 (business rules) and section 5 (auth model) as fixed requirements handed down from a locked product spec, not open design questions — if something there seems wrong or incomplete, flag it back to the user rather than silently deciding differently. Concretely:

- **Don't invent scope.** If it's listed under section 10 ("explicitly not building yet"), don't build it, even as a stub that half-works — a half-built platform-fee field is worse than no field.
- **Don't restyle.** Use the exact tokens in section 7. If a screen needs something the tokens don't cover, ask, don't improvise a new color or a second radius.
- **Don't skip the build stages below out of order** (same discipline the planning phase used) — each stage should be working and committed before the next one starts, so a demo is always possible from wherever the build currently stands, not just at the very end.
- **Prefer boring and correct over clever.** This is a payments ledger for real people's earnings — the append-only ledger, the idempotency keys, and the full-balance-only withdrawal rule all exist specifically to remove entire classes of bugs; don't "simplify" them back in. The cash dual-confirmation flow (section 4 rule 12) exists for the same reason — don't collapse it back into a single self-reported log.
- **No AI attribution in commits or PRs.** Commit messages and PR descriptions carry no `Co-Authored-By` line and no Claude/AI attribution of any kind. `.claude/settings.local.json` sets `"includeCoAuthoredBy": false` (that file is git-ignored, so set it again on a new machine).
- **Ask before touching anything in section 4, 5, or 6** — those are the parts a judge's Q&A will actually probe.

## 1. Stack (reused from a prior project, "Operix" — proven, not novel)

- **Backend:** FastAPI + async SQLAlchemy + asyncpg, deployed on Render as a Web Service.
- **Frontend:** React + Vite + Tailwind, `HashRouter` (not `_redirects` — Render SPA routing gotcha), deployed on Render as a second Web Service (or static site if the frontend ends up fully static — backend decides that, not assumed here).
- **Database / Auth / Storage / Realtime:** Supabase (already provisioned — project exists, credentials saved outside chat, to be set as Render env vars once the two Render services are created in this phase).
- **Payments:** Safaricom Daraja — STK Push (collection) + B2C (payout) for M-Pesa; cash uses the in-app dual-confirmation flow instead (section 4 rule 12, `CASH_TRACKING_UPDATE.md`). Sandbox already set up (consumer key/secret obtained, STK Push + B2C sandbox endpoints confirmed, placeholder callback URL registered — swap for ngrok during local dev, then the real Render URL at deploy).
- **Batch job:** in-process APScheduler for the daily 18:00 EAT payout sweep (Render free tier has no native cron).

## 2. Known deployment gotchas — apply from day one, don't rediscover these under deadline pressure

- asyncpg's `ssl` connect arg must be the boolean `True`, never the string `"require"`.
- Pin `.python-version` to `3.12.3` (already done in the repo) — a newer default Python breaks pydantic-core's prebuilt wheels on Render.
- SQLAlchemy enum columns need `values_callable=lambda x: [e.value for e in x]` or they serialize wrong.
- Use `HashRouter`, not Render's `_redirects` file, for SPA routing.
- Don't hand-edit the service worker if a PWA layer gets added later — this broke Operix's PWA once. *(2026-10-18: the PWA layer is now `frontend/public/sw.js`, hand-written on purpose — there's no plugin and no generated worker to edit. The rule that remains: bump its `CACHE` name (`sawa-v1` → `sawa-v2`…) on every change, keep it to same-origin GETs only (it must never see the API, Supabase or any POST), and it's registered only in production builds. See SCOPE_V2 MUST 20.)*
- Render's free tier has no shell access — plan migrations/seeding to run via a startup script or a one-off local connection, not `render ssh`.
- **`DATABASE_URL` must be Supabase's Session pooler (port 5432), never the Transaction pooler (port 6543)** — the latter runs PgBouncer in transaction mode, which cannot support prepared statements no matter how asyncpg/SQLAlchemy are configured (confirmed: `DuplicatePreparedStatementError`, unfixable client-side). Session mode gives each connection a dedicated backend, so prepared statements work normally. Both pooler strings look almost identical in the dashboard — the port number is the only tell.
- Plain `ssl=True` against Supabase's pooler fails with `self-signed certificate in certificate chain` (full cert-chain verification against system CAs doesn't trust the pooler's cert). The fix — skip chain/hostname verification — must be built as a **fresh `ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)`**, not `ssl.create_default_context()` with verification switched off afterward; the latter hangs indefinitely on asyncpg's `start_tls` against this pooler specifically, even though the override is otherwise equivalent.
- Supabase's **Phone auth provider is disabled by default** on a fresh project — the Admin API can still create phone-based users regardless, but the sign-in endpoint (`/auth/v1/token?grant_type=password` with `phone`) fails with `phone_provider_disabled` until Authentication → Sign In / Providers → Phone is explicitly enabled. It also needs *some* SMS provider configured in that same panel to fully save/activate, even though this app never sends an OTP — placeholder Twilio credentials are enough.
- Supabase Cloud enforces a **hard 6-character minimum password length that cannot be lowered**, even though the dashboard exposes a "Minimum password length" field that implies otherwise (confirmed: this is a managed-Cloud platform limit, not a config value — self-hosted GoTrue's `GOTRUE_PASSWORD_MIN_LENGTH` doesn't apply here). A 4-digit PIN can never be Supabase Auth's own password; see `app/routers/auth.py` / `auth_credentials` for how the PIN is decoupled from it.
- This dev environment's network path to Supabase's pooler is itself slow/jittery (several seconds per connection, with an outright stall roughly 1 in 5 attempts) — bound every asyncpg connection with an explicit `timeout` (`app/db.py` uses 10s) so a bad network path fails fast and loud instead of hanging a request indefinitely. Expected to be a non-issue once deployed to Render's own network, but keep the timeout regardless as cheap insurance.

## 2.1 Daraja sandbox findings — learned the hard way in stage 5

- **Two different shortcodes.** B2C `PartyA` is **600992** (`DARAJA_B2C_SHORTCODE`, initiator `testapi`). STK Push / C2B uses **174379** (`DARAJA_SHORTCODE`). Don't swap them.
- **B2C shortcode history.** On 2026-10-16 Safaricom support confirmed that **600426**, the B2C shortcode in use until then, was locked (this file had still listed the older 600979). They issued sandbox B2C shortcodes **600992** and **600998** (initiator `testapi`), and 600992 is now set in Render, `backend/.env` and `backend/.env.demo` with a fresh `DARAJA_SECURITY_CREDENTIAL`. One sandbox B2C of KSh 10 to 254708374149 from 600992 came back ResultCode **0** the same day. 600998 is the spare: switch to it only if 600992 locks, and never retry into a lock.
- **The B2C recipient must be 254708374149**, Safaricom's sandbox test MSISDN. Any other number fails with ResultCode **2040** ("Credit Party customer type … can't be supported"). That's why the stage-3 test producer's phone is 254708374149: a withdrawal pays the recipient's own phone.
- **ResultCode 8006 means the initiator's security credential is locked.** Fix it by regenerating the credential in the Daraja portal's Test Credentials panel and pasting it into `DARAJA_SECURITY_CREDENTIAL`. Don't retry in a loop: every failed attempt against a locked initiator can extend the lock.
- **In `.env`, keep comments on their own line.** A value like `DARAJA_B2C_SHORTCODE=600992# comment` loads as the whole string, comment included, and goes out as `PartyA`. This regressed twice.
- **Running `backend/scripts/verify_stage5.sh`:** pipe it through `tee` only with `set -o pipefail`, otherwise tee's exit status hides failures. Its Test 3 withdraws the producer's full balance, which must reach KES 500 after the run's KES 45 STK credit, so the producer needs at least KES 455 available first. The old KES 600 fixture entry behind that was Stage 5 debug data and was deleted on 2026-10-07 (it made reconciliation unbalanced). Fund the balance with a simulated M-Pesa sale instead (`scripts/simulate_mpesa_sale.py` plus a simulated callback to the local server), the way `verify_stage6.sh` does. A cash sale can't fund it any more, because cash is never payable (rule 12).
- **A sandbox STK Push to a real phone number charges real money.** Confirmed: KES 60 was deducted and is not refundable. Safaricom's test MSISDN no longer reliably auto-completes STK, so a real number is the only reliable way to get a callback, and each attempt costs the full amount. The script's STK payer comes from `STK_PAYER_MSISDN` (`.env` only, never committed). Keep the test amount at the KES 50 + 10 minimum.
- **B2C in sandbox only pays the test number**, so a sandbox payout never reaches a real producer's or driver's phone. Since 2026-10-13 `app/daraja.py` enforces it: against the sandbox, a B2C to any number but 254708374149 is refused **before anything is sent** (`SandboxRecipientRefused`; not even a token fetch). Before that, the test suites' payouts to the driver fixture failed for real (2040) over and over, and that **locked the initiator (8006)**.
- **A locked initiator stays locked after you regenerate the credential.** Seen 2026-10-13: a freshly generated `DARAJA_SECURITY_CREDENTIAL` still got 8006. So never retry into a lock: the first B2C callback with ResultCode 8006 or 2001 now **pauses all payouts** (migration 0015, `payout_pauses`): no automatic retry, no sweep, no withdrawal reaches Daraja. Coordinator → Reconciliation → **Resume payouts** once fixed, or from `backend/`: `.venv/bin/python scripts/resume_payouts.py --env-file .env.demo`. `verify_stage6.sh` and `verify_lifecycle.sh` refuse to start while paused.
- **Client IP on Render** comes from Cloudflare's `CF-Connecting-IP`. Measured with the keyed `/health`, it matches the caller's public IP even when the caller forges `X-Forwarded-For`/`True-Client-IP`, and Cloudflare rejects a client-set one (error 1000). `X-Forwarded-For` there is "client, Cloudflare edge, Render internal": its first hop is forgeable and its last is shared by everyone. uvicorn's own client address follows the forgeable first hop. So never use `--forwarded-allow-ips='*'` for anything that matters.

## 3. Database schema — exact shape (Supabase / Postgres)

```sql
-- producers
id            uuid primary key default gen_random_uuid(),
name          text not null,
phone         text unique not null,
till          text not null,
site          text,
default_split_driver_pct  numeric not null check (default_split_driver_pct <= 40), -- maker floor: 60%, applies to the product component only
charges_product  boolean not null default true,
charges_photo    boolean not null default false,
account_status text not null default 'active' check (account_status in ('active','suspended','closing','closed')), -- rule 17
active        boolean generated always as (account_status = 'active') stored,  -- derived; every "is it active" check reads this
created_at    timestamptz not null default now(),
constraint producers_at_least_one_component check (charges_product or charges_photo)

-- drivers
id            uuid primary key default gen_random_uuid(),
name          text not null,
phone         text unique not null,
till          text not null,
qr_code       text unique not null,
account_status text not null default 'active' check (account_status in ('active','suspended','closing','closed')), -- rule 17
active        boolean generated always as (account_status = 'active') stored,
created_at    timestamptz not null default now()

-- transactions
-- Product and photo consent are two independent, separately-priced components.
-- A transaction charges whichever component(s) are active for that visit — never a merged bundle.
-- payment_method + the cash_* statuses below implement the dual-confirmation cash flow (section 4 rule 12).
id                    uuid primary key default gen_random_uuid(),
producer_id           uuid references producers(id),
driver_id             uuid references drivers(id),   -- nullable: no driver on a photo-only visit or a walk-up (Case B) cash sale with no referral
payment_method        text not null default 'mpesa' check (payment_method in ('mpesa','cash')),
product_enabled       boolean not null default false,
product_amount        numeric,              -- null unless product_enabled
product_maker_amount  numeric,              -- null unless product_enabled
product_driver_amount numeric,              -- null unless product_enabled
photo_enabled         boolean not null default false,
photo_amount          numeric,              -- null unless photo_enabled; paid 100% to maker, never split
total_amount          numeric not null check (total_amount > 0),
maker_amount          numeric not null,     -- product_maker_amount + photo_amount
driver_amount         numeric not null default 0,  -- product_driver_amount only
stk_receipt           text unique,          -- mpesa only, null for cash
status                text not null check (status in ('initiated','verifying','confirmed','failed','disputed','cash_unconfirmed','cash_confirmed','cash_expired')),
                                            -- 'verifying': STK_QUERY_MODE=enforce, callback received, Safaricom not yet confirmed; nobody credited
driver_confirmed_at   timestamptz,          -- cash Case A (driver_id set): driver's confirm tap
maker_confirmed_at    timestamptz,          -- cash Case A and Case B: maker's confirm tap
tourist_confirmed_at  timestamptz,          -- cash Case B (no driver_id): tourist's confirm tap
confirmation_deadline timestamptz,          -- cash only: created_at + CASH_CONFIRM_WINDOW_MINUTES (default 10)
created_at            timestamptz not null default now(),
constraint transactions_at_least_one_component check (product_enabled or photo_enabled)
-- checkout_request_id and tourist_confirm_token are NOT on this table: makers and drivers
-- read it and Realtime streams it. They live in transaction_secrets (migration 0012).

-- withdrawal_secrets   (migration 0016: no browser role can read it, not in the Realtime publication)
withdrawal_id   uuid primary key references withdrawal_requests(id) on delete cascade,
idempotency_key uuid unique not null        -- sent to Daraja as OriginatorConversationID; the B2C callback matches on it

-- transaction_secrets   (no browser role can read it, not in the Realtime publication)
transaction_id        uuid primary key references transactions(id) on delete cascade,
checkout_request_id   text unique,          -- mpesa: Daraja's STK Push id, matched by the callback
tourist_confirm_token text unique           -- cash Case B: the tourist's confirmation token

-- stk_verifications   (STK Push Query check of each successful STK callback; section 6 step 2)
transaction_id  uuid primary key references transactions(id) on delete cascade,
mode            text not null check (mode in ('flag','enforce')),
state           text not null default 'pending' check (state in ('pending','verified','mismatch','unanswered','amount_mismatch')),
attempts        int not null default 0,
next_check_at   timestamptz not null default now(),
callback_amount numeric,
last_result     jsonb,
created_at      timestamptz not null default now(),
updated_at      timestamptz not null default now()

-- wallet_ledger_entries   (append-only — balances are computed, never stored directly; amounts never change)
-- Only M-Pesa money is ever payable (rule 12). An M-Pesa sale writes the maker's and driver's
-- shares at its STK callback. A cash sale, at cash_confirmed, writes only the maker's share,
-- as 'cash_held' (already in hand, never payable); the driver's share becomes a cash_debts row.
-- Settling a debt marks whole maker entries 'transferred' and writes new entries: the driver's
-- credit and the maker's change. So pending + available + frozen + paid = M-Pesa collected.
id              uuid primary key default gen_random_uuid(),
recipient_type  text not null check (recipient_type in ('maker','driver')),
recipient_id    uuid not null,
amount          numeric not null check (amount > 0),
status          text not null check (status in ('pending','available','paid','frozen','cash_held','transferred')),
transaction_id  uuid references transactions(id),
settlement_id   uuid references cash_debts(id),  -- set on entries a debt settlement spent or created
created_at      timestamptz not null default now()
-- index: (recipient_type, recipient_id, status) for fast balance queries

-- cash_debts   (maker -> driver: the driver's share of a confirmed cash sale, which the maker holds)
-- Settled internally, never by B2C: from the maker's available M-Pesa-sourced entries, in full,
-- at confirmation if they cover it, otherwise as soon as they do (STK credit, payout, or sweep).
id              uuid primary key default gen_random_uuid(),
transaction_id  uuid unique not null references transactions(id),
producer_id     uuid not null references producers(id),   -- owes
driver_id       uuid not null references drivers(id),     -- is owed
amount          numeric not null check (amount > 0),      -- the sale's driver_amount
status          text not null default 'outstanding' check (status in ('outstanding','settled')),
created_at      timestamptz not null default now(),
settled_at      timestamptz                               -- set exactly when status = 'settled'

-- withdrawal_requests   (the B2C idempotency key is NOT here since migration 0016: see withdrawal_secrets)
id                uuid primary key default gen_random_uuid(),
recipient_type    text not null,
recipient_id      uuid not null,
amount            numeric not null,
b2c_receipt       text,
status            text not null check (status in ('requested','processing','paid','failed','retried')),
requested_at      timestamptz not null default now(),
resolved_at       timestamptz

-- closure_requests   (rule 17; party_type/party_id as in the ledger: 'maker' = producers.id, 'driver' = drivers.id)
id              uuid primary key default gen_random_uuid(),
party_type      text not null check (party_type in ('maker','driver')),
party_id        uuid not null,
reason          text not null,             -- required, non-blank
status          text not null default 'pending' check (status in ('pending','cancelled','rejected','approved','closed')),
requested_at    timestamptz not null default now(),
decided_at      timestamptz,
decided_by      uuid,                      -- coordinator's auth user id
decision_reason text,                      -- required when rejected
closed_at       timestamptz
-- unique (party_type, party_id) where status in ('pending','approved'): one open request per account

-- account_suspensions   (rule 17)
id           uuid primary key default gen_random_uuid(),
party_type   text not null check (party_type in ('maker','driver')),
party_id     uuid not null,
reason       text not null,                -- shown to the suspended person
review_on    date not null,                -- default 7 days after suspension; past it, flagged overdue
suspended_by uuid not null,
suspended_at timestamptz not null default now(),
lifted_at    timestamptz, lifted_by uuid, lift_reason text
-- unique (party_type, party_id) where lifted_at is null

-- account_audit_log   (rule 17: append-only; triggers refuse every UPDATE, DELETE and TRUNCATE)
id          bigint generated always as identity primary key,
at          timestamptz not null default now(),
action      text not null check (action in ('closure_requested','closure_cancelled','closure_approved',
              'closure_rejected','account_closed','suspended','unsuspended')),
party_type  text not null, party_id uuid not null,
actor_role  text not null check (actor_role in ('maker','driver','coordinator','system')),
actor_id    uuid, actor_phone text,        -- who
reason      text,                          -- why
details     jsonb not null default '{}'

-- migration 0020 (rule 4, fixed split): transactions.split_model ('legacy' | 'fixed', default 'legacy') and
-- transactions.fund_amount (default 0), stored when the payment starts; wallet_ledger_entries.recipient_type gains
-- 'fund' (recipient_id always 00000000-0000-0000-0000-00000000f00d, app/ledger.py FUND_ID); cash_debts gains
-- creditor_type ('driver' | 'fund'), driver_id nullable (null exactly for 'fund'), unique (transaction_id, creditor_type)
-- v2 (migration 0017, section 7.2): producers.stall_code text not null (unique lower()), producers.photo_fee numeric
-- (whole KSh, nullable), drivers.referral_code text not null (unique lower()), transactions.open_sale_id uuid
-- open_sales: id, producer_id, amount (whole KSh > 0), description, photo_fee (snapshot), status
--   ('open','paying','paid','expired','cancelled'), expires_at (+30 min), created_at, paid_at, cancelled_at;
--   at most one open/paying per maker; no browser access

-- login_failures   (migration 0013, section 5: failed logins, pruned after a day)
id    bigint generated always as identity primary key,
phone text not null,                       -- normalised 254XXXXXXXXX, registered or not
ip    text not null,
at    timestamptz not null default now()

-- login_lockouts   (migration 0013: one row per lockout; in force while locked_until > now())
id           bigint generated always as identity primary key,
kind         text not null check (kind in ('phone','ip')),
key          text not null,
locked_until timestamptz not null,
created_at   timestamptz not null default now()
-- account_audit_log also gains action 'login_locked' (party_type maker/driver/coordinator/unknown/ip, party_id nullable)

-- sync_queue_items   (true offline/no-connectivity capture — a still-unbuilt future concern,
-- distinct from cash-payment tracking, which now lives directly in `transactions` above via
-- payment_method + the cash_* statuses. Do not repurpose this table for cash — it's for the
-- separate case of no network at all, e.g. a fully offline PWA sync queue, if that gets built.)
id                uuid primary key default gen_random_uuid(),
payload           jsonb not null,
idempotency_key   uuid unique not null,
synced_at         timestamptz
```

Storage: one Supabase Storage bucket, `qr-codes` — public read, coordinator-only write.

## 4. Business rules — locked, do not reinterpret

1. **Two independent components.** Product and photo consent are never one bundled charge. Each producer toggles `charges_product` / `charges_photo` independently (at least one must be on). A transaction only carries the component(s) that actually applied to that visit.
2. **Photo consent never splits.** Paid 100% to the maker, always — no driver referral fee on it.
3. **Guaranteed artisan floor.** Within the product component, the maker's share can never fall below 60% — hard ceiling of 40% on `default_split_driver_pct`, validated when a producer's split is set, not just at transaction time.
4. **No platform fee, ever.** *(Revised 2026-10-22, approved by the user; SCOPE_V2 MUST 21, migration 0020.)* "Sawa Split keeps nothing. The product price is split FIXED: 80% creator, 15% site intermediary, 5% Conservation fund. No intermediary on the sale → 95% creator, 5% fund. The photo-consent fee stays 100% creator, not split. Whole shillings: intermediary = floor(15%), fund = floor(5%), creator gets the remainder. The Conservation fund is ring-fenced: never paid out by the payout engine, reported separately. No other fee, reserve or bucket." It applies when `SPLIT_MODEL=fixed`; `legacy` (the default) keeps the coordinator-set % (rule 3), and v1 signed price cards always split legacy. The split is computed once, when the payment starts, and stored on the transaction; every credit uses the stored amounts.
5. **Minimum amount:** KES 50 business floor (Daraja's own technical floor is KES 1).
6. **Failed/timed-out STK Push:** no ledger entry, no auto-retry. Tourist sees a plain retry message.
7. **Idempotent webhooks:** a redelivered Daraja callback (STK or B2C) is a no-op, never a double credit/payout.
8. **Unregistered driver QR or inactive producer:** rejected at scan time, before payment initiation.
9. **Withdrawals are always full-balance, never partial.** Threshold KES 500.
10. **Daily batch sweep at 18:00 EAT** first settles every maker → driver cash debt that M-Pesa earnings now cover (rule 12), then auto-withdraws anyone whose *payable* balance is ≥ KES 500 and who hasn't already withdrawn that day. Payable means M-Pesa-sourced only: a driver's available balance; a maker's available balance minus any debt still owed to drivers and the Conservation fund. The fund itself is never a payout recipient (rule 4). Withdrawals (rule 9) use the same payable balance. **B2C must never pay out more than M-Pesa collected:** before every B2C call the API checks that everything paid or being paid, plus this payout, fits within M-Pesa collected less the Conservation fund's balance, and that the payout fits within the recipient's own available entries. If not, it refuses and logs a critical error (`PayoutCapExceeded`) instead of paying. *(Revised 2026-10-09; it used to sweep the whole available balance, cash-sourced included.)*
11. **Payout failure:** funds return to `available`, one automatic retry, then requires manual coordinator retry. *Exception (2026-10-13):* a failure that means the initiator itself can't pay (ResultCode 8006 credential locked, 2001 initiator invalid) gets no automatic retry and pauses every payout until a coordinator resumes them (section 2.1), because each retry into a lock extends it.
12. **Cash is a first-class second payment method, tracked via dual confirmation — not an offline afterthought and not evidence-only.** Split into two enforcement cases by whether a driver is attached, because the enforcement mechanism differs:
    - **Case A — referred cash sale** (`driver_id` set): requires BOTH `driver_confirmed_at` and `maker_confirmed_at` to be set before the transaction moves from `cash_unconfirmed` to `cash_confirmed`.
    - **Case B — walk-up cash sale** (no `driver_id`): requires BOTH `tourist_confirmed_at` and `maker_confirmed_at`.
    - A `cash_unconfirmed` transaction still unconfirmed past `confirmation_deadline` (default 10 min, `CASH_CONFIRM_WINDOW_MINUTES`) flips to `cash_expired` — kept visible in the ledger and reconciliation view, never deleted, never silently retried.
    - **Only `cash_confirmed` transactions write `wallet_ledger_entries`.** A `cash_expired` transaction never does.
    - **Cash money is never paid out by B2C** *(revised 2026-10-09).* The tourist hands cash to the maker, so it never reaches the M-Pesa account. Paying it out again would pay the maker twice, and a faked cash sale would be paid out of other tourists' M-Pesa money. So, at `cash_confirmed`:
      - The maker's share is recorded as received (`cash_held` ledger entry). It never enters the maker's payable balance.
      - The driver's share (Case A) becomes a debt the maker owes the driver (`cash_debts`). It's settled internally, with no B2C call, by moving that amount from the maker's available M-Pesa-sourced balance to the driver's. This happens at confirmation if the maker has enough, otherwise as soon as they do (their next M-Pesa credit, a payout attempt, or the sweep). Debts settle whole, never partially. From then on the driver is paid by the normal rules (9–11).
      - A disputed cash sale's debt neither settles nor counts against the maker until the dispute is cleared (rule 13).
    - Consequence: a fake Case A sale (driver and maker colluding) nets the pair zero, since the driver gains exactly what the maker loses. A fake Case B sale moves no money at all.
    - **Known records gap (Phase 2):** Case B's tourist confirm token is returned to whoever calls `POST /transactions/initiate`, so a maker can create a walk-up cash sale on their own phone and confirm it as both tourist and maker. Since the fix above, that can't move any money; it can only put a sale that never happened into the records (cash recorded, a photo-consent record). It's a records problem, not a money one: Phase 2 should deliver the token only to the tourist's own device or SMS.
    - Full design rationale: `CASH_TRACKING_UPDATE.md`. Do not simplify this back to a single self-reported "log cash sale" form — that was an earlier, explicitly rejected design.
13. **Disputes:** a coordinator can freeze a transaction's ledger entries (`frozen` status), excluded from any withdrawal/batch calculation until resolved.
14. **No partial withdrawals, no automatic dispute resolution, no public self-registration, no multi-currency/KYC/tax handling** — all explicitly out of scope.
15. **Dynamic GPS/volume-scored referee commissions** — explicitly parked as a Phase 3+ pitch narrative, not built now. Use the fixed per-producer split only.
16. **Only `cash_confirmed` referred transactions count toward a driver's clean-referral streak** for any future commission-rate review — a `cash_expired` referral does not count. This is what gives the driver a reason to chase confirmation rather than let it lapse.
17. **Accounts are closed or suspended, never deleted** *(added 2026-10-09)*. All transactions and ledger history always stay.
    - **Closure is requested by the maker or driver, and approved by a coordinator.** The request comes from a "Close my account" form on their dashboard, with a reason required, and they can cancel it while it's pending. The coordinator approves or rejects it from a "Closure requests" list; rejecting needs a reason. Approval is refused while the account has any of these, and the screen says which: a cash sale awaiting confirmation, an open dispute, a payout in progress or failed and awaiting a retry, an unsettled cash debt (owed by this maker, or owed to this driver), or an active suspension. A debt the maker can already cover is settled first, so it doesn't block.
    - **On approval:** the account becomes `closing`, which means no new sales; the person can still log in to watch the payout. Its remaining payable balance (rule 10: M-Pesa-sourced, minus debts) is paid out by B2C, even below KES 500. Only when that payout succeeds is the account `closed`, or straight away if there's nothing to pay. If the payout fails, it stays `closing`, under the usual retry rules (rule 11).
    - **A closed account** can't log in: refused by `POST /auth/login`, plus a Supabase Auth ban. Its price cards and QR stop working, because checkout, initiate and the driver page all require `active`.
    - **Suspension is a coordinator's decision; no request is needed.** It requires a reason, and has a review date (default 7 days); the coordinator view flags overdue reviews. It blocks new sales and login, and the suspended person sees the reason at login and on any open session. Unsuspend is allowed, with a reason. Money earned honestly stays owed and is still paid by the normal rules, including the sweep. Only disputed sales stay frozen, until resolved (rule 13).
    - **Audit log (`account_audit_log`):** append-only. It records every request, cancel, approve, reject, closure, suspend and unsuspend, with who, when and why, and the coordinator can read it. Nobody can edit or delete entries; database triggers refuse it, the API's own connection included.

## 5. Auth model

Four roles, no public self-registration:

- **Tourist** — no account. The public pay-initiate endpoint is the only surface, rate-limited per phone number. Cash Case B confirmation (rule 12) also needs no login — use a short-lived signed token tied to the transaction id, delivered via whatever already shows the tourist the price-transparency card (an in-page "I paid" button if she's still on the payment screen, or an SMS link if not). Do not require Supabase Auth for this — it would contradict "no account for tourists."
- **Producer / Driver** — coordinator-onboarded via Supabase Auth's admin API, phone number as identifier + a 4-digit PIN issued in person. Logs in with phone + PIN (login limits below). Cash-confirmation taps (rule 12, Case A/B for maker; Case A for driver) happen from their authenticated dashboard session. A suspended or closed account (rule 17) is refused at login and on every API call, with the reason; a closed one is also banned in Supabase Auth.
- **Coordinator/Admin** — same Supabase Auth mechanism, account carries an `is_admin` claim.

Enforced twice: Supabase Row Level Security at the data layer, FastAPI endpoint checks at the API layer. **The browser never writes to the database, for any role** *(migration 0012, 2026-10-09)*. The browser roles `anon` and `authenticated` hold SELECT and nothing else on every table, and there are no write policies at all. So no browser (maker, driver, coordinator or tourist) can insert, update or delete a row, whatever it sends with the Publishable key. Every change, including every coordinator action, goes through the FastAPI endpoints, which check who's calling and write with their own direct connection. That connection is the only writer, and its credentials and the Secret key are never exposed to the frontend. Default privileges keep any future table the same; `scripts/verify_security.sh` checks all of it.

**Login attempt limiting** *(migration 0013, 2026-10-11)*. A 4-digit PIN has only 10,000 values, so `POST /auth/login` enforces limits, stored in the database (`login_failures`, `login_lockouts`) because Render's free instance restarts on wake. Implemented in `app/login_limits.py`:
- **Per phone:** 5 failed attempts within 15 minutes lock that phone for 15 minutes. The phone is normalised, so `+2547…`, `2547…` and `07…` count as one.
- **Per IP:** 20 failures within 15 minutes lock that IP, so one person can't spray guesses across many phones. On Render the IP comes from Cloudflare's `CF-Connecting-IP`, which the client can't set.
- **While locked:** the PIN isn't even checked. The answer is a plain 429, "Too many attempts, try again in 15 minutes."
- **Same answer either way:** a wrong PIN and an unregistered phone get the same "Invalid phone or PIN", and an unregistered phone still costs a full bcrypt check, so neither the message nor the timing reveals which phones exist.
- **Counters and audit:** a successful login clears that phone's failures. Every lockout is written to `account_audit_log` (`login_locked`).
- **Supabase sign-in failure is not a PIN failure** *(SCOPE_V2 MUST 11)*. When the PIN is right but Supabase Auth's sign-in fails, `POST /auth/login` retries once on 429 or 5xx. If that still fails, it answers 503 "Couldn't sign you in right now, try again in a moment." (it used to say the PIN didn't match). Every login outcome is logged (`sawa.auth`: phone, IP and result, never a PIN or token). The PIN field has autocomplete off, so a shared phone doesn't autofill another account's PIN.
- **bcrypt:** cost 10, and the checks run in a worker thread, not on the event loop. A PIN stored at another cost is re-hashed after its next successful login.

Three values are secret even from their owners, because each would let someone aim a forged Daraja callback or confirmation:
- `checkout_request_id` and `tourist_confirm_token` live in `transaction_secrets`;
- the B2C correlation key (`idempotency_key`, sent as `OriginatorConversationID`) lives in `withdrawal_secrets` (migration 0016). With it, a fake "failed" callback during a real payout could trigger the automatic retry and pay twice.

No browser role can read either table, and Realtime doesn't stream them. `auth_credentials` is likewise unreadable.

Permission matrix. **Browser** is a direct read through Supabase with the Publishable key; **API** is a FastAPI endpoint:

| Role | producers/drivers | transactions | wallet_ledger_entries, cash_debts | withdrawal_requests | closure_requests, suspensions, audit log | transaction_secrets, auth_credentials |
|---|---|---|---|---|---|---|
| Tourist | — | API: create (pay endpoint), confirm own Case B cash sale (token) | — | — | — | — |
| Producer/Driver | browser: read own. Never write (status, split, phone, Till: coordinator only) | browser: read own. API: confirm own cash sale | browser: read own | browser: read own. API: withdraw | browser: read own closure requests. API: request/cancel own closure | — |
| Coordinator | browser: read all. API: register | browser: read all. API: dispute/resolve, check payment | browser: read all | browser: read all. API: manual retry | browser: read all. API: approve/reject, suspend/unsuspend | — |
| Anyone, browser | no writes on any table, ever | | | | | no reads either |

## 6. Money-movement sequence

1. `POST /transactions/initiate` — for `payment_method: mpesa`, STK Push fires. For `payment_method: cash`, no Daraja call — the transaction is created directly in `cash_unconfirmed` status with `confirmation_deadline` set (`created_at + CASH_CONFIRM_WINDOW_MINUTES`).
2. **M-Pesa path:** `POST /daraja/stk-callback/{token}`. Each STK Push gives Daraja its own callback URL, whose token is an HMAC of the transaction id (`app/links.py`). The backend checks three things, in order:
   - The token. Without this sale's token the callback is refused (403), so a POST to the public endpoint can't pose as Daraja.
   - The reported `Amount`. It must equal the whole-shilling total the STK Push asked for, or the callback is refused (400) and flagged.
   - The transaction reference, idempotently (rule 7).

   Then Safaricom itself is asked (STK Push Query, `app/verification.py`), as `STK_QUERY_MODE` says:
   - **`flag`** (default; sandbox and demo): credit at once, writing `pending` ledger entries for the maker (product_maker_amount + photo_amount, whichever enabled), only if `product_enabled` for the driver, and for the Conservation fund when the stored `fund_amount` is above 0 (fixed split, rule 4). The amounts come from the transaction as stored when the payment started, never recomputed. Then query in the background with retries (about 19 minutes), and flag a "not paid" or never-answered result to the coordinator under Reconciliation → Payment checks.
   - **`enforce`**: the sale becomes `verifying` ("Payment being verified") and nobody is credited until Safaricom confirms. A "no" fails the sale. A query that never answers leaves it verifying and flagged; the coordinator can "Check again".

   **Production must use `enforce`.** `flag` exists because the sandbox query is unreliable; in flag mode a forged-but-signed callback would be credited before it's flagged.
2b. **Cash path (parallel to step 2):** `POST /transactions/:id/confirm` is called once by each required party per rule 12 (driver+maker for Case A, tourist+maker for Case B), and sets the corresponding `*_confirmed_at` field. Once all required confirmations for that transaction's case are present, status flips to `cash_confirmed`. Then the maker's share is written as a `cash_held` ledger entry (never payable), and the driver's share, if any, opens a `cash_debts` row that settles from the maker's M-Pesa-sourced balance as described in rule 12. With the fixed split the fund's share opens its own `cash_debts` row (creditor `fund`) that settles the same way, and waits the same way while the sale is disputed. Cash never reaches steps 4–5 itself; only a driver's settled share does, and that is M-Pesa money moved from the maker. If `confirmation_deadline` passes first, status flips to `cash_expired` instead and nothing is written for that transaction.
3. Balance becomes `available` once cleared for payout eligibility. After every STK credit, the maker's outstanding cash debts are settled if the new balance covers them.
4. `POST /withdrawals/request` (on-demand, full payable balance, ≥ KES 500) or the 18:00 EAT batch sweep (rule 10: settles debts first) triggers Daraja B2C, with a generated idempotency key, after the never-more-than-M-Pesa-collected check.
5. `POST /daraja/b2c-callback` — marks the ledger entry `paid`, or on failure returns funds to `available` (one automatic retry, then manual coordinator retry).
6. `GET /admin/reconciliation` — M-Pesa collected vs. disbursed vs. still owed, which always sums exactly and matches the real M-Pesa account balance: collected = creators + intermediaries + Conservation fund = paid out + still owed. The fund is reported on its own line ("Conservation fund: KSh X — held for a partner community conservancy, transferred monthly (two approvals) once signed."); there is no transfer feature yet. Cash recorded and outstanding maker → driver and maker → fund debts are shown separately, beside these totals, never in them.

## 7. Frontend — design tokens and screens

Full interactive reference: the published Design Reference artifact (color/type/component specimens) and the published Wireframes canvas (all 8 screens, including the two-component price card). Key tokens:

```css
--sawa-bg: #FAFAF8; --sawa-surface: #FFFFFF; --sawa-text: #1A1A1A; --sawa-text-muted: #6B6B63;
--sawa-border: #E4E2DA; --sawa-green: #1E5B3A; --sawa-terracotta: #8C1D1D; --sawa-ochre: #9B661D;
--sawa-radius: 8px; --sawa-space: 8px;
```

**Pay-button ochre (2026-10-18):** `--sawa-ochre` is **#9B661D** (was #B97A22): white button text on the old value was 3.58:1, below WCAG's 4.5:1 for its 15px text; the new value is 4.87:1, same hue and saturation, slightly darker. **Approved deviations (2026-10-18, requested by the user; don't revert them):** the page background `--sawa-bg` is warm sand **#FAF6EE** (was #FAFAF8; cards and forms stay white, muted text measures 4.98:1 on it; the printable stand page keeps #FAFAF8); the footer is navy #1B2A41 with white text and white underlined links; `/#/demo` uses the hero's navy→teal background (`frontend/src/lib/brandBackground.js`) with its step in a white card with **24px** corners (a demo-only exception to the 8px radius); the homepage problem section has a photo under an 80% navy overlay (see 7.1). Inter (UI/words) + IBM Plex Mono (numbers only, tabular-nums). Mobile-first, 420px max-width card-centered, except the coordinator reconciliation view (full width past 768px, plain table, never a chart) and the public homepage (full width, its own layout — see 7.1). Status states: pending / confirmed / failed for M-Pesa, plus `cash_unconfirmed` / `cash_confirmed` / `cash_expired` for cash — render the cash states visibly distinct from the M-Pesa three (an unconfirmed cash sale is "still resolving," not "flagged as wrong," so it should not look like a disputed transaction). No gradients, no stock photography (the homepage's one exception is scoped separately in 7.1), no icon without a text label. Screens: **public homepage** (7.1), price-transparency card (two component cards, not merged), payment entry (M-Pesa "Pay [amount]" button plus a "Cash" option that creates the transaction directly and moves to a waiting-for-confirmation state), confirmation (for cash, shows the honest `cash_unconfirmed`/`cash_confirmed` state rather than a premature checkmark, and is where a Case B tourist taps her own confirm), shared producer/driver/coordinator login, producer/driver dashboard (recent-transactions list needs the cash states as a visibly distinct status, plus an inline "Confirm" action on any row awaiting this user's own confirmation), coordinator registration (with the charges-for toggle), coordinator reconciliation (status column includes all three cash states as distinct, visible entries — expired-unconfirmed cash rows are what a coordinator should notice first), dispute-flag action (modal off a table row, not its own screen), coordinator accounts (rule 17: closure requests with their blockers and Approve/Reject, makers and drivers with Suspend/Unsuspend and overdue reviews flagged, the audit log). The producer/driver dashboard ends with "Close my account" (rule 17).

## 7.1 Public homepage — content, layout, and photography rule

A ninth screen, added late in planning: a public marketing homepage (`/` on the frontend, no login) that explains the solution and showcases the design system to anyone who lands on it — judges included. It's the one screen in this app allowed to use real photography, and even there, only sparingly and on the terms below.

**Photography rule — read before sourcing anything:** the design system already rejects "stock tourist photography" (see section 7 and the Design Reference's "what to leave out" list) — the glossy, posed, brochure look. This page can use **one** real photo, sourced from a properly licensed source, treated as background texture rather than hero content:

- Source from the **Unsplash License** (free for commercial and noncommercial use, no permission needed, attribution appreciated but not required) or, if using Wikimedia Commons/Pexels under CC-BY, **credit the photographer in the page footer** — don't skip attribution if the license requires it.
- Pick something documentary and candid — someone actually working (weaving, cooking, at a stall), not smiling posed at the camera. Search terms like "East Africa artisan craft market" or "Kenya coast market stall" over anything with "safari" or "tourism" in it, which skews toward the brochure look this system rejects.
- Treat it, don't present it raw: duotone or color-wash it toward `--sawa-green` at low opacity so it reads as part of this palette, not a separate photographic layer bolted on. No caption needed if it's just texture; if it's more prominent, keep alt text factual, not romanticized.
- If a real photo from your own Phase 0 site visit becomes available later, swap it in — that's strictly better than a sourced one and needs no license handling at all.

**Sections, in order:**

1. **Hero.** *(2026-10-18, approved exception: the hero now uses a photo: a sunset craft stall with a phone showing the checkout, `frontend/src/assets/hero-bg-v2-1920.webp` / `hero-bg-v2-960.webp` (2026-10-22: same composition and 1.875 ratio, its phone now reads Creator / Site intermediary; replaced `hero-1717.webp` / `hero-960.webp`; served with srcset 1920w/960w, eager, high priority, alt=""). The outline button "Bring Sawa Split to your market" has a 65% navy fill (`onDarkOutline`), so its white text stays ≥ 4.5:1 where the photo behind it is bright (390×844, 360×640). Wide screens: full-bleed, ~85vh, a navy left-to-right gradient behind the text, the phone kept visible on the right; phones: the text on a navy band, the photo below anchored on the phone. Eyebrow "Fair pay for Kenya's makers and guides"; buttons "Try the demo" and "Bring Sawa Split to your market" (to Contact). The phone mock-up and the bead-dot gradient were removed from the hero; /#/demo keeps the gradient. **Known issue, accepted for now:** the logo on the phone and QR stand in the photo is not our bead logo; regenerating the image with it is a file swap.)* Headline "Every shilling has an address." + subhead "Tourists scan a stall's QR, see exactly who earns what, and pay by M-Pesa. Sawa Split splits it on the spot. No platform fee." *(Revised 2026-10-17; it used to be the PRD's one-line summary.)* **Hero background — a deliberate, hero-only exception to "no gradients" and to the token palette (2026-10-18, requested by the user):** navy #1B2A41 → #1468A8 → sea teal #1FB5A8, under a 15%-opacity tile of the logo's bead colours (#E4572E, #FFB627, #2E86DE, #3BB273), CSS and inline SVG only. Text stays over the navy end (white, ≥ 4.5:1; measured ≥ 9.5:1 at 390px), the light teal only behind the phone mock-up, and its buttons use the "onDark" variants in `Button.jsx`. No other screen gets gradients or these colours; don't "fix" this one back. Visual: the price-transparency card component itself, rendered live (not a screenshot) as the hero graphic — no photo here, this is the "no photography needed, the product is the visual" moment. Two CTAs: primary "See it work" (scrolls to or links the live demo/reconciliation view), secondary "Read the rulebook" (links out, e.g. to the published Rulebook reference).
2. **The problem.** *(2026-10-18: now over a photo, "Talek River at Talek, Kenya" by Daniel Case, CC BY-SA 4.0, taken near Talek gate, cropped to exclude the one person in it, toned and compressed to WebP; caption "Near Talek gate, Maasai Mara", credit linked to the licence. It is not the 2005 study village.)* The boma stat as a large mono numeral callout — "KSh 300 of every $20 paid at the gate" — with a short paragraph underneath and a source line (Prescott College students, "A Scandal in Maasailand…", Maasai Cultural Preservation Project, June 2005: in 2005 the village kept KSh 300 (US$3.50) of the $20, 17.5%; early 1990s about half). Text and numerals only, no photo, no chart (this system doesn't use charts to dramatize a number — the number itself, set huge in Plex Mono, is the visual).
3. **How it works.** Three steps — "Scan the stall" → "See every share" → "Pay, and it splits" — plus a "Credited instantly, paid out daily" note, using simple line icons (never emoji) each paired with a text label, consistent with the "icon never alone" rule.
4. **Who it's for.** The one licensed photo lives here, as a duotoned background behind or beside four short persona blurbs, each with a matching outline icon (tourist, producer, "Guides, drivers and agents", coordinator).
4b. **Why it can be trusted.** No platform fee; prices can't be changed (signed); everyone verified in person by a coordinator; every action on a permanent record.
5. **Roadmap.** A plain text/timeline strip: Pilot → Local Scale → Multi-Site (from the Implementation Plan's Phase 1–3), then "Next: per-member group payouts, Kiswahili, instant M-Pesa payouts". No photo, no chart.
6. **Footer.** Link to the live demo (no GitHub link: the repo is private), the challenge name, and photo attribution if the license requires it.

## 7.2 v2: open sales, stall QR and referral codes *(SCOPE_V2.md, binding; migration 0017)*

Anything not in `SCOPE_V2.md` needs asking first. The split engine stays maker + one referrer, and v1 (signed price cards, tag `v1-demo`) keeps working unchanged.
- **Codes.** Each referrer has `drivers.referral_code` (e.g. JAMES) and each maker `producers.stall_code` (e.g. WANJIRU). Both are unique and case-insensitive, generated from the first name at registration (a number is appended when taken: JAMES2). `/#/driver/<code>` accepts a referral code or the old QR code (QR-DRIVER-001).
- **Tour pass.** The referrer page's "Use <first name> as my guide today" saves the code in `localStorage` until midnight EAT (`frontend/src/lib/tourPass.js`). It tolerates missing storage.
- **Open sale.** The maker's dashboard → New sale: agreed amount (whole KSh, total ≥ KSh 50 per rule 5), optional description, and optional photo consent (`producers.photo_fee`, set at registration). `open_sales` rows are single use, expire after 30 minutes, are cancellable while open, and a maker has at most one open or paying sale. Starting a payment holds the sale (`paying`). A confirmed payment makes it `paid`; a failed STK Push, a Safaricom "not paid" or an expired cash sale releases it (`open` again within its 30 minutes, else `expired`). Paid, expired and cancelled sales refuse payment with a plain message.
- **Stand QR and checkout.** One static QR per maker opens `/#/stall/<stall code>`, which polls the public API and shows the open sale or "Waiting for the seller to enter the amount". Checkout pre-fills the tour-pass code (editable, removable) and shows the referrer's first name only. **The server computes the breakdown** (`app/sales.py`): referrer = the agreed amount × the maker's coordinator-set % (≤ 40), **rounded down** to whole shillings; maker = the rest, plus the photo fee (never split); no code = maker 100%. The parts always add up, and the maker's floor holds. Payment then runs the same M-Pesa or cash code as a price card (`transactions.start_payment`), with all of sections 4–6 unchanged.
- **API.** Public: `GET /public/stalls/{code}`, `GET /public/sales/{id}?ref=`, `POST /public/sales/{id}/pay`. Maker only: `POST /sales`, `GET /sales/current`, `POST /sales/{id}/cancel`. `open_sales` has no browser grants, RLS with no policies, and isn't streamed by Realtime.
- **Reconciliation** adds Referrers: sales count and commission per referral code.
- **Tests:** `backend/scripts/verify_v2.sh` on the test project, using cash and simulated M-Pesa, never STK or B2C.

## 7.3 Glossary: UI terms vs internal names *(2026-10-20)*

What people read on screen (frontend text, user-facing API messages, docs for users) uses the left column. Code, the database, API fields, routes and this brief's rules keep the internal names on the right. Never rename an identifier, column or route to match the UI.

| UI term | Internal name |
|---|---|
| Creator (creators) | maker / producer (`producers`, `maker_amount`, `recipient_type = 'maker'`) |
| Site intermediary (site intermediaries); "Intermediary · <Name>" in tight spots (checkout breakdown, receipts, badges) | driver / guide / agent / referrer (`drivers`, `driver_amount`, `referrer_type`, `/#/driver/<code>`) |
| The type, as a detail after the role: "Site intermediary · driver / tour guide / agent" | `drivers.referrer_type` (`driver`, `tour_guide`, `agent`) |
| Intermediary code | `drivers.referral_code` |
| "Sawa Split keeps nothing." | rule 4 (no platform fee) |

"Still with <Name>?" stays as it is. The pitch-day "Driver" in `DEMO_SCRIPT.md` (the person at the laptop) is a presenter role, not the app role.

## 8. Build stages — work in this order, commit at each checkpoint

Don't generate the whole app in one pass. Each stage should end in something that runs and is committed before the next stage starts.

1. **Repo scaffold.** `/backend` (FastAPI project skeleton, `requirements.txt`, `.python-version` already pinned) and `/frontend` (Vite + React + Tailwind skeleton) as two subfolders in `sawa-split`, or two repos if you'd rather — your call, just be consistent with what Render will point at. Checkpoint: both run locally with a placeholder "hello" route/page.
1.5. **Public homepage (can happen any time after stage 1 — no backend dependency).** Build the marketing homepage per section 7.1. Good to do early: it's demoable progress with zero backend risk, and it's the page most likely to be open when a judge first looks at your work.
2. **Database schema.** Turn section 3's SQL into actual Supabase migrations (SQL editor or a migration tool, your choice). Checkpoint: all six tables exist in Supabase with the constraints in place, verified by inserting one test row per table by hand.
3. **Auth.** Coordinator-created accounts via Supabase Auth's admin API (phone + PIN), login endpoint, RLS policies matching the permission matrix in section 5. Checkpoint: you can log in as a test producer and a test coordinator and get different access.
4. **Core backend endpoints (no Daraja yet).** `/transactions/initiate` and the ledger-writing logic, using a manually-triggered "fake confirm" instead of a real Daraja callback for now. Also build the cash dual-confirmation path here (rule 12, `POST /transactions/:id/confirm`) — it shares the same ledger-writing logic once a transaction reaches its confirmed state, so it's a small parallel branch, not a separate subsystem. Checkpoint: a fake M-Pesa transaction and a cash transaction (both Case A and Case B) each correctly write ledger entries split per section 4's rules.
5. **Daraja integration.** Real STK Push, real callback handling, idempotency check, then B2C payout + its callback. Checkpoint: one real sandbox transaction goes all the way from STK Push to a ledger entry moving from `pending` to `available`.
6. **Batch sweep.** APScheduler job for the 18:00 EAT sweep, on-demand withdrawal endpoint. Checkpoint: a withdrawal actually triggers B2C and the ledger entry reaches `paid`. *(Revised 2026-10-09: originally "for both an M-Pesa-sourced and a cash-sourced ledger entry". Cash is no longer paid out by B2C at all (rule 12), so only M-Pesa-sourced entries, including a driver's share moved from a maker by debt settlement, ever reach `paid`.)*
7. **Frontend screens, wired.** Build against the wireframes/design tokens in section 7, screen by screen, each one talking to the real backend as soon as it exists — price card and payment entry first (they depend on stage 4-5, including the Cash option), then confirmation, then producer/driver dashboard (with the confirm action), then coordinator login/registration/reconciliation last.
8. **Reconciliation + disputes.** The coordinator view (collected/disbursed/pending tiles + table, with the three cash states visible) and the dispute-flag action that freezes ledger entries.
9. **End-to-end rehearsal.** Run the exact sequence in `DEMO_SCRIPT.md` for real, on the actual deployed Render URLs, not localhost — this is also when the backup screen recording gets made (see `DEMO_SCRIPT.md` section 5).

## 9. Phase 1 scope — definition of done

Per the Implementation Plan: formalize the pilot agreement, co-design/print the price-transparency card, confirm the producer's Till, **build the MVP** (QR generation, Daraja sandbox split logic, cash dual-confirmation split logic, transaction log), print the driver's QR, run the pilot 2–3 weeks. Done when: **at least one real, end-to-end transaction — tourist pays, ledger credits, a successful withdrawal — logged and demonstrable**, matching the Demo Script's live-demo beat exactly (STK Push → split lands → ledger updates in real time on the reconciliation view).

## 10. Explicitly not building yet

Production Daraja B2C approval (parallel-tracked, not a blocker for sandbox demo), dynamic GPS-scored referee commissions, dark mode (tokens exist, implementation deferred), any platform fee or any fund other than the Conservation fund of rule 4 (and no transfer feature for that fund yet), partial withdrawals, automatic dispute resolution, multi-currency/KYC/tax handling, public self-registration, geofencing on cash confirmation (same-site check — a Phase 2 hardening step, not a Phase 1 blocker), true offline/no-connectivity capture (`sync_queue_items` exists in the schema but is unbuilt — not the same thing as cash tracking, see section 3).

**Known post-pitch item: sign the B2C result URL per payout.** STK callbacks arrive at a per-transaction signed URL (`/daraja/stk-callback/{token}`); B2C result callbacks still arrive at the unsigned `/daraja/b2c-callback`. Hiding the correlation key (migration 0016) closes the practical double-pay path, since a forger can't name a payout. Signing `/daraja/b2c-callback/{token}` per withdrawal, as for STK, is the defence-in-depth step, deliberately left until after the pitch.

**Known pilot limitation: price cards are signed per maker + driver pair.** Each card's signature (`app/links.py`) covers the producer, the prices *and* the driver's QR code, so every driver who brings tourists to a stall needs their own printed card for that stall. That's fine for the pilot's one or two pairs but won't scale. Phase 2 should sign only producer + prices and attach the driver separately at checkout (for example, by scanning the driver's own QR card, which already opens `#/driver/<code>`).

## 11. Environment variables (names only — values come from where you saved them, never from this chat)

Backend: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (Secret key), `DATABASE_URL` (asyncpg, `ssl=True` not `"require"`), `DARAJA_CONSUMER_KEY`, `DARAJA_CONSUMER_SECRET`, `DARAJA_SHORTCODE`, `DARAJA_PASSKEY`, `DARAJA_B2C_SHORTCODE`, `DARAJA_INITIATOR_NAME`, `DARAJA_SECURITY_CREDENTIAL`, `DARAJA_CALLBACK_BASE_URL`, `CORS_ORIGINS` (comma-separated frontend URLs allowed to call the API; defaults to the local Vite dev server), `CHECKOUT_LINK_SECRET` (HMAC key that signs price-card links and, under its own label, each STK Push's callback URL, `app/links.py`; every printed card and the demo link are signed with it, so use the same value everywhere the API runs, and expect every card to stop working if it changes), `HEALTH_TIMING_KEY` (optional secret: sent as the `X-Health-Timing-Key` header, it unlocks `GET /health`'s full timings; empty disables them, and the public `/health` stays a cheap database check), `STK_QUERY_MODE` (`flag` or `enforce`, default `flag`: how STK Push Query verification gates crediting, section 6 step 2. **Production must set `enforce`**), `SPLIT_MODEL` (`legacy` or `fixed`, default `legacy`: how an open sale splits, rule 4; stored on each transaction, so changing it never re-splits a sale already made), `CASH_CONFIRM_WINDOW_MINUTES` (default 10 — kept as an env var, not a hardcoded constant, since the right window is genuinely unknown until Phase 0/1 field testing).
Frontend: `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_API_BASE_URL` (the backend's URL), `VITE_PUBLIC_APP_URL` (the frontend's own public URL, encoded into every printed QR: driver cards and price cards; unset, it falls back to whatever URL the coordinator's browser is on, so set it to the Render URL in Stage 9 and then re-run `frontend/scripts/regenerate-driver-qrs.mjs` so existing driver cards point there too).

Set these as a Render Environment Group once the two Web Services exist (deferred from Phase G on purpose) — never commit them to the repo.
