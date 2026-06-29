'use strict';

/**
 * mediaAssetService
 *
 * Canonical ingestion, tracking, linking, deletion, and cleanup of persistent
 * user media. All persistent upload routes should go through `ingestUpload`;
 * there should be no direct GCS writes from route handlers anymore.
 *
 * See movetrack-api/docs/unified-media-upload-spec.md
 */

const fs = require('fs/promises');
const fsSync = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const knex = require('./knex');
const { storage, isLocalEnvironment, signUrl } = require('./gcsService');

const BUCKET = 'movetrack-item-photos';
const LOCAL_STORAGE_ROOT = path.join(__dirname, '../../.local-storage');
const MAX_AGE_HOURS = parseInt(process.env.MAX_AGE_HOURS || '48', 10);

const VALID_SOURCES = new Set([
  'inventory_item',
  'nexus_chat',
  'census_chat',
  'video_scan',
  'derived_crop',
  'derived_thumbnail',
]);

// ── Path resolution ─────────────────────────────────────────────────────────

function extensionFor(originalName, mimeType) {
  const fromName = originalName && originalName.includes('.')
    ? originalName.split('.').pop().toLowerCase()
    : null;
  if (fromName && fromName.length <= 5) return fromName;
  const fromMime = mimeType && mimeType.includes('/')
    ? mimeType.split('/')[1].toLowerCase()
    : null;
  return fromMime || 'bin';
}

function resolvePath({ source, userId, assetUuid, ext, uploadSessionId, folderHint }) {
  switch (source) {
    case 'inventory_item':
      return `users/${userId}/inventory/items/${assetUuid}.${ext}`;
    case 'nexus_chat':
      return `users/${userId}/chat/nexus/${assetUuid}.${ext}`;
    case 'census_chat':
      return `users/${userId}/chat/census/${assetUuid}.${ext}`;
    case 'video_scan': {
      if (!uploadSessionId) {
        throw new Error('video_scan uploads require uploadSessionId (scanId)');
      }
      return `users/${userId}/room-scans/${uploadSessionId}/source.${ext}`;
    }
    case 'derived_crop':
      return `users/${userId}/derived/crops/${assetUuid}.jpg`;
    case 'derived_thumbnail':
      return `users/${userId}/derived/thumbnails/${assetUuid}.jpg`;
    default:
      // Fallback path for any future source. folderHint is accepted for
      // backward-compat but not trusted beyond basic sanitisation.
      {
        const safeFolder = (folderHint || 'uploads').replace(/[^a-z0-9_\-/]/gi, '_');
        return `users/${userId}/${safeFolder}/${assetUuid}.${ext}`;
      }
  }
}

// ── Storage I/O ─────────────────────────────────────────────────────────────

/**
 * Write a buffer to the configured storage backend. In local dev this writes
 * to `.local-storage/<bucket>/<gcsPath>` and returns a localhost-relative URL
 * served by the /file/local route; in production it writes to GCS and returns
 * the canonical public URL.
 */
async function writeObject(bucket, gcsPath, buffer, mimeType) {
  if (isLocalEnvironment) {
    const absPath = path.join(LOCAL_STORAGE_ROOT, bucket, gcsPath);
    await fs.mkdir(path.dirname(absPath), { recursive: true });
    await fs.writeFile(absPath, buffer);
    return `/file/local/${bucket}/${gcsPath}`;
  }

  const file = storage.bucket(bucket).file(gcsPath);
  const useResumable = buffer.length > 5 * 1024 * 1024;
  await new Promise((resolve, reject) => {
    const stream = file.createWriteStream({
      metadata: { contentType: mimeType },
      resumable: useResumable,
    });
    stream.on('error', reject);
    stream.on('finish', resolve);
    stream.end(buffer);
  });
  return `https://storage.googleapis.com/${bucket}/${gcsPath}`;
}

async function deleteObject(bucket, gcsPath) {
  if (isLocalEnvironment) {
    const absPath = path.join(LOCAL_STORAGE_ROOT, bucket, gcsPath);
    await fs.unlink(absPath).catch(() => {});
    return;
  }
  try {
    await storage.bucket(bucket).file(gcsPath).delete({ ignoreNotFound: true });
  } catch (err) {
    if (err?.code !== 404) throw err;
  }
}

/**
 * Resolve a stored media asset to an absolute filesystem path when running in
 * local dev. Returns null outside local dev. The returned path is guaranteed
 * to stay inside LOCAL_STORAGE_ROOT so the caller can safely stream it.
 */
