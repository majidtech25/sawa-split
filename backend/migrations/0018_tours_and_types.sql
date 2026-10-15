-- SCOPE_V2 MUST 15 and 17: referrer and business types, and tours (anti code-farming).
-- Additive only: every new column has a default or is nullable, so the code before this
-- migration keeps working beside it.
--
--   drivers.referrer_type     driver | tour_guide | agent (default driver). Coordinator-set;
--                             shown on the referrer page, dashboard and Reconciliation.
--   producers.business_type   product | service (default product). A service includes
--                             photography in its price: no photo-consent line.
--   tours                     a referrer's tour: group size 1-30, ends at midnight EAT or
--                             when they end it. At most one open tour per referrer.
--   tour_joins                one row per tourist who joined a tour. Holds only a hash of
--                             the join token the tourist's phone keeps.
--   transactions.tour_id      the tour an open-sale referral was earned through.

begin;

alter table drivers add column referrer_type text not null default 'driver'
  check (referrer_type in ('driver', 'tour_guide', 'agent'));
alter table producers add column business_type text not null default 'product'
  check (business_type in ('product', 'service'));

-- Existing people (SCOPE_V2 MUST 15): James is a driver (the default), Hassan an agent;
-- every existing maker sells products (the default).
update drivers set referrer_type = 'agent' where lower(referral_code) = 'hassan';

create table tours (
  id          uuid primary key default gen_random_uuid(),
  driver_id   uuid not null references drivers(id),
  group_size  int not null check (group_size between 1 and 30),
  started_at  timestamptz not null default now(),
  ends_at     timestamptz not null,           -- the next midnight EAT after it started
  ended_at    timestamptz,                    -- set when ended by hand, or once past ends_at
  check (ends_at > started_at)
);
-- One open tour per referrer. A tour past its midnight is closed (ended_at = ends_at)
-- before a new one starts, so this index never blocks the next day's tour.
create unique index tours_one_open on tours (driver_id) where ended_at is null;
create index tours_started_idx on tours (started_at desc);

create table tour_joins (
  id          uuid primary key default gen_random_uuid(),
  tour_id     uuid not null references tours(id),
  token_hash  text unique not null,           -- sha256 of the join token; the token itself is never stored
  joined_at   timestamptz not null default now()
);
create index tour_joins_tour_idx on tour_joins (tour_id);

alter table transactions add column tour_id uuid references tours(id);
create index transactions_tour_idx on transactions (tour_id) where tour_id is not null;

-- Not for the browser: the referrer's dashboard, the tourist's join and Reconciliation
-- all go through the API.
revoke all on tours, tour_joins from anon, authenticated;
alter table tours enable row level security;        -- no policies: deny all
alter table tour_joins enable row level security;

commit;
