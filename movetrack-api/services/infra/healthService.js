/**
 * services/infra/healthService.js
 *
 * Shared health-check helpers used by both the public probe (routes/health.js)
 * and the admin maintenance endpoint (routes/admin/maintenance.js).
 */

const { db } = require('./db');

/**
 * Ping the database with a trivial query. Resolves to true/false; never throws.
 */
async function checkDatabase() {
  try {
    await db.one('SELECT 1 AS ok');
    return true;
  } catch (err) {
    console.error('[health] database check failed:', err.message);
    return false;
  }
}

/**
 * Full readiness snapshot: process liveness + dependency status.
 * Returns { ok, status, uptime_s, checks: { database } }.
 */
async function getReadiness() {
  const database = await checkDatabase();
  const ok = database;
  return {
    ok,
    status: ok ? 'ok' : 'degraded',
    uptime_s: Math.round(process.uptime()),
    checks: { database },
  };
}

module.exports = { checkDatabase, getReadiness };
