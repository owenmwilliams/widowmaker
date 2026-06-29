'use strict';

/**
 * middleware/aiBudget.js
 *
 * Blocks expensive AI requests (agents, vision) once a user has hit their daily
 * or monthly spend cap. Must run AFTER authentication (needs req.user).
 *
 * Fails OPEN on a metering error: a transient DB blip should not take the whole
 * AI surface offline. The cap is a safety net; normal operation still enforces it.
 */

const { checkBudget } = require('../services/infra/cost/aiCostService');

async function enforceAiBudget(req, res, next) {
  const userId = req.user && req.user.user_id;
  if (!userId) return next(); // auth layer handles the unauthenticated case

  try {
    const verdict = await checkBudget(userId, { isAdmin: !!(req.user && req.user.is_admin) });
    if (!verdict.allowed) {
      return res.status(402).json({
        error: 'AI usage limit reached',
        message: verdict.reason,
        usage: {
          today_usd: Number(verdict.todayUsd.toFixed(4)),
          month_usd: Number(verdict.monthUsd.toFixed(4)),
          daily_cap_usd: verdict.dailyCap,
          monthly_cap_usd: verdict.monthlyCap,
        },
      });
    }
    return next();
  } catch (err) {
    console.error('[aiBudget] check failed, allowing request:', err.message);
    return next();
  }
}

module.exports = { enforceAiBudget };
