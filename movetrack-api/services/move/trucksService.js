'use strict';

const knex = require('../infra/knex');

// ---------------------------------------------------------------------------
// Truck sizing recommendation
// ---------------------------------------------------------------------------

const TRUCK_SIZES = [
  { label: 'Cargo Van', cuFt: 250, maxLbs: 3000, code: 'van' },
  { label: '10-ft Truck', cuFt: 400, maxLbs: 4500, code: '10ft' },
  { label: '12-ft Truck', cuFt: 450, maxLbs: 4500, code: '12ft' },
  { label: '15-ft Truck', cuFt: 700, maxLbs: 6000, code: '15ft' },
  { label: '17-ft Truck', cuFt: 850, maxLbs: 6000, code: '17ft' },
  { label: '20-ft Truck', cuFt: 1100, maxLbs: 7500, code: '20ft' },
  { label: '22-ft Truck', cuFt: 1200, maxLbs: 7500, code: '22ft' },
  { label: '26-ft Truck', cuFt: 1600, maxLbs: 10000, code: '26ft' },
];

function recommendTruckSize(totals, bufferPct) {
  const buffer = bufferPct || 0.20;
  const bufferedVolume = totals.totalVolumeCuFt * (1 + buffer);

  const recommendation = TRUCK_SIZES.find(
    t => t.cuFt >= bufferedVolume && t.maxLbs >= totals.totalWeight
  ) || TRUCK_SIZES[TRUCK_SIZES.length - 1];

  const needsMultiple = bufferedVolume > TRUCK_SIZES[TRUCK_SIZES.length - 1].cuFt ||
    totals.totalWeight > TRUCK_SIZES[TRUCK_SIZES.length - 1].maxLbs;

  let multipleLoads = null;
  if (needsMultiple) {
    const largestTruck = TRUCK_SIZES[TRUCK_SIZES.length - 1];
    const tripsByVolume = Math.ceil(bufferedVolume / largestTruck.cuFt);
    const tripsByWeight = Math.ceil(totals.totalWeight / largestTruck.maxLbs);
    multipleLoads = {
      truckSize: largestTruck.label,
      trips: Math.max(tripsByVolume, tripsByWeight),
      reason: tripsByWeight > tripsByVolume ? 'weight' : 'volume',
    };
  }

  return {
    success: true,
    rawVolumeCuFt: totals.totalVolumeCuFt,
    bufferedVolumeCuFt: Math.round(bufferedVolume * 100) / 100,
    bufferPct: Math.round(buffer * 100),
    totalWeightLbs: totals.totalWeight,
    recommendation: {
      size: recommendation.label,
      code: recommendation.code,
      capacityCuFt: recommendation.cuFt,
      maxWeightLbs: recommendation.maxLbs,
      volumeUtilization: Math.round((bufferedVolume / recommendation.cuFt) * 100),
      weightUtilization: Math.round((totals.totalWeight / recommendation.maxLbs) * 100),
    },
    needsMultipleLoads: needsMultiple,
    multipleLoads,
    dataWarning: (totals.missingWeight > 0 || totals.missingDimensions > 0)
      ? `${totals.missingWeight} items missing weight, ${totals.missingDimensions} missing dimensions. Run estimate_missing_items for better accuracy.`
      : null,
  };
}

// ---------------------------------------------------------------------------
// Truck zone helpers
// ---------------------------------------------------------------------------

const TRUCK_ZONE_LABELS = ['Zone A', 'Zone B', 'Zone C', 'Zone D', 'Zone E', 'Zone F'];
const TRUCK_ZONE_COUNT_MAP = {
  van: 2,
  '10ft': 2,
  '12ft': 2,
  '15ft': 3,
  '17ft': 3,
  '20ft': 4,
  '22ft': 4,
  '24ft': 4,
  '26ft': 5,
};

function resolveTruckZoneCount(truckSize = '') {
  if (!truckSize) return 3;
  return TRUCK_ZONE_COUNT_MAP[truckSize] || 3;
}

