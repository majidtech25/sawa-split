# Sawa Split — Project Brief for Claude Code

**Purpose of this file:** everything locked during planning, consolidated into one build-ready brief. This file lives at the repo root as `CLAUDE.md`, so Claude Code loads it automatically at the start of every session in this repo — no need to re-paste it. Where this brief says "locked," treat it as non-negotiable — those are explicit decisions the team already made, not defaults to reconsider mid-build.

**Full detail behind this brief lives in `/docs`:** `PRD.md` (personas, user stories, success metrics), `TRD.md` (full non-functional requirements), `APP_FLOW.md` (step-by-step per persona), `UI_UX_DESIGN.md`, `BACKEND_SCHEMA_AUTH.md`, `IMPLEMENTATION_PLAN.md`, `DEMO_SCRIPT.md`, `CASH_TRACKING_UPDATE.md` (cash dual-confirmation design — read this before touching anything cash-related). This brief is the condensed, always-loaded version — read the relevant doc in `/docs` if something here is ambiguous or you need the fuller reasoning behind a rule.

## 0. What this is

**What we're building:** a transparent, point-of-sale value-split payment app. A tourist pays once via M-Pesa or cash; the payment automatically splits between the woman/PWD producer who made the value and the driver who referred the sale — and separately compensates the producer for photo consent. Every shilling collected is either the maker's or the driver's — **there is no platform fee, ever.**

**Who it's for:** four users, in order of who touches it most: the tourist (no account, pays once), the producer/maker (a woman or PWD artisan/cook/performer, wants a guaranteed transparent share with no dependency on a driver handing over cash), the driver/guide (wants a disclosed, guaranteed referral fee instead of pressuring a sale), and the coordinator (onboards people, watches the ledger, resolves disputes).

**Visual style we're aiming for:** minimal, fintech-restrained — quiet confidence, not startup energy. Two accent colors with single jobs (green for confirmed/success, ochre for the one "Pay" button, terracotta for errors only), one type family for words (Inter) and one for numbers (IBM Plex Mono, tabular), one 8px radius everywhere, one 8px spacing grid. No gradients, no stock tourist photography, no icon without a text label, nothing that reads as generated-in-five-minutes. Full spec in section 7 and the published Design Reference artifact.

**The core it needs to prove, end to end, by the demo:** a real tourist payment splits automatically and correctly between maker and driver (with photo consent as its own component), the ledger updates live, and at least one withdrawal actually pays out — on real (sandbox) Daraja, not mocked. Cash payments prove the same split via dual confirmation instead of Daraja (see section 4 rule 12).

This is an MVP for the Future Leaders Challenge Eastern Africa, built for a live demo, not a production system yet.

## 0.1 Your role and working constraints

You are the engineer implementing this MVP. Treat section 4 (business rules) and section 5 (auth model) as fixed requirements handed down from a locked product spec, not open design questions — if something there seems wrong or incomplete, flag it back to the user rather than silently deciding differently. Concretely:

