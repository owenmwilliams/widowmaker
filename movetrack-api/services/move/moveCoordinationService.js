'use strict';

const knex = require('../infra/knex');
const { extractQrToken } = require('../primitives/qrService');
const {
  resolveTruckZoneCount,
  createTruckLocationStructure,
  ensureTruckZoneInventory,
  resolveZoneCollectionId,
} = require('./trucksService');

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

const formatCityStateLabel = (value) => {
  if (!value || typeof value !== 'string') return value || '';
  const parts = value.split(',').map((part) => part.trim()).filter(Boolean);
  if (parts.length >= 2) {
    const stateRaw = parts[parts.length - 1].replace(/\d+/g, '').trim();
    const city = parts[parts.length - 2];
    if (city && stateRaw) return `${city}, ${stateRaw}`;
    if (city) return city;
    if (stateRaw) return stateRaw;
  }
  return parts[parts.length - 1] || value;
};

const normalizeDateOnly = (value) => {
  if (!value) return null;
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const date = new Date(`${value}T00:00:00Z`);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
};

function serviceError(message, statusCode) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

// ---------------------------------------------------------------------------
// Sessions — queries
// ---------------------------------------------------------------------------

async function getSessions(userId) {
  const result = await knex.raw(`
    SELECT ms.*,
            sm.name as move_name,
            ol.name as origin_name,
            dl.name as destination_name,
            sl.name as session_start_name,
            el.name as session_end_name,
            tl.name as truck_location_name,
            sw.city as start_waypoint_city,
            sw.state as start_waypoint_state,
            ew.city as end_waypoint_city,
            ew.state as end_waypoint_state,
            (SELECT COUNT(*) FROM box_scans WHERE move_session_id = ms.id AND scan_type = 'loaded') as boxes_loaded,
            (SELECT COUNT(*) FROM box_scans WHERE move_session_id = ms.id AND scan_type = 'unloaded') as boxes_unloaded,
            (SELECT COUNT(DISTINCT container_id) FROM box_scans WHERE move_session_id = ms.id) as total_boxes_scanned
     FROM move_sessions ms
     LEFT JOIN saved_moves sm ON ms.saved_move_id = sm.id
     LEFT JOIN locations ol ON ms.origin_location_id = ol.id
     LEFT JOIN locations dl ON ms.destination_location_id = dl.id
     LEFT JOIN locations sl ON ms.session_start_location_id = sl.id
     LEFT JOIN locations el ON ms.session_end_location_id = el.id
     LEFT JOIN locations tl ON ms.truck_location_id = tl.id
     LEFT JOIN move_waypoints sw ON ms.start_waypoint_id = sw.id
     LEFT JOIN move_waypoints ew ON ms.end_waypoint_id = ew.id
     WHERE ms.user_id = ?
     ORDER BY ms.created_at DESC
  `, [userId]);
  return result.rows;
}

async function getSession(userId, sessionId) {
  const sessionResult = await knex.raw(`
    SELECT ms.*,
            sm.name as move_name,
            ol.name as origin_name, ol.address as origin_address,
            dl.name as destination_name, dl.address as destination_address,
            sl.name as session_start_name,
            el.name as session_end_name,
            tl.name as truck_location_name
     FROM move_sessions ms
     LEFT JOIN saved_moves sm ON ms.saved_move_id = sm.id
     LEFT JOIN locations ol ON ms.origin_location_id = ol.id
     LEFT JOIN locations dl ON ms.destination_location_id = dl.id
     LEFT JOIN locations sl ON ms.session_start_location_id = sl.id
     LEFT JOIN locations el ON ms.session_end_location_id = el.id
     LEFT JOIN locations tl ON ms.truck_location_id = tl.id
     WHERE ms.id = ? AND ms.user_id = ?
  `, [sessionId, userId]);

  if (sessionResult.rows.length === 0) throw serviceError('Move session not found', 404);

  const [scansResult, timelineResult, damageResult, crewResult] = await Promise.all([
    knex.raw(`
      SELECT bs.*, c.name as container_name, c.box_number, c.box_type, c.color_code
       FROM box_scans bs
       JOIN containers c ON bs.container_id = c.id
       WHERE bs.move_session_id = ?
       ORDER BY bs.scanned_at DESC
    `, [sessionId]),
    knex.raw(`
      SELECT * FROM move_timeline WHERE move_session_id = ? ORDER BY created_at DESC
    `, [sessionId]),
    knex.raw(`
      SELECT dr.*, c.name as container_name, i.name as item_name
       FROM damage_reports dr
       LEFT JOIN containers c ON dr.container_id = c.id
       LEFT JOIN items i ON dr.item_id = i.id
       WHERE dr.move_session_id = ?
       ORDER BY dr.reported_at DESC
    `, [sessionId]),
    knex.raw(`
      SELECT * FROM move_crew WHERE move_session_id = ? ORDER BY created_at ASC
    `, [sessionId]),
  ]);

  let truckZones = [];
  if (sessionResult.rows[0].truck_location_id) {
    const zoneResult = await knex.raw(`
      SELECT id, name FROM collections
      WHERE user_id = ? AND location_id = ?
      ORDER BY id ASC
    `, [userId, sessionResult.rows[0].truck_location_id]);
    truckZones = zoneResult.rows;
  }

  return {
    session: sessionResult.rows[0],
    scans: scansResult.rows,
    timeline: timelineResult.rows,
    damage_reports: damageResult.rows,
    crew: crewResult.rows,
    truck_zones: truckZones,
  };
}

// ---------------------------------------------------------------------------
// Sessions — mutations
// ---------------------------------------------------------------------------

