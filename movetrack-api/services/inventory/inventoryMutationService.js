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

module.exports = {
  getPrimaryLocationId,
  findOrCreateRoom,
  addItem,
  updateItem,
  deleteItem,
  addRoom,
  updateRoom,
  updateLocation,
};