- **Don't invent scope.** If it's listed under section 10 ("explicitly not building yet"), don't build it, even as a stub that half-works — a half-built platform-fee field is worse than no field.
- **Don't restyle.** Use the exact tokens in section 7. If a screen needs something the tokens don't cover, ask, don't improvise a new color or a second radius.
- **Don't skip the build stages below out of order** (same discipline the planning phase used) — each stage should be working and committed before the next one starts, so a demo is always possible from wherever the build currently stands, not just at the very end.
- **Prefer boring and correct over clever.** This is a payments ledger for real people's earnings — the append-only ledger, the idempotency keys, and the full-balance-only withdrawal rule all exist specifically to remove entire classes of bugs; don't "simplify" them back in. The cash dual-confirmation flow (section 4 rule 12) exists for the same reason — don't collapse it back into a single self-reported log.
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
- Don't hand-edit the service worker if a PWA layer gets added later — this broke Operix's PWA once.
- Render's free tier has no shell access — plan migrations/seeding to run via a startup script or a one-off local connection, not `render ssh`.
- **`DATABASE_URL` must be Supabase's Session pooler (port 5432), never the Transaction pooler (port 6543)** — the latter runs PgBouncer in transaction mode, which cannot support prepared statements no matter how asyncpg/SQLAlchemy are configured (confirmed: `DuplicatePreparedStatementError`, unfixable client-side). Session mode gives each connection a dedicated backend, so prepared statements work normally. Both pooler strings look almost identical in the dashboard — the port number is the only tell.
- Plain `ssl=True` against Supabase's pooler fails with `self-signed certificate in certificate chain` (full cert-chain verification against system CAs doesn't trust the pooler's cert). The fix — skip chain/hostname verification — must be built as a **fresh `ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)`**, not `ssl.create_default_context()` with verification switched off afterward; the latter hangs indefinitely on asyncpg's `start_tls` against this pooler specifically, even though the override is otherwise equivalent.
- Supabase's **Phone auth provider is disabled by default** on a fresh project — the Admin API can still create phone-based users regardless, but the sign-in endpoint (`/auth/v1/token?grant_type=password` with `phone`) fails with `phone_provider_disabled` until Authentication → Sign In / Providers → Phone is explicitly enabled. It also needs *some* SMS provider configured in that same panel to fully save/activate, even though this app never sends an OTP — placeholder Twilio credentials are enough.
- Supabase Cloud enforces a **hard 6-character minimum password length that cannot be lowered**, even though the dashboard exposes a "Minimum password length" field that implies otherwise (confirmed: this is a managed-Cloud platform limit, not a config value — self-hosted GoTrue's `GOTRUE_PASSWORD_MIN_LENGTH` doesn't apply here). A 4-digit PIN can never be Supabase Auth's own password; see `app/routers/auth.py` / `auth_credentials` for how the PIN is decoupled from it.
- This dev environment's network path to Supabase's pooler is itself slow/jittery (several seconds per connection, with an outright stall roughly 1 in 5 attempts) — bound every asyncpg connection with an explicit `timeout` (`app/db.py` uses 10s) so a bad network path fails fast and loud instead of hanging a request indefinitely. Expected to be a non-issue once deployed to Render's own network, but keep the timeout regardless as cheap insurance.

## 2.1 Daraja sandbox findings — learned the hard way in stage 5

- **Two different shortcodes.** B2C `PartyA` is **600979** (`DARAJA_B2C_SHORTCODE`). STK Push / C2B uses **174379** (`DARAJA_SHORTCODE`). Don't swap them.
- **The B2C recipient must be 254708374149**, Safaricom's sandbox test MSISDN. Any other number fails with ResultCode **2040** ("Credit Party customer type … can't be supported"). That's why the stage-3 test producer's phone is 254708374149: a withdrawal pays the recipient's own phone.
- **ResultCode 8006 means the initiator's security credential is locked.** Fix it by regenerating the credential in the Daraja portal's Test Credentials panel and pasting it into `DARAJA_SECURITY_CREDENTIAL`. Don't retry in a loop: every failed attempt against a locked initiator can extend the lock.
- **In `.env`, keep comments on their own line.** A value like `DARAJA_B2C_SHORTCODE=600979# comment` loads as the whole string, comment included, and goes out as `PartyA`. This regressed twice.
- **Running `backend/scripts/verify_stage5.sh`:** pipe it through `tee` only with `set -o pipefail`, otherwise tee's exit status hides failures. Its Test 3 withdraws the producer's full balance, which must reach KES 500 after the run's KES 45 STK credit, so the producer needs at least KES 455 available first. The old KES 600 fixture entry behind that was Stage 5 debug data and was deleted on 2026-10-07 (it made reconciliation unbalanced). Fund the balance with a confirmed cash sale instead, the way `verify_stage6.sh` does.
- **A sandbox STK Push to a real phone number charges real money.** Confirmed: KES 60 was deducted and is not refundable. Safaricom's test MSISDN no longer reliably auto-completes STK, so a real number is the only reliable way to get a callback, and each attempt costs the full amount. The script's STK payer comes from `STK_PAYER_MSISDN` (`.env` only, never committed). Keep the test amount at the KES 50 + 10 minimum.
- **B2C in sandbox only pays the test number**, so a sandbox payout never reaches a real producer's or driver's phone.

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
active        boolean not null default true,
created_at    timestamptz not null default now(),
constraint producers_at_least_one_component check (charges_product or charges_photo)

