#!/usr/bin/env node

/**
 * Delete all images for a specific user (GDPR compliance)
 *
 * This script deletes ALL images uploaded by a user, including:
 * - Orphaned images (not linked to items)
 * - Linked images (attached to items)
 *
 * IMPORTANT: This should be called as part of account deletion
 *
 * Usage:
 *   node bin/deleteUserImages.js <user_id> [--dry-run]
 *
 * Example:
 *   node bin/deleteUserImages.js 550e8400-e29b-41d4-a716-446655440000
 *   node bin/deleteUserImages.js 550e8400-e29b-41d4-a716-446655440000 --dry-run
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

// Parse arguments
const args = process.argv.slice(2);
const userId = args.find(arg => !arg.startsWith('--'));
const isDryRun = args.includes('--dry-run');

if (!userId) {
  console.error('Error: user_id is required');
  console.error('Usage: node bin/deleteUserImages.js <user_id> [--dry-run]');
  process.exit(1);
}

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

async function deleteUserImages(userId) {
  console.log('========================================');
  console.log('User Image Deletion (GDPR Compliance)');
  console.log('========================================');
  console.log(`User ID: ${userId}`);
  console.log(`Mode: ${isDryRun ? 'DRY RUN (no deletions)' : 'LIVE (will delete)'}`);
  console.log('');

  try {
    // Find all images for this user
    console.log('Finding all images for user...');
    const userImages = await knex('image_uploads')
      .select('*')
      .where('user_id', userId)
      .orderBy('uploaded_at', 'asc');

    if (userImages.length === 0) {
      console.log('No images found for this user.');
      await knex.destroy();
      return;
    }

    console.log(`Found ${userImages.length} images.`);
    console.log('');
    console.log('Image Details:');
    console.log('----------------------------------------');

    let totalSize = 0;
    let linkedCount = 0;
    let orphanedCount = 0;

    userImages.forEach((img, index) => {
      const status = img.is_orphaned ? 'ORPHANED' : `LINKED (item ${img.linked_to_item_id})`;
      const sizeMB = (img.file_size / (1024 * 1024)).toFixed(2);
      const uploadDate = new Date(img.uploaded_at).toLocaleDateString();

      totalSize += img.file_size || 0;
      if (img.is_orphaned) orphanedCount++;
      else linkedCount++;

      console.log(`${index + 1}. ${img.gcs_path}`);
      console.log(`   Status: ${status} | Size: ${sizeMB} MB | Uploaded: ${uploadDate}`);
    });

    console.log('----------------------------------------');
    console.log(`Total images: ${userImages.length}`);
    console.log(`  - Linked to items: ${linkedCount}`);
    console.log(`  - Orphaned: ${orphanedCount}`);
    console.log(`Total size: ${(totalSize / (1024 * 1024)).toFixed(2)} MB`);
    console.log('');

    if (isDryRun) {
      console.log('DRY RUN: No deletions performed.');
      console.log('');
      console.log('⚠️  WARNING: In LIVE mode, this will:');
      console.log('  1. Delete all images from Google Cloud Storage');
      console.log('  2. Remove all tracking records from database');
      console.log('  3. Items with linked images will have broken picture_url references');
      await knex.destroy();
      return;
    }

    // Perform deletion
    console.log('Deleting images from GCS and database...');
    console.log('');
    let successCount = 0;
    let errorCount = 0;

    for (const img of userImages) {
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
    console.log('Deletion Summary:');
    console.log(`  User ID: ${userId}`);
    console.log(`  Success: ${successCount}`);
    console.log(`  Errors: ${errorCount}`);
    console.log(`  Total deleted: ${successCount}`);
    console.log(`  Space freed: ${(totalSize / (1024 * 1024)).toFixed(2)} MB`);
    console.log('========================================');
    console.log('');
    console.log('✓ User image data has been completely removed (GDPR compliant).');

  } catch (error) {
    console.error('Fatal error during deletion:', error);
    throw error;
  } finally {
    await knex.destroy();
  }
}

// Run deletion
deleteUserImages(userId)
  .then(() => {
    console.log('');
    console.log('Deletion complete.');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Deletion failed:', error);
    process.exit(1);
  });
