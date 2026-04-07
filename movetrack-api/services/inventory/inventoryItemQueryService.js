'use strict';

/**
 * inventoryItemQueryService.js
 *
 * Item-level read queries: search, photo lookup, single/all item reads,
 * container-filtered items, and loose (unboxed) items.
 */

const knex = require('../infra/knex');

/**
 * Search items with dynamic filters.
 */
async function searchItems(userId, args) {
  const allowedMissing = [
    'weight_lbs', 'length_in', 'width_in', 'height_in',
    'description', 'picture_url', 'material', 'primary_color', 'estimated_value',
  ];

  let query = knex('items')
    .select(
      'items.id', 'items.name', 'items.description', 'items.quantity',
      'items.weight_lbs', 'items.length_in', 'items.width_in', 'items.height_in',
      'items.fragile', 'items.material', 'items.primary_color',
      'items.estimated_value', 'items.picture_url',
      'collections.name as room_name'
    )
    .leftJoin('collections', 'items.collection_id', 'collections.id')
    .where('items.user_id', userId);

  if (args.room_name) {
    query = query.whereRaw('LOWER(collections.name) = ?', [args.room_name.toLowerCase()]);
  }
  if (args.search) {
    query = query.whereRaw('LOWER(items.name) LIKE ?', [`%${args.search.toLowerCase()}%`]);
  }
  if (args.missing_field && allowedMissing.includes(args.missing_field)) {
    query = query.whereNull(`items.${args.missing_field}`);
  }
  if (args.fragile !== undefined) {
    query = query.where('items.fragile', args.fragile);
  }

  const limit = Math.min(args.limit || 50, 100);
  const items = await query.orderBy('items.name').limit(limit);

  return { success: true, items, count: items.length };
}

/**
 * Get an item's photo by id or name.
 */
async function getItemPhoto(userId, args) {
  let item;
  if (args.item_id) {
    item = await knex('items')
      .select('id', 'name', 'picture_url')
      .where({ id: args.item_id, user_id: userId })
      .first();
  } else if (args.item_name) {
    item = await knex('items')
      .select('id', 'name', 'picture_url')
      .where({ user_id: userId })
      .whereRaw('LOWER(name) LIKE ?', [`%${args.item_name.toLowerCase()}%`])
      .first();
  }

  if (!item) {
    return { success: false, error: 'Item not found' };
  }
  if (!item.picture_url) {
    return { success: true, hasPhoto: false, name: item.name, message: 'No photo available for this item.' };
  }
  return { success: true, hasPhoto: true, name: item.name, picture_url: item.picture_url };
}

/**
 * Get items belonging to a specific container (filtered by location + collection + container).
 */
async function getItemsByContainer(userId, { locationId, collectionId, containerId }) {
  return knex
    .select({
      id: 'items.id',
      name: 'items.name',
      description: 'items.description',
      quantity: 'items.quantity',
      picture_url: 'items.picture_url',
      qr_code: 'items.qr_code',
      container_id: 'containers.id',
      collection_id: 'collections.id',
      location_id: 'locations.id',
    })
    .from('locations')
    .leftJoin('permissions', function () {
      this.on('permissions.resource_id', '=', 'locations.id')
          .andOn('permissions.resource_type', '=', knex.raw('?', ['location']));
    })
    .leftJoin('collections', 'collections.location_id', 'locations.id')
    .leftJoin('containers', 'containers.collection_id', 'collections.id')
    .leftJoin('items', 'items.container_id', 'containers.id')
    .where(knex.raw('permissions.user_id = ?', userId))
    .andWhere(knex.raw('locations.id = ?', locationId))
    .andWhere(knex.raw('collections.id = ?', collectionId))
    .andWhere(knex.raw('containers.id = ?', containerId));
}

/**
 * Get a single item with full location/collection/container context.
 */
async function getSingleItem(userId, itemId) {
  return knex
    .select({
      location_id: 'locations.id',
      location_name: 'locations.name',
      collection_id: 'collections.id',
      collection_name: 'collections.name',
      container_id: 'containers.id',
      container_name: 'containers.name',
      id: 'items.id',
      name: 'items.name',
      description: 'items.description',
      quantity: 'items.quantity',
      picture_url: 'items.picture_url',
      estimated_value: 'items.estimated_value',
      fragile: 'items.fragile',
      priority: 'items.priority',
      weight_lbs: 'items.weight_lbs',
      qr_code: 'items.qr_code',
      qr_assigned_at: 'items.qr_assigned_at',
      dimensions: knex.raw(`
        CASE
          WHEN items.length_in IS NOT NULL AND items.width_in IS NOT NULL AND items.height_in IS NOT NULL
            THEN CONCAT(items.length_in, '" × ', items.width_in, '" × ', items.height_in, '"')
          ELSE NULL
        END
      `),
      length_in: 'items.length_in',
      width_in: 'items.width_in',
      height_in: 'items.height_in',
      notes: 'items.notes',
      material: 'items.material',
      primary_color: 'items.primary_color',
      tags: 'items.tags',
    })
    .from('items')
    .leftJoin('permissions', function () {
      this.on('permissions.resource_id', '=', 'items.id')
          .andOn('permissions.resource_type', '=', knex.raw('?', ['item']));
    })
    .leftJoin('collections', 'collections.id', 'items.collection_id')
    .leftJoin('containers', 'containers.id', 'items.container_id')
    .leftJoin('locations', 'locations.id', 'collections.location_id')
    .where(knex.raw('permissions.user_id = ?', userId))
    .andWhere(knex.raw('items.id = ?', itemId));
}

/**
 * Get all items for a user across all locations, with hierarchy context.
 */
async function getAllItems(userId) {
  return knex('locations')
    .distinct({
      location_id: 'locations.id',
      location_name: 'locations.name',
      collection_id: 'collections.id',
      collection_name: 'collections.name',
      container_id: 'containers.id',
      container_name: 'containers.name',
      id: 'items.id',
      name: 'items.name',
      description: 'items.description',
      quantity: 'items.quantity',
      qr_code: 'items.qr_code',
      picture_url: 'items.picture_url',
    })
    .leftJoin('permissions', function () {
      this.on('permissions.resource_id', '=', 'locations.id')
          .andOn('permissions.resource_type', '=', knex.raw('?', ['location']));
    })
    .leftJoin('collections', 'collections.location_id', 'locations.id')
    .leftJoin('containers', 'containers.collection_id', 'collections.id')
    .leftJoin('items', 'items.container_id', 'containers.id')
    .whereNotNull('items.id')
    .andWhere(knex.raw('permissions.user_id = ?', userId));
}

/**
 * Get items that have no container assigned (loose / unboxed items).
 */
async function getLooseItems(userId) {
  const result = await knex.raw(`
    SELECT i.id, i.name, i.description, i.weight_lbs, i.fragile
    FROM items i
    WHERE i.user_id = ? AND i.container_id IS NULL
    ORDER BY i.name ASC
  `, [userId]);
  return result.rows;
}

module.exports = {
  searchItems,
  getItemPhoto,
  getItemsByContainer,
  getSingleItem,
  getAllItems,
  getLooseItems,
};
