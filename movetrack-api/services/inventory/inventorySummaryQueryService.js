'use strict';

/**
 * inventorySummaryQueryService.js
 *
 * Aggregate reads: inventory totals, full snapshot for client hydration,
 * and plain-text summary for AI context.
 */

const knex = require('../infra/knex');
const conn = require('../infra/db');
const db = conn.db;
const { signItemUrls } = require('../infra/gcsService');

const QR_BASE_URL = (process.env.APP_BASE_URL || 'https://reloprep.com').replace(/\/$/, '');

function buildQrUrl(type, token) {
  if (!token) return null;
  return `${QR_BASE_URL}/qr/${type}/${token}`;
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

/**
 * Fetch the full inventory for a user in a single parallel query burst.
 * Returns { locations, collections, containers, items } — the canonical shape
 * for client-side hydration. Items have signed GCS picture_url and qr_url.
 * Containers also have qr_url. Truck-type locations are excluded.
 */
async function getInventorySnapshot(userId) {
  const [locationRows, collectionRows, containerRows, itemRows] = await Promise.all([
    // Locations — permissions join, truck type excluded
    knex('locations')
      .select(
        'locations.id', 'locations.name', 'locations.description',
        'locations.address', 'locations.address_2', 'locations.city',
        'locations.state', 'locations.zip', 'locations.country',
        'locations.location_type', 'locations.lat', 'locations.lng'
      )
      .leftJoin('permissions', function () {
        this.on('permissions.resource_id', '=', 'locations.id')
            .andOn('permissions.resource_type', '=', knex.raw('?', ['location']));
      })
      .where('permissions.user_id', userId)
      .andWhere(function () {
        this.whereNull('locations.location_type').orWhereNot('locations.location_type', 'truck');
      }),

    // Collections — direct ownership + location name
    knex('collections')
      .select('collections.*', 'locations.name as location_name')
      .leftJoin('locations', 'collections.location_id', 'locations.id')
      .where('collections.user_id', userId),

    // Containers — direct ownership + location_id/name via collection
    knex('containers')
      .select('containers.*', 'collections.location_id', 'locations.name as location_name')
      .leftJoin('collections', 'containers.collection_id', 'collections.id')
      .leftJoin('locations', 'collections.location_id', 'locations.id')
      .where('containers.user_id', userId),

    // Items — direct ownership + location_id via collection
    knex('items')
      .select('items.*', 'collections.location_id', 'locations.name as location_name')
      .leftJoin('collections', 'items.collection_id', 'collections.id')
      .leftJoin('locations', 'collections.location_id', 'locations.id')
      .where('items.user_id', userId),
  ]);

  // Derive qr_url for items and containers
  const items = itemRows.map(item => ({ ...item, qr_url: buildQrUrl('item', item.qr_code) }));
  const containers = containerRows.map(c => ({ ...c, qr_url: buildQrUrl('container', c.qr_code) }));

  // Sign GCS picture_url on items (no-op in local dev)
  await signItemUrls(items);

  return { locations: locationRows, collections: collectionRows, containers, items };
}

/**
 * Build a compact plain-text summary of the user's entire inventory.
 * Designed to fit in an AI system prompt without consuming too many tokens.
 * Distinct from getInventorySnapshot, which returns structured JSON for the client.
 */
async function getInventoryTextSummary(userId) {
  const locations = await db.any(
    `SELECT id, name, address, city, state, location_type
     FROM locations WHERE user_id = $1 ORDER BY created_at`, [userId]
  );

  if (locations.length === 0) {
    return 'No locations, rooms, or items yet. This is a new user.';
  }

  const collections = await db.any(
    `SELECT c.id, c.name, c.location_id, COUNT(i.id)::int AS item_count,
            COALESCE(SUM(i.weight_lbs * i.quantity), 0) AS total_weight
     FROM collections c
     LEFT JOIN items i ON i.collection_id = c.id
     WHERE c.user_id = $1
     GROUP BY c.id ORDER BY c.name`, [userId]
  );

  const gaps = await db.oneOrNone(
    `SELECT
       COUNT(*)::int AS total,
       COALESCE(SUM(quantity), 0)::int AS total_qty,
       COALESCE(SUM(weight_lbs * quantity), 0) AS total_weight,
       COALESCE(SUM(CASE WHEN length_in IS NOT NULL AND width_in IS NOT NULL AND height_in IS NOT NULL
                     THEN (length_in * width_in * height_in / 1728.0) * quantity ELSE 0 END), 0) AS total_volume,
       COUNT(CASE WHEN weight_lbs IS NULL OR weight_lbs = 0 THEN 1 END)::int AS missing_weight,
       COUNT(CASE WHEN length_in IS NULL OR width_in IS NULL OR height_in IS NULL THEN 1 END)::int AS missing_dimensions,
       COUNT(CASE WHEN picture_url IS NULL OR picture_url = '' THEN 1 END)::int AS missing_photos
     FROM items WHERE user_id = $1`, [userId]
  ) || { total: 0, total_qty: 0, total_weight: 0, total_volume: 0, missing_weight: 0, missing_dimensions: 0, missing_photos: 0 };

  const lines = [];
  const sparseRooms = [];

  for (const loc of locations) {
    const addr = [loc.address, loc.city, loc.state].filter(Boolean).join(', ');
    lines.push(`Location: "${loc.name}" (${loc.location_type})${addr ? ' — ' + addr : ''}`);

    const roomsInLoc = collections.filter(c => String(c.location_id) === String(loc.id));
    if (roomsInLoc.length === 0) {
      lines.push('  No rooms yet.');
    }
    for (const room of roomsInLoc) {
      const tag = room.item_count < 5 ? ' [needs more items]' : '';
      lines.push(`  Room: "${room.name}" — ${room.item_count} items, ~${Math.round(room.total_weight)} lbs${tag}`);
      if (room.item_count < 5) sparseRooms.push(`${room.name} (${room.item_count})`);
    }
  }

  lines.push('');
  lines.push(`Totals: ${gaps.total_qty} items, ~${Math.round(gaps.total_weight)} lbs, ~${Math.round(gaps.total_volume)} cu ft`);

  const gapLines = [];
  if (gaps.missing_weight > 0) gapLines.push(`${gaps.missing_weight} of ${gaps.total} items missing weight`);
  if (gaps.missing_dimensions > 0) gapLines.push(`${gaps.missing_dimensions} of ${gaps.total} missing dimensions`);
  if (gaps.missing_photos > 0) gapLines.push(`${gaps.missing_photos} of ${gaps.total} missing photos`);
  if (gapLines.length > 0) lines.push(`Gaps: ${gapLines.join(', ')}`);
  if (sparseRooms.length > 0) lines.push(`Sparse rooms (<5 items): ${sparseRooms.join(', ')}`);

  return lines.join('\n');
}

module.exports = {
  getInventoryTotals,
  getInventorySnapshot,
  getInventoryTextSummary,
};
