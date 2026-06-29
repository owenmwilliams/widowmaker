#!/usr/bin/env node
'use strict';

/**
 * bin/migrate.js — tracked, transactional database migration runner.
 *
 * Replaces the previous cloudbuild approach of replaying every *.sql file on
 * every deploy with `set +e` (errors swallowed, no record of what ran). This:
 *   - records applied migrations in a `schema_migrations` table,
 *   - applies each pending migration inside its own transaction,
 *   - STOPS and exits non-zero on the first failure (no silent partial deploys),
 *   - adopts an existing database safely via baseline.
 *
 * Commands:
 *   migrate (default)  Apply pending migrations. On a database that already has
 *                      the schema but no tracking table yet, it auto-baselines
 *                      (records all current files as applied WITHOUT running
 *                      them) — the production DB's schema was built by the legacy
 *                      loop and must not be re-run.
 *   baseline           Record all current migration files as applied without
 *                      executing them (explicit adopt).
 *   status             Print applied / pending for each migration file.
 *
 * Connection comes from the same MT_DATALAYER_* env vars the app uses.
 *
 * NOTE: `db/init-movetrack.sql` is known-incomplete and diverges from the
 * historical migrations, so provisioning a brand-new environment should be done
 * from a production schema dump (pg_dump --schema-only), then `baseline`. See
 * docs/plan/migration-runner.md.
 */

const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');
const MIGRATION_RE = /^\d{3,}_.*\.sql$/;        // NNN_description.sql only
const SENTINEL_TABLE = 'users';                 // presence ⇒ schema already exists

// The last migration applied by the pre-runner deploy loop. When auto-adopting an
// existing database, everything up to and including this is recorded as already
// applied (it was); migrations after it are genuinely new and get executed.
// (Filenames are zero-padded 3-digit, so a lexical comparison is order-correct.)
const LEGACY_BASELINE_THROUGH = '026_add_beta_instrumentation.sql';

function connectionConfig() {
  const host = process.env.MT_DATALAYER_HOSTNAME;
  const cfg = {
    user: process.env.MT_DATALAYER_USERNAME,
    password: process.env.MT_DATALAYER_PASSWORD,
    database: process.env.MT_DATALAYER_DATABASE,
    port: process.env.MT_DATALAYER_PORT ? Number(process.env.MT_DATALAYER_PORT) : 5432,
  };
  // Cloud SQL unix socket (/cloudsql/...) vs TCP host.
  cfg.host = host || '127.0.0.1';
  return cfg;
}

function listMigrationFiles() {
  return fs.readdirSync(MIGRATIONS_DIR)
    .filter((f) => MIGRATION_RE.test(f))
    .sort((a, b) => {
      const na = parseInt(a, 10);
      const nb = parseInt(b, 10);
      if (na !== nb) return na - nb;       // numeric prefix first
      return a < b ? -1 : a > b ? 1 : 0;   // then lexical (deterministic for dupes)
    });
}

function readSql(file) {
  const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
  // Strip psql meta-commands (e.g. \connect) — invalid via the pg driver and a
  // footgun (they hardcode a DB name). New migrations must be plain SQL.
  return sql.replace(/^[ \t]*\\connect.*$/gim, '');
}

async function tableExists(client, name) {
  const r = await client.query('SELECT to_regclass($1) AS reg', [`public.${name}`]);
  return Boolean(r.rows[0].reg);
}

async function ensureTrackingTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename   TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
}

async function appliedSet(client) {
  const r = await client.query('SELECT filename FROM schema_migrations');
  return new Set(r.rows.map((x) => x.filename));
}

async function recordAll(client, files) {
  for (const f of files) {
    await client.query(
      'INSERT INTO schema_migrations(filename) VALUES ($1) ON CONFLICT DO NOTHING',
      [f]
    );
  }
}

async function run() {
  const cmd = process.argv[2] || 'migrate';
  const files = listMigrationFiles();
  const client = new Client(connectionConfig());
  await client.connect();

  try {
    const trackingExisted = await tableExists(client, 'schema_migrations');
    await ensureTrackingTable(client);

    if (cmd === 'status') {
      const applied = await appliedSet(client);
      for (const f of files) console.log(`${applied.has(f) ? 'applied' : 'PENDING'}  ${f}`);
      console.log(`\n${applied.size}/${files.length} applied.`);
      return;
    }

    // Adopt an existing schema: tracking table is brand-new but the app schema
    // is already present (production built by the legacy loop, or a prod dump).
    if (!trackingExisted) {
      const schemaPresent = await tableExists(client, SENTINEL_TABLE);
      if (cmd === 'baseline') {
        // Explicit adopt of a COMPLETE schema (e.g. provisioned from a prod dump):
        // record every current migration as applied, run nothing.
        await recordAll(client, files);
        console.log(`[migrate] baselined ${files.length} migration(s) — no SQL executed.`);
        return;
      }
      if (schemaPresent) {
        // Auto-adopt the existing production schema: mark migrations through the
        // legacy baseline as already-applied (the old loop ran them), then fall
        // through to APPLY anything newer (e.g. the first migration added under
        // the new runner).
        const through = files.filter((f) => f <= LEGACY_BASELINE_THROUGH);
        await recordAll(client, through);
        console.log(`[migrate] adopted existing database: baselined ${through.length} migration(s) through ${LEGACY_BASELINE_THROUGH}.`);
      }
    } else if (cmd === 'baseline') {
      const applied = await appliedSet(client);
      const missing = files.filter((f) => !applied.has(f));
      await recordAll(client, missing);
      console.log(`[migrate] baselined ${missing.length} migration(s).`);
      return;
    }

    // Apply pending migrations, each in its own transaction.
    const applied = await appliedSet(client);
    const pending = files.filter((f) => !applied.has(f));
    if (pending.length === 0) {
      console.log('[migrate] up to date — no pending migrations.');
      return;
    }

    for (const f of pending) {
      console.log(`[migrate] applying ${f} ...`);
      try {
        await client.query('BEGIN');
        await client.query(readSql(f));
        await client.query('INSERT INTO schema_migrations(filename) VALUES ($1)', [f]);
        await client.query('COMMIT');
        console.log(`[migrate] ✓ ${f}`);
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw new Error(`migration ${f} failed: ${err.message}`);
      }
    }
    console.log(`[migrate] applied ${pending.length} migration(s).`);
  } finally {
    await client.end();
  }
}

if (require.main === module) {
  run().catch((err) => {
    console.error(`[migrate] FAILED: ${err.message}`);
    process.exit(1);
  });
}

module.exports = { listMigrationFiles, readSql };
