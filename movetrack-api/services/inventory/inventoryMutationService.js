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
const mediaAssetService = require('../infra/mediaAssetService');

// Location functions have moved to workflow/locationQueryService + workflow/locationMutationService.
// Re-exported below for backwards compatibility.
const locationQuery = require('../workflow/locationQueryService');
const locationMutation = require('../workflow/locationMutationService');

const { getPrimaryLocationId } = locationQuery;

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

  // Committing an item is the confirm step for whatever crop/frame/thumbnail
  // the scan pipeline generated for it — link it so the 48h orphan cleanup
  // (mediaAssetService.cleanupUnlinkedAssets) never deletes a photo a
  // committed item still points at. No-op (and never throws) if picture_url
  // isn't a tracked asset, e.g. a user-supplied URL from elsewhere.
  if (params.picture_url) {
    await mediaAssetService.markAssetLinkedByUrl(params.picture_url, item.id);
  }

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
  const { QR_TYPES, buildQrUrl, generateUniqueToken, extractQrToken } = require('./qrService');

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
  const { QR_TYPES, buildQrUrl, generateUniqueToken, extractQrToken } = require('./qrService');

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

module.exports = {
  // Local inventory functions
  getPrimaryLocationId,
  findOrCreateRoom,
  addItem,
  updateItem,
  deleteItem,
  addRoom,
  updateRoom,
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
  // Re-exported from workflow/locationQueryService for backwards compatibility
  BASIC_LOCATION_CAP: locationMutation.BASIC_LOCATION_CAP,
  getLocationCount: locationQuery.getLocationCount,
  // Re-exported from workflow/locationMutationService for backwards compatibility
  updateLocation: locationMutation.updateLocation,
  createLocation: locationMutation.createLocation,
  updateLocationById: locationMutation.updateLocationById,
  getLocationDeletePreview: locationMutation.getLocationDeletePreview,
  executeLocationDeletion: locationMutation.executeLocationDeletion,
  deleteLocation: locationMutation.deleteLocation,
};
