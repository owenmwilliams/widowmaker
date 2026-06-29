/**
 * Unit tests for the migration runner's pure helpers (bin/migrate.js). DB-free.
 * (Adopt / apply / rollback behaviour is verified against a live Postgres; these
 * lock in the deterministic ordering and the \connect-stripping.)
 */

const { listMigrationFiles, readSql } = require('../../bin/migrate');

describe('listMigrationFiles', () => {
  const files = listMigrationFiles();

  test('only includes NNN_*.sql files (no migrations-safe.sql, no archive dir)', () => {
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) expect(f).toMatch(/^\d{3,}_.*\.sql$/);
    expect(files).not.toContain('migrations-safe.sql');
    expect(files).not.toContain('archive');
  });

  test('is ordered by numeric prefix then filename (deterministic for duplicates)', () => {
    const num = (f) => parseInt(f, 10);
    for (let i = 1; i < files.length; i++) {
      const prev = files[i - 1];
      const cur = files[i];
      const ok = num(prev) < num(cur) || (num(prev) === num(cur) && prev <= cur);
      expect(ok).toBe(true);
    }
  });
});

describe('readSql', () => {
  test('strips psql \\connect meta-commands', () => {
    const files = listMigrationFiles();
    for (const f of files) {
      expect(readSql(f)).not.toMatch(/^[ \t]*\\connect/im);
    }
  });
});
