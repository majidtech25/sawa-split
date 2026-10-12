# Sawa Split — Backend Schema & Authentication Flow

**Status:** Locked. Full rules and lifecycle states are in the published Rulebook artifact; this file is the schema + auth sequence Claude Code builds directly from.

## 1. Schema — six tables, plus `cash_debts` and the account lifecycle tables (2026-10-09)

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
account_status text not null default 'active' check (account_status in ('active','suspended','closing','closed')), -- CLAUDE.md rule 17
active        boolean generated always as (account_status = 'active') stored,  -- derived; every "is it active" check reads this
created_at    timestamptz not null default now(),
constraint producers_at_least_one_component check (charges_product or charges_photo)

-- drivers
id            uuid primary key default gen_random_uuid(),
name          text not null,
phone         text unique not null,
till          text not null,
qr_code       text unique not null,
account_status text not null default 'active' check (account_status in ('active','suspended','closing','closed')),
active        boolean generated always as (account_status = 'active') stored,
created_at    timestamptz not null default now()

-- transactions
-- Product and photo consent are two independent, separately-priced components.
-- A transaction charges whichever component(s) are active for that visit — never a merged bundle.
-- payment_method + the cash_* statuses below implement the dual-confirmation cash flow (section 4 rule 12 of CLAUDE.md).
id                    uuid primary key default gen_random_uuid(),
producer_id           uuid references producers(id),
driver_id             uuid references drivers(id),   -- nullable: no driver on a photo-only visit or a walk-up (Case B) cash sale with no referral
payment_method        text not null default 'mpesa' check (payment_method in ('mpesa','cash')),
product_enabled       boolean not null default false,
product_amount        numeric,              -- null unless product_enabled; the component's own total
product_maker_amount  numeric,              -- null unless product_enabled; maker's split of product_amount
product_driver_amount numeric,              -- null unless product_enabled; driver's split of product_amount
photo_enabled         boolean not null default false,
photo_amount          numeric,              -- null unless photo_enabled; paid 100% to maker, never split
total_amount          numeric not null check (total_amount > 0),  -- product_amount + photo_amount, whichever are enabled
maker_amount          numeric not null,     -- product_maker_amount + photo_amount
driver_amount         numeric not null default 0,  -- product_driver_amount only — photo never contributes here
stk_receipt           text unique,          -- mpesa only, null for cash
status                text not null check (status in ('initiated','verifying','confirmed','failed','disputed','cash_unconfirmed','cash_confirmed','cash_expired')),
                                            -- 'verifying': STK_QUERY_MODE=enforce, waiting for Safaricom's confirmation; nobody credited
driver_confirmed_at   timestamptz,          -- cash Case A (driver_id set): driver's confirm tap
maker_confirmed_at    timestamptz,          -- cash Case A and Case B: maker's confirm tap
tourist_confirmed_at  timestamptz,          -- cash Case B (no driver_id): tourist's confirm tap
confirmation_deadline timestamptz,          -- cash only: created_at + CASH_CONFIRM_WINDOW_MINUTES (default 10)
created_at            timestamptz not null default now(),
constraint transactions_at_least_one_component check (product_enabled or photo_enabled)

-- transaction_secrets   (migration 0012: no browser role can read it, not streamed by Realtime)
transaction_id        uuid primary key references transactions(id) on delete cascade,
checkout_request_id   text unique,          -- mpesa: Daraja's STK Push id, matched by the callback
tourist_confirm_token text unique           -- cash Case B: the tourist's confirmation token

-- stk_verifications   (migration 0012: STK Push Query check of each successful STK callback)
transaction_id  uuid primary key references transactions(id) on delete cascade,
mode            text not null,              -- 'flag' or 'enforce' (STK_QUERY_MODE when the callback arrived)
state           text not null default 'pending',  -- pending, verified, mismatch, unanswered, amount_mismatch
attempts        int not null default 0,
next_check_at   timestamptz not null default now(),
callback_amount numeric,
last_result     jsonb,
created_at      timestamptz not null default now(),
updated_at      timestamptz not null default now()

-- wallet_ledger_entries   (append-only — balances are computed, never stored directly; amounts never change)
-- Only M-Pesa money is ever payable (CLAUDE.md rule 12). An M-Pesa sale writes the maker's and
-- driver's shares at its STK callback. A cash sale, at cash_confirmed, writes only the maker's
-- share, as 'cash_held' (already in hand, never payable); the driver's share becomes a
-- cash_debts row. Settling a debt marks whole maker entries 'transferred' and writes new
-- entries: the driver's credit and the maker's change. So pending + available + frozen + paid
-- always equals M-Pesa collected.
id              uuid primary key default gen_random_uuid(),
recipient_type  text not null check (recipient_type in ('maker','driver')),
recipient_id    uuid not null,
amount          numeric not null check (amount > 0),
status          text not null check (status in ('pending','available','paid','frozen','cash_held','transferred')),
transaction_id  uuid references transactions(id),
settlement_id   uuid references cash_debts(id),  -- set on entries a debt settlement spent or created
created_at      timestamptz not null default now()
-- index: (recipient_type, recipient_id, status) for fast balance queries

