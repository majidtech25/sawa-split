# Sawa Split — Project Brief for Claude Code

**Purpose of this file:** everything locked during planning, consolidated into one build-ready brief. This file lives at the repo root as `CLAUDE.md`, so Claude Code loads it automatically at the start of every session in this repo — no need to re-paste it. Where this brief says "locked," treat it as non-negotiable — those are explicit decisions the team already made, not defaults to reconsider mid-build.

**Full detail behind this brief lives in `/docs`:** `PRD.md` (personas, user stories, success metrics), `TRD.md` (full non-functional requirements), `APP_FLOW.md` (step-by-step per persona), `UI_UX_DESIGN.md`, `BACKEND_SCHEMA_AUTH.md`, `IMPLEMENTATION_PLAN.md`, `DEMO_SCRIPT.md`. This brief is the condensed, always-loaded version — read the relevant doc in `/docs` if something here is ambiguous or you need the fuller reasoning behind a rule.

## 0. What this is

**What we're building:** a transparent, point-of-sale value-split payment app. A tourist pays once via M-Pesa; the payment automatically splits between the woman/PWD producer who made the value and the driver who referred the sale — and separately compensates the producer for photo consent. Every shilling collected is either the maker's or the driver's — **there is no platform fee, ever.**

**Who it's for:** four users, in order of who touches it most: the tourist (no account, pays once), the producer/maker (a woman or PWD artisan/cook/performer, wants a guaranteed transparent share with no dependency on a driver handing over cash), the driver/guide (wants a disclosed, guaranteed referral fee instead of pressuring a sale), and the coordinator (onboards people, watches the ledger, resolves disputes).

**Visual style we're aiming for:** minimal, fintech-restrained — quiet confidence, not startup energy. Two accent colors with single jobs (green for confirmed/success, ochre for the one "Pay" button, terracotta for errors only), one type family for words (Inter) and one for numbers (IBM Plex Mono, tabular), one 8px radius everywhere, one 8px spacing grid. No gradients, no stock tourist photography, no icon without a text label, nothing that reads as generated-in-five-minutes. Full spec in section 7 and the published Design Reference artifact.

**The core it needs to prove, end to end, by the demo:** a real tourist payment splits automatically and correctly between maker and driver (with photo consent as its own component), the ledger updates live, and at least one withdrawal actually pays out — on real (sandbox) Daraja, not mocked.

This is an MVP for the Future Leaders Challenge Eastern Africa, built for a live demo, not a production system yet.

## 0.1 Your role and working constraints

You are the engineer implementing this MVP. Treat section 4 (business rules) and section 5 (auth model) as fixed requirements handed down from a locked product spec, not open design questions — if something there seems wrong or incomplete, flag it back to the user rather than silently deciding differently. Concretely:

- **Don't invent scope.** If it's listed under section 10 ("explicitly not building yet"), don't build it, even as a stub that half-works — a half-built platform-fee field is worse than no field.
- **Don't restyle.** Use the exact tokens in section 7. If a screen needs something the tokens don't cover, ask, don't improvise a new color or a second radius.
- **Don't skip the build stages below out of order** (same discipline the planning phase used) — each stage should be working and committed before the next one starts, so a demo is always possible from wherever the build currently stands, not just at the very end.
- **Prefer boring and correct over clever.** This is a payments ledger for real people's earnings — the append-only ledger, the idempotency keys, and the full-balance-only withdrawal rule all exist specifically to remove entire classes of bugs; don't "simplify" them back in.
- **Ask before touching anything in section 4, 5, or 6** — those are the parts a judge's Q&A will actually probe.

## 1. Stack (reused from a prior project, "Operix" — proven, not novel)

- **Backend:** FastAPI + async SQLAlchemy + asyncpg, deployed on Render as a Web Service.
- **Frontend:** React + Vite + Tailwind, `HashRouter` (not `_redirects` — Render SPA routing gotcha), deployed on Render as a second Web Service (or static site if the frontend ends up fully static — backend decides that, not assumed here).
- **Database / Auth / Storage / Realtime:** Supabase (already provisioned — project exists, credentials saved outside chat, to be set as Render env vars once the two Render services are created in this phase).
- **Payments:** Safaricom Daraja — STK Push (collection) + B2C (payout). Sandbox already set up (consumer key/secret obtained, STK Push + B2C sandbox endpoints confirmed, placeholder callback URL registered — swap for ngrok during local dev, then the real Render URL at deploy).
- **Batch job:** in-process APScheduler for the daily 18:00 EAT payout sweep (Render free tier has no native cron).

## 2. Known deployment gotchas — apply from day one, don't rediscover these under deadline pressure

