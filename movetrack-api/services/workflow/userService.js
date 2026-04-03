/**
 * userService.js
 *
 * User-level workflow logic: plan quota tracking, usage metering.
 */

const knex = require('../infra/knex');
const { getUTCWeekStart } = require('../primitives/dateService');

const BASIC_MULTI_LIMIT = parseInt(process.env.BASIC_MULTI_SCANS_PER_WEEK || '3', 10);

// ── plan_usage table ──────────────────────────────────────────────────────────

const usageTableReady = ensureUsageTable();

async function ensureUsageTable(attempt = 1) {
  try {
    const exists = await knex.schema.hasTable('plan_usage');
    if (!exists) {
      await knex.schema.createTable('plan_usage', (table) => {
        table.increments('id').primary();
        table.uuid('user_id').notNullable();
        table.date('week_start').notNullable();
        table.integer('multi_scans').defaultTo(0);
        table.unique(['user_id', 'week_start']);
      });
    }
  } catch (err) {
    if (attempt < 3) {
      console.warn(`[userService] ensureUsageTable failed (attempt ${attempt}), retrying in 2s...`, err.code || err.message);
      await new Promise(r => setTimeout(r, 2000));
      return ensureUsageTable(attempt + 1);
    }
    console.error('[userService] Failed to ensure plan_usage table:', err);
  }
}

// ── Multi-scan quota ──────────────────────────────────────────────────────────

/**
 * Returns the current weekly multi-scan quota status without consuming a scan.
 * @returns {{ remaining: number, limit: number, nextReset: string }}
 */
async function getBasicMultiScanStatus(userId) {
  if (!userId) return { remaining: 0, limit: BASIC_MULTI_LIMIT, nextReset: null };
  await usageTableReady;
  const weekStart = getUTCWeekStart();
  const usage = await knex('plan_usage').where({ user_id: userId, week_start: weekStart }).first();
  const used = usage ? usage.multi_scans : 0;
  const remaining = Math.max(BASIC_MULTI_LIMIT - used, 0);
  const nextReset = new Date(weekStart);
  nextReset.setUTCDate(nextReset.getUTCDate() + 7);
  return { remaining, limit: BASIC_MULTI_LIMIT, nextReset: nextReset.toISOString() };
}

/**
 * Checks quota and, if allowed, increments usage by one scan atomically.
 * @returns {{ allowed: boolean, remaining: number, limit: number, nextReset: string|null }}
 */
async function consumeBasicMultiScan(userId) {
  if (!userId) return { allowed: false, remaining: 0, limit: BASIC_MULTI_LIMIT, nextReset: null };
  await usageTableReady;
  const weekStart = getUTCWeekStart();
  let usage = await knex('plan_usage').where({ user_id: userId, week_start: weekStart }).first();
  if (!usage) {
    await knex('plan_usage').insert({ user_id: userId, week_start: weekStart, multi_scans: 0 });
    usage = { multi_scans: 0 };
  }
  if (usage.multi_scans >= BASIC_MULTI_LIMIT) {
    const nextReset = new Date(weekStart);
    nextReset.setUTCDate(nextReset.getUTCDate() + 7);
    return { allowed: false, remaining: 0, limit: BASIC_MULTI_LIMIT, nextReset: nextReset.toISOString() };
  }
  await knex('plan_usage').where({ user_id: userId, week_start: weekStart }).increment('multi_scans', 1);
  return { allowed: true, remaining: BASIC_MULTI_LIMIT - (usage.multi_scans + 1), limit: BASIC_MULTI_LIMIT, nextReset: null };
}

// ── Route guards ──────────────────────────────────────────────────────────────

/**
 * Express middleware: requires pro plan or admin flag.
 * Assumes `authenticate` has already run and set `req.user`.
 */
function ensureProOrAdmin(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ success: false, error: 'Not authenticated' });
  }
  const plan = req.user.plan || 'basic';
  if (req.user.is_admin || plan === 'pro') return next();
  return res.status(403).json({ success: false, error: 'Pro plan required' });
}

module.exports = { getBasicMultiScanStatus, consumeBasicMultiScan, BASIC_MULTI_LIMIT, ensureProOrAdmin };
