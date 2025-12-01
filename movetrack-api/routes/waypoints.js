const express = require('express');
const router = express.Router();
const axios = require('axios');
const { authenticate } = require('../bin/authService');
const { reverseGeocode, batchReverseGeocode, forwardGeocode } = require('../services/geocodingService');
// Distance utilities used by calculate-route endpoint (batch calculation)
const { calculateEstimatedDistance, getOriginFromPolyline, estimateDriveHours } = require('../services/distanceUtils');

const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;

const knex = require('knex')({
  client: 'pg',
  connection: {
    host: process.env.MT_DATALAYER_HOSTNAME,
    user: process.env.MT_DATALAYER_USERNAME,
    password: process.env.MT_DATALAYER_PASSWORD,
    database: process.env.MT_DATALAYER_DATABASE
  }
});

async function detachWaypointSessions(moveId, waypointIds) {
  if (!Array.isArray(waypointIds) || waypointIds.length === 0) {
    return;
  }

  await knex('move_sessions')
    .where('saved_move_id', moveId)
    .whereIn('start_waypoint_id', waypointIds)
    .update({ start_waypoint_id: null, updated_at: knex.fn.now() });

  await knex('move_sessions')
    .where('saved_move_id', moveId)
    .whereIn('end_waypoint_id', waypointIds)
    .update({ end_waypoint_id: null, updated_at: knex.fn.now() });
}

/**
 * GET /api/waypoints/:moveId
 * Get all waypoints for a specific saved move
 */
router.get('/:moveId', authenticate, async (req, res) => {
  try {
    const userId = req.user.user_id;
    const moveId = req.params.moveId;

    // Verify user owns the move
    const move = await knex('saved_moves')
      .where('id', moveId)
      .andWhere('user_id', userId)
      .first();

    if (!move) {
      return res.status(404).json({ error: 'Saved move not found' });
    }

    const waypoints = await knex('move_waypoints')
      .where('saved_move_id', moveId)
      .orderBy('sequence_order', 'asc');

    res.json(waypoints);
  } catch (error) {
    console.error('Error fetching waypoints:', error);
    res.status(500).json({ error: 'Failed to fetch waypoints' });
  }
});

/**
 * POST /api/waypoints/:moveId
 * Create a new waypoint for a move
 */
router.post('/:moveId', authenticate, async (req, res) => {
  try {
    const userId = req.user.user_id;
    const moveId = req.params.moveId;
    const {
      city,
      state,
      country = 'USA',
      lat,
      lng,
      source = 'manual',
      distanceFromOriginMiles,
      typicalDriveHoursFromOrigin,
      notes,
      overnightRecommended = false,
      isDropoff = false,
      sequenceOrder
    } = req.body;

    // Verify user owns the move
    const move = await knex('saved_moves')
      .where('id', moveId)
      .andWhere('user_id', userId)
      .first();

    if (!move) {
      return res.status(404).json({ error: 'Saved move not found' });
    }

    if (!city) {
      return res.status(400).json({ error: 'City is required' });
    }

    // If lat/lng not provided, forward geocode the city/state to get coordinates
    let waypointLat = lat;
    let waypointLng = lng;
    if (waypointLat == null || waypointLng == null) {
      console.log(`[Waypoints] Forward geocoding: ${city}, ${state || 'USA'}`);
      const geocodeResult = await forwardGeocode(city, state, country, {
        correlationId: `waypoint-create-${moveId}`
      });

      if (geocodeResult.lat != null && geocodeResult.lng != null) {
        waypointLat = geocodeResult.lat;
        waypointLng = geocodeResult.lng;
        console.log(`[Waypoints] Geocoded ${city}, ${state} -> ${waypointLat}, ${waypointLng}`);
      } else {
        console.warn(`[Waypoints] Could not geocode ${city}, ${state} - marker may not appear on map`);
      }
    }

    // If sequenceOrder not provided, set it to max + 1
    let order = sequenceOrder;
    if (order === undefined || order === null) {
      const maxOrder = await knex('move_waypoints')
        .where('saved_move_id', moveId)
        .max('sequence_order as max')
        .first();
      order = (maxOrder?.max || 0) + 1;
    }

    // Distance is NOT calculated on create - use "Calculate Route" button for batch calculation
    // This keeps waypoint creation simple and fast
    const result = await knex('move_waypoints')
      .insert({
        saved_move_id: moveId,
        user_id: userId,
        city,
        state,
        country,
        lat: waypointLat,
        lng: waypointLng,
        source: source || (waypointLat != null ? 'manual_geocoded' : 'manual'),
        distance_from_origin_miles: distanceFromOriginMiles || null,
        typical_drive_hours_from_origin: typicalDriveHoursFromOrigin || null,
        distance_source: distanceFromOriginMiles ? 'calculated' : null,
        notes,
        overnight_recommended: overnightRecommended,
        is_dropoff: isDropoff,
        sequence_order: order
      })
      .returning('*');

    res.status(201).json(result[0]);
  } catch (error) {
    console.error('Error creating waypoint:', error);
    res.status(500).json({ error: 'Failed to create waypoint', details: error.message });
  }
});

/**
 * PUT /api/waypoints/:waypointId
 * Update an existing waypoint
 */
router.put('/:waypointId', authenticate, async (req, res) => {
  try {
    const userId = req.user.user_id;
    const waypointId = req.params.waypointId;
    const {
      city,
      state,
      country,
      lat,
      lng,
      source,
      distanceFromOriginMiles,
      typicalDriveHoursFromOrigin,
      notes,
      overnightRecommended,
      isDropoff,
      sequenceOrder
    } = req.body;

    // Verify user owns the waypoint
    const existing = await knex('move_waypoints')
      .where('id', waypointId)
      .andWhere('user_id', userId)
      .first();

    if (!existing) {
      return res.status(404).json({ error: 'Waypoint not found' });
    }

    const updateData = {};
    if (city !== undefined) updateData.city = city;
    if (state !== undefined) updateData.state = state;
    if (country !== undefined) updateData.country = country;
    if (lat !== undefined) updateData.lat = lat;
    if (lng !== undefined) updateData.lng = lng;
    if (source !== undefined) updateData.source = source;
    if (distanceFromOriginMiles !== undefined) updateData.distance_from_origin_miles = distanceFromOriginMiles;
    if (typicalDriveHoursFromOrigin !== undefined) updateData.typical_drive_hours_from_origin = typicalDriveHoursFromOrigin;
    if (notes !== undefined) updateData.notes = notes;
    if (overnightRecommended !== undefined) updateData.overnight_recommended = overnightRecommended;
    if (isDropoff !== undefined) updateData.is_dropoff = isDropoff;
    if (sequenceOrder !== undefined) updateData.sequence_order = sequenceOrder;

    // If city or state changed but lat/lng not provided, forward geocode
    const cityChanged = city !== undefined && city !== existing.city;
    const stateChanged = state !== undefined && state !== existing.state;
    if ((cityChanged || stateChanged) && lat === undefined && lng === undefined) {
      const updatedCity = city !== undefined ? city : existing.city;
      const updatedState = state !== undefined ? state : existing.state;
      const updatedCountry = country !== undefined ? country : existing.country;

      console.log(`[Waypoints] Forward geocoding updated location: ${updatedCity}, ${updatedState}`);
      const geocodeResult = await forwardGeocode(updatedCity, updatedState, updatedCountry, {
        correlationId: `waypoint-update-${waypointId}`
      });

      if (geocodeResult.lat != null && geocodeResult.lng != null) {
        updateData.lat = geocodeResult.lat;
        updateData.lng = geocodeResult.lng;
        updateData.source = 'manual_geocoded';
        console.log(`[Waypoints] Geocoded ${updatedCity}, ${updatedState} -> ${geocodeResult.lat}, ${geocodeResult.lng}`);
      }
    }

    updateData.updated_at = knex.fn.now();

    const result = await knex('move_waypoints')
      .where('id', waypointId)
      .andWhere('user_id', userId)
      .update(updateData)
      .returning('*');

    res.json(result[0]);
  } catch (error) {
    console.error('Error updating waypoint:', error);
    res.status(500).json({ error: 'Failed to update waypoint', details: error.message });
  }
});