- asyncpg's `ssl` connect arg must be the boolean `True`, never the string `"require"`.
- Pin `.python-version` to `3.12.3` (already done in the repo) — a newer default Python breaks pydantic-core's prebuilt wheels on Render.
- SQLAlchemy enum columns need `values_callable=lambda x: [e.value for e in x]` or they serialize wrong.
- Use `HashRouter`, not Render's `_redirects` file, for SPA routing.
- Don't hand-edit the service worker if a PWA layer gets added later — this broke Operix's PWA once.
- Render's free tier has no shell access — plan migrations/seeding to run via a startup script or a one-off local connection, not `render ssh`.

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
id                    uuid primary key default gen_random_uuid(),
producer_id           uuid references producers(id),
driver_id             uuid references drivers(id),   -- nullable: no driver on a photo-only visit with no referral
product_enabled       boolean not null default false,
product_amount        numeric,              -- null unless product_enabled
product_maker_amount  numeric,              -- null unless product_enabled
product_driver_amount numeric,              -- null unless product_enabled
photo_enabled         boolean not null default false,
photo_amount          numeric,              -- null unless photo_enabled; paid 100% to maker, never split
total_amount          numeric not null check (total_amount > 0),
maker_amount          numeric not null,     -- product_maker_amount + photo_amount
driver_amount         numeric not null default 0,  -- product_driver_amount only
stk_receipt           text unique,
status                text not null check (status in ('initiated','confirmed','failed','disputed')),
created_at            timestamptz not null default now(),
constraint transactions_at_least_one_component check (product_enabled or photo_enabled)

-- wallet_ledger_entries   (append-only — balances are computed, never stored directly)
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

-- sync_queue_items   (offline cash transactions — evidence only, never enters payout pipeline)
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
12. **Offline/cash:** recorded as `recorded_offline` for evidence only — never enters the withdrawal pipeline.
13. **Disputes:** a coordinator can freeze a transaction's ledger entries (`frozen` status), excluded from any withdrawal/batch calculation until resolved.
14. **No partial withdrawals, no automatic dispute resolution, no public self-registration, no multi-currency/KYC/tax handling** — all explicitly out of scope.
15. **Dynamic GPS/volume-scored referee commissions** — explicitly parked as a Phase 3+ pitch narrative, not built now. Use the fixed per-producer split only.

## 5. Auth model

Four roles, no public self-registration:

- **Tourist** — no account. The public pay-initiate endpoint is the only surface, rate-limited per phone number.
- **Producer / Driver** — coordinator-onboarded via Supabase Auth's admin API, phone number as identifier + a 4-digit PIN issued in person. Logs in with phone + PIN.
- **Coordinator/Admin** — same Supabase Auth mechanism, account carries an `is_admin` claim.

Enforced twice: Supabase Row Level Security at the data layer, FastAPI endpoint checks at the API layer. Only FastAPI's service-role key (called **Secret key** under Supabase's current naming) writes to money-affecting tables — never exposed to the frontend, which uses the Publishable key instead.

RLS permission matrix:

| Role | producers/drivers | transactions | wallet_ledger_entries | withdrawal_requests | admin actions |
|---|---|---|---|---|---|
| Tourist | — | create (via pay endpoint only) | — | — | — |
| Producer/Driver | read own | read own | read own | create/read own | — |
| Coordinator | full | full + dispute flag | full | full + manual retry | reconciliation, registration |

## 6. Money-movement sequence

1. `POST /transactions/initiate` — STK Push fires.
2. `POST /daraja/stk-callback` — Daraja confirms; backend checks the transaction reference (idempotent), writes `pending` ledger entries for the maker (product_maker_amount + photo_amount, whichever enabled) and, only if `product_enabled`, for the driver.
3. Balance becomes `available` once cleared for payout eligibility.
4. `POST /withdrawals/request` (on-demand, full balance, ≥ KES 500) or the 18:00 EAT batch sweep triggers Daraja B2C, with a generated idempotency key.
5. `POST /daraja/b2c-callback` — marks the ledger entry `paid`, or on failure returns funds to `available` (one automatic retry, then manual coordinator retry).
6. `GET /admin/reconciliation` — Till collected vs. disbursed vs. pending, should always sum correctly.

## 7. Frontend — design tokens and screens

Full interactive reference: the published Design Reference artifact (color/type/component specimens) and the published Wireframes canvas (all 8 screens, including the two-component price card). Key tokens:

```css
--sawa-bg: #FAFAF8; --sawa-surface: #FFFFFF; --sawa-text: #1A1A1A; --sawa-text-muted: #6B6B63;
--sawa-border: #E4E2DA; --sawa-green: #1E5B3A; --sawa-terracotta: #8C1D1D; --sawa-ochre: #B97A22;
--sawa-radius: 8px; --sawa-space: 8px;
```