function resolveLocalPath(bucket, gcsPath) {
  if (!isLocalEnvironment) return null;
  const abs = path.join(LOCAL_STORAGE_ROOT, bucket, gcsPath);
  const normalisedRoot = path.resolve(LOCAL_STORAGE_ROOT);
  const normalisedAbs = path.resolve(abs);
  if (!normalisedAbs.startsWith(normalisedRoot + path.sep)) {
    return null;
  }
  return normalisedAbs;
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Ingest a persistent user media upload.
 *
 * @param {object} options
 * @param {string} options.userId            - owner of the asset (required)
 * @param {Buffer} options.buffer            - file bytes (required)
 * @param {string} options.mimeType          - MIME type (required)
 * @param {string} [options.originalName]    - original filename for metadata + ext
 * @param {string} options.source            - one of VALID_SOURCES (required)
 * @param {string} [options.folderHint]      - legacy folder hint (fallback sources only)
 * @param {string} [options.uploadSessionId] - session/scan id (required for video_scan)
 * @param {object} [options.metadata]        - freeform metadata merged into metadata JSON
 * @param {string} [options.bucket]          - override bucket (default: canonical)
 *
 * @returns {Promise<{
 *   assetId: string,
 *   url: string,
 *   mimeType: string,
 *   bucket: string,
 *   gcsPath: string,
 *   size: number,
 *   source: string,
 *   assetType: 'image'|'video'
 * }>}
 */
async function ingestUpload(options) {
  const {
    userId,
    buffer,
    mimeType,
    originalName,
    source,
    folderHint,
    uploadSessionId,
    metadata = {},
    bucket = BUCKET,
  } = options || {};

  if (!userId) throw new Error('mediaAssetService.ingestUpload: userId is required');
  if (!buffer || !buffer.length) throw new Error('mediaAssetService.ingestUpload: buffer is required');
  if (!mimeType) throw new Error('mediaAssetService.ingestUpload: mimeType is required');
  if (!source) throw new Error('mediaAssetService.ingestUpload: source is required');
  if (!VALID_SOURCES.has(source)) {
    console.warn(`[mediaAssetService] Unknown source '${source}' — accepting but this should be added to VALID_SOURCES.`);
  }

  const assetUuid = uuidv4();
  const ext = extensionFor(originalName, mimeType);
  const gcsPath = resolvePath({
    source,
    userId,
    assetUuid,
    ext,
    uploadSessionId,
    folderHint,
  });

  const url = await writeObject(bucket, gcsPath, buffer, mimeType);
  const assetType = mimeType.startsWith('video/') ? 'video' : 'image';

  await knex('image_uploads').insert({
    asset_uuid: assetUuid,
    user_id: userId,
    image_url: url,
    gcs_bucket: bucket,
    gcs_path: gcsPath,
    file_size: buffer.length,
    mime_type: mimeType,
    source,
    asset_type: assetType,
    status: 'uploaded',
    upload_session_id: uploadSessionId || null,
    metadata: JSON.stringify({
      ...metadata,
      original_name: originalName || null,
    }),
    uploaded_at: new Date(),
    is_orphaned: true,
  });

  return {
    assetId: assetUuid,
    url,
    mimeType,
    bucket,
    gcsPath,
    size: buffer.length,
    source,
    assetType,
  };
}

/**
 * Link an asset to an owning entity. Asserts that the asset belongs to the
 * caller before updating.
 *
 * @param {object} options
 * @param {string} options.assetId       - asset_uuid returned from ingestUpload
 * @param {string} options.userId        - asserted owner
 * @param {string} options.entityType    - e.g. 'item', 'nexus_message', 'scan_session'
 * @param {string|number} options.entityId
 * @param {number} [options.linkedToItemId] - optional legacy mirror for item photos
 */
async function linkAsset({ assetId, userId, entityType, entityId, linkedToItemId }) {
  if (!assetId) throw new Error('mediaAssetService.linkAsset: assetId is required');
  if (!userId) throw new Error('mediaAssetService.linkAsset: userId is required');
  if (!entityType) throw new Error('mediaAssetService.linkAsset: entityType is required');
  if (entityId === undefined || entityId === null) {
    throw new Error('mediaAssetService.linkAsset: entityId is required');
  }

  const row = await knex('image_uploads').where({ asset_uuid: assetId }).first();
  if (!row) throw new Error(`mediaAssetService.linkAsset: asset ${assetId} not found`);
  if (row.user_id !== userId) {
    throw new Error(`mediaAssetService.linkAsset: asset ${assetId} does not belong to user ${userId}`);
  }

  const update = {
    status: 'linked',
    is_orphaned: false,
    linked_at: new Date(),
    linked_to_entity_type: entityType,
    linked_to_entity_id: String(entityId),
  };
  if (linkedToItemId !== undefined && linkedToItemId !== null) {
    update.linked_to_item_id = linkedToItemId;
  } else if (entityType === 'item') {
    update.linked_to_item_id = Number(entityId);
  }

  await knex('image_uploads').where({ asset_uuid: assetId }).update(update);
  return { assetId, entityType, entityId: String(entityId) };
}

/**
 * Soft-delete an asset: remove from storage and mark the row as deleted.
 * Ownership is asserted when userId is provided.
 */
async function deleteAsset({ assetId, userId }) {
  if (!assetId) throw new Error('mediaAssetService.deleteAsset: assetId is required');
  const row = await knex('image_uploads').where({ asset_uuid: assetId }).first();
  if (!row) return { deleted: false, reason: 'not_found' };
  if (userId && row.user_id !== userId) {
    throw new Error(`mediaAssetService.deleteAsset: asset ${assetId} does not belong to user ${userId}`);
  }

  try {
    await deleteObject(row.gcs_bucket, row.gcs_path);
  } catch (err) {
    console.warn(`[mediaAssetService] Failed to delete storage object ${row.gcs_path}:`, err.message);
  }

  await knex('image_uploads').where({ asset_uuid: assetId }).update({ status: 'deleted' });
  return { deleted: true };
}

/**
 * Purge all assets owned by a user — storage + rows. Used by account deletion.
 */
async function purgeAssetsForUser(userId) {
  if (!userId) throw new Error('mediaAssetService.purgeAssetsForUser: userId is required');
  const assets = await knex('image_uploads').where({ user_id: userId });
  let deleted = 0;
  let errors = 0;
  for (const asset of assets) {
    try {
      await deleteObject(asset.gcs_bucket, asset.gcs_path);
      deleted++;
    } catch (err) {
      console.error(`[mediaAssetService] purge: failed to delete ${asset.gcs_path}:`, err.message);
      errors++;
    }
  }
  await knex('image_uploads').where({ user_id: userId }).delete();
  return { deleted, errors, total: assets.length };
}

/**
 * Delete stale unlinked (status='uploaded') assets older than MAX_AGE_HOURS.
 * Replaces the old imageCleanupService.cleanupOrphanedImages.
 */
async function cleanupUnlinkedAssets({ olderThanHours = MAX_AGE_HOURS, dryRun = false } = {}) {
  const cutoff = new Date(Date.now() - olderThanHours * 60 * 60 * 1000);
  console.log(`[mediaAssetService] Cleanup: finding unlinked assets older than ${cutoff.toISOString()}`);

  const stale = await knex('image_uploads')
    .where('status', 'uploaded')
    .andWhere('uploaded_at', '<', cutoff)
    .orderBy('uploaded_at', 'asc');

  if (stale.length === 0) {
    console.log('[mediaAssetService] Cleanup: nothing to delete.');
    return { deleted: 0, errors: 0, totalSize: 0, spaceFreedbMB: '0.00', found: 0 };
  }

  let deleted = 0;
  let errors = 0;
  let totalSize = 0;

  for (const asset of stale) {
    try {
      totalSize += asset.file_size || 0;
      if (!dryRun) {
        await deleteObject(asset.gcs_bucket, asset.gcs_path);
        await knex('image_uploads').where('id', asset.id).delete();
      }
      deleted++;
      console.log(`[mediaAssetService] Cleanup: removed ${asset.gcs_path}`);
    } catch (err) {
      console.error(`[mediaAssetService] Cleanup error on ${asset.gcs_path}:`, err.message);
      errors++;
    }
  }

  const spaceFreedbMB = (totalSize / (1024 * 1024)).toFixed(2);
  console.log(`[mediaAssetService] Cleanup done — deleted: ${deleted}, errors: ${errors}, freed: ${spaceFreedbMB} MB`);
  return { deleted, errors, totalSize, spaceFreedbMB, found: stale.length };
}

/**
 * Stats on unlinked assets (admin analytics). Replaces imageCleanupService.getOrphanedImageStats.
 */
async function getUnlinkedAssetStats() {
  const cutoff = new Date(Date.now() - MAX_AGE_HOURS * 60 * 60 * 1000);
  const stats = await knex('image_uploads')
    .where('status', 'uploaded')
    .select(
      knex.raw('COUNT(*) as total_unlinked'),
      knex.raw('SUM(file_size) as total_bytes'),
      knex.raw('COUNT(*) FILTER (WHERE uploaded_at < ?) as overdue_count', [cutoff])
    )
    .first();

  return {
    totalUnlinked: parseInt(stats.total_unlinked || 0, 10),
    totalSizeMB: ((Number(stats.total_bytes) || 0) / (1024 * 1024)).toFixed(2),
    overdueCount: parseInt(stats.overdue_count || 0, 10),
    ageThresholdHours: MAX_AGE_HOURS,
  };
}

/**
 * Legacy URL-based fallback for linking an inventory item photo.
 *
 * New callers should pass `picture_asset_id` through and use `linkAsset`
 * instead. This shim exists so [routes/api/inventory/items.js] keeps working
 * while the frontend migrates to ID-based linkage (spec step 6).
 */
async function markAssetLinkedByUrl(imageUrl, itemId) {
  if (!imageUrl || !itemId) return;
  try {
    await knex('image_uploads')
      .update({
        linked_to_item_id: itemId,
        linked_to_entity_type: 'item',
        linked_to_entity_id: String(itemId),
        linked_at: new Date(),
        is_orphaned: false,
        status: 'linked',
      })
      .where('image_url', imageUrl);
  } catch (err) {
    console.error('[mediaAssetService] markAssetLinkedByUrl failed (non-critical):', err.message);
  }
}

module.exports = {
  ingestUpload,
  linkAsset,
  deleteAsset,
  purgeAssetsForUser,
  cleanupUnlinkedAssets,
  getUnlinkedAssetStats,
  markAssetLinkedByUrl,
  resolveLocalPath,
  LOCAL_STORAGE_ROOT,
  BUCKET,
};