/**
 * DELETE /api/waypoints/:waypointId
 * Delete a waypoint
 */
router.delete('/:waypointId', authenticate, async (req, res) => {
  try {
    const userId = req.user.user_id;
    const waypointId = req.params.waypointId;

    // Verify user owns the waypoint
    const existing = await knex('move_waypoints')
      .where('id', waypointId)
      .andWhere('user_id', userId)
      .first();

    if (!existing) {
      return res.status(404).json({ error: 'Waypoint not found' });
    }

    // Count sessions that will be affected by this deletion
    const affectedSessions = await knex('move_sessions')
      .where(function() {
        this.where('start_waypoint_id', waypointId)
          .orWhere('end_waypoint_id', waypointId);
      })
      .select('id');

    // Delete affected sessions first (cascade delete)
    if (affectedSessions.length > 0) {
      await knex('move_sessions')
        .where(function() {
          this.where('start_waypoint_id', waypointId)
            .orWhere('end_waypoint_id', waypointId);
        })
        .del();

      console.log(`[Waypoints] Deleted ${affectedSessions.length} sessions referencing waypoint ${waypointId}`);
    }

    // Delete the waypoint
    await knex('move_waypoints')
      .where('id', waypointId)
      .andWhere('user_id', userId)
      .del();

    res.json({
      success: true,
      message: 'Waypoint deleted successfully',
      sessionsDeleted: affectedSessions.length
    });
  } catch (error) {
    console.error('Error deleting waypoint:', error);
    res.status(500).json({ error: 'Failed to delete waypoint' });
  }
});

/**
 * POST /api/waypoints/:moveId/reorder
 * Reorder waypoints for a move
 */
router.post('/:moveId/reorder', authenticate, async (req, res) => {
  try {
    const userId = req.user.user_id;
    const moveId = req.params.moveId;
    const { waypointIds } = req.body; // Array of waypoint IDs in desired order

    if (!Array.isArray(waypointIds)) {
      return res.status(400).json({ error: 'waypointIds must be an array' });
    }

    // Verify user owns the move
    const move = await knex('saved_moves')
      .where('id', moveId)
      .andWhere('user_id', userId)
      .first();

    if (!move) {
      return res.status(404).json({ error: 'Saved move not found' });
    }

    // Update sequence_order for each waypoint
    await knex.transaction(async (trx) => {
      for (let i = 0; i < waypointIds.length; i++) {
        await trx('move_waypoints')
          .where('id', waypointIds[i])
          .andWhere('saved_move_id', moveId)
          .andWhere('user_id', userId)
          .update({ sequence_order: i, updated_at: knex.fn.now() });
      }
    });

    // Return updated waypoints
    const waypoints = await knex('move_waypoints')
      .where('saved_move_id', moveId)
      .orderBy('sequence_order', 'asc');

    res.json(waypoints);
  } catch (error) {
    console.error('Error reordering waypoints:', error);
    res.status(500).json({ error: 'Failed to reorder waypoints' });
  }
});

/**
 * POST /api/waypoints/suggest
 * Auto-suggest waypoints based on route polyline and distance
 * Uses Google Maps Reverse Geocoding to find cities at ~500 mile intervals
 */
router.post('/suggest', authenticate, async (req, res) => {
  try {
    const { routePolyline, totalDistanceMiles, maxDailyMiles = 600 } = req.body;

    if (!routePolyline) {
      return res.status(400).json({ error: 'routePolyline is required' });
    }

    if (!totalDistanceMiles || totalDistanceMiles < maxDailyMiles) {
      return res.json({
        suggestions: [],
        message: 'Distance too short for waypoint suggestions'
      });
    }

    // Calculate number of stops needed
    const numStops = Math.ceil(totalDistanceMiles / maxDailyMiles) - 1;
    if (numStops <= 0) {
      return res.json({
        suggestions: [],
        message: 'No stops needed for this distance'
      });
    }

    // Decode polyline to get lat/lng points
    const polyline = require('@mapbox/polyline');
    let decodedPath;
    try {
      decodedPath = polyline.decode(routePolyline);
    } catch (decodeError) {
      console.error('Error decoding polyline:', decodeError);
      return res.status(400).json({ error: 'Invalid polyline format' });
    }

    if (!decodedPath || decodedPath.length < 2) {
      return res.status(400).json({ error: 'Polyline too short' });
    }

    // Sample points along the route at stop intervals
    // First, collect all coordinates to geocode
    const coordsToGeocode = [];
    for (let i = 1; i <= numStops; i++) {
      const fraction = i / (numStops + 1);
      const pathIndex = Math.floor(fraction * (decodedPath.length - 1));
      const point = decodedPath[Math.min(pathIndex, decodedPath.length - 1)];
      coordsToGeocode.push({
        id: i,
        lat: point[0],
        lng: point[1],
        fraction
      });
    }

    // Batch geocode all coordinates using the centralized service
    const geocodeResults = await batchReverseGeocode(coordsToGeocode, {
      correlationId: 'suggest',
      delayBetweenRequests: 300
    });

    // Build suggestions from geocode results
    const suggestions = coordsToGeocode.map(coord => {
      const geocode = geocodeResults.get(coord.id) || {};
      const distanceFromOrigin = Math.round(coord.fraction * totalDistanceMiles);
      const driveHoursFromOrigin = Math.round((distanceFromOrigin / 60) * 10) / 10;

      return {
        sequence_order: coord.id,
        lat: Math.round(coord.lat * 10000000) / 10000000,
        lng: Math.round(coord.lng * 10000000) / 10000000,
        city: geocode.city || `Stop ${coord.id}`,
        state: geocode.state || null,
        country: geocode.country || 'USA',
        source: 'suggested',
        distance_from_origin_miles: distanceFromOrigin,
        typical_drive_hours_from_origin: driveHoursFromOrigin,
        overnight_recommended: true,
        notes: `Suggested overnight stop ~${distanceFromOrigin} miles from origin`
      };
    });

    res.json({
      suggestions,
      numStops,
      totalDistanceMiles,
      maxDailyMiles
    });
  } catch (error) {
    console.error('Error suggesting waypoints:', error);
    res.status(500).json({ error: 'Failed to suggest waypoints', details: error.message });
  }
});