function buildTruckLocationName(truckSize, sessionName, truckIdentifier, truckSequence) {
  if (truckIdentifier) return truckIdentifier;
  if (truckSequence) {
    const sizeLabel = truckSize ? ` (${truckSize})` : '';
    return `Truck ${truckSequence}${sizeLabel}`;
  }
  const sizeLabel = truckSize ? `${truckSize.toUpperCase()} ` : '';
  const suffix = sessionName ? ` - ${sessionName}` : '';
  return `${sizeLabel}Truck Staging${suffix}`;
}

async function createTruckLocationStructure(userId, sessionName, truckSizeHint, options = {}) {
  const { truckIdentifier, savedMoveId } = options;
  const zoneCount = resolveTruckZoneCount(truckSizeHint);

  let truckSequence = 1;
  if (savedMoveId) {
    const countResult = await knex.raw(`
      SELECT COUNT(*) as count FROM locations l
      INNER JOIN move_sessions ms ON ms.truck_location_id = l.id
      WHERE ms.saved_move_id = ? AND l.location_type = 'truck'
    `, [savedMoveId]);
    truckSequence = parseInt(countResult.rows[0].count, 10) + 1;
  }

  const locationName = buildTruckLocationName(truckSizeHint, sessionName, truckIdentifier, truckSequence);

  const locationResult = await knex.raw(`
    INSERT INTO locations (user_id, name, location_type, description, truck_identifier, truck_sequence, truck_size, created_at, updated_at)
    VALUES (?, ?, 'truck', 'Auto-generated truck staging area for Move Day', ?, ?, ?, NOW(), NOW())
    RETURNING id, truck_identifier, truck_sequence, truck_size
  `, [userId, locationName, truckIdentifier || null, truckSequence, truckSizeHint || null]);

  const locationId = locationResult.rows[0].id;
  const zones = [];

  for (let i = 0; i < zoneCount; i += 1) {
    const label = `Truck ${TRUCK_ZONE_LABELS[i] || `Zone ${i + 1}`}`;
    const zoneResult = await knex.raw(`
      INSERT INTO collections (user_id, name, description, location_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, NOW(), NOW())
      RETURNING id, name
    `, [userId, label, `Truck zone ${TRUCK_ZONE_LABELS[i] || i + 1}`, locationId]);
    zones.push(zoneResult.rows[0]);
  }

  return { locationId, zones, zoneCount };
}

async function ensureTruckZoneInventory(userId, locationId, truckSizeHint) {
  if (!locationId) return { zones: [], zoneCount: 0 };

  const desiredCount = resolveTruckZoneCount(truckSizeHint);
  const existing = await knex.raw(`
    SELECT id, name FROM collections
    WHERE user_id = ? AND location_id = ?
    ORDER BY id ASC
  `, [userId, locationId]);

  const zones = existing.rows;
  if (zones.length < desiredCount) {
    for (let i = zones.length; i < desiredCount; i += 1) {
      const label = `Truck ${TRUCK_ZONE_LABELS[i] || `Zone ${i + 1}`}`;
      const insertResult = await knex.raw(`
        INSERT INTO collections (user_id, name, description, location_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, NOW(), NOW())
        RETURNING id, name
      `, [userId, label, `Truck zone ${TRUCK_ZONE_LABELS[i] || i + 1}`, locationId]);
      zones.push(insertResult.rows[0]);
    }
  }

  return { zones, zoneCount: Math.max(desiredCount, zones.length) };
}

function resolveZoneCollectionId(zones, index = 0) {
  if (!zones || zones.length === 0) return null;
  const safeIndex = Number.isInteger(index) ? index : 0;
  const boundedIndex = Math.min(Math.max(safeIndex, 0), zones.length - 1);
  return zones[boundedIndex]?.id || null;
}

// ---------------------------------------------------------------------------
// Truck CRUD
// ---------------------------------------------------------------------------

