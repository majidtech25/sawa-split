-- Supabase Realtime streams only tables in the supabase_realtime publication (empty
-- on a fresh project). The coordinator's reconciliation view and the producer/driver
-- dashboards refetch when one of these changes (CLAUDE.md section 6 step 6, and the
-- demo's "ledger updates live" beat). Realtime applies each subscriber's RLS, so a
-- producer or driver only receives changes to their own rows (0002 + 0007).

alter publication supabase_realtime add table transactions, wallet_ledger_entries, withdrawal_requests;
