const express = require('express');
const router = express.Router();
const { Storage } = require('@google-cloud/storage');
const path = require('path');
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
  storageOptions.keyFilename = path.join(__dirname, '../devkeys/take-stock-364901-c11c49339bff.json');
}

const storage = new Storage(storageOptions);

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

module.exports = router;
