const express = require('express');
const router = express.Router();
const { Storage } = require('@google-cloud/storage');
const path = require('path');
const { authenticate } = require('../services/infra/authService');
const knex = require('knex')({
  client: 'pg',
  connection: {
    host: process.env.MT_DATALAYER_HOSTNAME,
    port: process.env.MT_DATALAYER_PORT,
    user: process.env.MT_DATALAYER_USERNAME,
    password: process.env.MT_DATALAYER_PASSWORD,
    database: process.env.MT_DATALAYER_DATABASE
  }
});

// Initialize GCS client
const isLocalEnvironment = process.env.NODE_ENV !== 'production';
const storageOptions = {
  projectId: 'widowmaker-477505',
};

if (isLocalEnvironment) {
  const localKeyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS
    || path.join(__dirname, '../devkeys/service-account.json');
  storageOptions.keyFilename = localKeyPath;
}

const storage = new Storage(storageOptions);

router.use(authenticate);
router.use((req, res, next) => {
  if (!req.user?.is_admin) {
    return res.status(403).json({ error: 'Admins only' });
  }
  next();
});

// Configuration
const MAX_AGE_HOURS = parseInt(process.env.MAX_AGE_HOURS || '48', 10);

/**
 * POST /admin/cleanup-orphaned-images
 * Automated cleanup endpoint for Cloud Scheduler
 * Deletes orphaned images older than 48 hours (configurable)
 */
router.post('/cleanup-orphaned-images', async (req, res) => {
  console.log('========================================');
  console.log('Orphaned Image Cleanup (Automated)');
  console.log('========================================');
  console.log(`Age threshold: ${MAX_AGE_HOURS} hours`);
  console.log('');

  try {
    // Calculate cutoff timestamp
    const cutoffDate = new Date();
    cutoffDate.setHours(cutoffDate.getHours() - MAX_AGE_HOURS);

    console.log(`Finding orphaned images older than ${cutoffDate.toISOString()}...`);

    // Find orphaned images older than threshold
    const orphanedImages = await knex('image_uploads')
      .select('*')
      .where('is_orphaned', true)
      .where('uploaded_at', '<', cutoffDate)
      .orderBy('uploaded_at', 'asc');

    console.log(`Found ${orphanedImages.length} orphaned images to clean up.`);

    if (orphanedImages.length === 0) {
      console.log('Nothing to clean up!');
      return res.json({
        success: true,
        message: 'No orphaned images to clean up',
        deleted: 0,
        errors: 0
      });
    }

    console.log('');
    console.log('Deleting images from GCS and database...');
    let successCount = 0;
    let errorCount = 0;
    let totalSize = 0;

    for (const img of orphanedImages) {
      try {
        totalSize += img.file_size || 0;

        // Delete from GCS
        const bucket = storage.bucket(img.gcs_bucket);
        const file = bucket.file(img.gcs_path);

        // Check if file exists before deleting
        const [exists] = await file.exists();
        if (exists) {
          await file.delete();
          console.log(`✓ Deleted from GCS: ${img.gcs_path}`);
        } else {
          console.log(`⚠ File not found in GCS: ${img.gcs_path}`);
        }

        // Delete from database
        await knex('image_uploads')
          .where('id', img.id)
          .delete();

        successCount++;
      } catch (error) {
        console.error(`✗ Error deleting ${img.gcs_path}:`, error.message);
        errorCount++;
      }
    }

    console.log('');
    console.log('========================================');
    console.log('Cleanup Summary:');
    console.log(`  Success: ${successCount}`);
    console.log(`  Errors: ${errorCount}`);
    console.log(`  Total: ${orphanedImages.length}`);
    console.log(`  Space freed: ${(totalSize / (1024 * 1024)).toFixed(2)} MB`);
    console.log('========================================');

    res.json({
      success: true,
      message: 'Orphaned image cleanup completed',
      deleted: successCount,
      errors: errorCount,
      totalSize: totalSize,
      spaceFreedbMB: (totalSize / (1024 * 1024)).toFixed(2)
    });

  } catch (error) {
    console.error('Fatal error during cleanup:', error);
    res.status(500).json({
      success: false,
      error: 'Cleanup failed',
      message: error.message
    });
  }
});