/**
 * POST /api/waypoints/:moveId/suggest-and-save
 * Auto-suggest waypoints and save them to the move
 * This is a convenience endpoint that combines suggest + save
 */
router.post('/:moveId/suggest-and-save', authenticate, async (req, res) => {
  try {
    const userId = req.user.user_id;
    const moveId = req.params.moveId;
    const { routePolyline, totalDistanceMiles, maxDailyMiles = 600, clearExisting = false } = req.body;

    // Verify user owns the move
    const move = await knex('saved_moves')
      .where('id', moveId)
      .andWhere('user_id', userId)
      .first();

    if (!move) {
      return res.status(404).json({ error: 'Saved move not found' });
    }

    if (!routePolyline || !totalDistanceMiles) {
      return res.status(400).json({ error: 'routePolyline and totalDistanceMiles are required' });
    }

    // Clear existing waypoints if requested (keep drop-off locations)
    if (clearExisting) {
      const deletableIds = await knex('move_waypoints')
        .where('saved_move_id', moveId)
        .andWhere('user_id', userId)
        .whereNot('source', 'dropoff_location')
        .pluck('id');

      if (deletableIds.length) {
        await detachWaypointSessions(moveId, deletableIds);
        await knex('move_waypoints')
          .whereIn('id', deletableIds)
          .del();
      }
    }

    const polyline = require('@mapbox/polyline');
    let decodedPath;
    try {
      decodedPath = polyline.decode(routePolyline);
    } catch (decodeError) {
      return res.status(400).json({ error: 'Invalid polyline format' });
    }

    // Generate a unique correlation ID for this request
    const correlationId = `suggest-save-${moveId}-${Date.now()}`;
    console.log(`[Waypoints] ${correlationId}: Starting intelligent waypoint suggestion`);

    // Get existing drop-off waypoints (sorted by distance from origin)
    const dropoffWaypoints = await knex('move_waypoints')
      .where('saved_move_id', moveId)
      .where('is_dropoff', true)
      .whereNotNull('lat')
      .whereNotNull('lng')
      .orderBy('distance_from_origin_miles', 'asc');

    console.log(`[Waypoints] ${correlationId}: Found ${dropoffWaypoints.length} drop-off waypoint(s) to route through`);

    // Build route segments: origin → dropoff1 → dropoff2 → ... → destination
    // Each segment gets its own overnight stop suggestions based on distance
    const segments = [];

    if (dropoffWaypoints.length === 0) {
      // Simple case: no drop-offs, one segment from origin to destination
      segments.push({
        startMiles: 0,
        endMiles: totalDistanceMiles,
        distanceMiles: totalDistanceMiles,
        description: 'Origin to Destination'
      });
    } else {
      // Complex case: route through drop-offs
      // Segment 1: Origin to first drop-off
      segments.push({
        startMiles: 0,
        endMiles: dropoffWaypoints[0].distance_from_origin_miles,
        distanceMiles: dropoffWaypoints[0].distance_from_origin_miles,
        description: `Origin to ${dropoffWaypoints[0].city}, ${dropoffWaypoints[0].state}`
      });

      // Middle segments: between drop-offs
      for (let i = 0; i < dropoffWaypoints.length - 1; i++) {
        const startMiles = dropoffWaypoints[i].distance_from_origin_miles;
        const endMiles = dropoffWaypoints[i + 1].distance_from_origin_miles;
        segments.push({
          startMiles,
          endMiles,
          distanceMiles: endMiles - startMiles,
          description: `${dropoffWaypoints[i].city} to ${dropoffWaypoints[i + 1].city}`
        });
      }

      // Final segment: Last drop-off to destination
      const lastDropoff = dropoffWaypoints[dropoffWaypoints.length - 1];
      segments.push({
        startMiles: lastDropoff.distance_from_origin_miles,
        endMiles: totalDistanceMiles,
        distanceMiles: totalDistanceMiles - lastDropoff.distance_from_origin_miles,
        description: `${lastDropoff.city}, ${lastDropoff.state} to Destination`
      });
    }

    console.log(`[Waypoints] ${correlationId}: Route divided into ${segments.length} segment(s)`);
    segments.forEach((seg, idx) => {
      console.log(`[Waypoints] ${correlationId}:   Segment ${idx + 1}: ${seg.description} (${seg.distanceMiles} miles)`);
    });

    // For each segment, use Google Directions API with optimize:true to get optimized waypoints
    // This ensures we get the best route within each segment between drop-offs
    const axios = require('axios');
    const coordsToGeocode = [];
    let stopCounter = 1;

    // Get origin and destination from saved move
    let routeData = move.route_data ? (typeof move.route_data === 'string' ? JSON.parse(move.route_data) : move.route_data) : null;
    if (!routeData) {
      routeData = {};
    }

    const ensureAddressForRole = async (role, locationId) => {
      if (!locationId || routeData[`${role}_address`]) {
        return;
      }
      const location = await knex('locations').where('id', locationId).first();
      if (!location) {
        return;
      }
      const components = [
        location.address || location.name,
        location.city,
        location.state,
        location.zip
      ].filter(Boolean);
      if (components.length) {
        routeData[`${role}_address`] = components.join(', ');
      }
      if (location.lat != null && location.lng != null) {
        routeData[`${role}_lat`] = location.lat;
        routeData[`${role}_lng`] = location.lng;
      }
    };

    await ensureAddressForRole('origin', move.origin_location_id);
    await ensureAddressForRole('destination', move.destination_location_id);

    if (!routeData?.origin_address || !routeData?.destination_address) {
      return res.status(400).json({ error: 'Saved move is missing origin or destination address' });
    }

    // For each segment, call Google Directions API with optimize:true
    for (let segIdx = 0; segIdx < segments.length; segIdx++) {
      const segment = segments[segIdx];
      const numStopsInSegment = Math.floor(segment.distanceMiles / maxDailyMiles);

      if (numStopsInSegment === 0) {
        console.log(`[Waypoints] ${correlationId}:   ${segment.description}: No stops needed (${segment.distanceMiles} < ${maxDailyMiles} miles)`);
        continue;
      }

      console.log(`[Waypoints] ${correlationId}:   ${segment.description}: Requesting ${numStopsInSegment} optimized stop(s) from Google`);

      // Determine segment origin and destination
      let segmentOrigin, segmentDestination;

      if (segIdx === 0) {
        // First segment: origin to first drop-off (or destination)
        segmentOrigin = routeData.origin_address;
      } else {
        // Use previous drop-off's coordinates
        const prevDropoff = dropoffWaypoints[segIdx - 1];
        segmentOrigin = `${prevDropoff.lat},${prevDropoff.lng}`;
      }

      if (segIdx < dropoffWaypoints.length) {
        // Segment ends at a drop-off
        const dropoff = dropoffWaypoints[segIdx];
        segmentDestination = `${dropoff.lat},${dropoff.lng}`;
      } else {
        // Final segment: ends at destination
        segmentDestination = routeData.destination_address;
      }

      // Place evenly-spaced waypoints along the polyline within this segment
      const segmentWaypoints = [];
      for (let i = 1; i <= numStopsInSegment; i++) {
        const fractionInSegment = i / (numStopsInSegment + 1);
        const milesIntoSegment = segment.distanceMiles * fractionInSegment;
        const totalMilesFromOrigin = segment.startMiles + milesIntoSegment;

        const fraction = totalMilesFromOrigin / totalDistanceMiles;
        const pathIndex = Math.floor(fraction * (decodedPath.length - 1));
        const point = decodedPath[Math.min(pathIndex, decodedPath.length - 1)];

        segmentWaypoints.push({
          lat: point[0],
          lng: point[1],
          estimatedDistance: Math.round(totalMilesFromOrigin)
        });
      }

      // Call Google Directions API with optimize:true for this segment
      const waypointsParam = segmentWaypoints.map(w => `${w.lat},${w.lng}`).join('|');
      const url = `https://maps.googleapis.com/maps/api/directions/json?origin=${encodeURIComponent(segmentOrigin)}&destination=${encodeURIComponent(segmentDestination)}&waypoints=optimize:true|${encodeURIComponent(waypointsParam)}&key=${GOOGLE_MAPS_API_KEY}`;

      console.log(`[Waypoints] ${correlationId}:     Calling Google Directions API for segment ${segIdx + 1}...`);

      const response = await axios.get(url, { timeout: 30000 });

      if (response.data.status !== 'OK') {
        console.error(`[Waypoints] ${correlationId}:     Segment ${segIdx + 1} API error:`, response.data.status);
        // Fall back to evenly-spaced waypoints if Google fails
        for (const wp of segmentWaypoints) {
          coordsToGeocode.push({
            id: stopCounter++,
            lat: wp.lat,
            lng: wp.lng,
            distanceFromOrigin: wp.estimatedDistance,
            segmentDescription: segment.description
          });
        }
        continue;
      }

      const route = response.data.routes[0];
      const legs = route.legs;
      const waypointOrder = response.data.routes[0].waypoint_order || [];

      console.log(`[Waypoints] ${correlationId}:     Google optimized waypoint order: [${waypointOrder.join(', ')}]`);

      // Reorder waypoints based on Google's optimization
      const optimizedSegmentWaypoints = waypointOrder.length > 0
        ? waypointOrder.map(idx => segmentWaypoints[idx])
        : segmentWaypoints;

      // Add optimized waypoints to geocode list with actual distances from route legs
      let cumulativeSegmentDistance = segment.startMiles * 1609.34; // Convert to meters
      for (let i = 0; i < legs.length - 1; i++) {  // -1 because last leg goes to segment destination
        const leg = legs[i];
        cumulativeSegmentDistance += leg.distance.value;

        const wp = optimizedSegmentWaypoints[i];
        coordsToGeocode.push({
          id: stopCounter++,
          lat: wp.lat,
          lng: wp.lng,
          distanceFromOrigin: Math.round(cumulativeSegmentDistance / 1609.34),
          segmentDescription: segment.description
        });
      }
    }

    if (coordsToGeocode.length === 0) {
      console.log(`[Waypoints] ${correlationId}: No overnight stops needed - all segments < ${maxDailyMiles} miles`);
      return res.json({
        waypoints: [],
        message: 'No overnight stops needed for this route'
      });
    }

    console.log(`[Waypoints] ${correlationId}: Geocoding ${coordsToGeocode.length} suggested stop location(s)`);

    // Get current max sequence order
    const maxOrder = await knex('move_waypoints')
      .where('saved_move_id', moveId)
      .max('sequence_order as max')
      .first();
    const startOrder = (maxOrder?.max || 0) + 1;

    // Batch geocode all coordinates using the centralized service
    // This handles caching, retry logic, and rate limiting automatically
    const geocodeResults = await batchReverseGeocode(coordsToGeocode, {
      correlationId,
      delayBetweenRequests: 300  // 300ms between requests for safety
    });

    // Save all waypoints to database
    const savedWaypoints = [];
    for (const coord of coordsToGeocode) {
      const geocode = geocodeResults.get(coord.id) || {};
      const distanceFromOrigin = coord.distanceFromOrigin; // Already calculated per segment
      const driveHoursFromOrigin = Math.round((distanceFromOrigin / 60) * 10) / 10;

      const [savedWaypoint] = await knex('move_waypoints')
        .insert({
          saved_move_id: moveId,
          user_id: userId,
          city: geocode.city || `Stop ${coord.id}`,
          state: geocode.state || null,
          country: geocode.country || 'USA',
          lat: Math.round(coord.lat * 10000000) / 10000000,
          lng: Math.round(coord.lng * 10000000) / 10000000,
          source: 'suggested',
          distance_from_origin_miles: distanceFromOrigin,
          typical_drive_hours_from_origin: driveHoursFromOrigin,
          notes: `Suggested overnight stop in ${coord.segmentDescription} (~${distanceFromOrigin} mi from origin)`,
          overnight_recommended: true,
          sequence_order: clearExisting ? coord.id : startOrder + coord.id - 1
        })
        .returning('*');

      savedWaypoints.push(savedWaypoint);
      console.log(`[Waypoints] ${correlationId}:   Saved: ${geocode.city || 'Stop'}, ${geocode.state || ''} (${distanceFromOrigin} mi)`);
    }

    console.log(`[Waypoints] ${correlationId}: Completed - saved ${savedWaypoints.length} waypoint(s)`);

    res.status(201).json({
      waypoints: savedWaypoints,
      message: `Added ${savedWaypoints.length} suggested overnight stop(s) for your route`
    });
  } catch (error) {
    console.error('Error in suggest-and-save:', error);
    res.status(500).json({ error: 'Failed to suggest and save waypoints', details: error.message });
  }
});

