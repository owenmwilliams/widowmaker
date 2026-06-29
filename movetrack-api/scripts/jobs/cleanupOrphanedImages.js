#!/usr/bin/env node
'use strict';

/**
 * Job: Cleanup Unlinked Media Assets
 *
 * Standalone script that can be run directly (node scripts/jobs/cleanupOrphanedImages.js)
 * or scheduled via Cloud Scheduler / cron. Delegates all logic to mediaAssetService.
 *
 * The /admin/maintenance/cleanup-orphaned-images endpoint also calls this service and is
 * the preferred path for Cloud Scheduler HTTP triggers.
 */

require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

const { cleanupUnlinkedAssets } = require('../../services/infra/mediaAssetService');

async function run() {
  console.log('========================================');
  console.log('Unlinked Media Asset Cleanup Job');
  console.log('========================================');

  const result = await cleanupUnlinkedAssets();

  console.log('');
  console.log('Result:');
  console.log(`  Deleted : ${result.deleted}`);
  console.log(`  Errors  : ${result.errors}`);
  console.log(`  Freed   : ${result.spaceFreedbMB} MB`);
  console.log('========================================');

  process.exit(result.errors > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error('[cleanupOrphanedImages] Fatal error:', err);
  process.exit(1);
});