/**
 * GET /admin/orphaned-images/stats
 * Get statistics about orphaned images
 */
router.get('/orphaned-images/stats', async (req, res) => {
  try {
    const cutoffDate = new Date();
    cutoffDate.setHours(cutoffDate.getHours() - MAX_AGE_HOURS);

    const stats = await knex('image_uploads')
      .select(
        knex.raw('COUNT(*) as total_orphaned'),
        knex.raw('SUM(file_size) as total_bytes'),
        knex.raw(`COUNT(*) FILTER (WHERE uploaded_at < ?) as overdue_count`, [cutoffDate])
      )
      .where('is_orphaned', true)
      .first();

    res.json({
      success: true,
      stats: {
        totalOrphaned: parseInt(stats.total_orphaned || 0),
        totalSizeMB: ((stats.total_bytes || 0) / (1024 * 1024)).toFixed(2),
        overdueCount: parseInt(stats.overdue_count || 0),
        ageThresholdHours: MAX_AGE_HOURS
      }
    });
  } catch (error) {
    console.error('Error fetching orphaned image stats:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch stats',
      message: error.message
    });
  }
});

// ── Beta Metrics ──────────────────────────────────────────────────────────────

/**
 * GET /admin/beta-metrics
 * Performance summary for the family beta scorecard.
 * ?since=YYYY-MM-DD (default: last 7 days)
 */
