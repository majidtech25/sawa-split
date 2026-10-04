-- Supabase Cloud enforces a hard 6-char password minimum that cannot be lowered
-- (confirmed against the real project — not configurable, unlike self-hosted GoTrue's
-- GOTRUE_PASSWORD_MIN_LENGTH). A literal 4-digit PIN can't be Supabase's own Auth
-- password, so the PIN is decoupled from it entirely:
--   - Supabase Auth's password becomes an internal, random, human-never-sees-it secret,
--     used only to mint a real session after we've verified the PIN ourselves.
--   - The actual 4-digit PIN is bcrypt-hashed and checked by FastAPI (app/pin.py).
-- This is a new auxiliary table, not a change to the six locked business tables in
-- CLAUDE.md section 3 — producers/drivers are untouched. It covers coordinators too,
-- who have no domain row of their own (auth.users + app_metadata.is_admin only).
create table auth_credentials (
  auth_user_id  uuid primary key,
  phone         text unique not null,
  pin_hash      text not null,
  auth_password text not null,
  created_at    timestamptz not null default now()
);

-- No policies — default-deny for anon/authenticated via PostgREST. Only the
-- backend's direct Postgres connection (which bypasses RLS) ever reads this table.
alter table auth_credentials enable row level security;