async function createSession(userId, body) {
  const {
    saved_move_id,
    session_date,
    session_name,
    notes,
    origin_location_id,
    destination_location_id,
    start_location_id,
    start_collection_id,
    end_location_id,
    end_collection_id,
    end_mode,
    end_truck_zone_index,
    truck_size_hint,
    truck_identifier,
    existing_truck_id,
    session_type,
    start_waypoint_id,
    end_waypoint_id,
  } = body;

  if (!saved_move_id) throw serviceError('saved_move_id is required', 400);

  const savedMoveId = saved_move_id;

  const move = await knex('saved_moves').where({ id: savedMoveId, user_id: userId }).first();
  if (!move) throw serviceError('Saved move not found', 404);

  if (!session_date) throw serviceError('Session date is required', 400);
  const normalizedSessionDate = normalizeDateOnly(session_date);
  if (!normalizedSessionDate) throw serviceError('Invalid session date', 400);

  const desiredStart = normalizeDateOnly(move.desired_start_date || move.move_date);
  const desiredEnd = normalizeDateOnly(move.desired_end_date || desiredStart);
  if (desiredStart && desiredEnd) {
    if (normalizedSessionDate < desiredStart || normalizedSessionDate > desiredEnd) {
      throw serviceError('Session date must be within the move window', 400);
    }
  }

  const allowedStartLocations = new Set();
  if (move.origin_location_id) allowedStartLocations.add(String(move.origin_location_id));

  const existingSessions = await knex('move_sessions')
    .where({ saved_move_id: savedMoveId })
    .andWhere('user_id', userId)
    .whereNotNull('session_end_location_id')
    .select('session_end_location_id');
  existingSessions.forEach(s => {
    if (s.session_end_location_id) allowedStartLocations.add(String(s.session_end_location_id));
  });

  const resolvedStartLocationId = start_location_id || move.origin_location_id;
  const normalizedStartLocationId = resolvedStartLocationId ? String(resolvedStartLocationId) : null;
  const startLocationIdNumeric = normalizedStartLocationId ? Number(normalizedStartLocationId) : null;

  let startLocationRecord = null;
  if (Number.isFinite(startLocationIdNumeric)) {
    startLocationRecord = await knex('locations')
      .select('id', 'location_type')
      .where({ id: startLocationIdNumeric, user_id: userId })
      .first();
  }

  if (!normalizedStartLocationId || !allowedStartLocations.has(normalizedStartLocationId)) {
    throw serviceError('Selected start location is not eligible for this move', 400);
  }

  const resolvedOriginOverride = origin_location_id || move.origin_location_id;
  const resolvedDestinationOverride = destination_location_id || move.destination_location_id;
  const destinationMode = (end_mode || 'location').toLowerCase();
  let resolvedTruckSize = truck_size_hint ? truck_size_hint.toLowerCase() : null;

  let resolvedEndLocationId = null;
  let resolvedEndCollectionId = null;
  let truckLocationId = null;
  let zoneCount = null;

  if (destinationMode === 'truck') {
    if (existing_truck_id) {
      const existingTruck = await knex('locations')
        .where({ id: existing_truck_id, user_id: userId, location_type: 'truck' })
        .first();
      if (!existingTruck) throw serviceError('Selected truck not found or does not belong to you', 400);

      const truckZones = await knex('collections')
        .where({ location_id: existing_truck_id, user_id: userId })
        .orderBy('name', 'asc');

      truckLocationId = existingTruck.id;
      zoneCount = truckZones.length;
      resolvedTruckSize = existingTruck.truck_size || null;
      resolvedEndLocationId = truckLocationId;
      resolvedEndCollectionId = resolveZoneCollectionId(truckZones, end_truck_zone_index);
    } else {
      const truckStructure = await createTruckLocationStructure(userId, session_name, resolvedTruckSize, {
        truckIdentifier: truck_identifier,
        savedMoveId,
      });
      truckLocationId = truckStructure.locationId;
      zoneCount = truckStructure.zoneCount;
      resolvedTruckSize = resolvedTruckSize || null;
      resolvedEndLocationId = truckLocationId;
      resolvedEndCollectionId = resolveZoneCollectionId(truckStructure.zones, end_truck_zone_index);
    }
  } else {
    resolvedEndLocationId = end_location_id || resolvedDestinationOverride;
    resolvedEndCollectionId = end_collection_id || null;
  }

  if (!resolvedEndLocationId) throw serviceError('Destination location is required', 400);

  const validSessionTypes = ['loading', 'driving', 'unloading', 'transfer'];
  const resolvedSessionType = session_type && validSessionTypes.includes(session_type) ? session_type : 'loading';

  const startIsOrigin = !!(move.origin_location_id && normalizedStartLocationId && normalizedStartLocationId === String(move.origin_location_id));
  const startIsTruck = startLocationRecord?.location_type === 'truck';

  if (resolvedSessionType === 'loading') {
    if (!startIsOrigin) throw serviceError('Loading sessions must start at the move origin', 400);
    if (destinationMode !== 'truck') throw serviceError('Loading sessions must end in a truck', 400);
  }
  if (resolvedSessionType === 'unloading') {
    if (!startIsTruck) throw serviceError('Unloading sessions must start from a truck', 400);
    if (destinationMode !== 'location') throw serviceError('Unloading sessions must end at a destination or dropoff location', 400);
  }
  if (resolvedSessionType === 'transfer') {
    if (!startIsTruck) throw serviceError('Transfer sessions must start from a truck', 400);
    if (destinationMode !== 'truck') throw serviceError('Transfer sessions must end in a truck', 400);
  }
  if (resolvedSessionType === 'driving') {
    if (!start_waypoint_id || !end_waypoint_id) {
      throw serviceError('Driving sessions require both start_waypoint_id and end_waypoint_id', 400);
    }
    const [startWaypoint, endWaypoint] = await Promise.all([
      knex('move_waypoints').where({ id: start_waypoint_id, saved_move_id: savedMoveId, user_id: userId }).first(),
      knex('move_waypoints').where({ id: end_waypoint_id, saved_move_id: savedMoveId, user_id: userId }).first(),
    ]);
    if (!startWaypoint || !endWaypoint) throw serviceError('Invalid waypoint(s) specified', 400);
  }

  const result = await knex('move_sessions')
    .insert({
      user_id: userId,
      saved_move_id: savedMoveId,
      move_date: session_date,
      session_date,
      origin_location_id: resolvedOriginOverride || null,
      destination_location_id: resolvedDestinationOverride || null,
      notes: notes || null,
      session_name: session_name || null,
      status: 'not_started',
      stage: 'planning',
      session_start_location_id: normalizedStartLocationId,
      session_start_collection_id: start_collection_id || null,
      session_end_location_id: resolvedEndLocationId || null,
      session_end_collection_id: resolvedEndCollectionId,
      truck_location_id: truckLocationId,
      truck_size: truckLocationId ? resolvedTruckSize : null,
      num_zones: truckLocationId ? zoneCount : null,
      session_type: resolvedSessionType,
      start_waypoint_id: start_waypoint_id || null,
      end_waypoint_id: end_waypoint_id || null,
    })
    .returning('*');

  await knex.raw(`
    INSERT INTO move_timeline (move_session_id, event_type, description, created_by)
    VALUES (?, 'session_created', 'Move session created', ?)
  `, [result[0].id, userId]);

  return result[0];
}

