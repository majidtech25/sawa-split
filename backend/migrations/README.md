Plain numbered SQL files applied by hand via `psql`, run in order. No migration framework — matches CLAUDE.md's "prefer boring and correct."

Apply against Supabase (`DATABASE_URL` in `backend/.env`, Supabase's own `postgresql://...` string, no substitution needed for `psql`):

```
cd backend
set -a; source .env; set +a
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f migrations/0001_initial_schema.sql
```

Verify a migration's constraints actually hold (inserts one valid row per table, then deliberately violates the named check constraints and confirms they're rejected, then cleans up after itself):

```
bash migrations/verify_0001.sh
```
