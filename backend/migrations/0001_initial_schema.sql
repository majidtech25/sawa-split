-- Sawa Split — initial schema
-- Source of truth: CLAUDE.md section 3. Six tables, applied in FK dependency order.

create extension if not exists pgcrypto;

create table producers (
  id                        uuid primary key default gen_random_uuid(),
  name                      text not null,
  phone                     text unique not null,
  till                      text not null,
  site                      text,
  default_split_driver_pct numeric not null check (default_split_driver_pct <= 40), -- maker floor: 60%, applies to the product component only
  charges_product           boolean not null default true,
  charges_photo             boolean not null default false,
  active                    boolean not null default true,
  created_at                timestamptz not null default now(),
  constraint producers_at_least_one_component check (charges_product or charges_photo)
);

create table drivers (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  phone      text unique not null,
  till       text not null,
  qr_code    text unique not null,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

-- Product and photo consent are two independent, separately-priced components.
-- A transaction charges whichever component(s) are active for that visit — never a merged bundle.
-- payment_method + the cash_* statuses implement the dual-confirmation cash flow (CLAUDE.md section 4 rule 12).
create table transactions (
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
);

-- Append-only — balances are computed, never stored directly.
-- Written identically for mpesa and cash transactions, once each has reached its own
-- "money has actually moved" point: the STK callback for mpesa, cash_confirmed for cash.
create table wallet_ledger_entries (
  id             uuid primary key default gen_random_uuid(),
  recipient_type text not null check (recipient_type in ('maker','driver')),
  recipient_id   uuid not null,
  amount         numeric not null check (amount > 0),
  status         text not null check (status in ('pending','available','paid','frozen')),
  transaction_id uuid references transactions(id),
  created_at     timestamptz not null default now()
);

create index wallet_ledger_entries_recipient_status_idx
  on wallet_ledger_entries (recipient_type, recipient_id, status);

create table withdrawal_requests (
  id              uuid primary key default gen_random_uuid(),
  recipient_type  text not null,
  recipient_id    uuid not null,
  amount          numeric not null,
  idempotency_key uuid unique not null,
  b2c_receipt     text,
  status          text not null check (status in ('requested','processing','paid','failed','retried')),
  requested_at    timestamptz not null default now(),
  resolved_at     timestamptz
);

-- True offline/no-connectivity capture — a still-unbuilt future concern, distinct from
-- cash-payment tracking, which lives in `transactions` above via payment_method + cash_*
-- statuses. Do not repurpose this table for cash.
create table sync_queue_items (
  id              uuid primary key default gen_random_uuid(),
  payload         jsonb not null,
  idempotency_key uuid unique not null,
  synced_at       timestamptz
);
