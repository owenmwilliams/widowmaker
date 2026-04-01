'use strict';

/**
 * Move Summary Service
 *
 * Composite move summary, room breakdown, and missing item estimation.
 */

const knex = require('../infra/knex');
const { getInventoryTotals } = require('../census/inventoryQueryService');
const { generateItemEstimate } = require('../shared/itemEstimationService');

/**
 * Get a comprehensive move summary.
 *
 * @param {string} userId
 * @returns {object} - items, weight, volume, rooms, locations, saved moves
 */
async function getMoveSummary(userId) {
  const totals = await getInventoryTotals(userId);

  const locations = await knex('locations')
    .select('id', 'name', 'address', 'city', 'state', 'zip', 'location_type')
    .where('user_id', userId);

  const rooms = await knex('collections')
    .select('collections.name')
    .count('items.id as item_count')
    .leftJoin('items', 'collections.id', 'items.collection_id')
    .where('collections.user_id', userId)
    .groupBy('collections.id', 'collections.name')
    .orderBy('collections.name');

  const savedMoves = await knex('saved_moves')
    .select('id', 'name', 'origin_location_id', 'destination_location_id',
            'desired_start_date', 'desired_end_date')
    .where('user_id', userId)
    .orderBy('updated_at', 'desc')
    .limit(5);

  return {
    success: true,
    totalItems: totals.totalItems,
    totalWeight: totals.totalWeight,
    totalVolumeCuFt: totals.totalVolumeCuFt,
    missingWeight: totals.missingWeight,
    missingDimensions: totals.missingDimensions,
    dataCompleteness: totals.totalItems > 0
      ? Math.round((1 - (totals.missingWeight + totals.missingDimensions) / (totals.totalItems * 2)) * 100)
      : 0,
    rooms: rooms.map(r => ({ name: r.name, itemCount: parseInt(r.item_count) })),
    locations: locations.map(l => ({
      id: l.id, name: l.name, city: l.city, state: l.state,
      type: l.location_type,
    })),
    savedMoves: savedMoves.map(m => ({
      id: m.id, name: m.name,
      startDate: m.desired_start_date,
      endDate: m.desired_end_date,
    })),
  };
}

/**
 * Estimate missing weight/dimensions for items using AI.
 *
 * @param {string} userId
 * @param {object} args - { max_items }
 * @returns {object} - { estimated, failed, remaining, results }
 */
async function estimateMissingItems(userId, args) {
  const maxItems = Math.min(args.max_items || 20, 50);

  const items = await knex('items')
    .select('items.id', 'items.name', 'items.description', 'items.quantity', 'items.weight_lbs',
            'items.length_in', 'items.width_in', 'items.height_in', 'items.material', 'items.primary_color',
            'collections.name as collection_name')
    .leftJoin('collections', 'items.collection_id', 'collections.id')
    .where('items.user_id', userId)
    .where(function() {
      this.whereNull('items.weight_lbs')
        .orWhereNull('items.length_in')
        .orWhereNull('items.width_in')
        .orWhereNull('items.height_in');
    })
    .limit(maxItems);

  if (items.length === 0) {
    return { success: true, message: 'All items already have weight and dimension data.', estimated: 0 };
  }

  const results = [];
  let estimated = 0;
  let failed = 0;

  for (const item of items) {
    try {
      const estimate = await generateItemEstimate({
        name: item.name,
        description: item.description,
        quantity: item.quantity,
        collection_name: item.collection_name,
        material: item.material,
        primary_color: item.primary_color,
        weight_lbs: item.weight_lbs,
        length_in: item.length_in,
        width_in: item.width_in,
        height_in: item.height_in,
      });

      const updates = {};
      const est = estimate.estimate;

      if (!item.weight_lbs && est.weight_lbs?.value) {
        updates.weight_lbs = est.weight_lbs.value;
      }
      if (!item.length_in && est.dimensions?.length_in?.value) {
        updates.length_in = est.dimensions.length_in.value;
      }
      if (!item.width_in && est.dimensions?.width_in?.value) {
        updates.width_in = est.dimensions.width_in.value;
      }
      if (!item.height_in && est.dimensions?.height_in?.value) {
        updates.height_in = est.dimensions.height_in.value;
      }

      if (Object.keys(updates).length > 0) {
        updates.updated_at = new Date();
        await knex('items').where({ id: item.id, user_id: userId }).update(updates);
        estimated++;
        results.push({
          name: item.name,
          weight: updates.weight_lbs || item.weight_lbs,
          dimensions: updates.length_in
            ? `${updates.length_in || item.length_in}" × ${updates.width_in || item.width_in}" × ${updates.height_in || item.height_in}"`
            : null,
          confidence: est.confidence,
        });
      }
    } catch (err) {
      console.error(`[vector] Estimation failed for item ${item.id}:`, err.message);
      failed++;
    }
  }

  const totals = await getInventoryTotals(userId);

  return {
    success: true,
    estimated,
    failed,
    remaining: totals.missingWeight + totals.missingDimensions,
    results,
    updatedTotals: {
      totalWeight: totals.totalWeight,
      totalVolumeCuFt: totals.totalVolumeCuFt,
      missingWeight: totals.missingWeight,
      missingDimensions: totals.missingDimensions,
    },
  };
}

/**
 * Get a room-by-room breakdown of items, weight, and volume.
 *
 * @param {string} userId
 * @returns {object} - { rooms, totals }
 */
async function getRoomBreakdown(userId) {
  const items = await knex('items')
    .select(
      'items.quantity', 'items.weight_lbs',
      'items.length_in', 'items.width_in', 'items.height_in',
      'collections.name as room_name'
    )
    .leftJoin('collections', 'items.collection_id', 'collections.id')
    .where('items.user_id', userId);

  const rooms = {};
  for (const item of items) {
    const room = item.room_name || 'Uncategorized';
    if (!rooms[room]) {
      rooms[room] = { itemCount: 0, weightLbs: 0, volumeCuFt: 0 };
    }
    const qty = item.quantity || 1;
    rooms[room].itemCount += qty;
    if (item.weight_lbs) rooms[room].weightLbs += item.weight_lbs * qty;
    if (item.length_in && item.width_in && item.height_in) {
      rooms[room].volumeCuFt += (item.length_in * item.width_in * item.height_in) / 1728 * qty;
    }
  }

  const breakdown = Object.entries(rooms).map(([name, data]) => ({
    room: name,
    items: data.itemCount,
    weightLbs: Math.round(data.weightLbs),
    volumeCuFt: Math.round(data.volumeCuFt * 100) / 100,
  }));

  breakdown.sort((a, b) => b.volumeCuFt - a.volumeCuFt);

  return {
    success: true,
    rooms: breakdown,
    totals: {
      rooms: breakdown.length,
      items: breakdown.reduce((s, r) => s + r.items, 0),
      weightLbs: breakdown.reduce((s, r) => s + r.weightLbs, 0),
      volumeCuFt: Math.round(breakdown.reduce((s, r) => s + r.volumeCuFt, 0) * 100) / 100,
    },
  };
}

module.exports = {
  getMoveSummary,
  estimateMissingItems,
  getRoomBreakdown,
};
