'use strict';

/**
 * Move Summary Service
 *
 * Composite move summary, room breakdown, and missing item estimation.
 */

const knex = require('../infra/knex');
const { getInventoryTotals } = require('../inventory/inventorySummaryQueryService');
const { generateItemEstimate, generateBatchEstimates } = require('../inventory/itemEstimationService');
const { specForName, isLargeImpactItem } = require('../inventory/itemSpecsReference');

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

function positiveNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0;
}
function round1(v) {
  return Math.round(Number(v) * 10) / 10;
}

/**
 * Fill missing weight/dimensions across the inventory using a cheap 3-tier
 * strategy, so hundreds of items can be estimated in seconds:
 *   1. Typical values from a deterministic table — free, instant (most items).
 *   2. ONE batched model call for the remaining ordinary items.
 *   3. A per-item, photo-grounded call for large, high-impact items that have a
 *      photo (e.g. a sofa, where dimensions/weight vary a lot and matter most).
 *
 * @param {string} userId
 * @param {object} args - { max_items, max_photo_calls }
 * @returns {object} - { estimated, failed, remaining, byTier, results }
 */
async function estimateMissingItems(userId, args = {}) {
  const maxItems = Math.min(args.max_items || 500, 1000);
  const maxPhotoCalls = Math.min(args.max_photo_calls || 15, 30);
  const BATCH_SIZE = 50;

  const items = await knex('items')
    .select('items.id', 'items.name', 'items.description', 'items.quantity', 'items.weight_lbs',
            'items.length_in', 'items.width_in', 'items.height_in', 'items.material', 'items.primary_color',
            'items.picture_url', 'collections.name as collection_name')
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

  // ── Route each item to the cheapest tier that fits ──────────────────────
  const photoTier = [];          // large + has photo → per-item photo call
  const tableTier = [];          // recognized common item → free typical values
  const batchTier = [];          // everything else → one batched text call
  for (const item of items) {
    if (isLargeImpactItem(item.name) && item.picture_url && photoTier.length < maxPhotoCalls) {
      photoTier.push(item);
      continue;
    }
    const spec = specForName(item.name);
    if (spec) tableTier.push({ item, spec });
    else batchTier.push(item);
  }

  const pendingUpdates = [];
  let failed = 0;

  const queueUpdate = (item, fields, source) => {
    const updates = {};
    if (item.weight_lbs == null && positiveNumber(fields.weight_lbs)) updates.weight_lbs = round1(fields.weight_lbs);
    if (item.length_in == null && positiveNumber(fields.length_in)) updates.length_in = round1(fields.length_in);
    if (item.width_in == null && positiveNumber(fields.width_in)) updates.width_in = round1(fields.width_in);
    if (item.height_in == null && positiveNumber(fields.height_in)) updates.height_in = round1(fields.height_in);
    if (Object.keys(updates).length === 0) return;
    pendingUpdates.push({
      id: item.id,
      updates,
      result: {
        name: item.name,
        weight: updates.weight_lbs ?? item.weight_lbs,
        dimensions: (updates.length_in ?? item.length_in)
          ? `${updates.length_in ?? item.length_in}" × ${updates.width_in ?? item.width_in}" × ${updates.height_in ?? item.height_in}"`
          : null,
        source,
      },
    });
  };

  // Tier 1 — deterministic table (free)
  for (const { item, spec } of tableTier) {
    queueUpdate(item, { weight_lbs: spec.w, length_in: spec.l, width_in: spec.wd, height_in: spec.h }, 'typical');
  }

  // Tier 2 — one batched model call per chunk
  for (let i = 0; i < batchTier.length; i += BATCH_SIZE) {
    const chunk = batchTier.slice(i, i + BATCH_SIZE);
    try {
      const estimates = await generateBatchEstimates(
        chunk.map((it) => ({ name: it.name, room: it.collection_name, material: it.material }))
      );
      chunk.forEach((item, idx) => {
        const e = estimates.find((x) => Number(x.index) === idx + 1) || estimates[idx];
        if (!e) { failed++; return; }
        queueUpdate(item, e, 'ai');
      });
    } catch (err) {
      console.error('[estimate] batch estimate failed:', err.message);
      failed += chunk.length;
    }
  }

  // Tier 3 — per-item, photo-grounded call for large high-impact items
  for (const item of photoTier) {
    try {
      const res = await generateItemEstimate(
        {
          name: item.name,
          description: item.description,
          collection_name: item.collection_name,
          material: item.material,
          primary_color: item.primary_color,
        },
        { pictureUrl: item.picture_url }
      );
      const est = res.estimate || {};
      queueUpdate(item, {
        weight_lbs: est.weight_lbs?.value,
        length_in: est.dimensions?.length_in?.value,
        width_in: est.dimensions?.width_in?.value,
        height_in: est.dimensions?.height_in?.value,
      }, 'photo');
    } catch (err) {
      console.error(`[estimate] photo estimate failed for item ${item.id}:`, err.message);
      failed++;
    }
  }

  // ── Apply all updates ───────────────────────────────────────────────────
  const results = [];
  for (const { id, updates, result } of pendingUpdates) {
    updates.updated_at = new Date();
    await knex('items').where({ id, user_id: userId }).update(updates);
    results.push(result);
  }

  const totals = await getInventoryTotals(userId);
  return {
    success: true,
    estimated: results.length,
    failed,
    remaining: totals.missingWeight + totals.missingDimensions,
    byTier: { typical: tableTier.length, ai: batchTier.length, photo: photoTier.length },
    results: results.slice(0, 40),
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