async function updateSessionDate(userId, sessionId, sessionDate) {
  const normalizedSessionDate = normalizeDateOnly(sessionDate);
  if (!normalizedSessionDate) throw serviceError('Invalid session date', 400);

  const sessionCheck = await knex.raw(`
    SELECT ms.id, ms.saved_move_id, sm.desired_start_date, sm.desired_end_date, sm.move_date
    FROM move_sessions ms
    LEFT JOIN saved_moves sm ON ms.saved_move_id = sm.id
    WHERE ms.id = ? AND ms.user_id = ?
  `, [sessionId, userId]);

  if (sessionCheck.rows.length === 0) throw serviceError('Move session not found', 404);

  const session = sessionCheck.rows[0];
  const desiredStart = normalizeDateOnly(session.desired_start_date || session.move_date);
  const desiredEnd = normalizeDateOnly(session.desired_end_date || desiredStart);

  if (desiredStart && desiredEnd) {
    if (normalizedSessionDate < desiredStart || normalizedSessionDate > desiredEnd) {
      throw serviceError('Session date must be within the move window', 400);
    }
  }

  const result = await knex.raw(`
    UPDATE move_sessions
    SET session_date = ?, move_date = ?, updated_at = NOW()
    WHERE id = ? AND user_id = ?
    RETURNING *
  `, [normalizedSessionDate, normalizedSessionDate, sessionId, userId]);

  if (result.rows.length === 0) throw serviceError('Move session not found', 404);
  return result.rows[0];
}

async function updateSessionStatus(userId, sessionId, status) {
  const validStatuses = ['not_started', 'in_progress', 'complete'];
  if (!validStatuses.includes(status)) throw serviceError('Invalid status', 400);

  const sessionInfo = await knex('move_sessions as ms')
    .select(
      'ms.status as current_status',
      'ms.session_start_location_id',
      'ms.session_end_location_id',
      'ms.origin_location_id as session_origin_location_id',
      'ms.destination_location_id as session_destination_location_id',
      'sm.origin_location_id',
      'sm.destination_location_id',
      'sm.name as move_name',
      'sm.id as saved_move_id'
    )
    .leftJoin('saved_moves as sm', 'ms.saved_move_id', 'sm.id')
    .where('ms.id', sessionId)
    .andWhere('ms.user_id', userId)
    .first();

  if (!sessionInfo) throw serviceError('Move session not found', 404);

  if (status === 'in_progress') {
    const normalizedLocationIds = new Set();
    [
      sessionInfo.origin_location_id,
      sessionInfo.destination_location_id,
      sessionInfo.session_start_location_id,
      sessionInfo.session_end_location_id,
      sessionInfo.session_origin_location_id,
      sessionInfo.session_destination_location_id,
    ]
      .filter(Boolean)
      .forEach((loc) => normalizedLocationIds.add(String(loc)));

    if (sessionInfo.saved_move_id) {
      const multiLocationRows = await knex('move_locations')
        .select('location_id')
        .where('move_id', sessionInfo.saved_move_id);
      multiLocationRows.forEach((row) => {
        if (row.location_id) normalizedLocationIds.add(String(row.location_id));
      });
    }

    if (normalizedLocationIds.size > 0) {
      const activeSessions = await knex('move_sessions as ms')
        .leftJoin('saved_moves as sm', 'ms.saved_move_id', 'sm.id')
        .leftJoin('move_locations as ml', 'ml.move_id', 'sm.id')
        .select(
          'ms.id',
          'ms.session_start_location_id',
          'ms.session_end_location_id',
          'ms.origin_location_id as session_origin_location_id',
          'ms.destination_location_id as session_destination_location_id',
          'sm.origin_location_id',
          'sm.destination_location_id',
          'sm.name as move_name',
          'ml.location_id as multi_location_id'
        )
        .where('ms.user_id', userId)
        .where('ms.status', 'in_progress')
        .whereNot('ms.id', sessionId);

      const conflictSession = activeSessions.find((s) => {
        const otherLocations = [
          s.origin_location_id,
          s.destination_location_id,
          s.session_start_location_id,
          s.session_end_location_id,
          s.session_origin_location_id,
          s.session_destination_location_id,
          s.multi_location_id,
        ]
          .filter(Boolean)
          .map((loc) => String(loc));
        return otherLocations.some((loc) => normalizedLocationIds.has(loc));
      });

      if (conflictSession) {
        const err = serviceError(
          `Location already active under move "${conflictSession.move_name || conflictSession.id}". Finish that move before starting another.`,
          409
        );
        err.conflict_move_id = conflictSession.id;
        throw err;
      }
    }
  }

  const result = await knex.raw(`
    UPDATE move_sessions
     SET status = ?,
         stage = CASE
           WHEN ? = 'complete' THEN 'complete'
           WHEN ? = 'in_progress' THEN 'action'
           WHEN ? = 'not_started' THEN 'planning'
           ELSE stage
         END,
         completed_destination_location_id = CASE
           WHEN ? = 'complete' THEN COALESCE(session_end_location_id, completed_destination_location_id)
           ELSE completed_destination_location_id
         END,
         updated_at = NOW(),
         start_time = CASE WHEN ? = 'in_progress' AND start_time IS NULL THEN NOW() ELSE start_time END,
         end_time = CASE WHEN ? = 'complete' THEN NOW() ELSE end_time END
     WHERE id = ? AND user_id = ?
     RETURNING *
  `, [status, status, status, status, status, status, status, sessionId, userId]);

  if (result.rows.length === 0) throw serviceError('Move session not found', 404);

  await knex.raw(`
    INSERT INTO move_timeline (move_session_id, event_type, description, created_by, event_data)
     VALUES (?, 'status_changed', ?, ?, ?)
  `, [sessionId, `Status changed to ${status}`, userId, JSON.stringify({ new_status: status })]);

  return result.rows[0];
}

