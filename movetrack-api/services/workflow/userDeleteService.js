/**
 * userDeleteService.js
 *
 * GDPR-compliant account deletion.
 * Clears all GCS assets then cascades through all user-owned DB tables.
 */

const knex = require('../infra/knex');
const { storage } = require('../infra/gcsService');

/**
 * Delete a user account and all associated data.
 * Order: GCS images → DB rows in FK-safe order → users row.
 *
 * @param {string} userId
 * @returns {{ images: number, items: number, collections: number, containers: number, locations: number, moves: number, sessions: number }}
 */
async function deleteUserAccount(userId) {
  if (!userId) throw new Error('userId is required');

  // ── Step 1: Delete GCS images ───────────────────────────────────────────────
  const userImages = await knex('image_uploads').where('user_id', userId);
  let imageDeleteCount = 0;

  for (const img of userImages) {
    try {
      const file = storage.bucket(img.gcs_bucket).file(img.gcs_path);
      const [exists] = await file.exists();
      if (exists) await file.delete();
      imageDeleteCount++;
    } catch (err) {
      console.error(`[userDeleteService] Failed to delete GCS image ${img.gcs_path}:`, err.message);
    }
  }

  await knex('image_uploads').where('user_id', userId).delete();

  // ── Step 2: Cascade DB rows ─────────────────────────────────────────────────
  const itemsDeleted       = await knex('items').where('user_id', userId).delete();
  const containersDeleted  = await knex('containers').where('user_id', userId).delete();
  const collectionsDeleted = await knex('collections').where('user_id', userId).delete();
  const locationsDeleted   = await knex('locations').where('user_id', userId).delete();
  const movesDeleted       = await knex('saved_moves').where('user_id', userId).delete();
  const sessionsDeleted    = await knex('move_sessions').where('user_id', userId).delete();
  await knex('move_waypoints').where('user_id', userId).delete();
  await knex('auth_tokens').where('user_id', userId).delete();

  // ── Step 3: Delete user record ──────────────────────────────────────────────
  await knex('users').where('user_id', userId).delete();

  return {
    images:      imageDeleteCount,
    items:       itemsDeleted,
    collections: collectionsDeleted,
    containers:  containersDeleted,
    locations:   locationsDeleted,
    moves:       movesDeleted,
    sessions:    sessionsDeleted,
  };
}

module.exports = { deleteUserAccount };
