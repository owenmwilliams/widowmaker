#!/usr/bin/env node

/**
 * Cleanup script for orphaned images
 *
 * This script deletes images that:
 * 1. Are marked as orphaned (not linked to any item)
 * 2. Are older than 48 hours (configurable via MAX_AGE_HOURS env var)
 *
 * Usage:
 *   node bin/cleanupOrphanedImages.js [--dry-run]
 *
 * Environment variables:
 *   MAX_AGE_HOURS - Age threshold in hours (default: 48)
 *   DRY_RUN - Set to 'true' to preview without deleting
 */

require('dotenv').config();
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

// Configuration
const MAX_AGE_HOURS = parseInt(process.env.MAX_AGE_HOURS || '48', 10);
const isDryRun = process.argv.includes('--dry-run') || process.env.DRY_RUN === 'true';

// Initialize GCS client
const isLocalEnvironment = process.env.NODE_ENV !== 'production';
const storageOptions = {
  projectId: 'widowmaker-477505',
};

if (isLocalEnvironment) {
  storageOptions.keyFilename = path.join(__dirname, '../devkeys/take-stock-364901-c11c49339bff.json');
}

const storage = new Storage(storageOptions);

async function cleanupOrphanedImages() {
  console.log('========================================');
  console.log('Orphaned Image Cleanup Script');
  console.log('========================================');
  console.log(`Mode: ${isDryRun ? 'DRY RUN (no deletions)' : 'LIVE (will delete)'}`);
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
      await knex.destroy();
      return;
    }

    console.log('');
    console.log('Images to be deleted:');
    console.log('----------------------------------------');

    let totalSize = 0;
    orphanedImages.forEach((img, index) => {
      const age = Math.round((new Date() - new Date(img.uploaded_at)) / (1000 * 60 * 60));
      const sizeMB = (img.file_size / (1024 * 1024)).toFixed(2);
      totalSize += img.file_size || 0;
      console.log(`${index + 1}. ${img.gcs_path}`);
      console.log(`   Age: ${age} hours | Size: ${sizeMB} MB | User: ${img.user_id}`);
    });

    console.log('----------------------------------------');
    console.log(`Total size: ${(totalSize / (1024 * 1024)).toFixed(2)} MB`);
    console.log('');

    if (isDryRun) {
      console.log('DRY RUN: No deletions performed.');
      await knex.destroy();
      return;
    }

    // Perform deletion
    console.log('Deleting images from GCS and database...');
    let successCount = 0;
    let errorCount = 0;

    for (const img of orphanedImages) {
      try {
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

  } catch (error) {
    console.error('Fatal error during cleanup:', error);
  } finally {
    await knex.destroy();
  }
}

// Run cleanup
cleanupOrphanedImages()
  .then(() => {
    console.log('Cleanup complete.');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Cleanup failed:', error);
    process.exit(1);
  });
