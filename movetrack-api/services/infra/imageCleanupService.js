'use strict';

/**
 * Image Cleanup Service
 *
 * Handles detection and deletion of orphaned images from GCS and the database.
 * Intended to be triggered by Cloud Scheduler via the /admin/cleanup-orphaned-images endpoint
 * or directly via scripts/jobs/cleanupOrphanedImages.js.
 */

const path = require('path');
const { Storage } = require('@google-cloud/storage');
const knex = require('./knex');

const MAX_AGE_HOURS = parseInt(process.env.MAX_AGE_HOURS || '48', 10);

function buildStorage() {
  const options = { projectId: 'widowmaker-477505' };
  if (process.env.NODE_ENV !== 'production') {
    options.keyFilename = process.env.GOOGLE_APPLICATION_CREDENTIALS
      || path.join(__dirname, '../../devkeys/service-account.json');
  }
  return new Storage(options);
}

/**
 * Returns stats on orphaned images without deleting them.
 */
async function getOrphanedImageStats() {
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

  return {
    totalOrphaned: parseInt(stats.total_orphaned || 0),
    totalSizeMB: ((stats.total_bytes || 0) / (1024 * 1024)).toFixed(2),
    overdueCount: parseInt(stats.overdue_count || 0),
    ageThresholdHours: MAX_AGE_HOURS,
  };
}

/**
 * Deletes orphaned images older than MAX_AGE_HOURS from GCS and the database.
 * Returns a summary of deleted/errored counts.
 */
async function cleanupOrphanedImages() {
  const storage = buildStorage();
  const cutoffDate = new Date();
  cutoffDate.setHours(cutoffDate.getHours() - MAX_AGE_HOURS);

  console.log('[imageCleanupService] Finding orphaned images older than', cutoffDate.toISOString());

  const orphanedImages = await knex('image_uploads')
    .select('*')
    .where('is_orphaned', true)
    .where('uploaded_at', '<', cutoffDate)
    .orderBy('uploaded_at', 'asc');

  if (orphanedImages.length === 0) {
    console.log('[imageCleanupService] Nothing to clean up.');
    return { deleted: 0, errors: 0, totalSize: 0, spaceFreedbMB: '0.00' };
  }

  let successCount = 0;
  let errorCount = 0;
  let totalSize = 0;

  for (const img of orphanedImages) {
    try {
      totalSize += img.file_size || 0;

      const bucket = storage.bucket(img.gcs_bucket);
      const file = bucket.file(img.gcs_path);
      const [exists] = await file.exists();

      if (exists) {
        await file.delete();
        console.log(`[imageCleanupService] ✓ Deleted from GCS: ${img.gcs_path}`);
      } else {
        console.log(`[imageCleanupService] ⚠ File not in GCS: ${img.gcs_path}`);
      }

      await knex('image_uploads').where('id', img.id).delete();
      successCount++;
    } catch (err) {
      console.error(`[imageCleanupService] ✗ Error deleting ${img.gcs_path}:`, err.message);
      errorCount++;
    }
  }

  const spaceFreedbMB = (totalSize / (1024 * 1024)).toFixed(2);
  console.log(`[imageCleanupService] Done — deleted: ${successCount}, errors: ${errorCount}, freed: ${spaceFreedbMB} MB`);

  return { deleted: successCount, errors: errorCount, totalSize, spaceFreedbMB };
}

/**
 * Mark an image as linked to an item so it is no longer treated as orphaned.
 * Non-critical: logs errors but does not throw.
 */
async function markImageLinked(imageUrl, itemId) {
  try {
    await knex('image_uploads')
      .update({
        linked_to_item_id: itemId,
        linked_at: new Date(),
        is_orphaned: false,
      })
      .where('image_url', imageUrl);
    console.log(`[imageCleanupService] Marked image as linked: ${imageUrl} -> item ${itemId}`);
  } catch (err) {
    console.error('[imageCleanupService] Failed to mark image as linked (non-critical):', err);
  }
}

module.exports = { cleanupOrphanedImages, getOrphanedImageStats, markImageLinked };
