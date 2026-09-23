# Sawa Split — Backend Schema & Authentication Flow

**Status:** Locked. Full rules and lifecycle states are in the published Rulebook artifact; this file is the schema + auth sequence Claude Code builds directly from.

## 1. Schema — six tables

```sql
-- producers
id            uuid primary key,
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
id            uuid primary key,
name          text not null,
phone         text unique not null,
till          text not null,
qr_code       text unique not null,
active        boolean not null default true,
created_at    timestamptz not null default now()

-- transactions
-- Product and photo consent are two independent, separately-priced components.
-- A transaction charges whichever component(s) are active for that visit — never a merged bundle.
id                    uuid primary key,
producer_id           uuid references producers(id),
driver_id             uuid references drivers(id),   -- nullable: no driver on a photo-only visit with no referral
product_enabled       boolean not null default false,
product_amount        numeric,              -- null unless product_enabled; the component's own total
product_maker_amount  numeric,              -- null unless product_enabled; maker's split of product_amount
product_driver_amount numeric,              -- null unless product_enabled; driver's split of product_amount
photo_enabled         boolean not null default false,
photo_amount          numeric,              -- null unless photo_enabled; paid 100% to maker, never split
total_amount          numeric not null check (total_amount > 0),  -- product_amount + photo_amount, whichever are enabled
maker_amount          numeric not null,     -- product_maker_amount + photo_amount
driver_amount         numeric not null default 0,  -- product_driver_amount only — photo never contributes here
stk_receipt           text unique,
status                text not null check (status in ('initiated','confirmed','failed','disputed')),
created_at            timestamptz not null default now(),
constraint transactions_at_least_one_component check (product_enabled or photo_enabled)

-- wallet_ledger_entries   (append-only — balances are computed, never stored directly)
id              uuid primary key,
recipient_type  text not null check (recipient_type in ('maker','driver')),
recipient_id    uuid not null,
amount          numeric not null check (amount > 0),
status          text not null check (status in ('pending','available','paid','frozen')),
transaction_id  uuid references transactions(id),
created_at      timestamptz not null default now()
-- index: (recipient_type, recipient_id, status) for fast balance queries

-- withdrawal_requests
id                uuid primary key,
recipient_type    text not null,
recipient_id      uuid not null,
amount            numeric not null,
idempotency_key   uuid unique not null,
b2c_receipt       text,
status            text not null check (status in ('requested','processing','paid','failed','retried')),
requested_at      timestamptz not null default now(),
resolved_at       timestamptz

-- sync_queue_items   (offline cash transactions — evidence only, never enters payout pipeline)
id                uuid primary key,
payload           jsonb not null,
idempotency_key   uuid unique not null,
synced_at         timestamptz
```

## 2. Storage

One Supabase Storage bucket, `qr-codes` — public read, coordinator-only write. Nothing else needs a bucket at MVP scope.

## 3. Row Level Security — permission matrix

| Role | producers/drivers | transactions | wallet_ledger_entries | withdrawal_requests | admin actions |
|---|---|---|---|---|---|
| Tourist (anonymous) | — | create (via pay endpoint only) | — | — | — |
| Producer | read own | read own | read own | create/read own | — |
| Driver | read own | read own | read own | create/read own | — |
| Coordinator | full | full + dispute flag | full | full + manual retry | reconciliation, registration |

Enforced twice: Supabase RLS at the data layer, FastAPI endpoint checks at the API layer. A client can display its own balance; it can never write to it directly — only the FastAPI service, using the service-role key, writes to money-affecting tables.

## 4. Authentication flow

No public self-registration for any role. Accounts are created by the coordinator during in-person onboarding, matching how the pilot actually runs.

1. **Coordinator creates the account** — via Supabase Auth's admin API, using the producer's/driver's phone number as the identifier plus a 4-digit PIN issued in person.
2. **Login** — the producer/driver enters phone + PIN on a thin FastAPI-fronted login screen, which verifies against Supabase Auth and returns a session.
3. **Session** — the frontend holds the Supabase session token; reads against `producers`/`drivers`/`transactions`/`wallet_ledger_entries`/`withdrawal_requests` go directly to Supabase, scoped by RLS to that user's own `recipient_id`.
4. **Coordinator/Admin login** — same Supabase Auth mechanism, but the account carries an `is_admin` claim, unlocking the reconciliation, registration, and dispute-resolution endpoints (checked at both the RLS and FastAPI layers).
5. **Tourist** — no account, no session. The public pay endpoint is the only surface a tourist ever touches, and it's rate-limited per phone number rather than gated by login.

## 5. Money-movement sequence (STK → ledger → payout)

1. `POST /transactions/initiate` — STK Push fires.
2. `POST /daraja/stk-callback` — Daraja confirms; backend checks the transaction reference (idempotent), writes `pending` `wallet_ledger_entries` for maker (product_maker_amount + photo_amount, whichever are enabled) and, only if `product_enabled`, for the driver.
3. Balance becomes `available` once cleared for payout eligibility.
4. `POST /withdrawals/request` (on-demand, full balance, ≥ KES 500) **or** the 18:00 EAT APScheduler batch sweep — either path creates a `withdrawal_requests` row with a generated idempotency key and triggers Daraja B2C.
5. `POST /daraja/b2c-callback` — marks the ledger entry `paid`, or on failure, returns funds to `available` (one automatic retry, then requires coordinator manual retry).
6. `GET /admin/reconciliation` — Till collected vs. disbursed vs. pending, should always sum correctly.