async function getTrucksForMove(userId, moveId) {
  const trucks = await knex.raw(`
    SELECT DISTINCT l.id, l.name, l.truck_identifier, l.truck_sequence, l.truck_size,
           l.created_at, l.updated_at,
           (SELECT COUNT(*) FROM move_sessions ms WHERE ms.truck_location_id = l.id) as session_count,
           (SELECT COUNT(*) FROM collections c WHERE c.location_id = l.id) as zone_count
    FROM locations l
    INNER JOIN move_sessions ms ON ms.truck_location_id = l.id
    WHERE l.user_id = ? AND l.location_type = 'truck' AND ms.saved_move_id = ?
    ORDER BY l.truck_sequence ASC, l.created_at ASC
  `, [userId, moveId]);
  return trucks.rows;
}

async function getAllTrucks(userId) {
  const trucks = await knex.raw(`
    SELECT l.id, l.name, l.truck_identifier, l.truck_sequence, l.truck_size,
           l.created_at, l.updated_at,
           (SELECT COUNT(*) FROM move_sessions ms WHERE ms.truck_location_id = l.id) as session_count,
           (SELECT COUNT(*) FROM collections c WHERE c.location_id = l.id) as zone_count
    FROM locations l
    WHERE l.user_id = ? AND l.location_type = 'truck'
    ORDER BY l.created_at DESC
  `, [userId]);
  return trucks.rows;
}

async function getTruck(userId, truckId) {
  const truck = await knex.raw(`
    SELECT l.*,
           (SELECT json_agg(json_build_object('id', c.id, 'name', c.name))
            FROM collections c WHERE c.location_id = l.id) as zones,
           (SELECT json_agg(json_build_object('id', ms.id, 'session_name', ms.session_name, 'move_date', ms.move_date))
            FROM move_sessions ms WHERE ms.truck_location_id = l.id) as sessions
    FROM locations l
    WHERE l.id = ? AND l.user_id = ? AND l.location_type = 'truck'
  `, [truckId, userId]);
  return truck.rows[0] || null;
}

async function updateTruck(userId, truckId, { name, truck_identifier, truck_size }) {
  const existing = await knex.raw(`
    SELECT id FROM locations WHERE id = ? AND user_id = ? AND location_type = 'truck'
  `, [truckId, userId]);
  if (existing.rows.length === 0) return null;

  const updates = { updated_at: knex.fn.now() };
  if (name !== undefined) updates.name = name;
  if (truck_identifier !== undefined) updates.truck_identifier = truck_identifier;
  if (truck_size !== undefined) updates.truck_size = truck_size;

  const result = await knex('locations')
    .where({ id: truckId, user_id: userId })
    .update(updates)
    .returning('*');
  return result[0];
}

async function deleteTruck(userId, truckId) {
  const existing = await knex.raw(`
    SELECT l.id,
           (SELECT COUNT(*) FROM move_sessions ms WHERE ms.truck_location_id = l.id) as session_count
    FROM locations l
    WHERE l.id = ? AND l.user_id = ? AND l.location_type = 'truck'
  `, [truckId, userId]);
  if (existing.rows.length === 0) return null;

  const sessionCount = parseInt(existing.rows[0].session_count, 10) || 0;

  await knex.raw(`
    UPDATE move_sessions SET truck_location_id = NULL, updated_at = NOW()
    WHERE truck_location_id = ? AND user_id = ?
  `, [truckId, userId]);

  await knex.raw(`DELETE FROM collections WHERE location_id = ? AND user_id = ?`, [truckId, userId]);
  await knex.raw(`DELETE FROM locations WHERE id = ? AND user_id = ? AND location_type = 'truck'`, [truckId, userId]);

  return { sessions_affected: sessionCount };
}

module.exports = {
  TRUCK_SIZES,
  TRUCK_ZONE_LABELS,
  TRUCK_ZONE_COUNT_MAP,
  recommendTruckSize,
  resolveTruckZoneCount,
  buildTruckLocationName,
  createTruckLocationStructure,
  ensureTruckZoneInventory,
  resolveZoneCollectionId,
  getTrucksForMove,
  getAllTrucks,
  getTruck,
  updateTruck,
  deleteTruck,
};
