'use strict';

/**
 * services/infra/cost/aiCostService.js
 *
 * AI cost metering + hard per-user budget caps (B4).
 *
 * The app calls paid LLM/vision providers (Gemini, Claude, GPT-4o, …) on behalf
 * of users with no spend tracking. On a free tier that is an unbounded financial
 * risk — one abusive loop can run a large bill. This module:
 *   - estimates the USD cost of each model call from token counts,
 *   - accumulates per-user daily spend in the user_costs table,
 *   - enforces a daily + monthly USD cap (HTTP 402 when exceeded).
 *
 * Prices are approximate public list prices per 1M tokens and are intentionally
 * conservative (rounded up) so the cap trips slightly before real overspend.
 * They are budgeting estimates, not billing figures.
 */

const { db } = require('../db');

// USD per 1,000,000 tokens. Matched by longest model-id prefix; DEFAULT is used
// for anything unrecognized (conservative so unknown models still cost-count).
const PRICING = {
  'gemini-2.5-flash': { input: 0.30, output: 2.50 },
  'gemini-2.5-pro': { input: 1.25, output: 10.0 },
  'gemini-3-pro': { input: 2.0, output: 12.0 },
  'gemini-pro': { input: 1.25, output: 5.0 },
  'gemini': { input: 0.30, output: 2.50 },
  'claude-sonnet': { input: 3.0, output: 15.0 },
  'claude': { input: 3.0, output: 15.0 },
  'gpt-4o': { input: 2.5, output: 10.0 },
  'gpt-4': { input: 10.0, output: 30.0 },
  DEFAULT: { input: 3.0, output: 15.0 },
};

// Caps are env-configurable; defaults are protective ceilings for a free tier.
const DAILY_CAP_USD = Number(process.env.AI_DAILY_USD_CAP || 2.0);
const MONTHLY_CAP_USD = Number(process.env.AI_MONTHLY_USD_CAP || 20.0);

class CostLimitError extends Error {
  constructor(message, usage) {
    super(message);
    this.name = 'CostLimitError';
    this.status = 402;
    this.usage = usage;
  }
}

function priceFor(model) {
  if (!model) return PRICING.DEFAULT;
  const key = Object.keys(PRICING)
    .filter((k) => k !== 'DEFAULT' && model.startsWith(k))
    .sort((a, b) => b.length - a.length)[0];
  return key ? PRICING[key] : PRICING.DEFAULT;
}

/** Pure: estimate USD cost of a single call. */
function estimateCostUsd(model, inputTokens = 0, outputTokens = 0) {
  const p = priceFor(model);
  const cost = (Number(inputTokens) / 1e6) * p.input + (Number(outputTokens) / 1e6) * p.output;
  return Math.max(0, Number(cost.toFixed(6)));
}

/** Pure: decide whether a user is within budget. */
function evaluateBudget({ todayUsd, monthUsd, dailyCap = DAILY_CAP_USD, monthlyCap = MONTHLY_CAP_USD, isAdmin = false }) {
  if (isAdmin) return { allowed: true, reason: null };
  if (todayUsd >= dailyCap) {
    return { allowed: false, reason: `Daily AI usage limit reached ($${dailyCap.toFixed(2)}). Try again tomorrow.` };
  }
  if (monthUsd >= monthlyCap) {
    return { allowed: false, reason: `Monthly AI usage limit reached ($${monthlyCap.toFixed(2)}).` };
  }
  return { allowed: true, reason: null };
}

/** Record one model call's usage (best-effort; never throws). */
async function recordUsage(userId, { model, inputTokens = 0, outputTokens = 0 } = {}) {
  if (!userId) return;
  const cost = estimateCostUsd(model, inputTokens, outputTokens);
  try {
    await db.none(
      `INSERT INTO user_costs (user_id, usage_date, calls, input_tokens, output_tokens, cost_usd)
       VALUES ($1, CURRENT_DATE, 1, $2, $3, $4)
       ON CONFLICT (user_id, usage_date) DO UPDATE SET
         calls = user_costs.calls + 1,
         input_tokens = user_costs.input_tokens + EXCLUDED.input_tokens,
         output_tokens = user_costs.output_tokens + EXCLUDED.output_tokens,
         cost_usd = user_costs.cost_usd + EXCLUDED.cost_usd,
         updated_at = now()`,
      [userId, inputTokens, outputTokens, cost]
    );
  } catch (err) {
    console.error('[aiCost] recordUsage failed:', err.message);
  }
}

/** Get a user's today + month-to-date spend in USD. */
async function getSpend(userId) {
  const row = await db.oneOrNone(
    `SELECT
       COALESCE(SUM(cost_usd) FILTER (WHERE usage_date = CURRENT_DATE), 0) AS today_usd,
       COALESCE(SUM(cost_usd) FILTER (WHERE usage_date >= date_trunc('month', CURRENT_DATE)), 0) AS month_usd
     FROM user_costs WHERE user_id = $1`,
    [userId]
  );
  return { todayUsd: Number(row?.today_usd || 0), monthUsd: Number(row?.month_usd || 0) };
}

/** Check whether a user may make another AI call. */
async function checkBudget(userId, { isAdmin = false } = {}) {
  const { todayUsd, monthUsd } = await getSpend(userId);
  const verdict = evaluateBudget({ todayUsd, monthUsd, isAdmin });
  return { ...verdict, todayUsd, monthUsd, dailyCap: DAILY_CAP_USD, monthlyCap: MONTHLY_CAP_USD };
}

// NOTE: token usage is recorded by services/infra/ai/resilientModel.js
// (instrumentModel), which wraps the model with timeout + retry and calls
// recordUsage() on success — a single wrap point for reliability + cost.

module.exports = {
  PRICING,
  DAILY_CAP_USD,
  MONTHLY_CAP_USD,
  CostLimitError,
  estimateCostUsd,
  evaluateBudget,
  recordUsage,
  getSpend,
  checkBudget,
};
