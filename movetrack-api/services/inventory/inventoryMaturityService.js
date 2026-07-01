'use strict';

/**
 * inventoryMaturityService.js
 *
 * Evaluates how complete and move-ready a user's inventory is.
 * Provides gap analysis, confidence scoring, and readiness assessments.
 */

const conn = require('../infra/db');
const db = conn.db;
const { REFERENCE_ROOMS, TYPICAL_ITEMS } = require('./inventoryReferenceData');
const { assessWeightPlausibility, flagWeightOutliers } = require('./inventoryBenchmarkService');
const { isLargeImpactItem } = require('./itemSpecsReference');
const { listRoomVideos } = require('./roomVideoService');

// ── Gap Analysis ──────────────────────────────────────────────────────────────

/**
 * Compare existing rooms against what's expected for a home of this type/size.
 * Returns { missingRooms, suggestions, expectedRooms }.
 */
function getMissingContext(existingRoomNames, homeType, bedroomCount, bathroomCount) {
  let refKey = 'house_default';
  const bedrooms = bedroomCount || 1;
  if (homeType === 'studio') {
    refKey = 'studio';
  } else if (bedrooms <= 4) {
    refKey = `${bedrooms}bed`;
  }

  const expectedRooms = REFERENCE_ROOMS[refKey] || REFERENCE_ROOMS.house_default;
  const normalizedExisting = existingRoomNames.map(r => r.toLowerCase().trim());

  const missingRooms = expectedRooms.filter(room => {
    const lower = room.toLowerCase();
    return !normalizedExisting.some(existing =>
      existing.includes(lower) || lower.includes(existing) ||
      (lower.includes('bedroom') && existing.includes('bedroom')) ||
      (lower.includes('bathroom') && existing.includes('bathroom'))
    );
  });

  const suggestions = [];
  for (const room of normalizedExisting) {
    const typicalKey = Object.keys(TYPICAL_ITEMS).find(k => room.includes(k));
    if (typicalKey) {
      suggestions.push({ room, typicalItems: TYPICAL_ITEMS[typicalKey] });
    }
  }

  return { missingRooms, suggestions, expectedRooms };
}

/**
 * Get typical items for a room type by fuzzy-matching against TYPICAL_ITEMS keys.
 */
function getTypicalItems(roomName) {
  const lower = roomName.toLowerCase().trim();
  const key = Object.keys(TYPICAL_ITEMS).find(k => lower.includes(k));
  return key ? TYPICAL_ITEMS[key] : [];
}

// ── Readiness Assessment ──────────────────────────────────────────────────────

/**
 * Evaluate how ready a user's inventory is to share with moving companies.
 * Returns a structured report with scores (0-100) and actionable next steps.
 */