-- cash_debts   (migration 0010: maker -> driver, the driver's share of a confirmed cash sale)
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

-- closure_requests   (migration 0011, CLAUDE.md rule 17)
id              uuid primary key default gen_random_uuid(),
party_type      text not null check (party_type in ('maker','driver')),  -- as recipient_type
party_id        uuid not null,
reason          text not null,             -- required, non-blank
status          text not null default 'pending' check (status in ('pending','cancelled','rejected','approved','closed')),
requested_at    timestamptz not null default now(),
decided_at      timestamptz,
decided_by      uuid,                      -- coordinator's auth user id
decision_reason text,                      -- required when rejected
closed_at       timestamptz
-- unique (party_type, party_id) where status in ('pending','approved')

-- account_suspensions   (migration 0011)
id           uuid primary key default gen_random_uuid(),
party_type   text not null check (party_type in ('maker','driver')),
party_id     uuid not null,
reason       text not null,                -- shown to the suspended person
review_on    date not null,                -- default 7 days; past it, flagged overdue
suspended_by uuid not null,
suspended_at timestamptz not null default now(),
lifted_at    timestamptz, lifted_by uuid, lift_reason text
-- unique (party_type, party_id) where lifted_at is null

-- account_audit_log   (migration 0011: append-only, triggers refuse UPDATE, DELETE and TRUNCATE for every role)
id          bigint generated always as identity primary key,
at          timestamptz not null default now(),
action      text not null,                 -- closure_requested/_cancelled/_approved/_rejected, account_closed, suspended, unsuspended
party_type  text not null, party_id uuid not null,
actor_role  text not null,                 -- maker, driver, coordinator, system
actor_id    uuid, actor_phone text,
reason      text,
details     jsonb not null default '{}'

-- sync_queue_items   (true offline/no-connectivity capture — a still-unbuilt future concern,
-- distinct from cash-payment tracking, which now lives directly in `transactions` above via
-- payment_method + the cash_* statuses. Do not repurpose this table for cash — it's for the
-- separate case of no network at all, e.g. a fully offline PWA sync queue, if that gets built.)
id                uuid primary key default gen_random_uuid(),
payload           jsonb not null,
idempotency_key   uuid unique not null,
synced_at         timestamptz
```

## 2. Storage

One Supabase Storage bucket, `qr-codes` — public read, coordinator-only write. Nothing else needs a bucket at MVP scope.

## 3. Row Level Security — permission matrix

Every browser role (`anon`, `authenticated`) holds SELECT and nothing else on every table, and there are no write policies at all *(migration 0012, 2026-10-09)*. **No browser writes the database, for any role: maker, driver, coordinator or tourist.** Every change goes through a FastAPI endpoint, which checks the caller and writes with its own direct connection. That connection is the only writer, and the Secret key never reaches the frontend. Default privileges keep future tables the same. `checkout_request_id` and `tourist_confirm_token` live in `transaction_secrets`, which no browser role can read and Realtime doesn't stream; `auth_credentials` is unreadable too. `scripts/verify_security.sh` proves all of it.

**Browser** is a direct read through Supabase with the Publishable key; **API** is a FastAPI endpoint:

| Role | producers/drivers | transactions | wallet_ledger_entries, cash_debts | withdrawal_requests | closure_requests, suspensions, audit log | transaction_secrets, auth_credentials |
|---|---|---|---|---|---|---|
| Tourist (anonymous) | — | API: create (pay endpoint), confirm own Case B cash sale (token) | — | — | — | — |
| Producer/Driver | browser: read own. Never write (status, split, phone, Till: coordinator only) | browser: read own. API: confirm own cash sale | browser: read own | browser: read own. API: withdraw | browser: read own closure requests. API: request/cancel own closure | — |
| Coordinator | browser: read all. API: register | browser: read all. API: dispute/resolve, check payment | browser: read all | browser: read all. API: manual retry | browser: read all. API: approve/reject, suspend/unsuspend | — |
| Anyone, browser | no writes on any table, ever | | | | | no reads either |

The tourist's cash-confirmation right above is scoped by a short-lived signed token tied to the transaction id, not by an account — she has none. Producer/Driver's cash-confirmation right is exercised through the API from their authenticated dashboard session.

## 4. Authentication flow

No public self-registration for any role. Accounts are created by the coordinator during in-person onboarding, matching how the pilot actually runs.

1. **Coordinator creates the account** — via Supabase Auth's admin API, using the producer's/driver's phone number as the identifier plus a 4-digit PIN issued in person.
2. **Login** — the producer/driver enters phone + PIN on a thin FastAPI-fronted login screen, which verifies against Supabase Auth and returns a session. Attempts are limited (migration 0013): 5 failures per phone or 20 per IP within 15 minutes lock it for 15 minutes, with "Too many attempts, try again in 15 minutes". A wrong PIN and an unregistered phone get the same answer, in the same time. A successful login clears the phone's counter, and lockouts are audit-logged. PINs are bcrypt cost 10, checked off the event loop, and re-hashed at that cost on login.
3. **Session** — the frontend holds the Supabase session token; reads against `producers`/`drivers`/`transactions`/`wallet_ledger_entries`/`withdrawal_requests` go directly to Supabase, scoped by RLS to that user's own `recipient_id`.
4. **Coordinator/Admin login** — same Supabase Auth mechanism, but the account carries an `is_admin` claim, unlocking the reconciliation, registration, and dispute-resolution endpoints (checked at both the RLS and FastAPI layers).
5. **Tourist** — no account, no session. The public pay endpoint is the only surface a tourist ever touches, and it's rate-limited per phone number rather than gated by login. A Case B walk-up cash sale (no driver referral) needs her own confirmation too (CLAUDE.md section 4 rule 12) — that also needs no login: a short-lived signed token tied to the transaction id, delivered via whatever already shows her the payment-confirmation screen (an in-page "I paid" button if she's still there, or an SMS link if not). Do not require Supabase Auth for this — it would contradict "no account for tourists."
6. **Cash confirmation taps for Producer/Driver** — a Case A referred cash sale needs both the driver's and the maker's confirmation, a Case B walk-up sale needs the maker's alongside the tourist's; both happen from the producer's/driver's already-authenticated dashboard session, via the same login as step 2.
7. **Suspended or closed accounts (CLAUDE.md rule 17):** `POST /auth/login` checks `account_status` after the PIN (so a wrong PIN learns nothing). A suspended account is refused with its reason and review date; a closed one with "This account is closed". Every authenticated producer/driver API call, the cash confirm included, is refused the same way, so a session opened before a suspension sees the reason too. A closed account is also banned in Supabase Auth (`ban_duration`), so its session can't refresh. A suspension isn't banned there, so an open session still shows the reason rather than a bare token error. A `closing` account can still log in to follow its final payout.

## 5. Money-movement sequence (STK/cash → ledger → payout)

1. `POST /transactions/initiate` — for `payment_method: mpesa`, STK Push fires. For `payment_method: cash`, no Daraja call — the transaction is created directly in `cash_unconfirmed` status with `confirmation_deadline` set (`created_at + CASH_CONFIRM_WINDOW_MINUTES`).
2. **M-Pesa path:** `POST /daraja/stk-callback/{token}`, the per-transaction URL the STK Push gave Daraja (token = HMAC of the transaction id, `app/links.py`). A missing or wrong token is refused (403), and so is an `Amount` other than the whole-shilling total the STK Push asked for (400, flagged). Otherwise, checking the transaction reference idempotently, `STK_QUERY_MODE` decides (`app/verification.py`):
   - **`flag`** (default; sandbox and demo): write `pending` `wallet_ledger_entries` for maker (product_maker_amount + photo_amount, whichever are enabled) and, only if `product_enabled`, for the driver; then confirm with Safaricom by STK Push Query in the background, flagging a "not paid" or unanswered result to the coordinator.
   - **`enforce`** (**required in production**): mark the sale `verifying` and write nothing until the query confirms it. A "no" fails it; no answer leaves it verifying, flagged, with "Check again" for the coordinator.
2b. **Cash path (parallel to step 2):** `POST /transactions/:id/confirm` is called once by each required party per rule 12 (driver+maker for Case A, tourist+maker for Case B), and sets the corresponding `*_confirmed_at` field. Once all required confirmations for that transaction's case are present, status flips to `cash_confirmed`. Then the maker's share is written as `cash_held` (never payable), and the driver's share, if any, opens a `cash_debts` row. That debt is settled from the maker's available M-Pesa-sourced entries at once if they cover it, otherwise as soon as they do. Cash itself never reaches steps 4–5. If `confirmation_deadline` passes first, status flips to `cash_expired` instead and nothing is written for that transaction.
3. Balance becomes `available` once cleared for payout eligibility. After every STK credit, the maker's outstanding cash debts are settled if the new balance covers them.
4. `POST /withdrawals/request` (on-demand, full payable balance, ≥ KES 500) **or** the 18:00 EAT APScheduler batch sweep (which settles cash debts first). Either path creates a `withdrawal_requests` row with a generated idempotency key and triggers Daraja B2C. Payable is the available M-Pesa-sourced balance, minus (for a maker) debts still owed to drivers. Before every B2C call, the API refuses with a critical log (`PayoutCapExceeded`) if everything paid or being paid, plus this payout, would exceed M-Pesa collected, or if this payout exceeds the recipient's own available entries.
5. `POST /daraja/b2c-callback` — marks the ledger entry `paid`, or on failure, returns funds to `available` (one automatic retry, then requires coordinator manual retry).
6. `GET /admin/reconciliation` — M-Pesa collected vs. disbursed vs. still owed. These always sum exactly and match the real M-Pesa account balance. Cash recorded and outstanding maker → driver debts are reported separately.