/**
 * POST /api/waypoints/:moveId/calculate-route
 * Calculate optimized route with all waypoints using Google Directions API
 * - Uses optimize:true to automatically reorder waypoints for shortest route
 * - Returns new polyline for map display
 * - Updates waypoint order in database based on optimization
 * - Updates saved_moves with new route data
 */
router.post('/:moveId/calculate-route', authenticate, async (req, res) => {
  const correlationId = `calc-route-${Date.now()}`;
  console.log(`[Waypoints] ${correlationId}: Starting optimized route calculation`);

  try {
    const userId = req.user.user_id;
    const moveId = req.params.moveId;

    // Verify user owns the move
    const move = await knex('saved_moves')
      .where('id', moveId)
      .andWhere('user_id', userId)
      .first();

    if (!move) {
      return res.status(404).json({ error: 'Saved move not found' });
    }

    // ENFORCE: Sync drop-off waypoints BEFORE optimization to ensure they're included
    console.log(`[Waypoints] ${correlationId}: Syncing drop-off waypoints before optimization`);
    const { syncDropoffWaypoints } = require('./savedMoves');
    await syncDropoffWaypoints(moveId, userId);

    // Get all waypoints in sequence order (now includes freshly synced drop-offs)
    const waypoints = await knex('move_waypoints')
      .where('saved_move_id', moveId)
      .orderBy('sequence_order', 'asc');

    if (waypoints.length === 0) {
      return res.status(400).json({ error: 'No waypoints to calculate' });
    }

    // Check for drop-off waypoints specifically
    const dropoffWaypoints = waypoints.filter(w => w.is_dropoff === true);
    console.log(`[Waypoints] ${correlationId}: Found ${dropoffWaypoints.length} drop-off waypoint(s) in route`);

    // Validate that drop-off waypoints have coordinates
    const dropoffsWithoutCoords = dropoffWaypoints.filter(w => w.lat == null || w.lng == null);
    if (dropoffsWithoutCoords.length > 0) {
      const missingCities = dropoffsWithoutCoords.map(w => w.city || 'Unknown').join(', ');
      console.warn(`[Waypoints] ${correlationId}: ${dropoffsWithoutCoords.length} drop-off(s) missing coordinates: ${missingCities}`);
      return res.status(400).json({
        error: 'Some drop-off locations are missing coordinates',
        details: `The following drop-off location(s) could not be geocoded: ${missingCities}. Please verify the addresses are correct.`,
        missingDropoffs: dropoffsWithoutCoords.map(w => ({
          city: w.city,
          state: w.state,
          locationId: w.location_id
        }))
      });
    }

    // Get all intermediate (dropoff) locations from move_locations for this move
    // These are the source of truth for which locations should have unloading sessions
    // Join with locations table to get city names and addresses for matching
    const intermediateLocations = await knex('move_locations')
      .join('locations', 'move_locations.location_id', 'locations.id')
      .where('move_locations.move_id', moveId)
      .where('move_locations.location_role', 'intermediate')
      .select('locations.id', 'locations.city', 'locations.state', 'locations.address', 'locations.name');

    // Build a Set of possible matches (city|state, city from address, city from name)
    const dropoffMatches = new Set();
    for (const loc of intermediateLocations) {
      // Add city|state if available
      if (loc.city && loc.state) {
        dropoffMatches.add(`${loc.city}|${loc.state}`.toLowerCase());
      }
      // Extract city from address using regex (e.g., "Dallas, TX" from "123 Main St, Dallas, TX 75211")
      if (loc.address) {
        const addressMatch = loc.address.match(/,\s*([^,]+),\s*([A-Z]{2})\s*\d{5}/);
        if (addressMatch) {
          const city = addressMatch[1].trim();
          const state = addressMatch[2].trim();
          dropoffMatches.add(`${city}|${state}`.toLowerCase());
        }
      }
      // Extract city from name if it contains common city patterns (e.g., "Dallas House" -> "Dallas")
      if (loc.name) {
        const nameWords = loc.name.split(' ');
        if (nameWords.length > 0) {
          // Try first word as potential city name
          dropoffMatches.add(nameWords[0].toLowerCase());
        }
      }
    }
    console.log(`[Waypoints] ${correlationId}: Found ${intermediateLocations.length} intermediate dropoff locations with ${dropoffMatches.size} match patterns:`, Array.from(dropoffMatches));

    // Check that all waypoints have coordinates
    const waypointsWithCoords = waypoints.filter(w => w.lat != null && w.lng != null);
    if (waypointsWithCoords.length !== waypoints.length) {
      return res.status(400).json({
        error: 'Some waypoints are missing coordinates. Please ensure all waypoints have been geocoded.'
      });
    }

    // Get origin and destination from saved move (fall back to location records if route_data missing)
    let routeData = move.route_data ? (typeof move.route_data === 'string' ? JSON.parse(move.route_data) : move.route_data) : null;
    if (!routeData) {
      routeData = {};
    }

    const ensureAddressForRole = async (role, locationId) => {
      if (!locationId || routeData[`${role}_address`]) {
        return;
      }
      const location = await knex('locations').where('id', locationId).first();
      if (!location) {
        return;
      }
      const components = [
        location.address || location.name,
        location.city,
        location.state,
        location.zip
      ].filter(Boolean);
      if (components.length) {
        routeData[`${role}_address`] = components.join(', ');
      }
      if (location.lat != null && location.lng != null) {
        routeData[`${role}_lat`] = location.lat;
        routeData[`${role}_lng`] = location.lng;
      }
    };

    await ensureAddressForRole('origin', move.origin_location_id);
    await ensureAddressForRole('destination', move.destination_location_id);

    if (!routeData?.origin_address || !routeData?.destination_address) {
      return res.status(400).json({ error: 'Saved move is missing origin or destination address' });
    }

    // SEGMENT-BASED OPTIMIZATION WITH FIXED WAYPOINT SUPPORT
    // Only optimize auto-suggested waypoints. Keep drop-offs AND manual waypoints fixed.
    // This ensures user can add custom stops that won't be reordered.

    console.log(`[Waypoints] ${correlationId}: Building route segments based on ${dropoffWaypoints.length} drop-off(s)`);

    // Separate waypoints by type:
    // - Drop-offs (is_dropoff = true): Always fixed in position
    // - Manual waypoints (source = 'manual'): Fixed in position (user-added)
    // - Suggested waypoints (source = 'suggested'): Can be optimized
    const fixedWaypoints = waypointsWithCoords.filter(w => w.is_dropoff || w.source === 'manual');
    const suggestedWaypoints = waypointsWithCoords.filter(w => !w.is_dropoff && w.source === 'suggested');

    console.log(`[Waypoints] ${correlationId}: Fixed waypoints: ${fixedWaypoints.length} (${dropoffWaypoints.length} drop-offs, ${fixedWaypoints.length - dropoffWaypoints.length} manual)`);
    console.log(`[Waypoints] ${correlationId}: Suggested waypoints: ${suggestedWaypoints.length} (can be optimized)`);

    // Build segments: each segment is origin → waypoints → (next fixed point or destination)
    const segments = [];
    const sortedFixedWaypoints = fixedWaypoints.sort((a, b) => a.sequence_order - b.sequence_order);

    if (sortedFixedWaypoints.length === 0) {
      // Simple case: no fixed waypoints, one segment with all suggested waypoints
      segments.push({
        origin: routeData.origin_address,
        destination: routeData.destination_address,
        suggestedWaypoints: suggestedWaypoints,
        fixedWaypoints: [],
        description: 'Origin to Destination'
      });
    } else {
      // Complex case: create segments between fixed waypoints
      let currentOrigin = routeData.origin_address;
      let lastSequenceOrder = -1;

      for (let i = 0; i < sortedFixedWaypoints.length; i++) {
        const fixedWaypoint = sortedFixedWaypoints[i];
        const fixedAddress = `${fixedWaypoint.lat},${fixedWaypoint.lng}`;

        // Get suggested waypoints between last point and this fixed waypoint
        const segmentSuggested = suggestedWaypoints.filter(w =>
          w.sequence_order > lastSequenceOrder && w.sequence_order < fixedWaypoint.sequence_order
        );

        // Get any fixed waypoints between last point and this fixed waypoint (for via points)
        const segmentFixed = sortedFixedWaypoints.filter((w, idx) =>
          idx < i && w.sequence_order > lastSequenceOrder && w.sequence_order < fixedWaypoint.sequence_order
        );

        const waypointType = fixedWaypoint.is_dropoff ? 'drop-off' : 'manual stop';
        segments.push({
          origin: currentOrigin,
          destination: fixedAddress,
          destinationFixedWaypoint: fixedWaypoint,
          suggestedWaypoints: segmentSuggested,
          fixedWaypoints: segmentFixed,
          description: `${i === 0 ? 'Origin' : sortedFixedWaypoints[i-1].city} → ${fixedWaypoint.city}, ${fixedWaypoint.state} (${waypointType})`
        });

        currentOrigin = fixedAddress;
        lastSequenceOrder = fixedWaypoint.sequence_order;
      }

      // Final segment: last fixed waypoint to destination
      const finalSuggested = suggestedWaypoints.filter(w => w.sequence_order > lastSequenceOrder);
      segments.push({
        origin: currentOrigin,
        destination: routeData.destination_address,
        suggestedWaypoints: finalSuggested,
        fixedWaypoints: [],
        description: `${sortedFixedWaypoints[sortedFixedWaypoints.length - 1].city} → Destination`
      });
    }

    console.log(`[Waypoints] ${correlationId}: Route divided into ${segments.length} segment(s):`);
    segments.forEach((seg, idx) => {
      const totalWaypoints = seg.suggestedWaypoints.length + seg.fixedWaypoints.length;
      console.log(`[Waypoints] ${correlationId}:   Segment ${idx + 1}: ${seg.description} (${seg.suggestedWaypoints.length} suggested, ${seg.fixedWaypoints.length} fixed)`);
    });

    // Optimize each segment separately and collect all results
    let allPolylines = [];
    const optimizedWaypoints = [];
    let globalSequenceOrder = 0;
    let cumulativeDistanceMeters = 0;
    let cumulativeDurationSeconds = 0;

    for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex++) {
      const segment = segments[segmentIndex];
      console.log(`[Waypoints] ${correlationId}: Optimizing segment ${segmentIndex + 1}/${segments.length}: ${segment.description}`);

      // Build waypoints parameter for Google Directions API
      // Fixed waypoints go first (in order), then suggested waypoints (can be optimized)
      // Google will optimize the suggested ones but keep fixed ones in place
      const allSegmentWaypoints = [
        ...segment.fixedWaypoints.sort((a, b) => a.sequence_order - b.sequence_order),
        ...segment.suggestedWaypoints
      ];

      // Only apply optimize:true if we have suggested waypoints
      const hasOptimizableWaypoints = segment.suggestedWaypoints.length > 0;
      const waypointsParam = allSegmentWaypoints.length > 0
        ? allSegmentWaypoints.map(w => `${w.lat},${w.lng}`).join('|')
        : '';

      let url = `https://maps.googleapis.com/maps/api/directions/json?origin=${encodeURIComponent(segment.origin)}&destination=${encodeURIComponent(segment.destination)}&key=${GOOGLE_MAPS_API_KEY}`;

      if (waypointsParam) {
        // Only optimize suggested waypoints, not fixed ones
        // Google's optimize:true will reorder ALL waypoints, so we need a different approach
        // For now, only enable optimization if ALL waypoints in segment are suggested
        const optimizeFlag = hasOptimizableWaypoints && segment.fixedWaypoints.length === 0 ? 'optimize:true|' : '';
        url += `&waypoints=${optimizeFlag}${encodeURIComponent(waypointsParam)}`;
      }

      const response = await axios.get(url, { timeout: 30000 });

      if (response.data.status !== 'OK') {
        console.error(`[Waypoints] ${correlationId}: Segment ${segmentIndex + 1} API error:`, response.data.status);
        return res.status(400).json({
          error: `Google Directions API error on segment ${segmentIndex + 1}: ${response.data.status}`,
          details: response.data.error_message
        });
      }

      const route = response.data.routes[0];
      const legs = route.legs;
      const waypointOrder = response.data.routes[0].waypoint_order || [];
      allPolylines.push(route.overview_polyline?.points);

      console.log(`[Waypoints] ${correlationId}:   Segment ${segmentIndex + 1} Google waypoint order: [${waypointOrder.join(', ')}]`);

      // Build final waypoint order for this segment
      let segmentWaypointsOrdered = [];

      if (waypointOrder.length > 0) {
        // Google optimized the waypoints - reorder according to waypoint_order
        // waypoint_order is indices into allSegmentWaypoints
        segmentWaypointsOrdered = waypointOrder.map(idx => allSegmentWaypoints[idx]);
      } else if (allSegmentWaypoints.length > 0) {
        // No optimization happened (no suggested waypoints), use original order
        segmentWaypointsOrdered = allSegmentWaypoints;
      }

      // Process each leg in this segment
      for (let i = 0; i < legs.length; i++) {
        const leg = legs[i];
        cumulativeDistanceMeters += leg.distance.value;
        cumulativeDurationSeconds += leg.duration.value;

        // If this leg ends at a waypoint (not the segment destination)
        if (i < segmentWaypointsOrdered.length) {
          const waypoint = segmentWaypointsOrdered[i];
          const distanceMiles = Math.round(cumulativeDistanceMeters / 1609.34);
          const durationHours = Math.round((cumulativeDurationSeconds / 3600) * 10) / 10;
          const segmentDistanceMiles = Math.round(leg.distance.value / 1609.34);
          const segmentDurationHours = Math.round((leg.duration.value / 3600) * 10) / 10;

          const waypointType = waypoint.is_dropoff ? '[DROP-OFF]' : (waypoint.source === 'manual' ? '[MANUAL]' : '');

          optimizedWaypoints.push({
            ...waypoint,
            sequence_order: globalSequenceOrder++,
            distance_from_origin_miles: distanceMiles,
            typical_drive_hours_from_origin: durationHours,
            segment_distance_miles: segmentDistanceMiles,
            segment_duration_hours: segmentDurationHours
          });

          console.log(`[Waypoints] ${correlationId}:     ${waypoint.city}, ${waypoint.state}: ${distanceMiles} mi (${segmentDistanceMiles} mi segment) ${waypointType}`);
        }
      }

      // If this segment ends at a fixed waypoint, add it to optimized waypoints
      if (segment.destinationFixedWaypoint) {
        const fixedWaypoint = segment.destinationFixedWaypoint;
        const lastLeg = legs[legs.length - 1];
        cumulativeDistanceMeters += lastLeg.distance.value;
        cumulativeDurationSeconds += lastLeg.duration.value;

        const distanceMiles = Math.round(cumulativeDistanceMeters / 1609.34);
        const durationHours = Math.round((cumulativeDurationSeconds / 3600) * 10) / 10;
        const segmentDistanceMiles = Math.round(lastLeg.distance.value / 1609.34);
        const segmentDurationHours = Math.round((lastLeg.duration.value / 3600) * 10) / 10;

        const waypointType = fixedWaypoint.is_dropoff ? '[DROP-OFF]' : '[MANUAL]';

        optimizedWaypoints.push({
          ...fixedWaypoint,
          sequence_order: globalSequenceOrder++,
          distance_from_origin_miles: distanceMiles,
          typical_drive_hours_from_origin: durationHours,
          segment_distance_miles: segmentDistanceMiles,
          segment_duration_hours: segmentDurationHours
        });

        console.log(`[Waypoints] ${correlationId}:     ${fixedWaypoint.city}, ${fixedWaypoint.state}: ${distanceMiles} mi ${waypointType}`);
      }
    }

    // Update all waypoints in database with optimized order and distances
    const updatedWaypoints = [];

    for (const waypoint of optimizedWaypoints) {
      await knex('move_waypoints')
        .where('id', waypoint.id)
        .update({
          sequence_order: waypoint.sequence_order,
          distance_from_origin_miles: waypoint.distance_from_origin_miles,
          typical_drive_hours_from_origin: waypoint.typical_drive_hours_from_origin,
          segment_distance_miles: waypoint.segment_distance_miles,
          segment_duration_hours: waypoint.segment_duration_hours,
          distance_source: 'calculated',
          // Preserve is_dropoff and source - don't override them
          updated_at: knex.fn.now()
        });

      updatedWaypoints.push(waypoint);
    }

    // Calculate totals
    const totalDistanceMiles = Math.round(cumulativeDistanceMeters / 1609.34);
    const totalDurationHours = Math.round((cumulativeDurationSeconds / 3600) * 10) / 10;

    // Combine all polylines (if multiple segments)
    const combinedPolyline = allPolylines.filter(Boolean).join('~'); // Use ~ as separator, frontend can split if needed

    // Get final leg info (from last segment)
    const lastSegment = segments[segments.length - 1];
    let finalLegDistanceMiles = 0;
    let finalLegDurationHours = 0;

    if (lastSegment) {
      // Re-fetch the last segment's route to get final leg
      const lastResponse = await axios.get(`https://maps.googleapis.com/maps/api/directions/json?origin=${encodeURIComponent(lastSegment.origin)}&destination=${encodeURIComponent(lastSegment.destination)}&key=${GOOGLE_MAPS_API_KEY}`, { timeout: 30000 });
      if (lastResponse.data.status === 'OK') {
        const lastLegs = lastResponse.data.routes[0].legs;
        const finalLeg = lastLegs[lastLegs.length - 1];
        finalLegDistanceMiles = Math.round(finalLeg.distance.value / 1609.34);
        finalLegDurationHours = Math.round((finalLeg.duration.value / 3600) * 10) / 10;
      }
    }

    console.log(`[Waypoints] ${correlationId}: Final leg to destination: ${finalLegDistanceMiles} mi, ${finalLegDurationHours} hrs`);

    // Update saved_moves with new route data
    const updatedRouteData = {
      ...routeData,
      route_polyline: allPolylines[0] || '',  // Use first segment's polyline for map display
      total_distance_miles: totalDistanceMiles,
      total_duration_hours: totalDurationHours,
      waypoints_optimized: true,
      last_calculated: new Date().toISOString(),
      optimization_method: 'segment-based'
    };

    await knex('saved_moves')
      .where('id', moveId)
      .update({
        route_data: JSON.stringify(updatedRouteData),
        updated_at: knex.fn.now()
      });

    console.log(`[Waypoints] ${correlationId}: Segment-based optimization complete. Total: ${totalDistanceMiles} mi, ${totalDurationHours} hrs across ${segments.length} segment(s)`);

    res.json({
      success: true,
      waypoints: updatedWaypoints,
      routePolyline: allPolylines[0] || '',
      totalDistanceMiles,
      totalDurationHours,
      numberOfSegments: segments.length,
      finalLegDistanceMiles,
      finalLegDurationHours,
      message: `Route optimized across ${segments.length} segment(s) with ${updatedWaypoints.length} waypoint(s)`
    });

  } catch (error) {
    console.error(`[Waypoints] ${correlationId}: Error calculating route:`, error);
    res.status(500).json({ error: 'Failed to calculate route', details: error.message });
  }
});