-- drivers
id            uuid primary key default gen_random_uuid(),
name          text not null,
phone         text unique not null,
till          text not null,
qr_code       text unique not null,
active        boolean not null default true,
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
status                text not null check (status in ('initiated','confirmed','failed','disputed','cash_unconfirmed','cash_confirmed','cash_expired')),
driver_confirmed_at   timestamptz,          -- cash Case A (driver_id set): driver's confirm tap
maker_confirmed_at    timestamptz,          -- cash Case A and Case B: maker's confirm tap
tourist_confirmed_at  timestamptz,          -- cash Case B (no driver_id): tourist's confirm tap
confirmation_deadline timestamptz,          -- cash only: created_at + CASH_CONFIRM_WINDOW_MINUTES (default 10)
created_at            timestamptz not null default now(),
constraint transactions_at_least_one_component check (product_enabled or photo_enabled)

-- wallet_ledger_entries   (append-only — balances are computed, never stored directly)
-- Written identically for mpesa and cash transactions, once each has reached its own
-- "money has actually moved" point: the STK callback for mpesa, cash_confirmed for cash.
id              uuid primary key default gen_random_uuid(),
recipient_type  text not null check (recipient_type in ('maker','driver')),
recipient_id    uuid not null,
amount          numeric not null check (amount > 0),
status          text not null check (status in ('pending','available','paid','frozen')),
transaction_id  uuid references transactions(id),
created_at      timestamptz not null default now()
-- index: (recipient_type, recipient_id, status) for fast balance queries

