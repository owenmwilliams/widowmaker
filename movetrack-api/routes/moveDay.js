const express = require('express');
const router = express.Router();
const { authenticate, requireProOrAdmin } = require('../bin/authService');
const { extractQrToken } = require('../services/qrService');

// Database connection using knex
const knex = require('knex')({
  client: 'pg',
  connection: {
    host: process.env.MT_DATALAYER_HOSTNAME,
    port: process.env.MT_DATALAYER_PORT,
    user: process.env.MT_DATALAYER_USERNAME,
    password: process.env.MT_DATALAYER_PASSWORD,
    database: process.env.MT_DATALAYER_DATABASE
  }
});

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
  '26ft': 5
};

const resolveTruckZoneCount = (truckSize = '') => {
  if (!truckSize) return 3;
  return TRUCK_ZONE_COUNT_MAP[truckSize] || 3;
};

const buildTruckLocationName = (truckSize, sessionName, truckIdentifier, truckSequence) => {
  // If user provided a custom truck identifier, use it
  if (truckIdentifier) {
    return truckIdentifier;
  }
  // Otherwise, use sequential naming like "Truck 1", "Truck 2"
  if (truckSequence) {
    const sizeLabel = truckSize ? ` (${truckSize})` : '';
    return `Truck ${truckSequence}${sizeLabel}`;
  }
  // Fallback to old behavior
  const sizeLabel = truckSize ? `${truckSize.toUpperCase()} ` : '';
  const suffix = sessionName ? ` - ${sessionName}` : '';
  return `${sizeLabel}Truck Staging${suffix}`;
};

async function createTruckLocationStructure(userId, sessionName, truckSizeHint, options = {}) {
  const { truckIdentifier, savedMoveId } = options;
  const zoneCount = resolveTruckZoneCount(truckSizeHint);

  // Get next truck sequence number for this move
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
  const description = 'Auto-generated truck staging area for Move Day';

  const locationResult = await knex.raw(`
    INSERT INTO locations (user_id, name, location_type, description, truck_identifier, truck_sequence, truck_size, created_at, updated_at)
    VALUES (?, ?, 'truck', ?, ?, ?, ?, NOW(), NOW())
    RETURNING id, truck_identifier, truck_sequence, truck_size
  `, [userId, locationName, description, truckIdentifier || null, truckSequence, truckSizeHint || null]);

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
  if (!locationId) {
    return { zones: [], zoneCount: 0 };
  }

  const desiredCount = resolveTruckZoneCount(truckSizeHint);
  const existing = await knex.raw(`
    SELECT id, name
    FROM collections
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

const resolveZoneCollectionId = (zones, index = 0) => {
  if (!zones || zones.length === 0) return null;
  const safeIndex = Number.isInteger(index) ? index : 0;
  const boundedIndex = Math.min(Math.max(safeIndex, 0), zones.length - 1);
  return zones[boundedIndex]?.id || null;
};

const normalizeDateOnly = (value) => {
  if (!value) return null;

  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const date = new Date(`${value}T00:00:00Z`);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
};

// Require auth + pro/admin for all routes here
router.use(authenticate, requireProOrAdmin);

// Get all move sessions for a user
router.get('/sessions', async (req, res) => {
  const userId = req.user?.user_id;

  if (!userId) {
    return res.status(400).json({ error: 'User not authenticated' });
  }

  try {
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

    console.log('Query returned rows:', result.rows.length);
    console.log('First row:', result.rows[0]);

    // Prevent caching
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');

    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching move sessions:', error);
    res.status(500).json({ error: 'Failed to fetch move sessions' });
  }
});

// Get a specific move session with details
router.get('/sessions/:id', async (req, res) => {
  const { id } = req.params;
  const userId = req.user?.user_id;

  if (!userId) {
    return res.status(400).json({ error: 'User parameter is required' });
  }

  try {
    // Get session details
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
    `, [id, userId]);

    if (sessionResult.rows.length === 0) {
      return res.status(404).json({ error: 'Move session not found' });
    }

    // Get box scans
    const scansResult = await knex.raw(`
      SELECT bs.*, c.name as container_name, c.box_number, c.box_type, c.color_code
       FROM box_scans bs
       JOIN containers c ON bs.container_id = c.id
       WHERE bs.move_session_id = ?
       ORDER BY bs.scanned_at DESC
    `, [id]);

    // Get timeline events
    const timelineResult = await knex.raw(`
      SELECT * FROM move_timeline
       WHERE move_session_id = ?
       ORDER BY created_at DESC
    `, [id]);

    // Get damage reports
    const damageResult = await knex.raw(`
      SELECT dr.*,
              c.name as container_name,
              i.name as item_name
       FROM damage_reports dr
       LEFT JOIN containers c ON dr.container_id = c.id
       LEFT JOIN items i ON dr.item_id = i.id
       WHERE dr.move_session_id = ?
       ORDER BY dr.reported_at DESC
    `, [id]);

    // Get crew
    const crewResult = await knex.raw(`
      SELECT * FROM move_crew
       WHERE move_session_id = ?
       ORDER BY created_at ASC
    `, [id]);

    let truckZones = [];
    if (sessionResult.rows[0].truck_location_id) {
      const zoneResult = await knex.raw(`
        SELECT id, name
        FROM collections
        WHERE user_id = ? AND location_id = ?
        ORDER BY id ASC
      `, [userId, sessionResult.rows[0].truck_location_id]);
      truckZones = zoneResult.rows;
    }

    res.json({
      session: sessionResult.rows[0],
      scans: scansResult.rows,
      timeline: timelineResult.rows,
      damage_reports: damageResult.rows,
      crew: crewResult.rows,
      truck_zones: truckZones
    });
  } catch (error) {
    console.error('Error fetching move session details:', error);
    res.status(500).json({ error: 'Failed to fetch move session details' });
  }
});

