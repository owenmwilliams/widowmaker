const express = require('express');
const router = express.Router();
const { authenticate } = require('../../services/infra/authService');
const { cleanupUnlinkedAssets } = require('../../services/infra/mediaAssetService');
const { getReadiness } = require('../../services/infra/healthService');

router.use(authenticate);
router.use((req, res, next) => {
  if (!req.user?.is_admin) return res.status(403).json({ error: 'Admins only' });
  next();
});

/**
 * POST /admin/maintenance/cleanup-orphaned-images
 * Automated cleanup for Cloud Scheduler.
 * Deletes unlinked media assets older than MAX_AGE_HOURS (default 48h).
 */
router.post('/cleanup-orphaned-images', async (_req, res) => {
  try {
    const result = await cleanupUnlinkedAssets();
    res.json({
      success: true,
      message: result.deleted === 0 ? 'No unlinked assets to clean up' : 'Unlinked asset cleanup completed',
      ...result,
    });
  } catch (err) {
    console.error('[maintenance] cleanup-orphaned-images failed:', err);
    res.status(500).json({ success: false, error: 'Cleanup failed', message: err.message });
  }
});

/**
 * POST /admin/maintenance/cleanup-tokens
 * Purge expired auth tokens from the database.
 * See scripts/cleanupTokens.js for the current standalone script.
 * TODO: extract logic into services/infra/tokenCleanupService.js
 */
router.post('/cleanup-tokens', (_req, res) => {
  res.status(501).json({ error: 'Not yet implemented' });
});

/**
 * POST /admin/maintenance/reindex-vectors
 * Trigger re-indexing of the vector store for stale embeddings.
 * TODO: implement via vector agent services
 */
router.post('/reindex-vectors', (_req, res) => {
  res.status(501).json({ error: 'Not yet implemented' });
});

/**
 * GET /admin/maintenance/health
 * Internal readiness check for dependent services (currently the database).
 */
router.get('/health', async (_req, res) => {
  const health = await getReadiness();
  res.status(health.ok ? 200 : 503).json(health);
});

module.exports = router;