async function updateSessionTruck(userId, sessionId, { truck_size, truck_identifier }) {
  if (!truck_size) throw serviceError('Truck size is required', 400);

  const sessionResult = await knex.raw(`
    SELECT session_name, truck_location_id, saved_move_id
    FROM move_sessions WHERE id = ? AND user_id = ?
  `, [sessionId, userId]);

  if (sessionResult.rows.length === 0) throw serviceError('Move session not found', 404);

  let truckLocationId = sessionResult.rows[0].truck_location_id;
  let zoneInfo;

  if (!truckLocationId) {
    zoneInfo = await createTruckLocationStructure(userId, sessionResult.rows[0].session_name, truck_size, {
      truckIdentifier: truck_identifier,
      savedMoveId: sessionResult.rows[0].saved_move_id,
    });
    truckLocationId = zoneInfo.locationId;
  } else {
    zoneInfo = await ensureTruckZoneInventory(userId, truckLocationId, truck_size);
  }

  const num_zones = zoneInfo?.zoneCount || resolveTruckZoneCount(truck_size);

  const result = await knex.raw(`
    UPDATE move_sessions
     SET truck_size = ?, num_zones = ?, truck_location_id = ?, updated_at = NOW()
     WHERE id = ? AND user_id = ?
     RETURNING *
  `, [truck_size, num_zones, truckLocationId, sessionId, userId]);

  if (result.rows.length === 0) throw serviceError('Move session not found', 404);
  return result.rows[0];
}

async function assignZones(userId, sessionId) {
  const sessionResult = await knex.raw(`
    SELECT * FROM move_sessions WHERE id = ? AND user_id = ?
  `, [sessionId, userId]);

  if (sessionResult.rows.length === 0) throw serviceError('Move session not found', 404);

  const session = sessionResult.rows[0];
  if (session.stage !== 'planning') throw serviceError('Loading zones can only be reassigned during the Planning stage', 400);

  const numZones = session.num_zones || 3;
  const startLocationId = session.session_start_location_id || session.origin_location_id;

  await knex.raw(`
    INSERT INTO container_zones (move_session_id, container_id, loading_zone, load_priority)
    SELECT
      ? as move_session_id,
      c.id as container_id,
      CASE
        WHEN c.weight_lbs > 50 THEN 1
        WHEN c.weight_lbs > 20 THEN LEAST(2, ?)
        ELSE ?
      END as loading_zone,
      ROW_NUMBER() OVER (PARTITION BY
        CASE
          WHEN c.weight_lbs > 50 THEN 1
          WHEN c.weight_lbs > 20 THEN LEAST(2, ?)
          ELSE ?
        END
        ORDER BY c.weight_lbs DESC) as load_priority
    FROM containers c
    INNER JOIN collections col ON c.collection_id = col.id
    WHERE c.user_id = ? AND col.location_id = ?
    ON CONFLICT (move_session_id, container_id)
    DO UPDATE SET loading_zone = EXCLUDED.loading_zone, load_priority = EXCLUDED.load_priority, updated_at = NOW()
  `, [sessionId, numZones, numZones, numZones, numZones, userId, startLocationId]);

  await knex.raw(`
    INSERT INTO item_zones (move_session_id, item_id, loading_zone, load_priority)
    SELECT
      ? as move_session_id,
      i.id as item_id,
      CASE
        WHEN i.weight_lbs > 50 THEN 1
        WHEN i.fragile = true OR i.weight_lbs < 10 THEN ?
        ELSE LEAST(2, ?)
      END as loading_zone,
      ROW_NUMBER() OVER (PARTITION BY
        CASE
          WHEN i.weight_lbs > 50 THEN 1
          WHEN i.fragile = true OR i.weight_lbs < 10 THEN ?
          ELSE LEAST(2, ?)
        END
        ORDER BY i.weight_lbs DESC) as load_priority
    FROM items i
    INNER JOIN collections col ON i.collection_id = col.id
    WHERE i.user_id = ? AND i.container_id IS NULL AND col.location_id = ?
    ON CONFLICT (move_session_id, item_id)
    DO UPDATE SET loading_zone = EXCLUDED.loading_zone, load_priority = EXCLUDED.load_priority, updated_at = NOW()
  `, [sessionId, numZones, numZones, numZones, numZones, userId, startLocationId]);

  return { num_zones: numZones };
}