async function inventoryReadinessAssessment(userId) {
  const locations = await db.any(
    `SELECT id, name, location_type FROM locations WHERE user_id = $1`, [userId]
  );

  if (locations.length === 0) {
    return {
      overall: 0,
      status: 'not_started',
      summary: 'No locations set up yet. The user needs to start by adding their home.',
      categories: {},
      nextSteps: [
        'Set up your home location and rooms',
        'Start cataloging items room by room',
        'Take photos or videos of each room',
      ],
    };
  }

  const collections = await db.any(
    `SELECT c.id, c.name, c.location_id, COUNT(i.id)::int AS item_count
     FROM collections c
     LEFT JOIN items i ON i.collection_id = c.id
     WHERE c.user_id = $1
     GROUP BY c.id`, [userId]
  );

  const itemStats = await db.oneOrNone(
    `SELECT COUNT(*)::int AS total,
            COUNT(CASE WHEN weight_lbs IS NOT NULL AND weight_lbs > 0 THEN 1 END)::int AS has_weight,
            COUNT(CASE WHEN length_in IS NOT NULL AND width_in IS NOT NULL AND height_in IS NOT NULL THEN 1 END)::int AS has_dimensions,
            COUNT(CASE WHEN picture_url IS NOT NULL AND picture_url != '' THEN 1 END)::int AS has_photo,
            COUNT(CASE WHEN fragile IS NOT NULL THEN 1 END)::int AS has_fragile_flag,
            COALESCE(SUM(weight_lbs * COALESCE(quantity, 1)), 0)::int AS total_weight,
            COALESCE(SUM(CASE WHEN length_in IS NOT NULL AND width_in IS NOT NULL AND height_in IS NOT NULL
              THEN (length_in * width_in * height_in / 1728.0) * COALESCE(quantity, 1) ELSE 0 END), 0)::int AS total_volume_cuft
     FROM items WHERE user_id = $1`, [userId]
  ) || { total: 0, has_weight: 0, has_dimensions: 0, has_photo: 0, has_fragile_flag: 0, total_weight: 0, total_volume_cuft: 0 };

  const total = itemStats.total;
  const emptyRooms = collections.filter(c => c.item_count === 0);
  const sparseRooms = collections.filter(c => c.item_count > 0 && c.item_count < 3);

  const duplicates = await db.any(
    `SELECT LOWER(i.name) AS item_name, c.name AS room_name, COUNT(*)::int AS cnt
     FROM items i JOIN collections c ON i.collection_id = c.id
     WHERE i.user_id = $1
     GROUP BY LOWER(i.name), c.name
     HAVING COUNT(*) > 1`, [userId]
  );

  // ── Category scores ──────────────────────────────────────────────────────

  let roomScore = 100;
  if (collections.length === 0) {
    roomScore = 0;
  } else {
    const emptyPenalty = (emptyRooms.length / collections.length) * 60;
    const sparsePenalty = (sparseRooms.length / collections.length) * 25;
    roomScore = Math.max(0, Math.round(100 - emptyPenalty - sparsePenalty));
  }

  const weightScore = total > 0 ? Math.round((itemStats.has_weight / total) * 100) : 0;
  const dimensionScore = total > 0 ? Math.round((itemStats.has_dimensions / total) * 100) : 0;
  const photoScore = total > 0 ? Math.round((itemStats.has_photo / total) * 100) : 0;

  let qualityScore = 100;
  if (total > 0) {
    const fragilePct = itemStats.has_fragile_flag / total;
    if (total > 10 && fragilePct < 0.1) qualityScore -= 20;
    if (duplicates.length > 0) qualityScore -= Math.min(40, duplicates.length * 10);
    qualityScore = Math.max(0, qualityScore);
  } else {
    qualityScore = 0;
  }

  let itemCountScore;
  if (total === 0) itemCountScore = 0;
  else if (total < 10) itemCountScore = 20;
  else if (total < 20) itemCountScore = 40;
  else if (total < 35) itemCountScore = 60;
  else if (total < 50) itemCountScore = 80;
  else itemCountScore = 100;

  let overall = Math.round(
    roomScore * 0.15 +
    weightScore * 0.20 +
    dimensionScore * 0.15 +
    photoScore * 0.10 +
    qualityScore * 0.10 +
    itemCountScore * 0.30
  );

  // Cap the headline % by the home-size benchmark: a total far below what a home
  // this size should weigh can't read as "almost ready" just because the few
  // logged items are well-described. (Fixes "79% for one scanned room".)
  const benchmarkBedrooms = await getResidenceBedrooms(userId);
  const plausibility = assessWeightPlausibility({
    bedrooms: benchmarkBedrooms,
    actualWeightLbs: itemStats.total_weight,
    itemCount: total,
    itemsMissingWeight: Math.max(0, total - itemStats.has_weight),
  });
  if (plausibility.hasBenchmark) {
    if (plausibility.status === 'too_low') overall = Math.min(overall, 40);
    else if (plausibility.status === 'low') overall = Math.min(overall, 65);
  }

  let status;
  if (overall >= 85) status = 'ready';
  else if (overall >= 65) status = 'almost_ready';
  else if (overall >= 40) status = 'in_progress';
  else if (overall > 0) status = 'early';
  else status = 'not_started';

  // ── Next steps ────────────────────────────────────────────────────────────

  const nextSteps = [];

  if (emptyRooms.length > 0) {
    const names = emptyRooms.slice(0, 3).map(r => r.name).join(', ');
    nextSteps.push(`Catalog items in empty rooms: ${names}`);
  }
  if (total > 0 && total < 20) {
    nextSteps.push(`Keep adding items — ${total} logged so far, most moves have 50+`);
  }
  if (sparseRooms.length > 0) {
    const names = sparseRooms.slice(0, 3).map(r => `${r.name} (${r.item_count})`).join(', ');
    nextSteps.push(`Add more items to sparse rooms: ${names}`);
  }
  if (total > 5 && itemStats.has_weight < total * 0.5) {
    nextSteps.push(`Add weight estimates — only ${itemStats.has_weight} of ${total} items have weights`);
  }
  if (total > 5 && itemStats.has_dimensions < total * 0.5) {
    nextSteps.push(`Add dimensions — only ${itemStats.has_dimensions} of ${total} items have measurements`);
  }
  if (duplicates.length > 0) {
    const examples = duplicates.slice(0, 3).map(d => `"${d.item_name}" in ${d.room_name}`).join(', ');
    nextSteps.push(`Review potential duplicates: ${examples}`);
  }
  if (total > 10 && itemStats.has_photo < total * 0.3) {
    nextSteps.push(`Add photos — only ${itemStats.has_photo} of ${total} items have one`);
  }

  // Media completeness nudges (soft): photos for the big-ticket items and a
  // walkthrough per room. These are what make a mover's quote trustworthy.
  const mediaGaps = await getMediaGaps(userId);
  if (mediaGaps.largeItemsMissingPhoto.length > 0) {
    const first = mediaGaps.largeItemsMissingPhoto[0];
    nextSteps.unshift(`Photograph the big items in ${first.room}: ${first.items.slice(0, 4).join(', ')}`);
  }
  if (mediaGaps.roomsMissingVideo.length > 0) {
    const names = mediaGaps.roomsMissingVideo.slice(0, 3).map((r) => r.room).join(', ');
    nextSteps.push(`Record a quick walkthrough video of: ${names}`);
  }

  return {
    overall,
    status,
    mediaGaps,
    summary: `${total} items across ${collections.length} rooms. ${Math.round(itemStats.total_weight)} lbs, ~${itemStats.total_volume_cuft} cu ft.`,
    totals: {
      itemCount: total,
      weightLbs: Math.round(itemStats.total_weight),
      volumeCuFt: itemStats.total_volume_cuft,
      itemsMissingWeight: Math.max(0, total - itemStats.has_weight),
    },
    categories: {
      roomCoverage: { score: roomScore, detail: `${emptyRooms.length} empty, ${sparseRooms.length} sparse of ${collections.length} rooms` },
      itemCount: { score: itemCountScore, detail: `${total} items logged` },
      weights: { score: weightScore, detail: `${itemStats.has_weight}/${total} have weights` },
      dimensions: { score: dimensionScore, detail: `${itemStats.has_dimensions}/${total} have dimensions` },
      photos: { score: photoScore, detail: `${itemStats.has_photo}/${total} have photos` },
      dataQuality: { score: qualityScore, detail: `${duplicates.length} potential duplicates` },
    },
    nextSteps: nextSteps.slice(0, 3),
  };
}