router.get('/beta-metrics', async (req, res) => {
  try {
    const since = req.query.since
      ? new Date(req.query.since)
      : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const summary = await knex('beta_interaction_logs')
      .where('created_at', '>=', since)
      .select(
        knex.raw('COUNT(*)::int AS total_interactions'),
        knex.raw('COUNT(DISTINCT user_id)::int AS unique_users'),
        knex.raw('ROUND(AVG(total_latency_ms)) AS avg_total_ms'),
        knex.raw('ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY total_latency_ms)) AS median_total_ms'),
        knex.raw('ROUND(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY total_latency_ms)) AS p95_total_ms'),
        knex.raw('ROUND(AVG(ttfe_ms)) AS avg_ttfe_ms'),
        knex.raw('ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY ttfe_ms)) AS median_ttfe_ms'),
        knex.raw('ROUND(AVG(gemini_latency_ms)) AS avg_gemini_ms'),
        knex.raw('ROUND(AVG(vision_latency_ms)) AS avg_vision_ms'),
        knex.raw('COUNT(CASE WHEN total_latency_ms < 3000 THEN 1 END)::int AS under_3s_count'),
        knex.raw('COUNT(CASE WHEN total_latency_ms >= 3000 THEN 1 END)::int AS over_3s_count'),
        knex.raw('COUNT(CASE WHEN had_attachments THEN 1 END)::int AS photo_interactions'),
        knex.raw('ROUND(AVG(avg_confidence), 3) AS avg_confidence_score'),
        knex.raw('SUM(COALESCE(items_added_this_turn, 0))::int AS total_items_added'),
        knex.raw('COUNT(CASE WHEN had_error THEN 1 END)::int AS error_count')
      )
      .first();

    const perUser = await knex('beta_interaction_logs')
      .where('beta_interaction_logs.created_at', '>=', since)
      .join('users', 'beta_interaction_logs.user_id', 'users.user_id')
      .select(
        'users.first_name',
        knex.raw('COUNT(*)::int AS interactions'),
        knex.raw('ROUND(AVG(total_latency_ms)) AS avg_latency_ms'),
        knex.raw('SUM(COALESCE(items_added_this_turn, 0))::int AS items_added'),
        knex.raw('COUNT(CASE WHEN had_attachments THEN 1 END)::int AS photo_uses')
      )
      .groupBy('users.user_id', 'users.first_name')
      .orderBy('interactions', 'desc');

    const confidenceDist = await knex('items')
      .whereNotNull('confidence_score')
      .where('created_at', '>=', since)
      .select(
        knex.raw(`COUNT(CASE WHEN confidence_score >= 0.85 THEN 1 END)::int AS high_confidence`),
        knex.raw(`COUNT(CASE WHEN confidence_score >= 0.60 AND confidence_score < 0.85 THEN 1 END)::int AS medium_confidence`),
        knex.raw(`COUNT(CASE WHEN confidence_score < 0.60 THEN 1 END)::int AS low_confidence`),
        knex.raw('COUNT(*)::int AS total_with_confidence')
      )
      .first();

    const feedbackStats = await knex('item_feedback')
      .where('created_at', '>=', since)
      .select(
        knex.raw(`COUNT(CASE WHEN feedback = 'correct' THEN 1 END)::int AS correct`),
        knex.raw(`COUNT(CASE WHEN feedback = 'wrong' THEN 1 END)::int AS wrong`),
        knex.raw(`COUNT(CASE WHEN feedback = 'hallucinated' THEN 1 END)::int AS hallucinated`),
        knex.raw('COUNT(*)::int AS total_feedback')
      )
      .first();

    const scorecard = {
      ttfe_target_200ms: summary.avg_ttfe_ms != null
        ? `${summary.avg_ttfe_ms}ms avg (target: <200ms)`
        : 'No data yet',
      e2e_latency_target_3s: summary.avg_total_ms != null
        ? `${summary.avg_total_ms}ms avg, ${summary.under_3s_count} under 3s / ${summary.over_3s_count} over 3s`
        : 'No data yet',
      detection_precision: feedbackStats.total_feedback > 0
        ? `${Math.round((feedbackStats.correct / feedbackStats.total_feedback) * 100)}% correct of ${feedbackStats.total_feedback} rated items`
        : 'Need feedback data',
      hallucination_rate: feedbackStats.total_feedback > 0
        ? `${Math.round((feedbackStats.hallucinated / feedbackStats.total_feedback) * 100)}% of ${feedbackStats.total_feedback} rated items`
        : 'Need feedback data',
    };

    res.json({
      period: { since: since.toISOString(), now: new Date().toISOString() },
      summary,
      perUser,
      confidenceDist,
      feedbackStats,
      scorecard,
    });
  } catch (err) {
    console.error('[admin] beta-metrics failed:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /admin/beta-metrics/raw
 * Raw interaction log rows for export/spreadsheet.
 * ?limit=200&since=YYYY-MM-DD
 */
router.get('/beta-metrics/raw', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit || '200', 10), 1000);
    const since = req.query.since
      ? new Date(req.query.since)
      : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const rows = await knex('beta_interaction_logs')
      .where('beta_interaction_logs.created_at', '>=', since)
      .join('users', 'beta_interaction_logs.user_id', 'users.user_id')
      .select(
        'beta_interaction_logs.id',
        'beta_interaction_logs.created_at',
        'users.first_name',
        'beta_interaction_logs.total_latency_ms',
        'beta_interaction_logs.ttfe_ms',
        'beta_interaction_logs.gemini_latency_ms',
        'beta_interaction_logs.vision_latency_ms',
        'beta_interaction_logs.had_attachments',
        'beta_interaction_logs.attachment_count',
        'beta_interaction_logs.tool_calls',
        'beta_interaction_logs.items_added_this_turn',
        'beta_interaction_logs.detected_item_count',
        'beta_interaction_logs.avg_confidence',
        'beta_interaction_logs.gemini_model',
        'beta_interaction_logs.gemini_rounds',
        'beta_interaction_logs.had_error',
        'beta_interaction_logs.error_message'
      )
      .orderBy('beta_interaction_logs.created_at', 'desc')
      .limit(limit);

    res.json({ rows, count: rows.length });
  } catch (err) {
    console.error('[admin] beta-metrics/raw failed:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
