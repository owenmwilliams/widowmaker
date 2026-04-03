'use strict';

/**
 * Inventory Mutation Service
 *
 * Handles all write operations on inventory: items, rooms, locations.
 * Extracted from censusAgent.js tool handlers.
 */

const knex = require('../infra/knex');
const conn = require('../infra/db');
const db = conn.db;
const { forwardGeocode } = require('../infra/geocodingService');

// ── Location constants ────────────────────────────────────────────────────────
const BASIC_LOCATION_CAP = 2;
const HOLDING_LOCATION_TYPE = 'holding_area';
const HOLDING_LOCATION_NAME = 'Unassigned Items';
const HOLDING_LOCATION_DESCRIPTION = 'Auto-generated holding area for reassigned items';

function parseCoordinateInput(value) {
  if (value === undefined || value === null || value === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

async function geocodeLocationPayload(payload, correlationId) {
  const query = [payload.address, payload.address_2, payload.city, payload.state, payload.zip]
    .filter(Boolean).join(', ').trim() || payload.city || payload.name;

  if (!query) return { lat: null, lng: null };

  try {
    const result = await forwardGeocode(query, null, payload.country || 'USA', { correlationId });
    if (result?.lat != null && result?.lng != null) return { lat: result.lat, lng: result.lng };
  } catch (error) {
    console.warn(`[inventoryMutationService] Failed to geocode "${query}":`, error.message);
  }
  return { lat: null, lng: null };
}

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

/**
 * Get the user's primary location_id. Returns null if none exists.
 */
async function getPrimaryLocationId(userId) {
  const loc = await db.oneOrNone(
    `SELECT id FROM locations WHERE user_id = $1
     ORDER BY location_type = 'primary_residence' DESC, created_at ASC LIMIT 1`,
    [userId]
  );
  return loc ? loc.id : null;
}

/**
 * Find a collection by name for a user, or create one.
 */
async function findOrCreateRoom(userId, roomName, locationId) {
  // Try exact match first
  let room = await db.oneOrNone(
    `SELECT id, name FROM collections WHERE user_id = $1 AND LOWER(name) = LOWER($2)`,
    [userId, roomName]
  );
  if (room) return room;

  // Create it
  if (!locationId) {
    locationId = await getPrimaryLocationId(userId);
  }
  if (!locationId) {
    throw new Error('No location found. Please create a location first using set_location.');
  }

  const [created] = await knex('collections')
    .insert({
      user_id: userId,
      name: roomName,
      location_id: locationId,
    })
    .returning(['id', 'name']);

  // Add permission
  await knex('permissions').insert({
    user_id: userId,
    resource_id: created.id,
    resource_type: 'collection',
    permission_level: 'owner',
    granted_by: userId,
  });

  console.log(`[census] Created room: "${roomName}" (id: ${created.id})`);
  return created;
}

/**
 * Add an item to inventory. Auto-creates room if needed.
 */
async function addItem(userId, args) {
  const locationId = await getPrimaryLocationId(userId);
  const room = await findOrCreateRoom(userId, args.room_name, locationId);

  const params = {
    user_id: userId,
    name: args.name,
    collection_id: room.id,
    quantity: args.quantity || 1,
  };

  if (args.description) params.description = args.description;
  if (args.weight_lbs) params.weight_lbs = args.weight_lbs;
  if (args.length_in) params.length_in = args.length_in;
  if (args.width_in) params.width_in = args.width_in;
  if (args.height_in) params.height_in = args.height_in;
  if (args.fragile !== undefined) params.fragile = args.fragile;
  if (args.material) params.material = args.material;
  if (args.primary_color) params.primary_color = args.primary_color;
  if (args.tags) params.tags = args.tags;
  if (args.estimated_value) params.estimated_value = args.estimated_value;
  if (args.notes) params.notes = args.notes;
  if (args.picture_url) params.picture_url = args.picture_url;
  if (args.confidence_score != null) params.confidence_score = Math.max(0, Math.min(1, args.confidence_score));
  if (args.confidence_source) params.confidence_source = args.confidence_source;

  const [item] = await knex.transaction(async (trx) => {
    const [inserted] = await knex('items').transacting(trx).insert(params).returning(['id', 'name']);
    await knex('permissions').transacting(trx).insert({
      user_id: userId,
      resource_id: inserted.id,
      resource_type: 'item',
      permission_level: 'owner',
      granted_by: userId,
    });
    return [inserted];
  });

  console.log(`[census] Added item: "${args.name}" to "${args.room_name}" (id: ${item.id})`);
  return { success: true, itemId: item.id, name: args.name, room: args.room_name };
}

/**
 * Update an existing item.
 */
async function updateItem(userId, args) {
  const updates = {};
  if (args.name) updates.name = args.name;
  if (args.description) updates.description = args.description;
  if (args.quantity) updates.quantity = args.quantity;
  if (args.weight_lbs) updates.weight_lbs = args.weight_lbs;
  if (args.fragile !== undefined) updates.fragile = args.fragile;
  if (args.notes) updates.notes = args.notes;
  updates.updated_at = new Date();

  const count = await knex('items')
    .where({ id: args.item_id, user_id: userId })
    .update(updates);

  if (count === 0) {
    return { success: false, error: 'Item not found or not authorized' };
  }
  return { success: true, itemId: args.item_id };
}

/**
 * Delete an item and its permissions.
 */
async function deleteItem(userId, args) {
  const item = await knex('items')
    .select('id', 'name')
    .where({ id: args.item_id, user_id: userId })
    .first();

  if (!item) {
    return { success: false, error: 'Item not found or not authorized' };
  }

  await knex.transaction(async (trx) => {
    await knex('permissions').transacting(trx)
      .where({ resource_id: args.item_id, resource_type: 'item' })
      .del();
    await knex('items').transacting(trx)
      .where({ id: args.item_id, user_id: userId })
      .del();
  });

  console.log(`[census] Deleted item: "${item.name}" (id: ${args.item_id})`);
  return { success: true, deletedId: args.item_id, name: item.name };
}

/**
 * Add a room (delegates to findOrCreateRoom).
 */
async function addRoom(userId, args) {
  const locationId = await getPrimaryLocationId(userId);
  if (!locationId) {
    return { success: false, error: 'No location found. Create a location first.' };
  }
  const room = await findOrCreateRoom(userId, args.name, locationId);
  return { success: true, roomId: room.id, name: room.name };
}

/**
 * Update a room's name or description.
 */
async function updateRoom(userId, args) {
  let room;
  if (args.room_id) {
    room = await knex('collections')
      .select('id', 'name')
      .where({ id: args.room_id, user_id: userId })
      .first();
  } else if (args.room_name) {
    room = await knex('collections')
      .select('id', 'name')
      .where({ user_id: userId })
      .whereRaw('LOWER(name) = ?', [args.room_name.toLowerCase()])
      .first();
  }

  if (!room) {
    return { success: false, error: 'Room not found or not authorized' };
  }

  const updates = {};
  if (args.name) updates.name = args.name;
  if (args.description) updates.description = args.description;
  updates.updated_at = new Date();

  await knex('collections').where({ id: room.id, user_id: userId }).update(updates);

  console.log(`[census] Updated room: "${room.name}" → "${args.name || room.name}" (id: ${room.id})`);
  return { success: true, roomId: room.id, oldName: room.name, newName: args.name || room.name };
}

/**
 * Update a location's details.
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

  const updates = {};
  if (args.name) updates.name = args.name;
  if (args.address) updates.address = args.address;
  if (args.city) updates.city = args.city;
  if (args.state) updates.state = args.state;
  if (args.zip) updates.zip = args.zip;
  updates.updated_at = new Date();

  await knex('locations').where({ id: loc.id, user_id: userId }).update(updates);

  console.log(`[census] Updated location: "${loc.name}" → "${args.name || loc.name}" (id: ${loc.id})`);
  return { success: true, locationId: loc.id, oldName: loc.name, newName: args.name || loc.name };
}

// ── Collections (CRUD) ────────────────────────────────────────────────────────

/**
 * Create a collection (room) under a location. Verifies ownership of the location.
 */
async function createCollection(userId, { location, name, description }) {
  const loc = await knex('locations')
    .select('id')
    .where({ id: location, user_id: userId })
    .first();

  if (!loc) {
    return { success: false, error: 'Not authorized to use this location' };
  }

  const collection = await knex.transaction(async (trx) => {
    const [created] = await knex('collections')
      .transacting(trx)
      .insert({ user_id: userId, name, description, location_id: location })
      .returning(['id']);

    await knex('permissions').transacting(trx).insert({
      user_id: userId,
      resource_id: created.id,
      resource_type: 'collection',
      permission_level: 'owner',
      granted_by: userId,
    });

    return created;
  });

  return collection;
}

/**
 * Delete a collection and cascade-delete its containers, items, and permissions.
 */
async function deleteCollection(userId, collectionId) {
  const owned = await knex('collections')
    .select('id')
    .where({ id: collectionId, user_id: userId })
    .first();

  if (!owned) {
    return { success: false, error: 'Collection not found' };
  }

  await knex.transaction(async (trx) => {
    await knex('permissions').transacting(trx)
      .where({ resource_id: collectionId, resource_type: 'collection' }).del();
    await knex('items').transacting(trx)
      .where({ collection_id: collectionId, user_id: userId }).del();
    await knex('containers').transacting(trx)
      .where({ collection_id: collectionId, user_id: userId }).del();
    await knex('collections').transacting(trx)
      .where({ id: collectionId, user_id: userId }).del();
  });

  return { success: true };
}

/**
 * Update a collection's name, description, or location.
 * If a new location is provided, verifies ownership.
 */
async function updateCollection(userId, collectionId, { name, description, location }) {
  if (location !== undefined) {
    const loc = await knex('locations')
      .select('id')
      .where({ id: location, user_id: userId })
      .first();
    if (!loc) {
      return { success: false, error: 'Not authorized to use this location' };
    }
  }

  const updateData = {};
  if (name !== undefined) updateData.name = name;
  if (description !== undefined) updateData.description = description;
  if (location !== undefined) updateData.location_id = location;

  await knex.transaction(async (trx) => {
    await knex('collections').transacting(trx)
      .update(updateData)
      .where({ id: collectionId, user_id: userId });
  });

  return { success: true };
}

// ── Containers (CRUD) ─────────────────────────────────────────────────────────

/**
 * Create a container inside a collection. Verifies collection ownership.
 */
async function createContainer(userId, params) {
  const { collection, ...fields } = params;

  const coll = await knex('collections')
    .select('id')
    .where({ id: collection, user_id: userId })
    .first();

  if (!coll) {
    return { success: false, error: 'Not authorized to use this collection' };
  }

  const insertParams = {
    user_id: userId,
    collection_id: collection,
    name: fields.name,
    description: fields.description,
  };

  const booleanFields = ['sealed', 'fragile_contents'];
  const directFields = [
    'box_number', 'box_type', 'weight_lbs', 'qr_code', 'color_code',
    'max_weight_lbs', 'max_volume_cuft', 'box_size',
    'inner_length_in', 'inner_width_in', 'inner_height_in',
  ];

  for (const f of booleanFields) {
    if (fields[f] !== undefined) {
      insertParams[f] = fields[f] === 'true' || fields[f] === true;
    }
  }
  for (const f of directFields) {
    if (fields[f] !== undefined) insertParams[f] = fields[f];
  }

  const container = await knex.transaction(async (trx) => {
    const [created] = await knex('containers')
      .transacting(trx)
      .insert(insertParams)
      .returning(['id']);

    await knex('permissions').transacting(trx).insert({
      user_id: userId,
      resource_id: created.id,
      resource_type: 'container',
      permission_level: 'owner',
      granted_by: userId,
    });

    return created;
  });

  return container;
}

/**
 * Delete a container; orphans its items (sets container_id = null).
 */
async function deleteContainer(userId, containerId) {
  const owned = await knex('containers')
    .select('id')
    .where({ id: containerId, user_id: userId })
    .first();

  if (!owned) {
    return { success: false, error: 'Container not found' };
  }

  await knex.transaction(async (trx) => {
    await knex('permissions').transacting(trx)
      .where({ resource_id: containerId, resource_type: 'container' }).del();
    await knex('items').transacting(trx)
      .update({ container_id: null })
      .where({ container_id: containerId, user_id: userId });
    await knex('containers').transacting(trx)
      .where({ id: containerId, user_id: userId }).del();
  });

  return { success: true };
}

/**
 * Update a container's fields; propagates collection_id to its items if changed.
 */
async function updateContainer(userId, containerId, fields) {
  if (fields.collection) {
    const coll = await knex('collections')
      .select('id')
      .where({ id: fields.collection, user_id: userId })
      .first();
    if (!coll) {
      return { success: false, error: 'Not authorized to use this collection' };
    }
  }

  const containerParams = {};
  if (fields.name !== undefined) containerParams.name = fields.name;
  if (fields.description !== undefined) containerParams.description = fields.description;
  if (fields.collection !== undefined) containerParams.collection_id = fields.collection;

  const booleanFields = ['sealed', 'fragile_contents'];
  const directFields = [
    'box_number', 'box_type', 'weight_lbs', 'qr_code', 'color_code',
    'max_weight_lbs', 'max_volume_cuft', 'box_size',
    'inner_length_in', 'inner_width_in', 'inner_height_in',
  ];

  for (const f of booleanFields) {
    if (fields[f] !== undefined) {
      containerParams[f] = fields[f] === 'true' || fields[f] === true;
    }
  }
  if (containerParams.sealed) {
    containerParams.sealed_at = new Date();
  }
  for (const f of directFields) {
    if (fields[f] !== undefined) containerParams[f] = fields[f];
  }

  const itemParams = {};
  if (fields.collection !== undefined) itemParams.collection_id = fields.collection;

  await knex.transaction(async (trx) => {
    if (Object.keys(itemParams).length > 0) {
      await knex('items').transacting(trx)
        .update(itemParams)
        .where({ container_id: containerId, user_id: userId });
    }
    await knex('containers').transacting(trx)
      .update(containerParams)
      .where({ id: containerId, user_id: userId });
  });

  return { success: true };
}

/**
 * Assign or regenerate a QR code for a container.
 */
async function assignContainerQr(userId, containerId, { token, regenerate } = {}) {
  const { QR_TYPES, buildQrUrl, generateUniqueToken, extractQrToken } = require('../primitives/qrService');

  const container = await knex('containers')
    .select('id', 'user_id', 'qr_code')
    .where({ id: containerId })
    .first();

  if (!container) {
    return { success: false, status: 404, error: 'Container not found' };
  }
  if (String(container.user_id) !== String(userId)) {
    return { success: false, status: 403, error: 'Not authorized to modify this container' };
  }

  const shouldRegenerate = regenerate === true || regenerate === 'true';
  const normalizedToken = token ? extractQrToken(token) : null;

  if (normalizedToken) {
    const existsInContainers = await knex('containers').where({ qr_code: normalizedToken }).first();
    const existsInItems = await knex('items').where({ qr_code: normalizedToken }).first();
    if (
      (existsInContainers && existsInContainers.id !== container.id) ||
      existsInItems
    ) {
      return { success: false, status: 409, error: 'QR code already in use' };
    }
  } else if (container.qr_code && !shouldRegenerate) {
    return {
      success: true,
      token: container.qr_code,
      url: buildQrUrl(QR_TYPES.container, container.qr_code),
      existing: true,
    };
  }

  const tokenValue = normalizedToken || (await generateUniqueToken(knex, 'containers', 'ct'));

  await knex('containers').where({ id: containerId }).update({
    qr_code: tokenValue,
    qr_assigned_at: knex.fn.now(),
  });

  return {
    success: true,
    token: tokenValue,
    url: buildQrUrl(QR_TYPES.container, tokenValue),
    regenerated: shouldRegenerate || Boolean(normalizedToken),
  };
}

// ── Items (REST API) ──────────────────────────────────────────────────────────

/**
 * Create an item directly via the REST API.
 * params must include collection_id (verified for ownership) and optionally container_id.
 * Returns { success, item } or { success: false, status, error }.
 */
async function createItem(userId, params) {
  const collection = await knex('collections')
    .select('id')
    .where({ id: params.collection_id, user_id: userId })
    .first();

  if (!collection) {
    return { success: false, status: 403, error: 'Not authorized to use this collection' };
  }

  if (params.container_id) {
    const container = await knex('containers')
      .select('id')
      .where({ id: params.container_id, user_id: userId })
      .first();

    if (!container) {
      return { success: false, status: 403, error: 'Not authorized to use this container' };
    }
  }

  const item = await knex.transaction(async (trx) => {
    const [inserted] = await knex('items')
      .transacting(trx)
      .insert({ user_id: userId, ...params })
      .returning(['id']);

    await knex('permissions').transacting(trx).insert({
      user_id: userId,
      resource_id: inserted.id,
      resource_type: 'item',
      permission_level: 'owner',
      granted_by: userId,
    });

    return inserted;
  });

  return { success: true, item };
}

/**
 * Update an item by ID. Only modifies fields present in params.
 * If collection_id or container_id are provided, ownership is verified first.
 * Returns { success } or { success: false, status, error }.
 */
async function updateItemById(userId, itemId, params) {
  if (params.collection_id) {
    const collection = await knex('collections')
      .select('id')
      .where({ id: params.collection_id, user_id: userId })
      .first();

    if (!collection) {
      return { success: false, status: 403, error: 'Not authorized to use this collection' };
    }
  }

  if (params.container_id !== undefined && params.container_id) {
    const container = await knex('containers')
      .select('id')
      .where({ id: params.container_id, user_id: userId })
      .first();

    if (!container) {
      return { success: false, status: 403, error: 'Not authorized to use this container' };
    }
  }

  console.log(`[items] update user=${userId} item=${itemId} fields=${Object.keys(params).join(', ')}`);

  await knex.transaction(async (trx) => {
    await knex('items')
      .transacting(trx)
      .update(params)
      .where({ id: itemId, user_id: userId });
  });

  return { success: true };
}

/**
 * Assign or regenerate a QR code for an item.
 * Mirrors assignContainerQr but for the items table.
 */
async function assignItemQr(userId, itemId, { token, regenerate } = {}) {
  const { QR_TYPES, buildQrUrl, generateUniqueToken, extractQrToken } = require('../primitives/qrService');

  const item = await knex('items')
    .select('id', 'user_id', 'qr_code')
    .where({ id: itemId })
    .first();

  if (!item) {
    return { success: false, status: 404, error: 'Item not found' };
  }
  if (String(item.user_id) !== String(userId)) {
    return { success: false, status: 403, error: 'Not authorized to modify this item' };
  }

  const shouldRegenerate = regenerate === true || regenerate === 'true';
  const normalizedToken = token ? extractQrToken(token) : null;

  if (normalizedToken) {
    const existsInItems = await knex('items').where({ qr_code: normalizedToken }).first();
    const existsInContainers = await knex('containers').where({ qr_code: normalizedToken }).first();
    if (
      (existsInItems && existsInItems.id !== item.id) ||
      existsInContainers
    ) {
      return { success: false, status: 409, error: 'QR code already in use' };
    }
  } else if (item.qr_code && !shouldRegenerate) {
    return {
      success: true,
      token: item.qr_code,
      url: buildQrUrl(QR_TYPES.item, item.qr_code),
      existing: true,
    };
  }

  const tokenValue = normalizedToken || (await generateUniqueToken(knex, 'items', 'it'));

  await knex('items').where({ id: itemId }).update({
    qr_code: tokenValue,
    qr_assigned_at: knex.fn.now(),
  });

  return {
    success: true,
    token: tokenValue,
    url: buildQrUrl(QR_TYPES.item, tokenValue),
    regenerated: shouldRegenerate || Boolean(normalizedToken),
  };
}

// ── Locations (REST API) ──────────────────────────────────────────────────────

/**
 * Return current location count for a user (used by plan-cap middleware).
 */
async function getLocationCount(userId) {
  const [row] = await knex('locations').count('* as cnt').where('user_id', userId);
  return Number(row?.cnt || 0);
}

/**
 * Create a new location, geocoding if lat/lng not provided.
 * Demotes any existing primary_residence if is_primary is true.
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

/**
 * Update a location, geocoding if lat/lng not provided.
 * Demotes existing primary_residence if is_primary is true.
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
  getPrimaryLocationId,
  findOrCreateRoom,
  addItem,
  updateItem,
  deleteItem,
  addRoom,
  updateRoom,
  updateLocation,
  createCollection,
  deleteCollection,
  updateCollection,
  createContainer,
  deleteContainer,
  updateContainer,
  assignContainerQr,
  createItem,
  updateItemById,
  assignItemQr,
  BASIC_LOCATION_CAP,
  getLocationCount,
  createLocation,
  updateLocationById,
  getLocationDeletePreview,
  executeLocationDeletion,
  deleteLocation,
};