async function getLoadingPlan(userId, sessionId) {
  const sessionCheck = await knex.raw(`
    SELECT id, truck_size, num_zones, origin_location_id, session_start_location_id
    FROM move_sessions WHERE id = ? AND user_id = ?
  `, [sessionId, userId]);

  if (sessionCheck.rows.length === 0) throw serviceError('Move session not found', 404);

  const session = sessionCheck.rows[0];
  const startLocationId = session.session_start_location_id || session.origin_location_id;

  const [containers, items] = await Promise.all([
    knex.raw(`
      SELECT c.id, c.name as container_name, c.box_number, c.weight_lbs,
             cz.loading_zone, cz.load_priority
      FROM containers c
      INNER JOIN collections col ON c.collection_id = col.id
      LEFT JOIN (
        SELECT container_id, loading_zone, load_priority
        FROM container_zones WHERE move_session_id = ?
      ) cz ON c.id = cz.container_id
      WHERE c.user_id = ? AND col.location_id = ?
      ORDER BY cz.loading_zone ASC NULLS FIRST, c.weight_lbs DESC
    `, [sessionId, userId, startLocationId]),
    knex.raw(`
      SELECT i.id, i.name as item_name, i.weight_lbs, i.fragile,
             iz.loading_zone, iz.load_priority
      FROM items i
      INNER JOIN collections col ON i.collection_id = col.id
      LEFT JOIN (
        SELECT item_id, loading_zone, load_priority
        FROM item_zones WHERE move_session_id = ?
      ) iz ON i.id = iz.item_id
      WHERE i.user_id = ? AND i.container_id IS NULL AND col.location_id = ?
      ORDER BY iz.loading_zone ASC NULLS FIRST, i.weight_lbs DESC
    `, [sessionId, userId, startLocationId]),
  ]);

  return {
    truck_size: session.truck_size,
    num_zones: session.num_zones,
    containers: containers.rows,
    loose_items: items.rows,
  };
}

async function updateContainerZone(userId, sessionId, containerId, loadingZone) {
  const sessionCheck = await knex.raw(`SELECT id FROM move_sessions WHERE id = ? AND user_id = ?`, [sessionId, userId]);
  if (sessionCheck.rows.length === 0) throw serviceError('Move session not found', 404);

  const containerCheck = await knex.raw(`SELECT id FROM containers WHERE id = ? AND user_id = ?`, [containerId, userId]);
  if (containerCheck.rows.length === 0) throw serviceError('Container not found', 404);

  if (loadingZone === null) {
    await knex.raw(`DELETE FROM container_zones WHERE move_session_id = ? AND container_id = ?`, [sessionId, containerId]);
    return { message: 'Zone assignment removed' };
  }

  const result = await knex.raw(`
    INSERT INTO container_zones (move_session_id, container_id, loading_zone)
    VALUES (?, ?, ?)
    ON CONFLICT (move_session_id, container_id)
    DO UPDATE SET loading_zone = ?, updated_at = NOW()
    RETURNING *
  `, [sessionId, containerId, loadingZone, loadingZone]);
  return result.rows[0];
}

async function updateItemZone(userId, sessionId, itemId, loadingZone) {
  const sessionCheck = await knex.raw(`SELECT id FROM move_sessions WHERE id = ? AND user_id = ?`, [sessionId, userId]);
  if (sessionCheck.rows.length === 0) throw serviceError('Move session not found', 404);

  const itemCheck = await knex.raw(`SELECT id FROM items WHERE id = ? AND user_id = ?`, [itemId, userId]);
  if (itemCheck.rows.length === 0) throw serviceError('Item not found', 404);

  if (loadingZone === null) {
    await knex.raw(`DELETE FROM item_zones WHERE move_session_id = ? AND item_id = ?`, [sessionId, itemId]);
    return { message: 'Zone assignment removed' };
  }

  const result = await knex.raw(`
    INSERT INTO item_zones (move_session_id, item_id, loading_zone)
    VALUES (?, ?, ?)
    ON CONFLICT (move_session_id, item_id)
    DO UPDATE SET loading_zone = ?, updated_at = NOW()
    RETURNING *
  `, [sessionId, itemId, loadingZone, loadingZone]);
  return result.rows[0];
}

async function getProgress(userId, sessionId) {
  const sessionCheck = await knex.raw(`SELECT id FROM move_sessions WHERE id = ? AND user_id = ?`, [sessionId, userId]);
  if (sessionCheck.rows.length === 0) throw serviceError('Move session not found', 404);

  const [stats, totalContainers] = await Promise.all([
    knex.raw(`
      SELECT
        (SELECT COUNT(DISTINCT bs.container_id) FROM box_scans bs WHERE bs.move_session_id = ? AND bs.scan_type = 'loaded') as boxes_loaded,
        (SELECT COUNT(DISTINCT bs.container_id) FROM box_scans bs WHERE bs.move_session_id = ? AND bs.scan_type = 'unloaded') as boxes_unloaded,
        (SELECT COUNT(DISTINCT bs.container_id) FROM box_scans bs WHERE bs.move_session_id = ? AND bs.scan_type = 'unpacked') as boxes_unpacked,
        (SELECT COUNT(*) FROM damage_reports WHERE move_session_id = ?) as damage_reports_count,
        (SELECT COUNT(*) FROM move_crew WHERE move_session_id = ?) as crew_count
    `, [sessionId, sessionId, sessionId, sessionId, sessionId]),
    knex.raw(`
      SELECT COUNT(DISTINCT c.id) as total
       FROM containers c
       JOIN move_sessions ms ON ms.id = ?
       WHERE c.user_id = ms.user_id
    `, [sessionId]),
  ]);

  return {
    ...stats.rows[0],
    total_containers: parseInt(totalContainers.rows[0].total),
  };
}

async function deleteSession(userId, sessionId) {
  const sessionCheck = await knex.raw(`SELECT id FROM move_sessions WHERE id = ? AND user_id = ?`, [sessionId, userId]);
  if (sessionCheck.rows.length === 0) throw serviceError('Move session not found', 404);

  await knex.raw(`DELETE FROM move_sessions WHERE id = ? AND user_id = ?`, [sessionId, userId]);
  return { message: 'Move session deleted successfully' };
}

// ---------------------------------------------------------------------------
// Scans
// ---------------------------------------------------------------------------

