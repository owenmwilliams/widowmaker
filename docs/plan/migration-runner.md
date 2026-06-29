# Database Migration Runner

Replaces the old Cloud Build approach of replaying every `*.sql` file on each
deploy with `set +e` (errors swallowed, no record of what ran).

## What changed

- **`movetrack-api/bin/migrate.js`** — a tracked, transactional runner:
  - records applied files in a `schema_migrations(filename, applied_at)` table,
  - applies each pending migration in its own transaction,
  - **stops and exits non-zero on the first failure** (no silent partial deploys),
  - deterministic ordering (numeric prefix, then filename — stable for the
    historical duplicate-numbered files),
  - strips stray `\connect` psql meta-commands defensively.
- **`cloudbuild.yaml`** `run-migrations` step now runs `node bin/migrate.js`
  (Node image + Cloud SQL Proxy) instead of the `set +e` `psql` loop. The DB
  password comes from Secret Manager via `availableSecrets` (`DB_PASS`).
- **`db/init-movetrack.sql`** fixed: removed the hardcoded `\connect movetrack_db;`
  (it silently wrote to the wrong database) and a duplicate `idx_users_email`
  index that made the script abort under `ON_ERROR_STOP`.

## Commands

```bash
cd movetrack-api
npm run migrate           # apply pending migrations (auto-baselines an existing DB)
npm run migrate:status    # show applied / pending per file
node bin/migrate.js baseline   # record all current files as applied, run nothing
```

Connection is read from `MT_DATALAYER_{HOSTNAME,PORT,USERNAME,PASSWORD,DATABASE}`.

## How adoption works (important for the existing prod DB)

The production database's schema was built up over time by the old loop, so it
already contains every migration. On the **first** run of the new runner there is
no `schema_migrations` table yet but the schema is present (sentinel: the `users`
table exists). The runner detects this and **baselines** — records all current
migration files as applied **without executing them**. From then on only
genuinely new files run. This means the new system can be rolled out against prod
with zero risk of re-running historical migrations.

## Provisioning a brand-new environment (staging / fresh)

⚠️ The historical migrations are internally inconsistent with `db/init-movetrack.sql`
(init represents the post-UUID-conversion schema while migrations 014–018 still
reference the old `owner` column; init is also missing some tables such as
`move_waypoints`). Replaying all migrations from scratch does **not** produce a
correct schema.

Therefore, provision a new environment from a **production schema dump**, then
baseline:

```bash
pg_dump --schema-only --no-owner "$PROD_URL" > schema.sql
psql "$NEW_DB_URL" -f schema.sql
MT_DATALAYER_... node bin/migrate.js baseline
```

Follow-up (tracked separately): regenerate `db/init-movetrack.sql` from a prod
schema dump so it is a faithful, complete baseline, and retire the divergent
historical migration files into `migrations/archive/`.

## Verification (performed against a local Postgres 16)

1. **Adopt:** load a DB with the existing schema, `node bin/migrate.js migrate`
   → baselines all current migrations, runs no SQL, reports up to date.
2. **Apply:** add a new `NNN_*.sql`, run migrate → only the new file applies and
   is recorded; re-running is a no-op.
3. **Fail-safe:** a migration with bad SQL → the runner rolls back, exits
   non-zero, and the file stays `PENDING` (not recorded).
