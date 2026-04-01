'use strict';

/**
 * Inventory Query Service
 *
 * Read-only inventory queries: search, item photos, aggregate totals.
 * Used by both Census and Vector agents.
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
 * Get aggregate inventory totals (weight, volume, missing counts).
 * Used by both Census and Vector agents.
 */
async function getInventoryTotals(userId) {
  const items = await knex('items')
    .select(
      'items.id', 'items.name', 'items.quantity',
      'items.weight_lbs', 'items.length_in', 'items.width_in', 'items.height_in',
      'items.fragile', 'items.description', 'items.material',
      'collections.name as room_name'
    )
    .leftJoin('collections', 'items.collection_id', 'collections.id')
    .where('items.user_id', userId);

  let totalWeight = 0;
  let totalVolumeCuFt = 0;
  let totalItems = 0;
  let missingWeight = 0;
  let missingDimensions = 0;

  for (const item of items) {
    const qty = item.quantity || 1;
    totalItems += qty;

    if (item.weight_lbs) {
      totalWeight += item.weight_lbs * qty;
    } else {
      missingWeight += qty;
    }

    if (item.length_in && item.width_in && item.height_in) {
      const vol = (item.length_in * item.width_in * item.height_in) / 1728;
      totalVolumeCuFt += vol * qty;
    } else {
      missingDimensions += qty;
    }
  }

  return {
    items,
    totalItems,
    totalWeight: Math.round(totalWeight),
    totalVolumeCuFt: Math.round(totalVolumeCuFt * 100) / 100,
    missingWeight,
    missingDimensions,
  };
}

module.exports = {
  searchItems,
  getItemPhoto,
  getInventoryTotals,
};