async function recordContainerScan(userId, isAdmin, body) {
  const { move_session_id, container_id, qr_token, scan_type, scanned_by, location_type, destination_room, notes } = body;

  if (!move_session_id || (!container_id && !qr_token) || !scan_type) {
    throw serviceError('Move session, QR token or container, and scan type are required', 400);
  }

  const validScanTypes = ['loaded', 'unloaded', 'arrived_at_room', 'unpacked'];
  if (!validScanTypes.includes(scan_type)) throw serviceError('Invalid scan type', 400);

  const sessionRecord = await knex('move_sessions').select('stage', 'user_id').where({ id: move_session_id }).first();
  if (!sessionRecord) throw serviceError('Move session not found', 404);
  if (!isAdmin && sessionRecord.user_id !== userId) throw serviceError('Not authorized to modify this session', 403);
  if (sessionRecord.stage === 'planning') throw serviceError('Switch this session to Action stage before scanning items', 400);

  let resolvedContainerId = container_id;
  let containerRecord = null;

  if (!resolvedContainerId && qr_token) {
    const normalizedToken = extractQrToken(qr_token);
    containerRecord = await knex('containers').select('id', 'user_id', 'name', 'box_number', 'qr_code').where({ qr_code: normalizedToken }).first();
    if (!containerRecord) throw serviceError('QR code not recognized', 404);
    resolvedContainerId = containerRecord.id;
  }

  if (resolvedContainerId && !containerRecord) {
    containerRecord = await knex('containers').select('id', 'user_id', 'name', 'box_number', 'qr_code').where({ id: resolvedContainerId }).first();
  }

  if (!resolvedContainerId || !containerRecord) throw serviceError('Unable to resolve container', 400);
  if (!isAdmin && containerRecord.user_id !== sessionRecord.user_id) throw serviceError('Container does not belong to this move owner', 403);

  if (scan_type !== 'loaded') {
    const priorLoadedScan = await knex('box_scans').where({ move_session_id, container_id: resolvedContainerId, scan_type: 'loaded' }).first();
    if (!priorLoadedScan) throw serviceError('Load this container into the truck before recording this scan', 400);
  }

  const scanResult = await knex.raw(`
    INSERT INTO box_scans (move_session_id, container_id, scan_type, scanned_by, location_type, destination_room, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     RETURNING *
  `, [move_session_id, resolvedContainerId, scan_type, scanned_by || null, location_type || null, destination_room || null, notes || null]);

  const containerName = containerRecord.name || `Box #${containerRecord.box_number || resolvedContainerId}`;

  await knex.raw(`
    INSERT INTO move_timeline (move_session_id, event_type, description, created_by, event_data)
     VALUES (?, ?, ?, ?, ?)
  `, [
    move_session_id,
    `box_${scan_type}`,
    `${containerName} ${scan_type}`,
    scanned_by || 'system',
    JSON.stringify({ container_id: resolvedContainerId, scan_type, location_type, qr_token: containerRecord.qr_code || qr_token || null }),
  ]);

  return scanResult.rows[0];
}

async function getContainerScans(containerId, moveSessionId) {
  if (moveSessionId) {
    const result = await knex.raw(`
      SELECT bs.*, c.name as container_name, c.box_number
      FROM box_scans bs
      JOIN containers c ON bs.container_id = c.id
      WHERE bs.container_id = ? AND bs.move_session_id = ?
      ORDER BY bs.scanned_at DESC
    `, [containerId, moveSessionId]);
    return result.rows;
  }
  const result = await knex.raw(`
    SELECT bs.*, c.name as container_name, c.box_number
    FROM box_scans bs
    JOIN containers c ON bs.container_id = c.id
    WHERE bs.container_id = ?
    ORDER BY bs.scanned_at DESC
  `, [containerId]);
  return result.rows;
}

async function recordItemScan(userId, isAdmin, body) {
  const { move_session_id, item_id, qr_token, scan_type, scanned_by, location_type, destination_room, notes } = body;

  if (!move_session_id || (!item_id && !qr_token) || !scan_type) {
    throw serviceError('Move session, QR token or item, and scan type are required', 400);
  }

  const validScanTypes = ['loaded', 'unloaded', 'arrived_at_room', 'unpacked'];
  if (!validScanTypes.includes(scan_type)) throw serviceError('Invalid scan type', 400);

  const sessionRecord = await knex('move_sessions').select('stage', 'user_id').where({ id: move_session_id }).first();
  if (!sessionRecord) throw serviceError('Move session not found', 404);
  if (!isAdmin && sessionRecord.user_id !== userId) throw serviceError('Not authorized to modify this session', 403);
  if (sessionRecord.stage === 'planning') throw serviceError('Switch this session to Action stage before scanning items', 400);

  let resolvedItemId = item_id;
  let itemRecord = null;

  if (!resolvedItemId && qr_token) {
    const normalizedToken = extractQrToken(qr_token);
    itemRecord = await knex('items').select('id', 'name', 'container_id', 'user_id', 'qr_code').where({ qr_code: normalizedToken }).first();
    if (!itemRecord) throw serviceError('QR code not recognized', 404);
    resolvedItemId = itemRecord.id;
  }

  if (resolvedItemId && !itemRecord) {
    const itemCheck = await knex.raw(`SELECT i.id, i.name, i.container_id, i.user_id, i.qr_code FROM items i WHERE i.id = ?`, [resolvedItemId]);
    if (itemCheck.rows.length === 0) throw serviceError('Item not found', 404);
    itemRecord = itemCheck.rows[0];
  }

  if (!itemRecord) throw serviceError('Item not found', 404);
  if (!isAdmin && itemRecord.user_id !== sessionRecord.user_id) throw serviceError('Item does not belong to this move owner', 403);

  if (itemRecord.container_id) {
    const err = serviceError('Cannot scan item that is in a container. Please scan the container instead.', 400);
    err.container_id = itemRecord.container_id;
    throw err;
  }

  if (scan_type !== 'loaded') {
    const priorItemLoad = await knex('item_scans').where({ move_session_id, item_id: resolvedItemId, scan_type: 'loaded' }).first();
    if (!priorItemLoad) throw serviceError('Load this item into the truck before recording this scan', 400);
  }

  const scanResult = await knex.raw(`
    INSERT INTO item_scans (move_session_id, item_id, scan_type, scanned_by, location_type, destination_room, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     RETURNING *
  `, [move_session_id, resolvedItemId, scan_type, scanned_by || null, location_type || null, destination_room || null, notes || null]);

  await knex.raw(`
    INSERT INTO move_timeline (move_session_id, event_type, description, created_by, event_data)
     VALUES (?, ?, ?, ?, ?)
  `, [
    move_session_id,
    `item_${scan_type}`,
    `${itemRecord.name} ${scan_type}`,
    scanned_by || 'system',
    JSON.stringify({ item_id: resolvedItemId, scan_type, location_type, qr_token: itemRecord.qr_code || qr_token || null }),
  ]);

  return scanResult.rows[0];
}