// Create a new move session (optionally from a saved move)
router.post('/sessions', async (req, res) => {
  const userId = req.user?.user_id;
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
    existing_truck_id,  // Allow selecting an existing truck instead of creating one
    // New: session type and waypoint support
    session_type,       // 'loading', 'driving', 'unloading', 'transfer'
    start_waypoint_id,  // For driving sessions
    end_waypoint_id     // For driving sessions
  } = req.body;

  console.log('[POST /sessions] Request body:', req.body);
  console.log('[POST /sessions] User context:', { userId });

  if (!userId) {
    console.log('[POST /sessions] ERROR: User context required');
    return res.status(400).json({ error: 'User context required' });
  }

  if (!saved_move_id) {
    console.log('[POST /sessions] ERROR: saved_move_id is required');
    return res.status(400).json({ error: 'saved_move_id is required' });
  }

  const savedMoveId = saved_move_id;
  const requestedOriginLocationId = origin_location_id || null;
  const requestedDestinationLocationId = destination_location_id || null;
  const requestedStartLocationId = start_location_id || null;
  const requestedStartCollectionId = start_collection_id || null;
  const requestedEndLocationId = end_location_id || null;
  const requestedEndCollectionId = end_collection_id || null;

  try {
    const move = await knex('saved_moves')
      .where({ id: savedMoveId, user_id: userId })
      .first();

    if (!move) {
      console.log('[POST /sessions] ERROR: Saved move not found');
      return res.status(404).json({ error: 'Saved move not found' });
    }

    console.log('[POST /sessions] Found move:', move);

    if (!session_date) {
      console.log('[POST /sessions] ERROR: Session date is required');
      return res.status(400).json({ error: 'Session date is required' });
    }

    const normalizedSessionDate = normalizeDateOnly(session_date);
    if (!normalizedSessionDate) {
      console.log('[POST /sessions] ERROR: Invalid session date');
      return res.status(400).json({ error: 'Invalid session date' });
    }

    const desiredStart = normalizeDateOnly(move.desired_start_date || move.move_date);
    const desiredEnd = normalizeDateOnly(move.desired_end_date || desiredStart);
    console.log('[POST /sessions] Date validation:', { normalizedSessionDate, desiredStart, desiredEnd });
    if (desiredStart && desiredEnd) {
      if (normalizedSessionDate < desiredStart || normalizedSessionDate > desiredEnd) {
        console.log('[POST /sessions] ERROR: Session date must be within the move window');
        return res.status(400).json({ error: 'Session date must be within the move window' });
      }
    }

    // Determine eligible start locations:
    // 1. Move's origin location
    // 2. Ending location of ANY other session (regardless of completion status)
    //    This allows users to plan all sessions in advance
    // Use string keys for consistent comparison (frontend may send strings, DB returns numbers/bigints)
    const allowedStartLocations = new Set();
    if (move.origin_location_id) {
      allowedStartLocations.add(String(move.origin_location_id));
    }

    // Get session_end_location_id from all sessions for this move
    const existingSessions = await knex('move_sessions')
      .where({ saved_move_id: savedMoveId })
      .andWhere('user_id', userId)
      .whereNotNull('session_end_location_id')
      .select('session_end_location_id');

    existingSessions.forEach(session => {
      if (session.session_end_location_id) {
        allowedStartLocations.add(String(session.session_end_location_id));
      }
    });

    const resolvedStartLocationId = requestedStartLocationId || move.origin_location_id;
    const normalizedStartLocationId = resolvedStartLocationId ? String(resolvedStartLocationId) : null;
    console.log('[POST /sessions] Start location validation:', {
      normalizedStartLocationId,
      allowedStartLocations: Array.from(allowedStartLocations),
      requestedStartLocationId,
      moveOriginLocationId: move.origin_location_id
    });
    if (!normalizedStartLocationId || !allowedStartLocations.has(normalizedStartLocationId)) {
      console.log('[POST /sessions] ERROR: Selected start location is not eligible for this move');
      return res.status(400).json({ error: 'Selected start location is not eligible for this move' });
    }

    const resolvedStartCollectionId = requestedStartCollectionId || null;
    const resolvedOriginOverride = requestedOriginLocationId || move.origin_location_id;
    const resolvedDestinationOverride = requestedDestinationLocationId || move.destination_location_id;

    let resolvedEndLocationId = null;
    let resolvedEndCollectionId = null;
    let truckLocationId = null;
    let resolvedTruckSize = truck_size_hint ? truck_size_hint.toLowerCase() : null;
    let zoneCount = null;
    const destinationMode = (end_mode || 'location').toLowerCase();

    if (destinationMode === 'truck') {
      // Check if using an existing truck or creating a new one
      if (existing_truck_id) {
        // Validate that the truck exists and belongs to this user
        const existingTruck = await knex('locations')
          .where({
            id: existing_truck_id,
            user_id: userId,
            location_type: 'truck'
          })
          .first();

        if (!existingTruck) {
          return res.status(400).json({ error: 'Selected truck not found or does not belong to you' });
        }

        // Get the truck's zones
        const truckZones = await knex('collections')
          .where({
            location_id: existing_truck_id,
            user_id: userId
          })
          .orderBy('name', 'asc');

        truckLocationId = existingTruck.id;
        zoneCount = truckZones.length;
        resolvedTruckSize = existingTruck.truck_size || null;
        resolvedEndLocationId = truckLocationId;
        resolvedEndCollectionId = resolveZoneCollectionId(truckZones, end_truck_zone_index);

        console.log('[POST /sessions] Using existing truck:', {
          truckId: truckLocationId,
          truckName: existingTruck.name,
          zoneCount
        });
      } else {
        // Create a new truck
        const truckStructure = await createTruckLocationStructure(userId, session_name, resolvedTruckSize, {
          truckIdentifier: truck_identifier,
          savedMoveId
        });
        truckLocationId = truckStructure.locationId;
        zoneCount = truckStructure.zoneCount;
        resolvedTruckSize = resolvedTruckSize || null;
        resolvedEndLocationId = truckLocationId;
        resolvedEndCollectionId = resolveZoneCollectionId(truckStructure.zones, end_truck_zone_index);
      }
    } else {
      resolvedEndLocationId = requestedEndLocationId || resolvedDestinationOverride;
      resolvedEndCollectionId = requestedEndCollectionId || null;
    }

    if (!resolvedEndLocationId) {
      return res.status(400).json({ error: 'Destination location is required' });
    }

    // Validate session_type if provided
    const validSessionTypes = ['loading', 'driving', 'unloading', 'transfer'];
    const resolvedSessionType = session_type && validSessionTypes.includes(session_type)
      ? session_type
      : 'loading';  // Default to loading for backwards compatibility

    // For driving sessions, validate waypoints
    if (resolvedSessionType === 'driving') {
      if (!start_waypoint_id || !end_waypoint_id) {
        return res.status(400).json({
          error: 'Driving sessions require both start_waypoint_id and end_waypoint_id'
        });
      }
      // Verify waypoints exist and belong to this move/user
      const startWaypoint = await knex('move_waypoints')
        .where({ id: start_waypoint_id, saved_move_id: savedMoveId, user_id: userId })
        .first();
      const endWaypoint = await knex('move_waypoints')
        .where({ id: end_waypoint_id, saved_move_id: savedMoveId, user_id: userId })
        .first();

      if (!startWaypoint || !endWaypoint) {
        return res.status(400).json({ error: 'Invalid waypoint(s) specified' });
      }
    }

    const insertData = {
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
      session_start_collection_id: resolvedStartCollectionId,
      session_end_location_id: resolvedEndLocationId || null,
      session_end_collection_id: resolvedEndCollectionId,
      truck_location_id: truckLocationId,
      truck_size: truckLocationId ? resolvedTruckSize : null,
      num_zones: truckLocationId ? zoneCount : null,
      // New session type and waypoint fields
      session_type: resolvedSessionType,
      start_waypoint_id: start_waypoint_id || null,
      end_waypoint_id: end_waypoint_id || null
    };

    const result = await knex('move_sessions')
      .insert(insertData)
      .returning('*');

    await knex.raw(`
      INSERT INTO move_timeline (move_session_id, event_type, description, created_by)
      VALUES (?, 'session_created', 'Move session created', ?)
    `, [result[0].id, userId]);

    res.status(201).json(result[0]);
  } catch (error) {
    console.error('Error creating move session:', error);
    res.status(500).json({ error: 'Failed to create move session' });
  }
});

