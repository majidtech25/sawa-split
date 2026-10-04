-- qr-codes Supabase Storage bucket — public read, coordinator-only write
-- (CLAUDE.md section 3's closing line; deferred from migration 0001 to pair
-- naturally with the RLS/auth work in 0002).

insert into storage.buckets (id, name, public)
values ('qr-codes', 'qr-codes', true)
on conflict (id) do nothing;

-- storage.objects ships with RLS already enabled on every Supabase project —
-- only policies need adding here, not `enable row level security` itself.

create policy qr_codes_public_read on storage.objects
  for select using (bucket_id = 'qr-codes');

create policy qr_codes_coordinator_insert on storage.objects
  for insert with check (bucket_id = 'qr-codes' and public.is_admin());

create policy qr_codes_coordinator_update on storage.objects
  for update using (bucket_id = 'qr-codes' and public.is_admin());

create policy qr_codes_coordinator_delete on storage.objects
  for delete using (bucket_id = 'qr-codes' and public.is_admin());