/**
 * POST /api/waypoints/:moveId/recalculate-route
 * Recalculate distances for existing waypoints WITHOUT reordering
 * Just calls Google Directions API with waypoints in current sequence order
 * Updates distance/duration fields only
 */
router.post('/:moveId/recalculate-route', authenticate, async (req, res) => {
  const correlationId = `recalc-route-${Date.now()}`;
  console.log(`[Waypoints] ${correlationId}: Recalculating route distances (no reordering)`);

  try {
    const userId = req.user.user_id;
    const moveId = req.params.moveId;

    // Verify user owns the move
    const move = await knex('saved_moves')
      .where('id', moveId)
      .andWhere('user_id', userId)
      .first();

    if (!move) {
      return res.status(404).json({ error: 'Saved move not found' });
    }

    // Get all waypoints in current sequence order
    const waypoints = await knex('move_waypoints')
      .where('saved_move_id', moveId)
      .orderBy('sequence_order', 'asc');

    if (waypoints.length === 0) {
      return res.status(400).json({ error: 'No waypoints to calculate' });
    }

    // Get origin and destination
    let routeData = move.route_data ? (typeof move.route_data === 'string' ? JSON.parse(move.route_data) : move.route_data) : null;
    if (!routeData) {
      routeData = {};
    }

    const ensureAddressForRole = async (role, locationId) => {
      if (!locationId || routeData[`${role}_address`]) {
        return;
      }
      const location = await knex('locations').where('id', locationId).first();
      if (!location) {
        return;
      }
      const components = [
        location.address || location.name,
        location.city,
        location.state,
        location.zip
      ].filter(Boolean);
      if (components.length) {
        routeData[`${role}_address`] = components.join(', ');
      }
      if (location.lat != null && location.lng != null) {
        routeData[`${role}_lat`] = location.lat;
        routeData[`${role}_lng`] = location.lng;
      }
    };

    await ensureAddressForRole('origin', move.origin_location_id);
    await ensureAddressForRole('destination', move.destination_location_id);

    if (!routeData?.origin_address || !routeData?.destination_address) {
      return res.status(400).json({ error: 'Saved move is missing origin or destination address' });
    }

    // Build waypoints parameter (NO optimize:true - keep current order)
    const waypointsWithCoords = waypoints.filter(w => w.lat != null && w.lng != null);
    const waypointsParam = waypointsWithCoords.map(w => `${w.lat},${w.lng}`).join('|');

    let url = `https://maps.googleapis.com/maps/api/directions/json?origin=${encodeURIComponent(routeData.origin_address)}&destination=${encodeURIComponent(routeData.destination_address)}&key=${GOOGLE_MAPS_API_KEY}`;

    if (waypointsParam) {
      // NO optimize:true - just calculate distances for current order
      url += `&waypoints=${encodeURIComponent(waypointsParam)}`;
    }

    console.log(`[Waypoints] ${correlationId}: Calling Google Directions API with ${waypointsWithCoords.length} waypoint(s) in current order`);

    const axios = require('axios');
    const response = await axios.get(url, { timeout: 30000 });

    if (response.data.status !== 'OK') {
      console.error(`[Waypoints] ${correlationId}: API error:`, response.data.status);
      return res.status(400).json({
        error: `Google Directions API error: ${response.data.status}`,
        details: response.data.error_message
      });
    }

    const route = response.data.routes[0];
    const legs = route.legs;

    // Update waypoints with cumulative distances
    let cumulativeDistanceMeters = 0;
    let cumulativeDurationSeconds = 0;
    const updatedWaypoints = [];

    for (let i = 0; i < legs.length; i++) {
      const leg = legs[i];
      cumulativeDistanceMeters += leg.distance.value;
      cumulativeDurationSeconds += leg.duration.value;

      // If this leg ends at a waypoint (not the final destination)
      if (i < waypointsWithCoords.length) {
        const waypoint = waypointsWithCoords[i];
        const distanceMiles = Math.round(cumulativeDistanceMeters / 1609.34);
        const durationHours = Math.round((cumulativeDurationSeconds / 3600) * 10) / 10;
        const segmentDistanceMiles = Math.round(leg.distance.value / 1609.34);
        const segmentDurationHours = Math.round((leg.duration.value / 3600) * 10) / 10;

        await knex('move_waypoints')
          .where('id', waypoint.id)
          .update({
            distance_from_origin_miles: distanceMiles,
            typical_drive_hours_from_origin: durationHours,
            segment_distance_miles: segmentDistanceMiles,
            segment_duration_hours: segmentDurationHours,
            distance_source: 'calculated',
            updated_at: knex.fn.now()
          });

        updatedWaypoints.push({
          ...waypoint,
          distance_from_origin_miles: distanceMiles,
          typical_drive_hours_from_origin: durationHours,
          segment_distance_miles: segmentDistanceMiles,
          segment_duration_hours: segmentDurationHours
        });

        const waypointType = waypoint.is_dropoff ? '[DROP-OFF]' : (waypoint.source === 'manual' ? '[MANUAL]' : '');
        console.log(`[Waypoints] ${correlationId}:   ${waypoint.city}, ${waypoint.state}: ${distanceMiles} mi (${segmentDistanceMiles} mi segment) ${waypointType}`);
      }
    }

    // Calculate totals
    const totalDistanceMiles = Math.round(cumulativeDistanceMeters / 1609.34);
    const totalDurationHours = Math.round((cumulativeDurationSeconds / 3600) * 10) / 10;

    // Get final leg info
    const finalLeg = legs[legs.length - 1];
    const finalLegDistanceMiles = Math.round(finalLeg.distance.value / 1609.34);
    const finalLegDurationHours = Math.round((finalLeg.duration.value / 3600) * 10) / 10;

    console.log(`[Waypoints] ${correlationId}: Final leg to destination: ${finalLegDistanceMiles} mi, ${finalLegDurationHours} hrs`);

    // Update saved_moves with new route data
    const updatedRouteData = {
      ...routeData,
      route_polyline: route.overview_polyline?.points || '',
      total_distance_miles: totalDistanceMiles,
      total_duration_hours: totalDurationHours,
      waypoints_optimized: false,  // Not optimized, just recalculated
      last_calculated: new Date().toISOString()
    };

    await knex('saved_moves')
      .where('id', moveId)
      .update({
        route_data: JSON.stringify(updatedRouteData),
        updated_at: knex.fn.now()
      });

    console.log(`[Waypoints] ${correlationId}: Recalculation complete. Total: ${totalDistanceMiles} mi, ${totalDurationHours} hrs`);

    res.json({
      success: true,
      waypoints: updatedWaypoints,
      routePolyline: route.overview_polyline?.points || '',
      totalDistanceMiles,
      totalDurationHours,
      finalLegDistanceMiles,
      finalLegDurationHours,
      message: `Route recalculated with ${updatedWaypoints.length} waypoint(s) in current order`
    });

  } catch (error) {
    console.error(`[Waypoints] ${correlationId}: Error recalculating route:`, error);
    res.status(500).json({ error: 'Failed to recalculate route', details: error.message });
  }
});

module.exports = router;
