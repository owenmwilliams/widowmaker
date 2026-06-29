/**
 * routes/health.js
 *
 * Public, unauthenticated, unthrottled health probes (allowlisted in
 * middleware/auth.js and mounted before rate-limiting in app.js).
 *
 *   GET /health        – liveness: 200 as long as the process can serve requests.
 *                        Does NOT touch the database, so a DB blip won't cause
 *                        Cloud Run to kill an otherwise-healthy container.
 *   GET /health/ready  – readiness: pings the database; 200 when ready, 503 when not.
 */

const express = require('express');
const router = express.Router();
const { getReadiness } = require('../services/infra/healthService');

// Liveness — cheap, no dependencies.
router.get('/', (_req, res) => {
  res.json({ status: 'ok', uptime_s: Math.round(process.uptime()) });
});

// Readiness — verifies the database is reachable.
router.get('/ready', async (_req, res) => {
  const health = await getReadiness();
  res.status(health.ok ? 200 : 503).json(health);
});

module.exports = router;
