-- Case B cash confirmation (CLAUDE.md section 4 rule 12 / section 5): the tourist has
-- no account and needs a short-lived signed token tied to the transaction id. Minting
-- a real Supabase-compatible JWT would need the project's raw JWT secret, which isn't
-- provisioned — so this is a stored opaque token instead, set only on cash Case B
-- transactions (no driver_id) at creation time.
alter table transactions add column tourist_confirm_token text unique;