Inter (UI/words) + IBM Plex Mono (numbers only, tabular-nums). Mobile-first, 420px max-width card-centered, except the coordinator reconciliation view (full width past 768px, plain table, never a chart) and the public homepage (full width, its own layout — see 7.1). Three status states only: pending / confirmed / failed. No gradients, no stock photography (the homepage's one exception is scoped separately in 7.1), no icon without a text label. Screens: **public homepage** (7.1), price-transparency card (two component cards, not merged), payment entry, confirmation, shared producer/driver/coordinator login, producer/driver dashboard, coordinator registration (with the charges-for toggle), coordinator reconciliation, dispute-flag action (modal off a table row, not its own screen).

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
3. **The solution.** Three-step diagram — disclosed price → automatic split → paid instantly — using simple line icons (never emoji) each paired with a text label, consistent with the "icon never alone" rule.
4. **Who it's for.** The one licensed photo lives here, as a duotoned background behind or beside four short persona blurbs (tourist, producer, driver, coordinator — same four from the PRD's personas table).
5. **Roadmap.** A plain text/timeline strip: Pilot → Local Scale → Multi-Site (from the Implementation Plan's Phase 1–3), no photo, no chart.
6. **Footer.** Link to the live demo, the GitHub repo, the challenge name, and photo attribution if the license requires it.

## 8. Build stages — work in this order, commit at each checkpoint

Don't generate the whole app in one pass. Each stage should end in something that runs and is committed before the next stage starts.

1. **Repo scaffold.** `/backend` (FastAPI project skeleton, `requirements.txt`, `.python-version` already pinned) and `/frontend` (Vite + React + Tailwind skeleton) as two subfolders in `sawa-split`, or two repos if you'd rather — your call, just be consistent with what Render will point at. Checkpoint: both run locally with a placeholder "hello" route/page.
1.5. **Public homepage (can happen any time after stage 1 — no backend dependency).** Build the marketing homepage per section 7.1. Good to do early: it's demoable progress with zero backend risk, and it's the page most likely to be open when a judge first looks at your work.
2. **Database schema.** Turn section 3's SQL into actual Supabase migrations (SQL editor or a migration tool, your choice). Checkpoint: all six tables exist in Supabase with the constraints in place, verified by inserting one test row per table by hand.
3. **Auth.** Coordinator-created accounts via Supabase Auth's admin API (phone + PIN), login endpoint, RLS policies matching the permission matrix in section 5. Checkpoint: you can log in as a test producer and a test coordinator and get different access.
4. **Core backend endpoints (no Daraja yet).** `/transactions/initiate` and the ledger-writing logic, using a manually-triggered "fake confirm" instead of a real Daraja callback for now. Checkpoint: a fake transaction correctly writes ledger entries split per section 4's rules (test both product-only and product+photo cases).
5. **Daraja integration.** Real STK Push, real callback handling, idempotency check, then B2C payout + its callback. Checkpoint: one real sandbox transaction goes all the way from STK Push to a ledger entry moving from `pending` to `available`.
6. **Batch sweep.** APScheduler job for the 18:00 EAT sweep, on-demand withdrawal endpoint. Checkpoint: a withdrawal actually triggers B2C and the ledger entry reaches `paid`.
7. **Frontend screens, wired.** Build against the wireframes/design tokens in section 7, screen by screen, each one talking to the real backend as soon as it exists — price card and payment entry first (they depend on stage 4-5), then confirmation, then producer/driver dashboard, then coordinator login/registration/reconciliation last.
8. **Reconciliation + disputes.** The coordinator view (collected/disbursed/pending tiles + table) and the dispute-flag action that freezes ledger entries.
9. **End-to-end rehearsal.** Run the exact sequence in `DEMO_SCRIPT.md` for real, on the actual deployed Render URLs, not localhost — this is also when the backup screen recording gets made (see `DEMO_SCRIPT.md` section 5).

## 9. Phase 1 scope — definition of done

Per the Implementation Plan: formalize the pilot agreement, co-design/print the price-transparency card, confirm the producer's Till, **build the MVP** (QR generation, Daraja sandbox split logic, transaction log), print the driver's QR, run the pilot 2–3 weeks. Done when: **at least one real, end-to-end transaction — tourist pays, ledger credits, a successful withdrawal — logged and demonstrable**, matching the Demo Script's live-demo beat exactly (STK Push → split lands → ledger updates in real time on the reconciliation view).

## 10. Explicitly not building yet

Production Daraja B2C approval (parallel-tracked, not a blocker for sandbox demo), dynamic GPS-scored referee commissions, dark mode (tokens exist, implementation deferred), any platform fee/community-fund mechanism, partial withdrawals, automatic dispute resolution, multi-currency/KYC/tax handling, public self-registration.

## 11. Environment variables (names only — values come from where you saved them, never from this chat)

Backend: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (Secret key), `DATABASE_URL` (asyncpg, `ssl=True` not `"require"`), `DARAJA_CONSUMER_KEY`, `DARAJA_CONSUMER_SECRET`, `DARAJA_SHORTCODE`, `DARAJA_PASSKEY`, `DARAJA_CALLBACK_BASE_URL`.
Frontend: `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`.

Set these as a Render Environment Group once the two Web Services exist (deferred from Phase G on purpose) — never commit them to the repo.
