const express = require('express');
const router = express.Router();
const { authenticate } = require('../../services/infra/authService');
const { getUnlinkedAssetStats } = require('../../services/infra/mediaAssetService');
const { getBetaMetricsSummary, getBetaMetricsRaw, getRecentScanFailures } = require('../../services/analytics/reportingService');

router.use(authenticate);
router.use((req, res, next) => {
  if (!req.user?.is_admin) return res.status(403).json({ error: 'Admins only' });
  next();
});

/**
 * GET /admin/analytics/orphaned-images/stats
 * Counts and total size of unlinked assets waiting for cleanup.
 */
router.get('/orphaned-images/stats', async (_req, res) => {
  try {
    const stats = await getUnlinkedAssetStats();
    res.json({ success: true, stats });
  } catch (err) {
    console.error('[analytics] orphaned-images/stats failed:', err);
    res.status(500).json({ success: false, error: 'Failed to fetch stats', message: err.message });
  }
});

/**
 * GET /admin/analytics/agent-metrics
 * Performance summary for the agent scorecard.
 * ?since=YYYY-MM-DD (default: last 7 days)
 */
router.get('/agent-metrics', async (req, res) => {
  try {
    const since = req.query.since
      ? new Date(req.query.since)
      : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const data = await getBetaMetricsSummary(since);
    res.json({ period: { since: since.toISOString(), now: new Date().toISOString() }, ...data });
  } catch (err) {
    console.error('[analytics] agent-metrics failed:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /admin/analytics/agent-metrics/raw
 * Raw interaction log rows for export/spreadsheet.
 * ?limit=200&since=YYYY-MM-DD
 */
router.get('/agent-metrics/raw', async (req, res) => {
  try {
    const since = req.query.since
      ? new Date(req.query.since)
      : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const limit = parseInt(req.query.limit || '200', 10);

    const data = await getBetaMetricsRaw(since, limit);
    res.json(data);
  } catch (err) {
    console.error('[analytics] agent-metrics/raw failed:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /admin/analytics/scan-failures
 * Scan failures (scan_events status='error' or a non-null parse_error) and
 * hard-thrown turns (beta_interaction_logs had_error=true) in the trailing
 * window — the "is anything broken right now" view.
 * ?hours=24 (default, clamped to [1, 720]) ?limit=200 (default, clamped to [1, 500])
 */
router.get('/scan-failures', async (req, res) => {
  try {
    // getRecentScanFailures clamps/defaults invalid input (NaN, out-of-range)
    // itself — Number() on a non-numeric query param yields NaN, not a throw.
    const data = await getRecentScanFailures(Number(req.query.hours), Number(req.query.limit));
    res.json(data);
  } catch (err) {
    console.error('[analytics] scan-failures failed:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /admin/analytics/moves
 * Aggregate move statistics: volume, distance distribution, completion rates.
 * TODO: implement via services/analytics/moveAnalyticsService.js (TBD)
 */
router.get('/moves', (_req, res) => {
  res.status(501).json({ error: 'Not yet implemented' });
});

/**
 * GET /admin/analytics/inventory
 * Aggregate inventory statistics: item counts, weight totals, room distribution.
 * TODO: implement via services/analytics/inventoryAnalyticsService.js (TBD)
 */
router.get('/inventory', (_req, res) => {
  res.status(501).json({ error: 'Not yet implemented' });
});

/**
 * GET /admin/analytics/conversations
 * Nexus/Census conversation analytics: session lengths, tool use, user engagement.
 * TODO: implement via services/analytics/conversationAnalyticsService.js (TBD)
 */
router.get('/conversations', (_req, res) => {
  res.status(501).json({ error: 'Not yet implemented' });
});

module.exports = router;
