'use strict';

/**
 * locationMutationService.js
 *
 * All location write operations: create, update, delete, geocode validation.
 * Extracted from inventoryMutationService + onboardingService.
 */

const knex = require('../infra/knex');
const conn = require('../infra/db');
const db = conn.db;
const { forwardGeocode } = require('../infra/geocodingService');
const { getPrimaryLocationId } = require('./locationQueryService');

// ── Constants ────────────────────────────────────────────────────────────────

const BASIC_LOCATION_CAP = 2;
const HOLDING_LOCATION_TYPE = 'holding_area';
const HOLDING_LOCATION_NAME = 'Unassigned Items';
const HOLDING_LOCATION_DESCRIPTION = 'Auto-generated holding area for reassigned items';

// ── Helpers ──────────────────────────────────────────────────────────────────

function parseCoordinateInput(value) {
  if (value === undefined || value === null || value === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

/**
 * Forward-geocode an address payload to get lat/lng.
 * Returns { lat, lng } or { lat: null, lng: null } on failure.
 */
async function geocodeLocationPayload(payload, correlationId) {
  const query = [payload.address, payload.address_2, payload.city, payload.state, payload.zip]
    .filter(Boolean).join(', ').trim() || payload.city || payload.name;

  if (!query) return { lat: null, lng: null };

  try {
    const result = await forwardGeocode(query, null, payload.country || 'USA', { correlationId });
    if (result?.lat != null && result?.lng != null) return { lat: result.lat, lng: result.lng };
  } catch (error) {
    console.warn(`[locationMutation] Failed to geocode "${query}":`, error.message);
  }
  return { lat: null, lng: null };
}

/**
 * Validate an address via forward geocoding.
 * Returns { valid: true, lat, lng } or { valid: false, message }.
 */
async function validateAddressViaGeocode(addressFields, correlationId) {
  const addressParts = [addressFields.address, addressFields.city, addressFields.state, addressFields.zip].filter(Boolean);
  const fullAddress = addressParts.join(', ');
  if (!fullAddress) return { valid: true, lat: null, lng: null };

  const geo = await forwardGeocode(null, null, null, {
    correlationId,
    addressOverride: fullAddress,
  });

  if (geo.source === 'no_results') {
    return {
      valid: false,
      message: `I couldn't verify "${fullAddress}" as a real address. Could you double-check the address and try again?`,
    };
  }

  return { valid: true, lat: geo.lat || null, lng: geo.lng || null };
}

// ── Holding Location ─────────────────────────────────────────────────────────

/**
 * Ensure a holding location exists for reassigned items.
 * Accepts a Knex transaction.
 */
async function ensureHoldingLocation(trx, userId) {
  const existing = await trx('locations')
    .where({ user_id: userId, location_type: HOLDING_LOCATION_TYPE })
    .first();
  if (existing) return existing.id;

  const [created] = await trx('locations')
    .insert({
      user_id: userId,
      name: HOLDING_LOCATION_NAME,
      description: HOLDING_LOCATION_DESCRIPTION,
      location_type: HOLDING_LOCATION_TYPE,
    })
    .returning(['id']);

  if (!created?.id) throw new Error('Failed to create holding location');

  await trx('permissions')
    .insert({
      user_id: userId,
      resource_id: created.id,
      resource_type: 'location',
      permission_level: 'owner',
      granted_by: userId,
    })
    .onConflict(['user_id', 'resource_id', 'resource_type'])
    .ignore();

  return created.id;
}

// ── Create ───────────────────────────────────────────────────────────────────

/**
 * Create a new location via the agent flow (onboarding / orchestrator).
 * Validates address via geocoding before saving.
 */
async function setLocation(userId, args = {}) {
  const params = {
    user_id: userId,
    name: args.name || 'Home',
    location_type: 'primary_residence',
  };
  if (args.address) params.address = args.address;
  if (args.city) params.city = args.city;
  if (args.state) params.state = args.state;
  if (args.zip) params.zip = args.zip;

  const validation = await validateAddressViaGeocode(args, `set-location-${userId}`);
  if (!validation.valid) {
    return { success: false, error: 'address_not_found', message: validation.message };
  }
  if (validation.lat) params.lat = validation.lat;
  if (validation.lng) params.lng = validation.lng;

  const [location] = await knex.transaction(async (trx) => {
    const [loc] = await knex('locations').transacting(trx).insert(params).returning(['id', 'name']);
    await knex('permissions').transacting(trx).insert({
      user_id: userId,
      resource_id: loc.id,
      resource_type: 'location',
      permission_level: 'owner',
      granted_by: userId,
    });
    return [loc];
  });

  console.log(`[location] Created: "${args.name}" (id: ${location.id})`);
  return { success: true, locationId: location.id, name: args.name };
}

/**
 * Create a new location via the HTTP/frontend flow.
 * Geocodes if lat/lng not provided. Handles primary demotion.
 */
async function createLocation(userId, params) {
  const {
    name, description, address, address_2, city, state, zip,
    country = 'USA', location_type, is_primary,
    lat: latRaw, lng: lngRaw,
  } = params;

  const isPrimary = is_primary === true || is_primary === 'true';
  const locationType = location_type || (isPrimary ? 'primary_residence' : 'residence');

  const basePayload = {
    user_id: userId, name, description, address, address_2, city, state, zip,
    country, location_type: locationType,
    lat: parseCoordinateInput(latRaw),
    lng: parseCoordinateInput(lngRaw),
  };

  if (basePayload.lat == null || basePayload.lng == null) {
    const coords = await geocodeLocationPayload(basePayload, `location-create-${userId}`);
    basePayload.lat = coords.lat;
    basePayload.lng = coords.lng;
  }

  return knex.transaction(async (trx) => {
    if (isPrimary) {
      await trx('locations').update({ location_type: 'residence' })
        .where('user_id', userId).andWhere('location_type', 'primary_residence');
    }
    return trx('locations').insert(basePayload).returning('id');
  });
}

// ── Update ───────────────────────────────────────────────────────────────────

/**
 * Update a location's details (agent tool version).
 * Validates address via geocoding if address fields are changing.
 */
async function updateLocation(userId, args) {
  let locationId = args.location_id;
  if (!locationId) {
    locationId = await getPrimaryLocationId(userId);
  }
  if (!locationId) {
    return { success: false, error: 'No location found' };
  }

  const loc = await knex('locations')
    .select('id', 'name')
    .where({ id: locationId, user_id: userId })
    .first();

  if (!loc) {
    return { success: false, error: 'Location not found or not authorized' };
  }

  // Validate address if any address fields are being updated
  const hasAddressUpdate = args.address || args.city || args.state || args.zip;
  if (hasAddressUpdate) {
    const validation = await validateAddressViaGeocode(args, `update-location-${locationId}`);
    if (!validation.valid) {
      return { success: false, error: 'address_not_found', message: validation.message };
    }
  }

  const updates = {};
  if (args.name) updates.name = args.name;
  if (args.address) updates.address = args.address;
  if (args.city) updates.city = args.city;
  if (args.state) updates.state = args.state;
  if (args.zip) updates.zip = args.zip;
  updates.updated_at = new Date();

  await knex('locations').where({ id: loc.id, user_id: userId }).update(updates);

  console.log(`[location] Updated: "${loc.name}" → "${args.name || loc.name}" (id: ${loc.id})`);
  return { success: true, locationId: loc.id, oldName: loc.name, newName: args.name || loc.name };
}

/**
 * Update a location by ID (HTTP/frontend version).
 * Geocodes if lat/lng not provided. Handles primary demotion.
 */
async function updateLocationById(userId, locationId, params) {
  const {
    name, description, address, address_2, city, state, zip,
    country = 'USA', location_type, is_primary,
    lat: latRaw, lng: lngRaw,
  } = params;

  const isPrimary = is_primary === true || is_primary === 'true';
  const locationType = location_type || (isPrimary ? 'primary_residence' : 'residence');

  const updatePayload = {
    name, description, address, address_2, city, state, zip,
    country, location_type: locationType,
    updated_at: knex.fn.now(),
    lat: parseCoordinateInput(latRaw),
    lng: parseCoordinateInput(lngRaw),
  };

  if (updatePayload.lat == null || updatePayload.lng == null) {
    const coords = await geocodeLocationPayload(
      { ...updatePayload, user_id: userId },
      `location-update-${locationId}`
    );
    updatePayload.lat = coords.lat;
    updatePayload.lng = coords.lng;
  }

  await knex.transaction(async (trx) => {
    if (isPrimary) {
      await trx('locations').update({ location_type: 'residence' })
        .where('user_id', userId).andWhere('location_type', 'primary_residence');
    }
    await trx('locations').update(updatePayload).where('id', locationId).andWhere('user_id', userId);
  });
}

// ── Delete ───────────────────────────────────────────────────────────────────

/**
 * Preview what will be affected by deleting a location.
 */
async function getLocationDeletePreview(userId, locationId) {
  const location = await knex('locations').where({ id: locationId, user_id: userId }).first();
  if (!location) return { success: false, status: 404, error: 'Location not found' };
  if (location.location_type === HOLDING_LOCATION_TYPE) {
    return { success: false, status: 400, error: 'Cannot delete the default holding location' };
  }

  const collectionSubquery = knex('collections').select('id').where({ location_id: locationId, user_id: userId });
  const [collectionsCount] = await knex('collections').count('* as count').where({ location_id: locationId, user_id: userId });
  const [itemsCount] = await knex('items').count('* as count').where({ collection_id: collectionSubquery });
  const [containersCount] = await knex('containers').count('* as count').where({ collection_id: collectionSubquery });

  const affectedMoveIds = new Set();
  (await knex('saved_moves').where({ user_id: userId, origin_location_id: locationId }).pluck('id')).forEach(id => affectedMoveIds.add(id));
  (await knex('saved_moves').where({ user_id: userId, destination_location_id: locationId }).pluck('id')).forEach(id => affectedMoveIds.add(id));
  (await knex('move_waypoints').where({ location_id: locationId }).pluck('saved_move_id')).forEach(id => affectedMoveIds.add(id));
  (await knex('move_locations').where({ location_id: locationId }).pluck('move_id')).forEach(id => affectedMoveIds.add(id));

  const affectedMovesCount = affectedMoveIds.size;
  const affectedMoveNames = affectedMovesCount > 0
    ? await knex('saved_moves').select('id', 'name').whereIn('id', Array.from(affectedMoveIds)).orderBy('name')
    : [];

  const otherLocations = await knex('locations')
    .select('id', 'name', 'location_type', 'address', 'city', 'state')
    .where({ user_id: userId }).whereNot({ id: locationId }).orderBy('name');

  const moveWarning = (count) =>
    count > 0 ? `${count} saved move(s) will be affected` : 'No moves will be affected';

  return {
    success: true,
    location: { id: location.id, name: location.name, location_type: location.location_type },
    affectedData: {
      collections: Number(collectionsCount.count),
      items: Number(itemsCount.count),
      containers: Number(containersCount.count),
      moves: affectedMovesCount,
    },
    affectedMoves: affectedMoveNames,
    availableDestinations: otherLocations,
    deletionStrategies: [
      {
        id: 'reassign', name: 'Move to another location',
        description: 'Collections and items will be moved to the selected location',
        moveBehavior: affectedMovesCount > 0
          ? `${affectedMovesCount} saved move(s) will be updated to use the new location`
          : 'No moves will be affected',
        recommended: otherLocations.length > 0, requiresDestination: true,
      },
      {
        id: 'unassigned', name: 'Move to Unassigned Items',
        description: 'Collections will be moved to a holding area',
        moveBehavior: moveWarning(affectedMovesCount) + (affectedMovesCount > 0 ? ' and permanently deleted' : ''),
        recommended: otherLocations.length === 0, requiresDestination: false,
      },
      {
        id: 'delete_all', name: 'Delete all inventory',
        description: 'Permanently delete all collections, items, and containers at this location',
        moveBehavior: moveWarning(affectedMovesCount) + (affectedMovesCount > 0 ? ' and permanently deleted' : ''),
        recommended: false, requiresDestination: false, requiresConfirmation: true,
      },
    ],
  };
}

/**
 * Delete a location using one of three strategies:
 *   'reassign'   — move collections to destinationLocationId; update moves
 *   'unassigned' — move collections to holding area; delete affected moves
 *   'delete_all' — delete all collections/items/containers; delete affected moves
 */
async function executeLocationDeletion(userId, locationId, strategy, destinationLocationId = null) {
  const VALID_STRATEGIES = ['reassign', 'unassigned', 'delete_all'];
  if (!VALID_STRATEGIES.includes(strategy)) {
    return { success: false, status: 400, error: 'Invalid deletion strategy. Must be: reassign, unassigned, or delete_all' };
  }
  if (strategy === 'reassign' && !destinationLocationId) {
    return { success: false, status: 400, error: 'destination_location_id is required for reassign strategy' };
  }

  const result = await knex.transaction(async (trx) => {
    const location = await trx('locations').where({ id: locationId, user_id: userId }).first();
    if (!location) throw Object.assign(new Error('Location not found'), { status: 404 });
    if (location.location_type === HOLDING_LOCATION_TYPE) {
      throw Object.assign(new Error('Cannot delete the default holding location'), { status: 400 });
    }

    let targetLocationId = null;
    let deletedCounts = { collections: 0, items: 0, containers: 0 };

    if (strategy === 'delete_all') {
      const collectionIds = (await trx('collections').where({ location_id: locationId, user_id: userId }).select('id')).map(c => c.id);
      if (collectionIds.length > 0) {
        const [ic] = await trx('items').count('* as count').whereIn('collection_id', collectionIds);
        const [cc] = await trx('containers').count('* as count').whereIn('collection_id', collectionIds);
        deletedCounts.items = Number(ic.count);
        deletedCounts.containers = Number(cc.count);
        deletedCounts.collections = collectionIds.length;
        await trx('collections').whereIn('id', collectionIds).delete();
      }
    } else {
      if (strategy === 'reassign') {
        const destLocation = await trx('locations').where({ id: destinationLocationId, user_id: userId }).first();
        if (!destLocation) throw Object.assign(new Error('Destination location not found'), { status: 404 });
        targetLocationId = destinationLocationId;
      } else {
        targetLocationId = await ensureHoldingLocation(trx, userId);
      }
      deletedCounts.moved = await trx('collections')
        .where({ location_id: locationId, user_id: userId })
        .update({ location_id: targetLocationId, updated_at: knex.fn.now() });
    }

    if (strategy === 'reassign') {
      deletedCounts.movesUpdated =
        (await trx('saved_moves').where({ user_id: userId, origin_location_id: locationId }).update({ origin_location_id: targetLocationId, updated_at: knex.fn.now() })) +
        (await trx('saved_moves').where({ user_id: userId, destination_location_id: locationId }).update({ destination_location_id: targetLocationId, updated_at: knex.fn.now() }));
      deletedCounts.waypointsUpdated = await trx('move_waypoints').where({ location_id: locationId }).update({ location_id: targetLocationId });
      await trx('move_locations').where({ location_id: locationId }).update({ location_id: targetLocationId });
      for (const col of ['session_start_location_id', 'session_end_location_id', 'truck_location_id']) {
        await trx('move_sessions').where({ [col]: locationId, user_id: userId }).update({ [col]: targetLocationId, updated_at: knex.fn.now() });
      }
    } else {
      const affectedMoveIds = new Set();
      (await trx('saved_moves').where({ user_id: userId, origin_location_id: locationId }).pluck('id')).forEach(id => affectedMoveIds.add(id));
      (await trx('saved_moves').where({ user_id: userId, destination_location_id: locationId }).pluck('id')).forEach(id => affectedMoveIds.add(id));
      (await trx('move_waypoints').where({ location_id: locationId }).pluck('saved_move_id')).forEach(id => affectedMoveIds.add(id));
      (await trx('move_locations').where({ location_id: locationId }).pluck('move_id')).forEach(id => affectedMoveIds.add(id));

      const ids = Array.from(affectedMoveIds);
      if (ids.length > 0) {
        await trx('move_waypoints').whereIn('saved_move_id', ids).del();
        await trx('move_locations').whereIn('move_id', ids).del();
        deletedCounts.sessionsDeleted = await trx('move_sessions').whereIn('saved_move_id', ids).del();
        deletedCounts.movesDeleted = await trx('saved_moves').whereIn('id', ids).del();
      } else {
        deletedCounts.movesDeleted = 0;
        deletedCounts.sessionsDeleted = 0;
      }
    }

    await trx('locations').where({ id: locationId, user_id: userId }).del();
    return { strategy, targetLocationId, deletedCounts };
  });

  return { success: true, ...result };
}

/**
 * Simple delete: moves collections to a holding area, cleans up move references,
 * and deletes the location. Legacy endpoint behaviour.
 */
async function deleteLocation(userId, locationId) {
  const result = await knex.transaction(async (trx) => {
    const location = await trx('locations').where({ id: locationId, user_id: userId }).first();
    if (!location) throw Object.assign(new Error('Location not found'), { status: 404 });
    if (location.location_type === HOLDING_LOCATION_TYPE) {
      throw Object.assign(new Error('Cannot delete the default holding location'), { status: 400 });
    }

    const fallbackId = await ensureHoldingLocation(trx, userId);
    const movesNeedingReview = new Set();

    await trx('collections').where({ location_id: locationId, user_id: userId }).update({ location_id: fallbackId, updated_at: knex.fn.now() });
    await trx('containers').where({ location_id: locationId, user_id: userId }).update({ location_id: fallbackId, updated_at: knex.fn.now() });
    await trx('items').where({ location_id: locationId, user_id: userId }).update({ location_id: null, updated_at: knex.fn.now() });
    await trx('move_sessions').where({ session_start_location_id: locationId, user_id: userId }).update({ session_start_location_id: fallbackId, updated_at: knex.fn.now() });
    await trx('move_sessions').where({ session_end_location_id: locationId, user_id: userId }).update({ session_end_location_id: fallbackId, updated_at: knex.fn.now() });

    const moveLocationIds = await trx('move_locations').where({ location_id: locationId }).pluck('move_id');
    if (moveLocationIds.length) {
      await trx('move_locations').where({ location_id: locationId }).del();
      moveLocationIds.forEach(id => movesNeedingReview.add(id));
    }

    const originMoves = await trx('saved_moves').where({ user_id: userId, origin_location_id: locationId }).pluck('id');
    if (originMoves.length) {
      await trx('saved_moves').whereIn('id', originMoves).update({ origin_location_id: fallbackId, updated_at: knex.fn.now() });
      originMoves.forEach(id => movesNeedingReview.add(id));
    }

    const destMoves = await trx('saved_moves').where({ user_id: userId, destination_location_id: locationId }).pluck('id');
    if (destMoves.length) {
      await trx('saved_moves').whereIn('id', destMoves).update({ destination_location_id: fallbackId, updated_at: knex.fn.now() });
      destMoves.forEach(id => movesNeedingReview.add(id));
    }

    const waypointRows = await trx('move_waypoints').select('id', 'saved_move_id').where({ location_id: locationId });
    if (waypointRows.length) {
      for (const row of waypointRows) {
        await trx('move_sessions').where({ saved_move_id: row.saved_move_id }).andWhere('start_waypoint_id', row.id).update({ start_waypoint_id: null, updated_at: knex.fn.now() });
        await trx('move_sessions').where({ saved_move_id: row.saved_move_id }).andWhere('end_waypoint_id', row.id).update({ end_waypoint_id: null, updated_at: knex.fn.now() });
        movesNeedingReview.add(row.saved_move_id);
      }
      await trx('move_waypoints').whereIn('id', waypointRows.map(r => r.id)).del();
    }

    await trx('locations').where({ id: locationId, user_id: userId }).del();
    return { fallbackLocationId: fallbackId, movesNeedingReview: Array.from(movesNeedingReview) };
  });

  return { success: true, ...result };
}

module.exports = {
  BASIC_LOCATION_CAP,
  HOLDING_LOCATION_TYPE,
  ensureHoldingLocation,
  setLocation,
  createLocation,
  updateLocation,
  updateLocationById,
  getLocationDeletePreview,
  executeLocationDeletion,
  deleteLocation,
};
