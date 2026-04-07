'use strict';

const knex = require('../infra/knex');
const conn = require('../infra/db');
const db = conn.db;
const locationMutation = require('./locationMutationService');

/**
 * Set the user's name and goal during onboarding.
 */
async function setUserProfile(userId, args = {}) {
  const updates = {};
  if (args.first_name) updates.first_name = args.first_name;
  if (args.last_name) updates.last_name = args.last_name;
  updates.updated_at = new Date();
  await knex('users').where({ user_id: userId }).update(updates);
  if (args.goal) console.log(`[orchestrator] User goal set: ${args.goal}`);
  return { success: true, name: `${args.first_name || ''} ${args.last_name || ''}`.trim() };
}

/**
 * Mark the user's onboarding as complete.
 */
async function markOnboardingComplete(userId) {
  await db.none(
    `UPDATE users SET onboarding_completed = true, updated_at = NOW() WHERE user_id = $1`,
    [userId]
  );
  console.log(`[orchestrator] Onboarding marked complete for user: ${userId}`);
  return { success: true, message: 'Onboarding marked complete.' };
}

// ── HTTP onboarding flow ──────────────────────────────────────────────────────

/**
 * Coerce a value to a finite number, stripping non-numeric characters.
 * Returns null for empty / non-numeric input.
 */
function parseNumber(value) {
  if (value === null || value === undefined) return null;
  const normalized = String(value).replace(/[^0-9.\-]/g, '');
  if (!normalized) return null;
  const num = Number(normalized);
  return Number.isFinite(num) ? num : null;
}

/**
 * Complete onboarding in one transaction: update profile, upsert location,
 * create rooms as collections, mark onboarding_completed = true.
 * All fields are optional — always marks onboarding complete.
 *
 * @param {string} userId
 * @param {{ profile?: object, location?: object, rooms?: string[] }} options
 * @returns {{ location_id: number|null, created_collections: number }}
 */
async function completeOnboarding(userId, { profile = null, location = null, rooms = [] } = {}) {
  const normalizedRooms = Array.isArray(rooms)
    ? rooms.map((r) => (typeof r === 'string' ? r.trim() : '')).filter(Boolean)
    : [];

  return knex.transaction(async (trx) => {
    if (profile && (profile.first_name || profile.last_name)) {
      await trx('users')
        .update({ first_name: profile.first_name || null, last_name: profile.last_name || null, updated_at: trx.fn.now() })
        .where({ user_id: userId });
    }

    let locationId = null;
    if (location && location.name && location.address && location.city && location.state && location.zip) {
      if (location.id) {
        await locationMutation.updateLocationById(userId, location.id, {
          name: location.name, address: location.address, address_2: location.address2 || null,
          city: location.city, state: location.state, zip: location.zip,
        });
        locationId = location.id;
      }
      if (!locationId) {
        const result = await locationMutation.createLocation(userId, {
          name: location.name, address: location.address, address_2: location.address2 || null,
          city: location.city, state: location.state, zip: location.zip,
          location_type: 'primary_residence', is_primary: true,
        });
        locationId = result?.[0]?.id || result?.[0];
      }
    }

    let createdCollections = 0;
    if (locationId && normalizedRooms.length) {
      const existing = await trx('collections').where({ user_id: userId, location_id: locationId });
      const existingNames = new Set(existing.map((c) => c.name?.trim().toLowerCase()));
      for (const room of normalizedRooms) {
        if (existingNames.has(room.toLowerCase())) continue;
        await trx('collections').insert({ user_id: userId, location_id: locationId, name: room, description: null });
        createdCollections++;
      }
    }

    await trx('users').update({ onboarding_completed: true, updated_at: trx.fn.now() }).where({ user_id: userId });
    return { location_id: locationId, created_collections: createdCollections };
  });
}

/**
 * Bulk-import inventory items from CSV-parsed rows.
 * Resolves or creates collections (rooms) and containers as needed.
 *
 * @param {string} userId
 * @param {number} locationId
 * @param {Array<object>} items
 * @returns {{ summary: object, rows: object[] }}
 */
async function importInventory(userId, locationId, items) {
  const location = await knex('locations').where({ id: locationId, user_id: userId }).first();
  if (!location) throw Object.assign(new Error('Location not found'), { status: 404 });

  const trx = await knex.transaction();
  try {
    const existingCollections = await trx('collections').where({ user_id: userId, location_id: locationId });
    const collectionMap = new Map(existingCollections.map((c) => [c.name.trim().toLowerCase(), c.id]));

    const collectionIds = existingCollections.map((c) => c.id);
    const existingContainers = collectionIds.length
      ? await trx('containers').where({ user_id: userId }).whereIn('collection_id', collectionIds)
      : [];
    const containerMap = new Map(
      existingContainers.map((c) => [`${c.collection_id}::${c.name.trim().toLowerCase()}`, c.id])
    );

    let createdCollections = 0, createdContainers = 0, createdItems = 0;
    const rowResults = [];

    for (const row of items) {
      const rowNumber = row?.rowNumber ?? null;
      const name = (row?.name || '').trim();
      const roomLabel = (row?.room || '').trim();

      if (!name || !roomLabel) {
        rowResults.push({ row: rowNumber, status: 'skipped', reason: 'Missing name or room' });
        continue;
      }

      let collectionId = collectionMap.get(roomLabel.toLowerCase());
      if (!collectionId) {
        const [ins] = await trx('collections').insert({ user_id: userId, location_id: locationId, name: roomLabel, description: null }).returning('id');
        collectionId = ins?.id || ins;
        collectionMap.set(roomLabel.toLowerCase(), collectionId);
        createdCollections++;
      }

      let containerId = null;
      const containerName = (row?.container || '').trim();
      if (containerName) {
        const key = `${collectionId}::${containerName.toLowerCase()}`;
        containerId = containerMap.get(key);
        if (!containerId) {
          const [ins] = await trx('containers').insert({ user_id: userId, collection_id: collectionId, name: containerName, description: row?.container_description || null }).returning('id');
          containerId = ins?.id || ins;
          containerMap.set(key, containerId);
          createdContainers++;
        }
      }

      const quantity = parseInt(row?.quantity, 10);
      const [insertedItem] = await trx('items').insert({
        user_id: userId, collection_id: collectionId, container_id: containerId, name,
        description: row?.description || null, notes: row?.notes || null,
        material: row?.material || null, primary_color: row?.primary_color || null,
        quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : 1,
        weight_lbs: parseNumber(row?.weight_lbs ?? row?.weight),
        length_in:  parseNumber(row?.length_in  ?? row?.length),
        width_in:   parseNumber(row?.width_in   ?? row?.width),
        height_in:  parseNumber(row?.height_in  ?? row?.height),
      }).returning(['id', 'name']);
      createdItems++;
      rowResults.push({ row: rowNumber, status: 'imported', item_id: insertedItem?.id || insertedItem });
    }

    await trx.commit();
    return {
      summary: { created_items: createdItems, created_collections: createdCollections, created_containers: createdContainers, total_rows: items.length },
      rows: rowResults,
    };
  } catch (err) {
    await trx.rollback();
    throw err;
  }
}

module.exports = {
  setUserProfile,
  setLocation: locationMutation.setLocation,
  markOnboardingComplete,
  completeOnboarding,
  importInventory,
};