// ---------------------------------------------------------------------------
// Damage + Crew
// ---------------------------------------------------------------------------

async function reportDamage(body) {
  const { move_session_id, container_id, item_id, severity, description, photo_urls, reported_by } = body;

  if (!move_session_id || !severity || !description || !reported_by) {
    throw serviceError('Move session, severity, description, and reporter are required', 400);
  }

  const validSeverities = ['minor', 'moderate', 'severe'];
  if (!validSeverities.includes(severity)) throw serviceError('Invalid severity level', 400);

  const result = await knex.raw(`
    INSERT INTO damage_reports (move_session_id, container_id, item_id, severity, description, photo_urls, reported_by)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     RETURNING *
  `, [move_session_id, container_id || null, item_id || null, severity, description, JSON.stringify(photo_urls || []), reported_by]);

  await knex.raw(`
    INSERT INTO move_timeline (move_session_id, event_type, description, created_by, event_data)
     VALUES (?, 'damage_reported', ?, ?, ?)
  `, [
    move_session_id,
    `${severity} damage reported: ${description.substring(0, 50)}...`,
    reported_by,
    JSON.stringify({ damage_report_id: result.rows[0].id, severity }),
  ]);

  return result.rows[0];
}

async function addCrewMember(body) {
  const { move_session_id, name, role, phone, email, notes } = body;
  if (!move_session_id || !name) throw serviceError('Move session and name are required', 400);

  const result = await knex.raw(`
    INSERT INTO move_crew (move_session_id, name, role, phone, email, notes)
     VALUES (?, ?, ?, ?, ?, ?)
     RETURNING *
  `, [move_session_id, name, role || null, phone || null, email || null, notes || null]);

  return result.rows[0];
}

async function deleteCrewMember(crewId) {
  const result = await knex.raw(`DELETE FROM move_crew WHERE id = ? RETURNING *`, [crewId]);
  if (result.rows.length === 0) throw serviceError('Crew member not found', 404);
  return { message: 'Crew member deleted successfully' };
}

// ---------------------------------------------------------------------------
// Schedule generation
// ---------------------------------------------------------------------------

