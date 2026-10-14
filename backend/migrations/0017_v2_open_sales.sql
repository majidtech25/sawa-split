-- v2 (SCOPE_V2.md): referral codes, stall codes, makers' photo fee, and open sales.
-- Additive only: new columns and a new table; nothing existing changes meaning, and the
-- signed price cards (v1) keep working.
--
--   drivers.referral_code   short, unique, case-insensitive (JAMES). /#/driver/<code>
--                           accepts it as well as the old qr_code (QR-DRIVER-001).
--   producers.stall_code    short, unique, case-insensitive (WANJIRU): the maker's one
--                           static stand QR, /#/stall/<code>.
--   producers.photo_fee     the maker's photo-consent fee, whole shillings; null = none.
--   open_sales              a sale the maker typed (agreed amount, optional description,
--                           photo consent): single use, 30-minute expiry, cancellable,
--                           at most one open (or paying) per maker.
--   transactions.open_sale_id   which open sale a payment was for.

begin;

alter table producers add column stall_code text;
alter table producers add column photo_fee numeric
  check (photo_fee is null or (photo_fee > 0 and photo_fee = trunc(photo_fee)));
alter table drivers add column referral_code text;

-- Codes from the first name, letters only, upper case, at most 10 characters; a number
-- is appended when that's taken (case-insensitive). The API does the same at registration.
do $$
declare r record; base text; candidate text; n int;
begin
  for r in select id, name from producers where stall_code is null order by created_at loop
    base := upper(left(regexp_replace(split_part(btrim(r.name), ' ', 1), '[^A-Za-z]', '', 'g'), 10));
    if base = '' then base := 'STALL'; end if;
    candidate := base; n := 1;
    while exists (select 1 from producers where lower(stall_code) = lower(candidate)) loop
      n := n + 1; candidate := base || n;
    end loop;
    update producers set stall_code = candidate where id = r.id;
  end loop;
  for r in select id, name from drivers where referral_code is null order by created_at loop
    base := upper(left(regexp_replace(split_part(btrim(r.name), ' ', 1), '[^A-Za-z]', '', 'g'), 10));
    if base = '' then base := 'GUIDE'; end if;
    candidate := base; n := 1;
    while exists (select 1 from drivers where lower(referral_code) = lower(candidate)) loop
      n := n + 1; candidate := base || n;
    end loop;
    update drivers set referral_code = candidate where id = r.id;
  end loop;
end $$;

alter table producers alter column stall_code set not null;
alter table drivers alter column referral_code set not null;
create unique index producers_stall_code_key on producers (lower(stall_code));
create unique index drivers_referral_code_key on drivers (lower(referral_code));

-- The demo maker charges KSh 10 for photo consent (as on her signed price card).
update producers set photo_fee = 10 where phone = '+254708374149';

create table open_sales (
  id           uuid primary key default gen_random_uuid(),
  producer_id  uuid not null references producers(id),
  amount       numeric not null check (amount > 0 and amount = trunc(amount)),  -- agreed price, whole KSh
  description  text,
  photo_fee    numeric check (photo_fee is null or (photo_fee > 0 and photo_fee = trunc(photo_fee))),  -- snapshot; null = no photo consent
  status       text not null default 'open' check (status in ('open', 'paying', 'paid', 'expired', 'cancelled')),
  expires_at   timestamptz not null,
  created_at   timestamptz not null default now(),
  paid_at      timestamptz,
  cancelled_at timestamptz
);
-- One open (or being-paid) sale per maker.
create unique index open_sales_one_active on open_sales (producer_id) where status in ('open', 'paying');
create index open_sales_open_expiry_idx on open_sales (expires_at) where status = 'open';

alter table transactions add column open_sale_id uuid references open_sales(id);
create index transactions_open_sale_idx on transactions (open_sale_id) where open_sale_id is not null;

-- Not for the browser: the stall page and the maker's dashboard go through the API.
revoke all on open_sales from anon, authenticated;
alter table open_sales enable row level security;   -- no policies: deny all

commit;