// Update move session date
router.put('/sessions/:id/date', async (req, res) => {
  const { id } = req.params;
  const { session_date } = req.body;
  const userId = req.user?.user_id;

  if (!userId || !session_date) {
    return res.status(400).json({ error: 'User and session_date are required' });
  }

  try {
    const normalizedSessionDate = normalizeDateOnly(session_date);
    if (!normalizedSessionDate) {
      return res.status(400).json({ error: 'Invalid session date' });
    }

    // Verify ownership
    const sessionCheck = await knex.raw(`
      SELECT ms.id, ms.saved_move_id, sm.desired_start_date, sm.desired_end_date, sm.move_date
      FROM move_sessions ms
      LEFT JOIN saved_moves sm ON ms.saved_move_id = sm.id
      WHERE ms.id = ? AND ms.user_id = ?
    `, [id, userId]);

    if (sessionCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Move session not found' });
    }

    const session = sessionCheck.rows[0];
    const desiredStart = normalizeDateOnly(session.desired_start_date || session.move_date);
    const desiredEnd = normalizeDateOnly(session.desired_end_date || desiredStart);

    if (desiredStart && desiredEnd) {
      if (normalizedSessionDate < desiredStart || normalizedSessionDate > desiredEnd) {
        return res.status(400).json({ error: 'Session date must be within the move window' });
      }
    }

    const result = await knex.raw(`
      UPDATE move_sessions
      SET session_date = ?, move_date = ?, updated_at = NOW()
      WHERE id = ? AND user_id = ?
      RETURNING *
    `, [normalizedSessionDate, normalizedSessionDate, id, userId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Move session not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating move session date:', error);
    res.status(500).json({ error: 'Failed to update move session date' });
  }
});

// Update move session status
router.put('/sessions/:id/status', async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  const userId = req.user?.user_id;

  if (!userId || !status) {
    return res.status(400).json({ error: 'User and status are required' });
  }

  const validStatuses = ['not_started', 'in_progress', 'complete'];
  if (!validStatuses.includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }

  try {
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
      .where('ms.id', id)
      .andWhere('ms.user_id', userId)
      .first();

    if (!sessionInfo) {
      return res.status(404).json({ error: 'Move session not found' });
    }

    if (status === 'in_progress') {
      const normalizedLocationIds = new Set();
      [
        sessionInfo.origin_location_id,
        sessionInfo.destination_location_id,
        sessionInfo.session_start_location_id,
        sessionInfo.session_end_location_id,
        sessionInfo.session_origin_location_id,
        sessionInfo.session_destination_location_id
      ]
        .filter(Boolean)
        .forEach((loc) => normalizedLocationIds.add(String(loc)));

      if (sessionInfo.saved_move_id) {
        const multiLocationRows = await knex('move_locations')
          .select('location_id')
          .where('move_id', sessionInfo.saved_move_id);
        multiLocationRows.forEach((row) => {
          if (row.location_id) {
            normalizedLocationIds.add(String(row.location_id));
          }
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
          .whereNot('ms.id', id);

        const conflictSession = activeSessions.find((session) => {
          const otherLocations = [
            session.origin_location_id,
            session.destination_location_id,
            session.session_start_location_id,
            session.session_end_location_id,
            session.session_origin_location_id,
            session.session_destination_location_id,
            session.multi_location_id
          ]
            .filter(Boolean)
            .map((loc) => String(loc));
          return otherLocations.some((loc) => normalizedLocationIds.has(loc));
        });

        if (conflictSession) {
          return res.status(409).json({
            error: `Location already active under move "${conflictSession.move_name || conflictSession.id}". Finish that move before starting another.`,
            conflict_move_id: conflictSession.id
          });
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
    `, [status, status, status, status, status, status, status, id, userId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Move session not found' });
    }

    // Create timeline event
    await knex.raw(`
      INSERT INTO move_timeline (move_session_id, event_type, description, created_by, event_data)
       VALUES (?, 'status_changed', ?, ?, ?)
    `, [id, `Status changed to ${status}`, userId, JSON.stringify({ new_status: status })]);

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating move session status:', error);
    res.status(500).json({ error: 'Failed to update move session status' });
  }
});

// Record a box scan
router.post('/scans', authenticate, async (req, res) => {
  const { move_session_id, container_id, qr_token, scan_type, scanned_by, location_type, destination_room, notes } = req.body;
  const userId = req.user?.user_id;
  const isAdmin = !!req.user?.is_admin;

  if (!move_session_id || (!container_id && !qr_token) || !scan_type) {
    return res.status(400).json({ error: 'Move session, QR token or container, and scan type are required' });
  }

  const validScanTypes = ['loaded', 'unloaded', 'arrived_at_room', 'unpacked'];
  if (!validScanTypes.includes(scan_type)) {
    return res.status(400).json({ error: 'Invalid scan type' });
  }

  try {
    const sessionRecord = await knex('move_sessions')
      .select('stage', 'user_id')
      .where({ id: move_session_id })
      .first();

    if (!sessionRecord) {
      return res.status(404).json({ error: 'Move session not found' });
    }
    if (!isAdmin && sessionRecord.user_id !== userId) {
      return res.status(403).json({ error: 'Not authorized to modify this session' });
    }
    if (sessionRecord.stage === 'planning') {
      return res.status(400).json({ error: 'Switch this session to Action stage before scanning items' });
    }

    let resolvedContainerId = container_id;
    let containerRecord = null;

    if (!resolvedContainerId && qr_token) {
      const normalizedToken = extractQrToken(qr_token);
      containerRecord = await knex('containers')
        .select('id', 'user_id', 'name', 'box_number', 'qr_code')
        .where({ qr_code: normalizedToken })
        .first();
      if (!containerRecord) {
        return res.status(404).json({ error: 'QR code not recognized' });
      }
      resolvedContainerId = containerRecord.id;
    }

    if (resolvedContainerId && !containerRecord) {
      containerRecord = await knex('containers')
        .select('id', 'user_id', 'name', 'box_number', 'qr_code')
        .where({ id: resolvedContainerId })
        .first();
    }

    if (!resolvedContainerId || !containerRecord) {
      return res.status(400).json({ error: 'Unable to resolve container' });
    }

    if (!isAdmin && containerRecord.user_id !== sessionRecord.user_id) {
      return res.status(403).json({ error: 'Container does not belong to this move owner' });
    }

    // Record the scan
    const scanResult = await knex.raw(`
      INSERT INTO box_scans (move_session_id, container_id, scan_type, scanned_by, location_type, destination_room, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       RETURNING *
    `, [move_session_id, resolvedContainerId, scan_type, scanned_by || null, location_type || null, destination_room || null, notes || null]);

    const containerName =
      containerRecord.name ||
      `Box #${containerRecord.box_number || resolvedContainerId}`;

    // Create timeline event
    await knex.raw(`
      INSERT INTO move_timeline (move_session_id, event_type, description, created_by, event_data)
       VALUES (?, ?, ?, ?, ?)
    `, [
      move_session_id,
      `box_${scan_type}`,
      `${containerName} ${scan_type}`,
      scanned_by || 'system',
      JSON.stringify({
        container_id: resolvedContainerId,
        scan_type,
        location_type,
        qr_token: containerRecord.qr_code || qr_token || null,
      })
    ]);

    res.status(201).json(scanResult.rows[0]);
  } catch (error) {
    console.error('Error recording box scan:', error);
    res.status(500).json({ error: 'Failed to record box scan' });
  }
});

// Get scan history for a container
router.get('/scans/container/:container_id', authenticate, async (req, res) => {
  const { container_id } = req.params;
  const { move_session_id } = req.query;

  try {
    let result;
    if (move_session_id) {
      result = await knex.raw(`
        SELECT bs.*, c.name as container_name, c.box_number
        FROM box_scans bs
        JOIN containers c ON bs.container_id = c.id
        WHERE bs.container_id = ? AND bs.move_session_id = ?
        ORDER BY bs.scanned_at DESC
      `, [container_id, move_session_id]);
    } else {
      result = await knex.raw(`
        SELECT bs.*, c.name as container_name, c.box_number
        FROM box_scans bs
        JOIN containers c ON bs.container_id = c.id
        WHERE bs.container_id = ?
        ORDER BY bs.scanned_at DESC
      `, [container_id]);
    }

    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching scan history:', error);
    res.status(500).json({ error: 'Failed to fetch scan history' });
  }
});

// Record a loose item scan (for items NOT in containers)
router.post('/scans/item', async (req, res) => {
  const { move_session_id, item_id, qr_token, scan_type, scanned_by, location_type, destination_room, notes } = req.body;
  const userId = req.user?.user_id;
  const isAdmin = !!req.user?.is_admin;

  if (!move_session_id || (!item_id && !qr_token) || !scan_type) {
    return res.status(400).json({ error: 'Move session, QR token or item, and scan type are required' });
  }

  const validScanTypes = ['loaded', 'unloaded', 'arrived_at_room', 'unpacked'];
  if (!validScanTypes.includes(scan_type)) {
    return res.status(400).json({ error: 'Invalid scan type' });
  }

  try {
    const sessionRecord = await knex('move_sessions')
      .select('stage', 'user_id')
      .where({ id: move_session_id })
      .first();

    if (!sessionRecord) {
      return res.status(404).json({ error: 'Move session not found' });
    }
    if (!isAdmin && sessionRecord.user_id !== userId) {
      return res.status(403).json({ error: 'Not authorized to modify this session' });
    }
    if (sessionRecord.stage === 'planning') {
      return res.status(400).json({ error: 'Switch this session to Action stage before scanning items' });
    }

    // Check that item is NOT in a container
    let resolvedItemId = item_id;
    let itemRecord = null;

    if (!resolvedItemId && qr_token) {
      const normalizedToken = extractQrToken(qr_token);
      itemRecord = await knex('items')
        .select('id', 'name', 'container_id', 'user_id', 'qr_code')
        .where({ qr_code: normalizedToken })
        .first();
      if (!itemRecord) {
        return res.status(404).json({ error: 'QR code not recognized' });
      }
      resolvedItemId = itemRecord.id;
    }

    if (resolvedItemId && !itemRecord) {
      const itemCheck = await knex.raw(`
        SELECT i.id, i.name, i.container_id, i.user_id, i.qr_code
        FROM items i
        WHERE i.id = ?
      `, [resolvedItemId]);

      if (itemCheck.rows.length === 0) {
        return res.status(404).json({ error: 'Item not found' });
      }
      itemRecord = itemCheck.rows[0];
    }

    if (!itemRecord) {
      return res.status(404).json({ error: 'Item not found' });
    }

    if (!isAdmin && itemRecord.user_id !== sessionRecord.user_id) {
      return res.status(403).json({ error: 'Item does not belong to this move owner' });
    }

    if (itemRecord.container_id) {
      return res.status(400).json({
        error: 'Cannot scan item that is in a container. Please scan the container instead.',
        container_id: itemRecord.container_id
      });
    }

    // Record the item scan
    const scanResult = await knex.raw(`
      INSERT INTO item_scans (move_session_id, item_id, scan_type, scanned_by, location_type, destination_room, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       RETURNING *
    `, [move_session_id, resolvedItemId, scan_type, scanned_by || null, location_type || null, destination_room || null, notes || null]);

    const itemName = itemRecord.name;

    // Create timeline event
    await knex.raw(`
      INSERT INTO move_timeline (move_session_id, event_type, description, created_by, event_data)
       VALUES (?, ?, ?, ?, ?)
    `, [
      move_session_id,
      `item_${scan_type}`,
      `${itemName} ${scan_type}`,
      scanned_by || 'system',
      JSON.stringify({
        item_id: resolvedItemId,
        scan_type,
        location_type,
        qr_token: itemRecord.qr_code || qr_token || null,
      })
    ]);

    res.status(201).json(scanResult.rows[0]);
  } catch (error) {
    console.error('Error recording item scan:', error);
    res.status(500).json({ error: 'Failed to record item scan' });
  }
});

// Get list of loose items (items NOT in containers) for a user
router.get('/loose-items', async (req, res) => {
  const userId = req.user?.user_id;

  if (!userId) {
    return res.status(400).json({ error: 'User not authenticated' });
  }

  try {
    const result = await knex.raw(`
      SELECT i.id, i.name, i.description, i.weight_lbs, i.fragile
      FROM items i
      WHERE i.user_id = ? AND i.container_id IS NULL
      ORDER BY i.name ASC
    `, [userId]);

    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching loose items:', error);
    res.status(500).json({ error: 'Failed to fetch loose items' });
  }
});

// Update truck size and calculate zones for a move session
router.put('/sessions/:id/truck', async (req, res) => {
  const { id } = req.params;
  const { truck_size, truck_identifier } = req.body;
  const userId = req.user?.user_id;

  if (!userId || !truck_size) {
    return res.status(400).json({ error: 'User and truck size are required' });
  }

  try {
    const sessionResult = await knex.raw(`
      SELECT session_name, truck_location_id, saved_move_id
      FROM move_sessions
      WHERE id = ? AND user_id = ?
    `, [id, userId]);

    if (sessionResult.rows.length === 0) {
      return res.status(404).json({ error: 'Move session not found' });
    }

    let truckLocationId = sessionResult.rows[0].truck_location_id;
    let zoneInfo;

    if (!truckLocationId) {
      zoneInfo = await createTruckLocationStructure(userId, sessionResult.rows[0].session_name, truck_size, {
        truckIdentifier: truck_identifier,
        savedMoveId: sessionResult.rows[0].saved_move_id
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
    `, [truck_size, num_zones, truckLocationId, id, userId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Move session not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating truck size:', error);
    res.status(500).json({ error: 'Failed to update truck size' });
  }
});

// Assign loading zones to containers and items based on weight/fragility
router.post('/sessions/:id/assign-zones', async (req, res) => {
  const { id } = req.params;
  const userId = req.user?.user_id;

  if (!userId) {
    return res.status(400).json({ error: 'User not authenticated' });
  }

  try {
    // Get session details including origin location
    const sessionResult = await knex.raw(`
      SELECT * FROM move_sessions WHERE id = ? AND user_id = ?
    `, [id, userId]);

    if (sessionResult.rows.length === 0) {
      return res.status(404).json({ error: 'Move session not found' });
    }

    const session = sessionResult.rows[0];
    if (session.stage !== 'planning') {
      return res.status(400).json({ error: 'Loading zones can only be reassigned during the Planning stage' });
    }
    const numZones = session.num_zones || 3;
    const startLocationId = session.session_start_location_id || session.origin_location_id;

    // Zone 1 = Front (heavy, non-fragile)
    // Zone 2 = Middle (medium weight)
    // Zone 3+ = Rear (light, fragile)

    // Assign zones to containers at the session's start location
    // Use UPSERT (INSERT ... ON CONFLICT UPDATE) to handle existing assignments
    await knex.raw(`
      INSERT INTO container_zones (move_session_id, container_id, loading_zone, load_priority)
      SELECT
        ? as move_session_id,
        c.id as container_id,
        CASE
          WHEN c.weight_lbs > 50 THEN 1  -- Heavy items go in front
          WHEN c.weight_lbs > 20 THEN LEAST(2, ?)  -- Medium weight in middle
          ELSE ?  -- Light items in rear
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
      DO UPDATE SET
        loading_zone = EXCLUDED.loading_zone,
        load_priority = EXCLUDED.load_priority,
        updated_at = NOW()
    `, [id, numZones, numZones, numZones, numZones, userId, startLocationId]);

    // Assign zones to loose items at the session's start location
    await knex.raw(`
      INSERT INTO item_zones (move_session_id, item_id, loading_zone, load_priority)
      SELECT
        ? as move_session_id,
        i.id as item_id,
        CASE
          WHEN i.weight_lbs > 50 THEN 1  -- Heavy items go in front
          WHEN i.fragile = true OR i.weight_lbs < 10 THEN ?  -- Fragile/light items in rear
          ELSE LEAST(2, ?)  -- Medium weight in middle
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
      DO UPDATE SET
        loading_zone = EXCLUDED.loading_zone,
        load_priority = EXCLUDED.load_priority,
        updated_at = NOW()
    `, [id, numZones, numZones, numZones, numZones, userId, startLocationId]);

    res.json({ message: 'Loading zones assigned successfully', num_zones: numZones });
  } catch (error) {
    console.error('Error assigning zones:', error);
    res.status(500).json({ error: 'Failed to assign loading zones' });
  }
});

// Get loading plan (zones and order) for a move session
router.get('/sessions/:id/loading-plan', async (req, res) => {
  const { id } = req.params;
  const userId = req.user?.user_id;

  if (!userId) {
    return res.status(400).json({ error: 'User not authenticated' });
  }

  try {
    // Verify ownership and get session details including origin location
    const sessionCheck = await knex.raw(`
      SELECT id, truck_size, num_zones, origin_location_id, session_start_location_id
      FROM move_sessions
      WHERE id = ? AND user_id = ?
    `, [id, userId]);

    if (sessionCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Move session not found' });
    }

    const session = sessionCheck.rows[0];
    const startLocationId = session.session_start_location_id || session.origin_location_id;
    console.log('Loading plan for session:', session);
    console.log('Start location ID:', startLocationId);

    // Get containers AT THE ORIGIN LOCATION with their zone assignments (if any)
    // Filter by collection's location_id matching the session's origin_location_id
    const containers = await knex.raw(`
      SELECT c.id, c.name as container_name, c.box_number, c.weight_lbs,
             cz.loading_zone, cz.load_priority
      FROM containers c
      INNER JOIN collections col ON c.collection_id = col.id
      LEFT JOIN (
        SELECT container_id, loading_zone, load_priority
        FROM container_zones
        WHERE move_session_id = ?
      ) cz ON c.id = cz.container_id
      WHERE c.user_id = ? AND col.location_id = ?
      ORDER BY cz.loading_zone ASC NULLS FIRST, c.weight_lbs DESC
    `, [id, userId, startLocationId]);

    console.log('Containers found:', containers.rows.length);
    console.log('Containers:', containers.rows);

    // Get loose items (not in containers) AT THE ORIGIN LOCATION with their zone assignments (if any)
    const items = await knex.raw(`
      SELECT i.id, i.name as item_name, i.weight_lbs, i.fragile,
             iz.loading_zone, iz.load_priority
      FROM items i
      INNER JOIN collections col ON i.collection_id = col.id
      LEFT JOIN (
        SELECT item_id, loading_zone, load_priority
        FROM item_zones
        WHERE move_session_id = ?
      ) iz ON i.id = iz.item_id
      WHERE i.user_id = ? AND i.container_id IS NULL AND col.location_id = ?
      ORDER BY iz.loading_zone ASC NULLS FIRST, i.weight_lbs DESC
    `, [id, userId, startLocationId]);

    console.log('Loose items found:', items.rows.length);
    console.log('Loose items:', items.rows);

    // Prevent caching
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');

    res.json({
      truck_size: session.truck_size,
      num_zones: session.num_zones,
      containers: containers.rows,
      loose_items: items.rows
    });
  } catch (error) {
    console.error('Error fetching loading plan:', error);
    res.status(500).json({ error: 'Failed to fetch loading plan' });
  }
});

// Update loading zone for a specific container (for planning, not scanning)
router.put('/sessions/:session_id/containers/:container_id/zone', async (req, res) => {
  const { session_id, container_id } = req.params;
  const { loading_zone } = req.body;
  const userId = req.user?.user_id;

  if (!userId) {
    return res.status(400).json({ error: 'User not authenticated' });
  }

  try {
    // Verify session ownership
    const sessionCheck = await knex.raw(`
      SELECT id FROM move_sessions WHERE id = ? AND user_id = ?
    `, [session_id, userId]);

    if (sessionCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Move session not found' });
    }

    // Verify container ownership
    const containerCheck = await knex.raw(`
      SELECT id FROM containers WHERE id = ? AND user_id = ?
    `, [container_id, userId]);

    if (containerCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Container not found' });
    }

    // UPSERT zone assignment (null to unassign)
    if (loading_zone === null) {
      // Delete the zone assignment
      await knex.raw(`
        DELETE FROM container_zones
        WHERE move_session_id = ? AND container_id = ?
      `, [session_id, container_id]);
      res.json({ message: 'Zone assignment removed' });
    } else {
      const result = await knex.raw(`
        INSERT INTO container_zones (move_session_id, container_id, loading_zone)
        VALUES (?, ?, ?)
        ON CONFLICT (move_session_id, container_id)
        DO UPDATE SET loading_zone = ?, updated_at = NOW()
        RETURNING *
      `, [session_id, container_id, loading_zone, loading_zone]);
      res.json(result.rows[0]);
    }
  } catch (error) {
    console.error('Error updating container zone:', error);
    res.status(500).json({ error: 'Failed to update loading zone' });
  }
});

// Update loading zone for a specific item (for planning, not scanning)
router.put('/sessions/:session_id/items/:item_id/zone', async (req, res) => {
  const { session_id, item_id } = req.params;
  const { loading_zone } = req.body;
  const userId = req.user?.user_id;

  if (!userId) {
    return res.status(400).json({ error: 'User not authenticated' });
  }

  try {
    // Verify session ownership
    const sessionCheck = await knex.raw(`
      SELECT id FROM move_sessions WHERE id = ? AND user_id = ?
    `, [session_id, userId]);

    if (sessionCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Move session not found' });
    }

    // Verify item ownership
    const itemCheck = await knex.raw(`
      SELECT id FROM items WHERE id = ? AND user_id = ?
    `, [item_id, userId]);

    if (itemCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Item not found' });
    }

    // UPSERT zone assignment (null to unassign)
    if (loading_zone === null) {
      // Delete the zone assignment
      await knex.raw(`
        DELETE FROM item_zones
        WHERE move_session_id = ? AND item_id = ?
      `, [session_id, item_id]);
      res.json({ message: 'Zone assignment removed' });
    } else {
      const result = await knex.raw(`
        INSERT INTO item_zones (move_session_id, item_id, loading_zone)
        VALUES (?, ?, ?)
        ON CONFLICT (move_session_id, item_id)
        DO UPDATE SET loading_zone = ?, updated_at = NOW()
        RETURNING *
      `, [session_id, item_id, loading_zone, loading_zone]);
      res.json(result.rows[0]);
    }
  } catch (error) {
    console.error('Error updating item zone:', error);
    res.status(500).json({ error: 'Failed to update loading zone' });
  }
});

// Report damage
router.post('/damage-reports', authenticate, async (req, res) => {
  const { move_session_id, container_id, item_id, severity, description, photo_urls, reported_by } = req.body;

  if (!move_session_id || !severity || !description || !reported_by) {
    return res.status(400).json({ error: 'Move session, severity, description, and reporter are required' });
  }

  const validSeverities = ['minor', 'moderate', 'severe'];
  if (!validSeverities.includes(severity)) {
    return res.status(400).json({ error: 'Invalid severity level' });
  }

  try {
    const result = await knex.raw(`
      INSERT INTO damage_reports (move_session_id, container_id, item_id, severity, description, photo_urls, reported_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       RETURNING *
    `, [move_session_id, container_id || null, item_id || null, severity, description, JSON.stringify(photo_urls || []), reported_by]);

    // Create timeline event
    await knex.raw(`
      INSERT INTO move_timeline (move_session_id, event_type, description, created_by, event_data)
       VALUES (?, 'damage_reported', ?, ?, ?)
    `, [move_session_id, `${severity} damage reported: ${description.substring(0, 50)}...`, reported_by, JSON.stringify({ damage_report_id: result.rows[0].id, severity })]);

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error reporting damage:', error);
    res.status(500).json({ error: 'Failed to report damage' });
  }
});

// Add crew member
router.post('/crew', authenticate, async (req, res) => {
  const { move_session_id, name, role, phone, email, notes } = req.body;

  if (!move_session_id || !name) {
    return res.status(400).json({ error: 'Move session and name are required' });
  }

  try {
    const result = await knex.raw(`
      INSERT INTO move_crew (move_session_id, name, role, phone, email, notes)
       VALUES (?, ?, ?, ?, ?, ?)
       RETURNING *
    `, [move_session_id, name, role || null, phone || null, email || null, notes || null]);

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error adding crew member:', error);
    res.status(500).json({ error: 'Failed to add crew member' });
  }
});

// Delete crew member
router.delete('/crew/:id', authenticate, async (req, res) => {
  const { id } = req.params;

  try {
    const result = await knex.raw(`
      DELETE FROM move_crew WHERE id = ? RETURNING *
    `, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Crew member not found' });
    }

    res.json({ message: 'Crew member deleted successfully' });
  } catch (error) {
    console.error('Error deleting crew member:', error);
    res.status(500).json({ error: 'Failed to delete crew member' });
  }
});

// Get move progress stats
router.get('/sessions/:id/progress', authenticate, async (req, res) => {
  const { id } = req.params;
  const userId = req.user?.user_id;

  if (!userId) {
    return res.status(400).json({ error: 'User parameter is required' });
  }

  try {
    // Verify ownership
    const sessionCheck = await knex.raw(`
      SELECT id FROM move_sessions WHERE id = ? AND user_id = ?
    `, [id, userId]);

    if (sessionCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Move session not found' });
    }

    // Get progress stats
    const stats = await knex.raw(`
      SELECT
        (SELECT COUNT(DISTINCT bs.container_id)
         FROM box_scans bs
         WHERE bs.move_session_id = ? AND bs.scan_type = 'loaded') as boxes_loaded,
        (SELECT COUNT(DISTINCT bs.container_id)
         FROM box_scans bs
         WHERE bs.move_session_id = ? AND bs.scan_type = 'unloaded') as boxes_unloaded,
        (SELECT COUNT(DISTINCT bs.container_id)
         FROM box_scans bs
         WHERE bs.move_session_id = ? AND bs.scan_type = 'unpacked') as boxes_unpacked,
        (SELECT COUNT(*) FROM damage_reports WHERE move_session_id = ?) as damage_reports_count,
        (SELECT COUNT(*) FROM move_crew WHERE move_session_id = ?) as crew_count
    `, [id, id, id, id, id]);

    // Get total containers for this move
    const totalContainers = await knex.raw(`
      SELECT COUNT(DISTINCT c.id) as total
       FROM containers c
       JOIN move_sessions ms ON ms.id = ?
       WHERE c.user_id = ms.user_id
    `, [id]);

    res.json({
      ...stats.rows[0],
      total_containers: parseInt(totalContainers.rows[0].total)
    });
  } catch (error) {
    console.error('Error fetching move progress:', error);
    res.status(500).json({ error: 'Failed to fetch move progress' });
  }
});

// Delete move session
router.delete('/sessions/:id', authenticate, async (req, res) => {
  const { id } = req.params;
  const userId = req.user?.user_id;

  if (!userId) {
    return res.status(400).json({ error: 'User not authenticated' });
  }

  try {
    // Verify ownership before deleting
    const sessionCheck = await knex.raw(`
      SELECT id FROM move_sessions WHERE id = ? AND user_id = ?
    `, [id, userId]);

    if (sessionCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Move session not found' });
    }

    // Delete the session (CASCADE will delete related records)
    await knex.raw(`
      DELETE FROM move_sessions WHERE id = ? AND user_id = ?
    `, [id, userId]);

    res.json({ message: 'Move session deleted successfully' });
  } catch (error) {
    console.error('Error deleting move session:', error);
    res.status(500).json({ error: 'Failed to delete move session' });
  }
});

// ============================================================================
// TRUCK MANAGEMENT ROUTES
// Trucks are special locations (location_type = 'truck') managed separately
// ============================================================================

// Get all trucks for a move (by saved_move_id)
router.get('/moves/:moveId/trucks', async (req, res) => {
  const { moveId } = req.params;
  const userId = req.user?.user_id;

  if (!userId) {
    return res.status(400).json({ error: 'User not authenticated' });
  }

  try {
    // Get all trucks associated with sessions for this move
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

    res.json(trucks.rows);
  } catch (error) {
    console.error('Error fetching trucks:', error);
    res.status(500).json({ error: 'Failed to fetch trucks' });
  }
});

// Get all trucks for the user (regardless of move)
router.get('/trucks', async (req, res) => {
  const userId = req.user?.user_id;

  if (!userId) {
    return res.status(400).json({ error: 'User not authenticated' });
  }

  try {
    const trucks = await knex.raw(`
      SELECT l.id, l.name, l.truck_identifier, l.truck_sequence, l.truck_size,
             l.created_at, l.updated_at,
             (SELECT COUNT(*) FROM move_sessions ms WHERE ms.truck_location_id = l.id) as session_count,
             (SELECT COUNT(*) FROM collections c WHERE c.location_id = l.id) as zone_count
      FROM locations l
      WHERE l.user_id = ? AND l.location_type = 'truck'
      ORDER BY l.created_at DESC
    `, [userId]);

    res.json(trucks.rows);
  } catch (error) {
    console.error('Error fetching trucks:', error);
    res.status(500).json({ error: 'Failed to fetch trucks' });
  }
});

// Get a single truck by ID
router.get('/trucks/:id', async (req, res) => {
  const { id } = req.params;
  const userId = req.user?.user_id;

  if (!userId) {
    return res.status(400).json({ error: 'User not authenticated' });
  }

  try {
    const truck = await knex.raw(`
      SELECT l.*,
             (SELECT json_agg(json_build_object('id', c.id, 'name', c.name))
              FROM collections c WHERE c.location_id = l.id) as zones,
             (SELECT json_agg(json_build_object('id', ms.id, 'session_name', ms.session_name, 'move_date', ms.move_date))
              FROM move_sessions ms WHERE ms.truck_location_id = l.id) as sessions
      FROM locations l
      WHERE l.id = ? AND l.user_id = ? AND l.location_type = 'truck'
    `, [id, userId]);

    if (truck.rows.length === 0) {
      return res.status(404).json({ error: 'Truck not found' });
    }

    res.json(truck.rows[0]);
  } catch (error) {
    console.error('Error fetching truck:', error);
    res.status(500).json({ error: 'Failed to fetch truck' });
  }
});

// Update a truck (rename, change identifier)
router.put('/trucks/:id', async (req, res) => {
  const { id } = req.params;
  const { name, truck_identifier, truck_size } = req.body;
  const userId = req.user?.user_id;

  if (!userId) {
    return res.status(400).json({ error: 'User not authenticated' });
  }

  try {
    // Verify truck exists and belongs to user
    const existing = await knex.raw(`
      SELECT id FROM locations
      WHERE id = ? AND user_id = ? AND location_type = 'truck'
    `, [id, userId]);

    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Truck not found' });
    }

    // Build update object with only provided fields
    const updates = { updated_at: knex.fn.now() };
    if (name !== undefined) updates.name = name;
    if (truck_identifier !== undefined) updates.truck_identifier = truck_identifier;
    if (truck_size !== undefined) updates.truck_size = truck_size;

    const result = await knex('locations')
      .where({ id, user_id: userId })
      .update(updates)
      .returning('*');

    res.json(result[0]);
  } catch (error) {
    console.error('Error updating truck:', error);
    res.status(500).json({ error: 'Failed to update truck' });
  }
});

// Delete a truck
router.delete('/trucks/:id', async (req, res) => {
  const { id } = req.params;
  const userId = req.user?.user_id;

  if (!userId) {
    return res.status(400).json({ error: 'User not authenticated' });
  }

  try {
    // Verify truck exists and belongs to user
    const existing = await knex.raw(`
      SELECT l.id,
             (SELECT COUNT(*) FROM move_sessions ms WHERE ms.truck_location_id = l.id) as session_count
      FROM locations l
      WHERE l.id = ? AND l.user_id = ? AND l.location_type = 'truck'
    `, [id, userId]);

    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Truck not found' });
    }

    const truck = existing.rows[0];

    // Clear truck_location_id from any sessions using this truck
    await knex.raw(`
      UPDATE move_sessions
      SET truck_location_id = NULL, updated_at = NOW()
      WHERE truck_location_id = ? AND user_id = ?
    `, [id, userId]);

    // Delete truck zones (collections)
    await knex.raw(`
      DELETE FROM collections WHERE location_id = ? AND user_id = ?
    `, [id, userId]);

    // Delete the truck location
    await knex.raw(`
      DELETE FROM locations WHERE id = ? AND user_id = ? AND location_type = 'truck'
    `, [id, userId]);

    res.json({
      message: 'Truck deleted successfully',
      sessions_affected: parseInt(truck.session_count, 10) || 0
    });
  } catch (error) {
    console.error('Error deleting truck:', error);
    res.status(500).json({ error: 'Failed to delete truck' });
  }
});

/**
 * POST /api/move-day/generate-from-route
 * Generate a complete move schedule (loading, driving, unloading sessions) from calculated route
 */
router.post('/generate-from-route', async (req, res) => {
  const correlationId = `gen-schedule-${Date.now()}`;
  console.log(`[MoveDay] ${correlationId}: Starting schedule generation from route`);

  try {
    const userId = req.user?.user_id;
    const { savedMoveId, clearExisting = true, anchorType = 'move-out', anchorDate } = req.body;

    if (!userId || !savedMoveId) {
      return res.status(400).json({ error: 'User ID and saved move ID are required' });
    }

    if (!anchorDate) {
      return res.status(400).json({ error: 'Anchor date is required' });
    }

    if (anchorType !== 'move-out' && anchorType !== 'move-in') {
      return res.status(400).json({ error: 'Anchor type must be "move-out" or "move-in"' });
    }

    // Verify user owns the move
    const move = await knex('saved_moves')
      .where('id', savedMoveId)
      .andWhere('user_id', userId)
      .first();

    if (!move) {
      return res.status(404).json({ error: 'Saved move not found' });
    }

    // Parse route_data to get origin and destination
    const routeData = move.route_data ? (typeof move.route_data === 'string' ? JSON.parse(move.route_data) : move.route_data) : null;
    if (!routeData) {
      return res.status(400).json({ error: 'Move does not have route data. Please calculate route first.' });
    }

    // Get all waypoints in sequence order
    const waypoints = await knex('move_waypoints')
      .where('saved_move_id', savedMoveId)
      .orderBy('sequence_order', 'asc');

    if (waypoints.length === 0) {
      return res.status(400).json({ error: 'No waypoints found. Please add waypoints and calculate route first.' });
    }

    // Check if waypoints have been optimized (have calculated distances)
    const hasCalculatedDistances = waypoints.every(w => w.distance_source === 'calculated');
    if (!hasCalculatedDistances) {
      return res.status(400).json({ error: 'Route not calculated. Please click "Calculate Route" first.' });
    }

    // Clear existing sessions if requested
    if (clearExisting) {
      await knex('move_sessions')
        .where('saved_move_id', savedMoveId)
        .andWhere('user_id', userId)
        .del();
      console.log(`[MoveDay] ${correlationId}: Cleared existing sessions`);
    }

    const createdSessions = [];

    // Build segments first to calculate total trip duration
    // Segments: origin -> waypoint1, waypoint1 -> waypoint2, ..., lastWaypoint -> destination
    const segments = [];

    // Origin to first waypoint
    segments.push({
      start: { type: 'origin', name: routeData.origin_address || 'Origin' },
      end: { type: 'waypoint', id: waypoints[0].id, name: `${waypoints[0].city}${waypoints[0].state ? ', ' + waypoints[0].state : ''}`, isDropoff: waypoints[0].is_dropoff || false },
      distance: waypoints[0].segment_distance_miles,
      duration: waypoints[0].segment_duration_hours,
      overnight: waypoints[0].overnight_recommended
    });

    console.log(`[MoveDay] ${correlationId}: Waypoint ${waypoints[0].city} - is_dropoff: ${waypoints[0].is_dropoff}`);

    // Waypoint to waypoint
    for (let i = 1; i < waypoints.length; i++) {
      console.log(`[MoveDay] ${correlationId}: Waypoint ${waypoints[i].city} - is_dropoff: ${waypoints[i].is_dropoff}`);
      segments.push({
        start: { type: 'waypoint', id: waypoints[i - 1].id, name: `${waypoints[i - 1].city}${waypoints[i - 1].state ? ', ' + waypoints[i - 1].state : ''}`, isDropoff: waypoints[i - 1].is_dropoff || false },
        end: { type: 'waypoint', id: waypoints[i].id, name: `${waypoints[i].city}${waypoints[i].state ? ', ' + waypoints[i].state : ''}`, isDropoff: waypoints[i].is_dropoff || false },
        distance: waypoints[i].segment_distance_miles,
        duration: waypoints[i].segment_duration_hours,
        overnight: waypoints[i].overnight_recommended
      });
    }

    // Last waypoint to destination
    // Get final leg distance from route_data if available
    const finalLegDistance = routeData.finalLegDistanceMiles || routeData.total_distance_miles - waypoints[waypoints.length - 1].distance_from_origin_miles;
    const finalLegDuration = routeData.finalLegDurationHours || (finalLegDistance / 60); // Estimate if not available

    segments.push({
      start: { type: 'waypoint', id: waypoints[waypoints.length - 1].id, name: `${waypoints[waypoints.length - 1].city}${waypoints[waypoints.length - 1].state ? ', ' + waypoints[waypoints.length - 1].state : ''}` },
      end: { type: 'destination', name: routeData.destination_address || 'Destination' },
      distance: finalLegDistance,
      duration: finalLegDuration,
      overnight: false // Arrive at destination
    });

    // Calculate total trip duration (number of days needed)
    // Start with 1 day for loading
    let totalDays = 1;

    // Add days for driving segments based on overnight stops
    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      // Each segment takes 1 day, plus additional day if overnight recommended
      totalDays += 1;
      if (segment.overnight && i < segments.length - 1) {
        // Overnight stop adds an extra day (except for the last segment)
        totalDays += 1;
      }
    }

    // Add 1 day for unloading
    totalDays += 1;

    console.log(`[MoveDay] ${correlationId}: Total trip duration: ${totalDays} days`);

    // Calculate session dates based on anchor type
    let sessionDates = [];

    if (anchorType === 'move-out') {
      // Forward calculation: anchor date is the loading date (Day 1)
      const loadingDate = new Date(anchorDate);
      loadingDate.setHours(0, 0, 0, 0);

      let currentDate = new Date(loadingDate);
      sessionDates.push({
        type: 'loading',
        date: new Date(currentDate)
      });

      // Calculate driving session dates
      for (let i = 0; i < segments.length; i++) {
        currentDate.setDate(currentDate.getDate() + 1);
        sessionDates.push({
          type: 'driving',
          date: new Date(currentDate),
          segmentIndex: i
        });

        // If overnight recommended and not the last segment, add an extra day
        if (segments[i].overnight && i < segments.length - 1) {
          currentDate.setDate(currentDate.getDate() + 1);
        }
      }

      // Unloading happens the day after the last driving segment
      currentDate.setDate(currentDate.getDate() + 1);
      sessionDates.push({
        type: 'unloading',
        date: new Date(currentDate)
      });

    } else {
      // Backward calculation: anchor date is the unloading date (final day)
      const unloadingDate = new Date(anchorDate);
      unloadingDate.setHours(0, 0, 0, 0);

      // Work backward from unloading date
      let currentDate = new Date(unloadingDate);

      // Unloading is on the anchor date
      sessionDates.unshift({
        type: 'unloading',
        date: new Date(currentDate)
      });

      // Calculate driving session dates in reverse
      for (let i = segments.length - 1; i >= 0; i--) {
        currentDate.setDate(currentDate.getDate() - 1);
        sessionDates.unshift({
          type: 'driving',
          date: new Date(currentDate),
          segmentIndex: i
        });

        // If overnight recommended and not the first segment, subtract an extra day
        if (segments[i].overnight && i > 0) {
          currentDate.setDate(currentDate.getDate() - 1);
        }
      }

      // Loading happens the day before the first driving segment
      currentDate.setDate(currentDate.getDate() - 1);
      sessionDates.unshift({
        type: 'loading',
        date: new Date(currentDate)
      });
    }

    console.log(`[MoveDay] ${correlationId}: Calculated ${sessionDates.length} session dates from ${sessionDates[0].date.toISOString().split('T')[0]} to ${sessionDates[sessionDates.length - 1].date.toISOString().split('T')[0]}`);

    // Create sessions in chronological order
    for (const sessionDate of sessionDates) {
      const dateStr = sessionDate.date.toISOString().split('T')[0];

      if (sessionDate.type === 'loading') {
        const loadingSession = await knex('move_sessions')
          .insert({
            user_id: userId,
            saved_move_id: savedMoveId,
            session_type: 'loading',
            session_name: 'Load at Origin',
            session_date: dateStr,
            move_date: dateStr,
            status: 'pending',
            notes: `Loading session at ${routeData.origin_address || 'origin'}`,
            created_at: knex.fn.now(),
            updated_at: knex.fn.now()
          })
          .returning('*');

        createdSessions.push(loadingSession[0]);
        console.log(`[MoveDay] ${correlationId}: Created loading session for ${dateStr}`);

      } else if (sessionDate.type === 'driving') {
        const segment = segments[sessionDate.segmentIndex];
        const drivingSession = await knex('move_sessions')
          .insert({
            user_id: userId,
            saved_move_id: savedMoveId,
            session_type: 'driving',
            session_name: `${segment.start.name} → ${segment.end.name}`,
            session_date: dateStr,
            move_date: dateStr,
            status: 'pending',
            start_waypoint_id: segment.start.type === 'waypoint' ? segment.start.id : null,
            end_waypoint_id: segment.end.type === 'waypoint' ? segment.end.id : null,
            notes: `${Math.round(segment.distance)} miles, ~${Math.round(segment.duration * 10) / 10} hours`,
            created_at: knex.fn.now(),
            updated_at: knex.fn.now()
          })
          .returning('*');

        createdSessions.push(drivingSession[0]);
        console.log(`[MoveDay] ${correlationId}: Created driving session ${segment.start.name} → ${segment.end.name} for ${dateStr}`);

        // If this segment ends at a dropoff waypoint, create an unloading session on the same day
        console.log(`[MoveDay] ${correlationId}: Checking segment end - type: ${segment.end.type}, isDropoff: ${segment.end.isDropoff}, name: ${segment.end.name}`);
        if (segment.end.type === 'waypoint' && segment.end.isDropoff) {
          const unloadSession = await knex('move_sessions')
            .insert({
              user_id: userId,
              saved_move_id: savedMoveId,
              session_type: 'unloading',
              session_name: `Unload at ${segment.end.name}`,
              session_date: dateStr,
              move_date: dateStr,
              status: 'pending',
              notes: `Unloading session at ${segment.end.name}`,
              created_at: knex.fn.now(),
              updated_at: knex.fn.now()
            })
            .returning('*');

          createdSessions.push(unloadSession[0]);
          console.log(`[MoveDay] ${correlationId}: Created dropoff unloading session at ${segment.end.name} for ${dateStr}`);
        }

      } else if (sessionDate.type === 'unloading') {
        const unloadingSession = await knex('move_sessions')
          .insert({
            user_id: userId,
            saved_move_id: savedMoveId,
            session_type: 'unloading',
            session_name: 'Unload at Destination',
            session_date: dateStr,
            move_date: dateStr,
            status: 'pending',
            notes: `Unloading session at ${routeData.destination_address || 'destination'}`,
            created_at: knex.fn.now(),
            updated_at: knex.fn.now()
          })
          .returning('*');

        createdSessions.push(unloadingSession[0]);
        console.log(`[MoveDay] ${correlationId}: Created unloading session for ${dateStr}`);
      }
    }

    console.log(`[MoveDay] ${correlationId}: Schedule generation complete. Created ${createdSessions.length} sessions`);

    res.status(201).json({
      success: true,
      sessions: createdSessions,
      summary: {
        total_sessions: createdSessions.length,
        loading_sessions: createdSessions.filter(s => s.session_type === 'loading').length,
        driving_sessions: createdSessions.filter(s => s.session_type === 'driving').length,
        unloading_sessions: createdSessions.filter(s => s.session_type === 'unloading').length,
        start_date: createdSessions[0].session_date,
        end_date: createdSessions[createdSessions.length - 1].session_date,
        duration_days: Math.ceil((new Date(createdSessions[createdSessions.length - 1].session_date) - new Date(createdSessions[0].session_date)) / (1000 * 60 * 60 * 24)) + 1
      }
    });

  } catch (error) {
    console.error(`[MoveDay] ${correlationId}: Error generating schedule:`, error);
    res.status(500).json({ error: 'Failed to generate schedule from route', details: error.message });
  }
});

module.exports = router;