async function generateScheduleFromRoute(userId, body) {
  const correlationId = `gen-schedule-${Date.now()}`;
  const { savedMoveId, clearExisting = true, anchorType = 'move-out', anchorDate } = body;

  if (!userId || !savedMoveId) throw serviceError('User ID and saved move ID are required', 400);
  if (!anchorDate) throw serviceError('Anchor date is required', 400);
  if (anchorType !== 'move-out' && anchorType !== 'move-in') {
    throw serviceError('Anchor type must be "move-out" or "move-in"', 400);
  }

  const move = await knex('saved_moves').where('id', savedMoveId).andWhere('user_id', userId).first();
  if (!move) throw serviceError('Saved move not found', 404);

  const routeData = move.route_data
    ? (typeof move.route_data === 'string' ? JSON.parse(move.route_data) : move.route_data)
    : null;
  if (!routeData) throw serviceError('Move does not have route data. Please calculate route first.', 400);

  const waypoints = await knex('move_waypoints').where('saved_move_id', savedMoveId).orderBy('sequence_order', 'asc');
  if (waypoints.length === 0) throw serviceError('No waypoints found. Please add waypoints and calculate route first.', 400);

  const hasCalculatedDistances = waypoints.every(w => w.distance_source === 'calculated');
  if (!hasCalculatedDistances) throw serviceError('Route not calculated. Please click "Calculate Route" first.', 400);

  if (clearExisting) {
    await knex('move_sessions').where('saved_move_id', savedMoveId).andWhere('user_id', userId).del();
    console.log(`[MoveCoordination] ${correlationId}: Cleared existing sessions`);
  }

  const createdSessions = [];
  const originLabel = formatCityStateLabel(routeData.origin_address || routeData.origin_city || 'Origin');
  const destinationLabel = formatCityStateLabel(routeData.destination_address || routeData.destination_city || 'Destination');

  const segments = [];

  segments.push({
    start: { type: 'origin', name: originLabel },
    end: {
      type: 'waypoint',
      id: waypoints[0].id,
      name: `${waypoints[0].city}${waypoints[0].state ? ', ' + waypoints[0].state : ''}`,
      isDropoff: waypoints[0].is_dropoff || false,
      location_id: waypoints[0].location_id || null,
    },
    distance: waypoints[0].segment_distance_miles,
    duration: waypoints[0].segment_duration_hours,
    overnight: waypoints[0].overnight_recommended,
  });

  for (let i = 1; i < waypoints.length; i++) {
    segments.push({
      start: {
        type: 'waypoint',
        id: waypoints[i - 1].id,
        name: `${waypoints[i - 1].city}${waypoints[i - 1].state ? ', ' + waypoints[i - 1].state : ''}`,
        isDropoff: waypoints[i - 1].is_dropoff || false,
        location_id: waypoints[i - 1].location_id || null,
      },
      end: {
        type: 'waypoint',
        id: waypoints[i].id,
        name: `${waypoints[i].city}${waypoints[i].state ? ', ' + waypoints[i].state : ''}`,
        isDropoff: waypoints[i].is_dropoff || false,
        location_id: waypoints[i].location_id || null,
      },
      distance: waypoints[i].segment_distance_miles,
      duration: waypoints[i].segment_duration_hours,
      overnight: waypoints[i].overnight_recommended,
    });
  }

  const finalLegDistance = routeData.finalLegDistanceMiles
    || routeData.total_distance_miles - waypoints[waypoints.length - 1].distance_from_origin_miles;
  const finalLegDuration = routeData.finalLegDurationHours || (finalLegDistance / 60);

  segments.push({
    start: {
      type: 'waypoint',
      id: waypoints[waypoints.length - 1].id,
      name: `${waypoints[waypoints.length - 1].city}${waypoints[waypoints.length - 1].state ? ', ' + waypoints[waypoints.length - 1].state : ''}`,
      isDropoff: waypoints[waypoints.length - 1].is_dropoff || false,
      location_id: waypoints[waypoints.length - 1].location_id || null,
    },
    end: { type: 'destination', name: destinationLabel },
    distance: finalLegDistance,
    duration: finalLegDuration,
    overnight: false,
  });

  let sessionDates = [];

  if (anchorType === 'move-out') {
    const loadingDate = new Date(anchorDate);
    loadingDate.setHours(0, 0, 0, 0);
    let currentDate = new Date(loadingDate);
    sessionDates.push({ type: 'loading', date: new Date(currentDate) });

    for (let i = 0; i < segments.length; i++) {
      currentDate.setDate(currentDate.getDate() + 1);
      sessionDates.push({ type: 'driving', date: new Date(currentDate), segmentIndex: i });
      if (segments[i].overnight && i < segments.length - 1) {
        currentDate.setDate(currentDate.getDate() + 1);
      }
    }

    currentDate.setDate(currentDate.getDate() + 1);
    sessionDates.push({ type: 'unloading', date: new Date(currentDate) });
  } else {
    const unloadingDate = new Date(anchorDate);
    unloadingDate.setHours(0, 0, 0, 0);
    let currentDate = new Date(unloadingDate);
    sessionDates.unshift({ type: 'unloading', date: new Date(currentDate) });

    for (let i = segments.length - 1; i >= 0; i--) {
      currentDate.setDate(currentDate.getDate() - 1);
      sessionDates.unshift({ type: 'driving', date: new Date(currentDate), segmentIndex: i });
      if (segments[i].overnight && i > 0) {
        currentDate.setDate(currentDate.getDate() - 1);
      }
    }

    currentDate.setDate(currentDate.getDate() - 1);
    sessionDates.unshift({ type: 'loading', date: new Date(currentDate) });
  }

  console.log(`[MoveCoordination] ${correlationId}: Creating ${sessionDates.length} sessions`);

  for (const sessionDate of sessionDates) {
    const dateStr = sessionDate.date.toISOString().split('T')[0];

    if (sessionDate.type === 'loading') {
      const s = await knex('move_sessions')
        .insert({
          user_id: userId, saved_move_id: savedMoveId, session_type: 'loading',
          session_name: 'Load at Origin', session_date: dateStr, move_date: dateStr,
          status: 'pending', notes: `Loading session at ${originLabel || 'origin'}`,
          created_at: knex.fn.now(), updated_at: knex.fn.now(),
        })
        .returning('*');
      createdSessions.push(s[0]);

    } else if (sessionDate.type === 'driving') {
      const segment = segments[sessionDate.segmentIndex];
      const s = await knex('move_sessions')
        .insert({
          user_id: userId, saved_move_id: savedMoveId, session_type: 'driving',
          session_name: `${segment.start.name} → ${segment.end.name}`,
          session_date: dateStr, move_date: dateStr, status: 'pending',
          start_waypoint_id: segment.start.type === 'waypoint' ? segment.start.id : null,
          end_waypoint_id: segment.end.type === 'waypoint' ? segment.end.id : null,
          notes: `${Math.round(segment.distance)} miles, ~${Math.round(segment.duration * 10) / 10} hours`,
          created_at: knex.fn.now(), updated_at: knex.fn.now(),
        })
        .returning('*');
      createdSessions.push(s[0]);

      if (segment.end.type === 'waypoint' && segment.end.isDropoff) {
        const u = await knex('move_sessions')
          .insert({
            user_id: userId, saved_move_id: savedMoveId, session_type: 'unloading',
            session_name: `Unload at ${segment.end.name}`,
            session_date: dateStr, move_date: dateStr, status: 'pending',
            session_start_location_id: segment.end.location_id || null,
            session_end_location_id: segment.end.location_id || null,
            notes: `Unloading session at ${segment.end.name}`,
            created_at: knex.fn.now(), updated_at: knex.fn.now(),
          })
          .returning('*');
        createdSessions.push(u[0]);
      }

    } else if (sessionDate.type === 'unloading') {
      const s = await knex('move_sessions')
        .insert({
          user_id: userId, saved_move_id: savedMoveId, session_type: 'unloading',
          session_name: 'Unload at Destination', session_date: dateStr, move_date: dateStr,
          status: 'pending', notes: `Unloading session at ${destinationLabel || 'destination'}`,
          created_at: knex.fn.now(), updated_at: knex.fn.now(),
        })
        .returning('*');
      createdSessions.push(s[0]);
    }
  }

  console.log(`[MoveCoordination] ${correlationId}: Created ${createdSessions.length} sessions`);

  return {
    success: true,
    sessions: createdSessions,
    summary: {
      total_sessions: createdSessions.length,
      loading_sessions: createdSessions.filter(s => s.session_type === 'loading').length,
      driving_sessions: createdSessions.filter(s => s.session_type === 'driving').length,
      unloading_sessions: createdSessions.filter(s => s.session_type === 'unloading').length,
      start_date: createdSessions[0].session_date,
      end_date: createdSessions[createdSessions.length - 1].session_date,
      duration_days: Math.ceil(
        (new Date(createdSessions[createdSessions.length - 1].session_date) - new Date(createdSessions[0].session_date))
        / (1000 * 60 * 60 * 24)
      ) + 1,
    },
  };
}

module.exports = {
  getSessions,
  getSession,
  createSession,
  updateSessionDate,
  updateSessionStatus,
  updateSessionTruck,
  assignZones,
  getLoadingPlan,
  updateContainerZone,
  updateItemZone,
  getProgress,
  deleteSession,
  recordContainerScan,
  getContainerScans,
  recordItemScan,
  reportDamage,
  addCrewMember,
  deleteCrewMember,
  generateScheduleFromRoute,
};