/**
 * Share-readiness: completeness assessment + a reasonableness benchmark against
 * the home size, so we can catch implausible inventories (e.g. 92 lbs for a
 * 3-bedroom home) before they're shared with movers.
 *
 * @param {string} userId
 * @param {{bedrooms?: number|null}} opts  bedroom count (null = unknown → no benchmark)
 */
async function shareReasonableness(userId, { bedrooms = null } = {}) {
  const assessment = await inventoryReadinessAssessment(userId);

  // Fall back to the persisted home size (residence with bedrooms set) when the
  // caller didn't pass one — so the share-time check works without the agent.
  let beds = bedrooms;
  if (beds === null || beds === undefined) {
    beds = await getResidenceBedrooms(userId);
  }

  const items = await db.any(
    `SELECT name, weight_lbs FROM items WHERE user_id = $1`, [userId]
  );
  const reasonableness = assessWeightPlausibility({
    bedrooms: beds,
    actualWeightLbs: assessment.totals.weightLbs,
    itemCount: assessment.totals.itemCount,
    itemsMissingWeight: assessment.totals.itemsMissingWeight,
  });
  const weightOutliers = flagWeightOutliers(items).slice(0, 10);
  return { ...assessment, reasonableness, weightOutliers, bedrooms: beds ?? null };
}

