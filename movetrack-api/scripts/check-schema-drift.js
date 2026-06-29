#!/usr/bin/env node
'use strict';

/**
 * scripts/check-schema-drift.js
 *
 * Guards against db/init-movetrack.sql drifting out of sync with the migrations.
 *
 * The deploy story has two schema sources that MUST agree:
 *   1. db/init-movetrack.sql        — the canonical fresh-build schema
 *   2. movetrack-api/migrations/*   — the forward change log applied to prod
 *
 * Because bin/migrate.js adopts an existing database by baselining everything
 * through LEGACY_BASELINE_THROUGH *without running it*, any table/column/index a
 * migration introduces but init lacks will simply be ABSENT on a fresh build,
 * while production (which ran every migration) has it. That silent divergence is
 * what made the inventory snapshot fail on locations.lat/lng.
 *
 * This script makes that divergence loud:
 *   - statically parses every migration for the tables, columns, and indexes it
 *     declares (minus anything later dropped/renamed),
 *   - compares against the ACTUAL catalog of a database that was just built from
 *     init + the migration runner,
 *   - exits non-zero (listing every drifted object) if anything a migration
 *     declares is missing from that fresh build.
 *
 * Usage (against an already-built fresh DB; connection via the MT_DATALAYER_* env
 * vars the app/runner use):
 *     node scripts/check-schema-drift.js
 *
 * CI builds the fresh DB first (psql -f db/init-movetrack.sql && node bin/migrate.js)
 * then runs this. See .github/workflows/ci.yml (schema-drift job).
 */

const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');
const MIGRATION_RE = /^\d{3,}_.*\.sql$/; // same set the runner applies; excludes migrations-safe.sql

function connectionConfig() {
  return {
    host: process.env.MT_DATALAYER_HOSTNAME || '127.0.0.1',
    user: process.env.MT_DATALAYER_USERNAME,
    password: process.env.MT_DATALAYER_PASSWORD,
    database: process.env.MT_DATALAYER_DATABASE,
    port: process.env.MT_DATALAYER_PORT ? Number(process.env.MT_DATALAYER_PORT) : 5432,
  };
}

function stripComments(sql) {
  return sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ');
}