-- withdrawal_requests
id                uuid primary key default gen_random_uuid(),
recipient_type    text not null,
recipient_id      uuid not null,
amount            numeric not null,
idempotency_key   uuid unique not null,
b2c_receipt       text,
status            text not null check (status in ('requested','processing','paid','failed','retried')),
requested_at      timestamptz not null default now(),
resolved_at       timestamptz

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
4. **No platform fee, ever.** Every shilling collected is either the maker's or the driver's. Do not add a fee, reserve, or community-fund bucket — this was explicitly proposed and explicitly rejected.
5. **Minimum amount:** KES 50 business floor (Daraja's own technical floor is KES 1).
6. **Failed/timed-out STK Push:** no ledger entry, no auto-retry. Tourist sees a plain retry message.
7. **Idempotent webhooks:** a redelivered Daraja callback (STK or B2C) is a no-op, never a double credit/payout.
8. **Unregistered driver QR or inactive producer:** rejected at scan time, before payment initiation.
9. **Withdrawals are always full-balance, never partial.** Threshold KES 500.
10. **Daily batch sweep at 18:00 EAT** auto-withdraws anyone ≥ KES 500 who hasn't already withdrawn that day.
11. **Payout failure:** funds return to `available`, one automatic retry, then requires manual coordinator retry.
12. **Cash is a first-class second payment method, tracked via dual confirmation — not an offline afterthought and not evidence-only.** Split into two enforcement cases by whether a driver is attached, because the enforcement mechanism differs:
    - **Case A — referred cash sale** (`driver_id` set): requires BOTH `driver_confirmed_at` and `maker_confirmed_at` to be set before the transaction moves from `cash_unconfirmed` to `cash_confirmed`.
    - **Case B — walk-up cash sale** (no `driver_id`): requires BOTH `tourist_confirmed_at` and `maker_confirmed_at`.
    - A `cash_unconfirmed` transaction still unconfirmed past `confirmation_deadline` (default 10 min, `CASH_CONFIRM_WINDOW_MINUTES`) flips to `cash_expired` — kept visible in the ledger and reconciliation view, never deleted, never silently retried.
    - **Only `cash_confirmed` transactions write `wallet_ledger_entries` and enter the withdrawal pipeline.** A `cash_expired` transaction never does.
    - Full design rationale: `CASH_TRACKING_UPDATE.md`. Do not simplify this back to a single self-reported "log cash sale" form — that was an earlier, explicitly rejected design.
13. **Disputes:** a coordinator can freeze a transaction's ledger entries (`frozen` status), excluded from any withdrawal/batch calculation until resolved.
14. **No partial withdrawals, no automatic dispute resolution, no public self-registration, no multi-currency/KYC/tax handling** — all explicitly out of scope.
15. **Dynamic GPS/volume-scored referee commissions** — explicitly parked as a Phase 3+ pitch narrative, not built now. Use the fixed per-producer split only.
16. **Only `cash_confirmed` referred transactions count toward a driver's clean-referral streak** for any future commission-rate review — a `cash_expired` referral does not count. This is what gives the driver a reason to chase confirmation rather than let it lapse.

## 5. Auth model

Four roles, no public self-registration:

- **Tourist** — no account. The public pay-initiate endpoint is the only surface, rate-limited per phone number. Cash Case B confirmation (rule 12) also needs no login — use a short-lived signed token tied to the transaction id, delivered via whatever already shows the tourist the price-transparency card (an in-page "I paid" button if she's still on the payment screen, or an SMS link if not). Do not require Supabase Auth for this — it would contradict "no account for tourists."
- **Producer / Driver** — coordinator-onboarded via Supabase Auth's admin API, phone number as identifier + a 4-digit PIN issued in person. Logs in with phone + PIN. Cash-confirmation taps (rule 12, Case A/B for maker; Case A for driver) happen from their authenticated dashboard session.
- **Coordinator/Admin** — same Supabase Auth mechanism, account carries an `is_admin` claim.

Enforced twice: Supabase Row Level Security at the data layer, FastAPI endpoint checks at the API layer. Only FastAPI's service-role key (called **Secret key** under Supabase's current naming) writes to money-affecting tables — never exposed to the frontend, which uses the Publishable key instead.

RLS permission matrix:

| Role | producers/drivers | transactions | wallet_ledger_entries | withdrawal_requests | admin actions |
|---|---|---|---|---|---|
| Tourist | — | create (via pay endpoint only) + confirm own cash txn (token-scoped) | — | — | — |
| Producer/Driver | read own | read own + confirm own cash txn | read own | create/read own | — |
| Coordinator | full | full + dispute flag | full | full + manual retry | reconciliation, registration |

## 6. Money-movement sequence

1. `POST /transactions/initiate` — for `payment_method: mpesa`, STK Push fires. For `payment_method: cash`, no Daraja call — the transaction is created directly in `cash_unconfirmed` status with `confirmation_deadline` set (`created_at + CASH_CONFIRM_WINDOW_MINUTES`).
2. **M-Pesa path:** `POST /daraja/stk-callback` — Daraja confirms; backend checks the transaction reference (idempotent), writes `pending` ledger entries for the maker (product_maker_amount + photo_amount, whichever enabled) and, only if `product_enabled`, for the driver.
2b. **Cash path (parallel to step 2):** `POST /transactions/:id/confirm` — called once by each required party per rule 12 (driver+maker for Case A, tourist+maker for Case B). Sets the corresponding `*_confirmed_at` field. Once all required confirmations for that transaction's case are present, status flips to `cash_confirmed` and the same `pending` ledger entries are written as in step 2 — from here, cash-derived entries flow through steps 3–6 identically to M-Pesa ones. If `confirmation_deadline` passes first, status flips to `cash_expired` instead and no ledger entries are ever written for that transaction.
3. Balance becomes `available` once cleared for payout eligibility.
4. `POST /withdrawals/request` (on-demand, full balance, ≥ KES 500) or the 18:00 EAT batch sweep triggers Daraja B2C, with a generated idempotency key.
5. `POST /daraja/b2c-callback` — marks the ledger entry `paid`, or on failure returns funds to `available` (one automatic retry, then manual coordinator retry).
6. `GET /admin/reconciliation` — Till collected vs. disbursed vs. pending, should always sum correctly, including confirmed-cash entries.

## 7. Frontend — design tokens and screens

Full interactive reference: the published Design Reference artifact (color/type/component specimens) and the published Wireframes canvas (all 8 screens, including the two-component price card). Key tokens:

```css
--sawa-bg: #FAFAF8; --sawa-surface: #FFFFFF; --sawa-text: #1A1A1A; --sawa-text-muted: #6B6B63;
--sawa-border: #E4E2DA; --sawa-green: #1E5B3A; --sawa-terracotta: #8C1D1D; --sawa-ochre: #B97A22;
--sawa-radius: 8px; --sawa-space: 8px;
```

Inter (UI/words) + IBM Plex Mono (numbers only, tabular-nums). Mobile-first, 420px max-width card-centered, except the coordinator reconciliation view (full width past 768px, plain table, never a chart) and the public homepage (full width, its own layout — see 7.1). Status states: pending / confirmed / failed for M-Pesa, plus `cash_unconfirmed` / `cash_confirmed` / `cash_expired` for cash — render the cash states visibly distinct from the M-Pesa three (an unconfirmed cash sale is "still resolving," not "flagged as wrong," so it should not look like a disputed transaction). No gradients, no stock photography (the homepage's one exception is scoped separately in 7.1), no icon without a text label. Screens: **public homepage** (7.1), price-transparency card (two component cards, not merged), payment entry (M-Pesa "Pay [amount]" button plus a "Cash" option that creates the transaction directly and moves to a waiting-for-confirmation state), confirmation (for cash, shows the honest `cash_unconfirmed`/`cash_confirmed` state rather than a premature checkmark, and is where a Case B tourist taps her own confirm), shared producer/driver/coordinator login, producer/driver dashboard (recent-transactions list needs the cash states as a visibly distinct status, plus an inline "Confirm" action on any row awaiting this user's own confirmation), coordinator registration (with the charges-for toggle), coordinator reconciliation (status column includes all three cash states as distinct, visible entries — expired-unconfirmed cash rows are what a coordinator should notice first), dispute-flag action (modal off a table row, not its own screen).

## 7.1 Public homepage — content, layout, and photography rule

A ninth screen, added late in planning: a public marketing homepage (`/` on the frontend, no login) that explains the solution and showcases the design system to anyone who lands on it — judges included. It's the one screen in this app allowed to use real photography, and even there, only sparingly and on the terms below.

**Photography rule — read before sourcing anything:** the design system already rejects "stock tourist photography" (see section 7 and the Design Reference's "what to leave out" list) — the glossy, posed, brochure look. This page can use **one** real photo, sourced from a properly licensed source, treated as background texture rather than hero content:

- Source from the **Unsplash License** (free for commercial and noncommercial use, no permission needed, attribution appreciated but not required) or, if using Wikimedia Commons/Pexels under CC-BY, **credit the photographer in the page footer** — don't skip attribution if the license requires it.
- Pick something documentary and candid — someone actually working (weaving, cooking, at a stall), not smiling posed at the camera. Search terms like "East Africa artisan craft market" or "Kenya coast market stall" over anything with "safari" or "tourism" in it, which skews toward the brochure look this system rejects.
- Treat it, don't present it raw: duotone or color-wash it toward `--sawa-green` at low opacity so it reads as part of this palette, not a separate photographic layer bolted on. No caption needed if it's just texture; if it's more prominent, keep alt text factual, not romanticized.
- If a real photo from your own Phase 0 site visit becomes available later, swap it in — that's strictly better than a sourced one and needs no license handling at all.

**Sections, in order:**

1. **Hero.** Headline (from the PRD's one-line summary — "A transparent, point-of-sale value-split app that routes tourist payments directly to the women and PWD producers and drivers who created the value") + a short subhead. Visual: the price-transparency card component itself, rendered live (not a screenshot) as the hero graphic — no photo here, this is the "no photography needed, the product is the visual" moment. Two CTAs: primary "See it work" (scrolls to or links the live demo/reconciliation view), secondary "Read the rulebook" (links out, e.g. to the published Rulebook reference).
2. **The problem.** The boma stat as a large mono numeral callout — "KSh 300 of every $20 paid at the gate" — with a short paragraph underneath. Text and numerals only, no photo, no chart (this system doesn't use charts to dramatize a number — the number itself, set huge in Plex Mono, is the visual).
3. **The solution.** Three-step diagram — disclosed price → automatic split (M-Pesa or cash) → paid instantly — using simple line icons (never emoji) each paired with a text label, consistent with the "icon never alone" rule.
4. **Who it's for.** The one licensed photo lives here, as a duotoned background behind or beside four short persona blurbs (tourist, producer, driver, coordinator — same four from the PRD's personas table).
5. **Roadmap.** A plain text/timeline strip: Pilot → Local Scale → Multi-Site (from the Implementation Plan's Phase 1–3), no photo, no chart.
6. **Footer.** Link to the live demo, the GitHub repo, the challenge name, and photo attribution if the license requires it.

## 8. Build stages — work in this order, commit at each checkpoint

Don't generate the whole app in one pass. Each stage should end in something that runs and is committed before the next stage starts.

1. **Repo scaffold.** `/backend` (FastAPI project skeleton, `requirements.txt`, `.python-version` already pinned) and `/frontend` (Vite + React + Tailwind skeleton) as two subfolders in `sawa-split`, or two repos if you'd rather — your call, just be consistent with what Render will point at. Checkpoint: both run locally with a placeholder "hello" route/page.
1.5. **Public homepage (can happen any time after stage 1 — no backend dependency).** Build the marketing homepage per section 7.1. Good to do early: it's demoable progress with zero backend risk, and it's the page most likely to be open when a judge first looks at your work.
2. **Database schema.** Turn section 3's SQL into actual Supabase migrations (SQL editor or a migration tool, your choice). Checkpoint: all six tables exist in Supabase with the constraints in place, verified by inserting one test row per table by hand.
3. **Auth.** Coordinator-created accounts via Supabase Auth's admin API (phone + PIN), login endpoint, RLS policies matching the permission matrix in section 5. Checkpoint: you can log in as a test producer and a test coordinator and get different access.
4. **Core backend endpoints (no Daraja yet).** `/transactions/initiate` and the ledger-writing logic, using a manually-triggered "fake confirm" instead of a real Daraja callback for now. Also build the cash dual-confirmation path here (rule 12, `POST /transactions/:id/confirm`) — it shares the same ledger-writing logic once a transaction reaches its confirmed state, so it's a small parallel branch, not a separate subsystem. Checkpoint: a fake M-Pesa transaction and a cash transaction (both Case A and Case B) each correctly write ledger entries split per section 4's rules.
5. **Daraja integration.** Real STK Push, real callback handling, idempotency check, then B2C payout + its callback. Checkpoint: one real sandbox transaction goes all the way from STK Push to a ledger entry moving from `pending` to `available`.
6. **Batch sweep.** APScheduler job for the 18:00 EAT sweep, on-demand withdrawal endpoint. Checkpoint: a withdrawal actually triggers B2C and the ledger entry reaches `paid` — for both an M-Pesa-sourced and a cash-sourced ledger entry.
7. **Frontend screens, wired.** Build against the wireframes/design tokens in section 7, screen by screen, each one talking to the real backend as soon as it exists — price card and payment entry first (they depend on stage 4-5, including the Cash option), then confirmation, then producer/driver dashboard (with the confirm action), then coordinator login/registration/reconciliation last.
8. **Reconciliation + disputes.** The coordinator view (collected/disbursed/pending tiles + table, with the three cash states visible) and the dispute-flag action that freezes ledger entries.
9. **End-to-end rehearsal.** Run the exact sequence in `DEMO_SCRIPT.md` for real, on the actual deployed Render URLs, not localhost — this is also when the backup screen recording gets made (see `DEMO_SCRIPT.md` section 5).

## 9. Phase 1 scope — definition of done

Per the Implementation Plan: formalize the pilot agreement, co-design/print the price-transparency card, confirm the producer's Till, **build the MVP** (QR generation, Daraja sandbox split logic, cash dual-confirmation split logic, transaction log), print the driver's QR, run the pilot 2–3 weeks. Done when: **at least one real, end-to-end transaction — tourist pays, ledger credits, a successful withdrawal — logged and demonstrable**, matching the Demo Script's live-demo beat exactly (STK Push → split lands → ledger updates in real time on the reconciliation view).

## 10. Explicitly not building yet

Production Daraja B2C approval (parallel-tracked, not a blocker for sandbox demo), dynamic GPS-scored referee commissions, dark mode (tokens exist, implementation deferred), any platform fee/community-fund mechanism, partial withdrawals, automatic dispute resolution, multi-currency/KYC/tax handling, public self-registration, geofencing on cash confirmation (same-site check — a Phase 2 hardening step, not a Phase 1 blocker), true offline/no-connectivity capture (`sync_queue_items` exists in the schema but is unbuilt — not the same thing as cash tracking, see section 3).

**Known pilot limitation: price cards are signed per maker + driver pair.** Each card's signature (`app/links.py`) covers the producer, the prices *and* the driver's QR code, so every driver who brings tourists to a stall needs their own printed card for that stall. That's fine for the pilot's one or two pairs but won't scale. Phase 2 should sign only producer + prices and attach the driver separately at checkout (for example, by scanning the driver's own QR card, which already opens `#/driver/<code>`).

## 11. Environment variables (names only — values come from where you saved them, never from this chat)

Backend: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (Secret key), `DATABASE_URL` (asyncpg, `ssl=True` not `"require"`), `DARAJA_CONSUMER_KEY`, `DARAJA_CONSUMER_SECRET`, `DARAJA_SHORTCODE`, `DARAJA_PASSKEY`, `DARAJA_B2C_SHORTCODE`, `DARAJA_INITIATOR_NAME`, `DARAJA_SECURITY_CREDENTIAL`, `DARAJA_CALLBACK_BASE_URL`, `CORS_ORIGINS` (comma-separated frontend URLs allowed to call the API; defaults to the local Vite dev server), `CHECKOUT_LINK_SECRET` (HMAC key that signs price-card links, `app/links.py`; every printed card and the demo link are signed with it, so use the same value everywhere the API runs, and expect every card to stop working if it changes), `CASH_CONFIRM_WINDOW_MINUTES` (default 10 — kept as an env var, not a hardcoded constant, since the right window is genuinely unknown until Phase 0/1 field testing).
Frontend: `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_API_BASE_URL` (the backend's URL), `VITE_PUBLIC_APP_URL` (the frontend's own public URL, encoded into every printed QR: driver cards and price cards; unset, it falls back to whatever URL the coordinator's browser is on, so set it to the Render URL in Stage 9 and then re-run `frontend/scripts/regenerate-driver-qrs.mjs` so existing driver cards point there too).

Set these as a Render Environment Group once the two Web Services exist (deferred from Phase G on purpose) — never commit them to the repo.