/**
 * Count bedrooms from room names (e.g. "Bedroom 1", "Master Bedroom"). Used as a
 * fallback when the home size wasn't explicitly recorded. Pure + testable.
 */
function inferBedroomsFromRoomNames(names = []) {
  const count = names.filter((n) => /bedroom/i.test(String(n || ''))).length;
  return count > 0 ? count : null;
}

/**
 * Best-guess bedroom count for the user's current home, or null if unknown.
 * Prefers the explicitly-recorded value; falls back to counting bedroom rooms so
 * the reasonableness check still works for users who never stated their home size.
 */
async function getResidenceBedrooms(userId) {
  const row = await db.oneOrNone(
    `SELECT bedrooms FROM locations
      WHERE user_id = $1 AND bedrooms IS NOT NULL
      ORDER BY (location_type = 'primary_residence') DESC, created_at ASC
      LIMIT 1`,
    [userId]
  );
  if (row && row.bedrooms != null) return row.bedrooms;

  const rooms = await db.any(`SELECT name FROM collections WHERE user_id = $1`, [userId]);
  return inferBedroomsFromRoomNames(rooms.map((r) => r.name));
}

/**
 * Media-completeness gaps that make a mover quote trustworthy: rooms that have
 * items but no walkthrough video, and large/high-variance items (sofa, fridge,
 * TV, bed…) with no photo to ground the estimate. Soft — surfaced as nudges in
 * the readiness flow, never a hard block.
 *
 * @returns {Promise<{roomsMissingVideo: Array<{room,itemCount}>,
 *   largeItemsMissingPhoto: Array<{room, items: string[]}>,
 *   counts: {roomsMissingVideo:number, largeItemsMissingPhoto:number}}>}
 */
async function getMediaGaps(userId) {
  const collections = await db.any(
    `SELECT c.name, COUNT(i.id)::int AS item_count
     FROM collections c LEFT JOIN items i ON i.collection_id = c.id
     WHERE c.user_id = $1 GROUP BY c.id, c.name`, [userId]
  );

  let videos = [];
  try { videos = await listRoomVideos(userId); } catch (_) { videos = []; }
  const videoRooms = new Set(
    (videos || []).map((v) => (v.room_name || '').toLowerCase().trim()).filter(Boolean)
  );

  const roomsMissingVideo = collections
    .filter((c) => c.item_count > 0 && !videoRooms.has((c.name || '').toLowerCase().trim()))
    .map((c) => ({ room: c.name, itemCount: c.item_count }));

  const items = await db.any(
    `SELECT i.name, i.picture_url, c.name AS room_name
     FROM items i LEFT JOIN collections c ON i.collection_id = c.id
     WHERE i.user_id = $1`, [userId]
  );
  const byRoom = new Map();
  for (const it of items) {
    const hasPhoto = it.picture_url && String(it.picture_url).trim() !== '';
    if (hasPhoto || !isLargeImpactItem(it.name)) continue;
    const room = it.room_name || 'Unsorted';
    if (!byRoom.has(room)) byRoom.set(room, []);
    byRoom.get(room).push(it.name);
  }
  const largeItemsMissingPhoto = [...byRoom.entries()].map(([room, names]) => ({ room, items: names }));

  return {
    roomsMissingVideo,
    largeItemsMissingPhoto,
    counts: {
      roomsMissingVideo: roomsMissingVideo.length,
      largeItemsMissingPhoto: largeItemsMissingPhoto.reduce((n, r) => n + r.items.length, 0),
    },
  };
}

module.exports = {
  getMissingContext,
  getTypicalItems,
  inventoryReadinessAssessment,
  shareReasonableness,
  getMediaGaps,
  getResidenceBedrooms,
  inferBedroomsFromRoomNames,
};
