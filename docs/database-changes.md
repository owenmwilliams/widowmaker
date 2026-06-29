# How we change the database

This is the canonical process for schema changes. It exists because
`db/init-movetrack.sql` silently drifted out of sync with the migrations and a
column the app read (`locations.lat`) was missing on every fresh build, blanking
the inventory. The rules below + the automated guard make that class of bug fail
loudly in CI instead of in production.

## The two sources of schema truth (must always agree)

| Source | Role | Used by |
|---|---|---|
| `movetrack-api/migrations/NNN_*.sql` | The **forward change log**. Each file runs once, in order, recorded in `schema_migrations`. | Production & any existing DB, via `bin/migrate.js`. |
| `db/init-movetrack.sql` | The **canonical fresh-build schema** — the full current state in one file. | Brand-new databases (local dev, staging, CI). |

**Why they can drift:** `bin/migrate.js` adopts an existing database by
*baselining* every migration through `026` — recording them as applied **without
running them** (production already ran them via the old deploy loop). On a
brand-new database built from `init`, those same migrations are *also* baselined,
so anything a baselined migration added that `init` is missing **never gets
created**. Production has it; the fresh build doesn't. That is the drift.

## The rule

> **Every schema change is BOTH a new migration AND an edit to `init-movetrack.sql`, in the same PR.**

Concretely, to add/alter a table, column, or index:

1. **Create the next migration** `movetrack-api/migrations/NNN_short_name.sql`:
   - Use the next unused number (check the directory; numbers ≤ 016 have
     historical duplicates — never reuse or renumber those).
   - **Idempotent**: `CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`,
     `CREATE INDEX IF NOT EXISTS`, `CREATE OR REPLACE FUNCTION`,
     `DROP ... IF EXISTS`.
   - **Plain SQL only** — no psql meta-commands (`\connect`, `\i`). The runner
     executes via the `pg` driver, which doesn't understand them.
   - **One logical change per file.** Don't bundle a destructive change with an
     additive one.
   - Don't add your own `BEGIN`/`COMMIT` — the runner wraps each migration in a
     transaction. (Migrations `015`/`016` did, which is why they must never be
     replayed.)

2. **Mirror the change in `db/init-movetrack.sql`** so a fresh build matches.
   For a new column, edit the table's `CREATE TABLE`. For a new table/index, add
   it (the file's tail holds an idempotent reconciliation section — keep new
   feature tables there or alongside their peers).

3. **Add a line to `movetrack-api/migrations/CHANGELOG.md`.**

4. **Run the guard locally** (see below). CI runs it too and will block the PR on
   any mismatch.

## The guard (what stops this recurring)

`movetrack-api/scripts/check-schema-drift.js` parses every migration for the
tables/columns/indexes it declares (minus anything later dropped/renamed) and
diffs them against a database built fresh from `init` + the runner. Any object a
migration declares but the fresh build lacks ⇒ **exit 1**.

- CI job **`schema-drift`** (`.github/workflows/ci.yml`) spins up Postgres, runs
  `psql -f db/init-movetrack.sql` then `node bin/migrate.js`, then the guard. It
  gates every PR.
- Locally:
  ```bash
  createdb movetrack_drift
  psql -d movetrack_drift -f db/init-movetrack.sql
  cd movetrack-api
  MT_DATALAYER_HOSTNAME=localhost MT_DATALAYER_DATABASE=movetrack_drift \
  MT_DATALAYER_USERNAME=$USER node bin/migrate.js
  MT_DATALAYER_HOSTNAME=localhost MT_DATALAYER_DATABASE=movetrack_drift \
  MT_DATALAYER_USERNAME=$USER npm run check:schema-drift
  ```

> The guard checks **existence** of tables/columns/indexes. It does **not** check
> column types, defaults, `NOT NULL`, `CHECK`/FK constraints, triggers, or views.
> Those can still drift. The only way to guarantee `init` is byte-for-byte
> correct is to regenerate it from production (below).

## Deploy safety (already wired)

`cloudbuild.yaml` runs, in order: unit tests → **Cloud SQL backup** →
`node bin/migrate.js` → deploy. The migration step `waitFor`s the backup, and
Cloud Build aborts the build if the backup step fails — so **migrations never run
without a fresh restore point**. Recovery steps: `docs/plan/backup-and-recovery.md`.
The runner stops on the first failing migration (no `set +e`), so a bad migration
fails the deploy instead of silently half-applying.

## Recommended: periodically reseed `init` from production (gold standard)

Hand-maintaining `init` is what drifted. The robust long-term practice is to treat
a production schema dump as the source for `init`:

```bash
# Requires prod DB access (Cloud SQL).
pg_dump --schema-only --no-owner --no-privileges "$PROD_DSN" > db/init-movetrack.sql
```

Then new environments are `restore dump` + `node bin/migrate.js baseline`. Do this
after large schema changes, or at least once now to catch any type/constraint
drift the existence-only guard can't see. (This requires DB credentials, so it's
an operator step, not something CI does automatically.)

## Frozen history — do not touch

Migrations `004–026` are baselined (never re-run); `009–016` contain intentional
duplicate numbers recorded by filename; `015`/`016` are destructive and
non-idempotent. Never edit, renumber, or replay these — see the changelog's
"Frozen history" note. New work always goes in a new, higher-numbered migration.