const norm = (s) => s.trim().replace(/"/g, '').toLowerCase();
const tbl = (s) => norm(s).split('.').pop();

function parseMigrations() {
  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => MIGRATION_RE.test(f))
    .sort((a, b) => parseInt(a, 10) - parseInt(b, 10) || a.localeCompare(b));

  const addedCols = new Map();     // "table.col" -> file
  const droppedCols = new Set();
  const renamedFrom = new Set();
  const createdTables = new Map();
  const droppedTables = new Set();
  const createdIndexes = new Map();
  const droppedIndexes = new Set();

  const alterRe = /\bALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?([a-zA-Z0-9_".]+)([\s\S]*?)(?=;|$)/gi;
  const addColRe = /\bADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-zA-Z0-9_"]+)/gi;
  const dropColRe = /\bDROP\s+COLUMN\s+(?:IF\s+EXISTS\s+)?([a-zA-Z0-9_"]+)/gi;
  const renameColRe = /\bRENAME\s+COLUMN\s+([a-zA-Z0-9_"]+)\s+TO\s+([a-zA-Z0-9_"]+)/gi;
  const createTabRe = /\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-zA-Z0-9_".]+)/gi;
  const dropTabRe = /\bDROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?([a-zA-Z0-9_".]+)/gi;
  const createIdxRe = /\bCREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:CONCURRENTLY\s+)?(?:IF\s+NOT\s+EXISTS\s+)?([a-zA-Z0-9_"]+)/gi;
  const dropIdxRe = /\bDROP\s+INDEX\s+(?:IF\s+EXISTS\s+)?([a-zA-Z0-9_"]+)/gi;

  for (const f of files) {
    const sql = stripComments(fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8'));

    let m;
    while ((m = alterRe.exec(sql))) {
      const table = tbl(m[1]);
      const body = m[2];
      let c;
      while ((c = addColRe.exec(body))) {
        const key = `${table}.${norm(c[1])}`;
        if (!addedCols.has(key)) addedCols.set(key, f);
      }
      while ((c = dropColRe.exec(body))) droppedCols.add(`${table}.${norm(c[1])}`);
      while ((c = renameColRe.exec(body))) renamedFrom.add(`${table}.${norm(c[1])}`);
    }
    while ((m = createTabRe.exec(sql))) {
      const t = tbl(m[1]);
      if (!createdTables.has(t)) createdTables.set(t, f);
    }
    while ((m = dropTabRe.exec(sql))) droppedTables.add(tbl(m[1]));
    while ((m = createIdxRe.exec(sql))) {
      const i = norm(m[1]);
      if (!createdIndexes.has(i)) createdIndexes.set(i, f);
    }
    while ((m = dropIdxRe.exec(sql))) droppedIndexes.add(norm(m[1]));
  }

  return { files, addedCols, droppedCols, renamedFrom, createdTables, droppedTables, createdIndexes, droppedIndexes };
}

async function fetchCatalog(client) {
  const cols = await client.query(
    "SELECT table_name||'.'||column_name AS k FROM information_schema.columns WHERE table_schema='public'"
  );
  const tables = await client.query(
    "SELECT table_name AS k FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'"
  );
  const indexes = await client.query("SELECT indexname AS k FROM pg_indexes WHERE schemaname='public'");
  return {
    cols: new Set(cols.rows.map((r) => r.k.toLowerCase())),
    tables: new Set(tables.rows.map((r) => r.k.toLowerCase())),
    indexes: new Set(indexes.rows.map((r) => r.k.toLowerCase())),
  };
}

async function main() {
  const decl = parseMigrations();
  const client = new Client(connectionConfig());
  await client.connect();
  let cat;
  try {
    cat = await fetchCatalog(client);
  } finally {
    await client.end();
  }

  const missingTables = [...decl.createdTables]
    .filter(([t]) => !decl.droppedTables.has(t) && !cat.tables.has(t))
    .sort();
  const missingCols = [...decl.addedCols]
    .filter(([key]) => {
      const t = key.split('.')[0];
      if (decl.droppedCols.has(key) || decl.renamedFrom.has(key)) return false;
      if (decl.droppedTables.has(t) || !cat.tables.has(t)) return false; // reported under missing table
      return !cat.cols.has(key);
    })
    .sort();
  const missingIndexes = [...decl.createdIndexes]
    .filter(([i]) => !decl.droppedIndexes.has(i) && !cat.indexes.has(i))
    .sort();

  const report = (title, rows) => {
    console.log(`\n${title}: ${rows.length}`);
    for (const [name, file] of rows) console.log(`  ${name}  <- ${file}`);
  };

  console.log(`Parsed ${decl.files.length} migration files; fresh build has ` +
    `${cat.tables.size} tables, ${cat.cols.size} columns, ${cat.indexes.size} indexes.`);
  report('Tables declared by a migration but MISSING from the fresh build', missingTables);
  report('Columns declared by a migration but MISSING from the fresh build', missingCols);
  report('Indexes declared by a migration but MISSING from the fresh build', missingIndexes);

  const total = missingTables.length + missingCols.length + missingIndexes.length;
  if (total > 0) {
    console.error(
      `\n✗ SCHEMA DRIFT: ${total} object(s) exist in migrations but not in a fresh build from init.\n` +
      `  Fix: add the missing object(s) to db/init-movetrack.sql (and add a forward\n` +
      `  migration with IF NOT EXISTS if production needs repairing). See docs/database-changes.md.`
    );
    process.exit(1);
  }
  console.log('\n✓ No schema drift — db/init-movetrack.sql matches the migrations.');
}

main().catch((err) => {
  console.error(`[check-schema-drift] FAILED: ${err.message}`);
  process.exit(1);
});
