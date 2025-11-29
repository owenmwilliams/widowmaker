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

    // Clear existing waypoints if requested
    if (clearExisting) {
      await knex('move_waypoints')
        .where('saved_move_id', moveId)
        .andWhere('user_id', userId)
        .del();
    }

    // Calculate suggestions
    const numStops = Math.ceil(totalDistanceMiles / maxDailyMiles) - 1;
    if (numStops <= 0) {
      return res.json({
        waypoints: [],
        message: 'No stops needed for this distance'
      });
    }

    const polyline = require('@mapbox/polyline');
    let decodedPath;
    try {
      decodedPath = polyline.decode(routePolyline);
    } catch (decodeError) {
      return res.status(400).json({ error: 'Invalid polyline format' });
    }

    // Get current max sequence order
    const maxOrder = await knex('move_waypoints')
      .where('saved_move_id', moveId)
      .max('sequence_order as max')
      .first();
    const startOrder = (maxOrder?.max || 0) + 1;

    // Generate a unique correlation ID for this request
    const correlationId = `suggest-save-${moveId}-${Date.now()}`;
    console.log(`[Waypoints] ${correlationId}: Starting waypoint suggestion for ${numStops} stops`);

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
    // This handles caching, retry logic, and rate limiting automatically
    const geocodeResults = await batchReverseGeocode(coordsToGeocode, {
      correlationId,
      delayBetweenRequests: 300  // 300ms between requests for safety
    });

    // Save all waypoints to database
    const savedWaypoints = [];
    for (const coord of coordsToGeocode) {
      const geocode = geocodeResults.get(coord.id) || {};
      const distanceFromOrigin = Math.round(coord.fraction * totalDistanceMiles);
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
          notes: `Suggested overnight stop ~${distanceFromOrigin} miles from origin`,
          overnight_recommended: true,
          sequence_order: clearExisting ? coord.id : startOrder + coord.id - 1
        })
        .returning('*');

      savedWaypoints.push(savedWaypoint);
    }

    console.log(`[Waypoints] ${correlationId}: Completed - saved ${savedWaypoints.length} waypoints`);

    res.status(201).json({
      waypoints: savedWaypoints,
      numStops,
      message: `Added ${savedWaypoints.length} suggested waypoints`
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

    // Get all waypoints in sequence order
    const waypoints = await knex('move_waypoints')
      .where('saved_move_id', moveId)
      .orderBy('sequence_order', 'asc');

    if (waypoints.length === 0) {
      return res.status(400).json({ error: 'No waypoints to calculate' });
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

    // Build Google Directions API request with optimize:true
    const origin = encodeURIComponent(routeData.origin_address);
    const destination = encodeURIComponent(routeData.destination_address);

    // Build waypoints string with optimize:true prefix
    // Format: optimize:true|lat,lng|lat,lng|...
    const waypointsParam = 'optimize:true|' + waypointsWithCoords
      .map(w => `${w.lat},${w.lng}`)
      .join('|');

    const url = `https://maps.googleapis.com/maps/api/directions/json?origin=${origin}&destination=${destination}&waypoints=${encodeURIComponent(waypointsParam)}&key=${GOOGLE_MAPS_API_KEY}`;

    console.log(`[Waypoints] ${correlationId}: Calling Directions API with ${waypointsWithCoords.length} waypoints (optimize:true)`);

    const response = await axios.get(url, { timeout: 30000 });

    if (response.data.status !== 'OK') {
      console.error(`[Waypoints] ${correlationId}: Directions API error:`, response.data.status, response.data.error_message);
      return res.status(400).json({
        error: `Google Directions API error: ${response.data.status}`,
        details: response.data.error_message
      });
    }

    const route = response.data.routes[0];
    const legs = route.legs;
    const waypointOrder = route.waypoint_order; // Array of indices showing optimized order
    const overviewPolyline = route.overview_polyline?.points;

    console.log(`[Waypoints] ${correlationId}: Optimized waypoint order: ${waypointOrder.join(', ')}`);

    // Reorder waypoints based on Google's optimization
    // waypointOrder contains indices into the original waypointsWithCoords array
    const optimizedWaypoints = waypointOrder.map(idx => waypointsWithCoords[idx]);

    // Calculate cumulative distances and update each waypoint with new order
    let cumulativeDistanceMeters = 0;
    let cumulativeDurationSeconds = 0;
    const updatedWaypoints = [];

    for (let i = 0; i < optimizedWaypoints.length; i++) {
      const waypoint = optimizedWaypoints[i];
      const leg = legs[i]; // leg from previous point to this waypoint

      // Add this leg's distance to cumulative
      cumulativeDistanceMeters += leg.distance.value;
      cumulativeDurationSeconds += leg.duration.value;

      const distanceMiles = Math.round(cumulativeDistanceMeters / 1609.34);
      const durationHours = Math.round((cumulativeDurationSeconds / 3600) * 10) / 10;

      // Store segment distance (from previous point) for display
      const segmentDistanceMiles = Math.round(leg.distance.value / 1609.34);
      const segmentDurationHours = Math.round((leg.duration.value / 3600) * 10) / 10;

      // Check if this waypoint is a dropoff location based on move_locations
      // Match by city|state name or just city name (normalized to lowercase)
      const waypointKeyFull = `${waypoint.city}|${waypoint.state || ''}`.toLowerCase();
      const waypointKeyCity = waypoint.city ? waypoint.city.toLowerCase() : '';
      const isDropoff = dropoffMatches.has(waypointKeyFull) || dropoffMatches.has(waypointKeyCity);

      // Update waypoint in database with new sequence_order and distances (including segment data)
      // Also sync is_dropoff from move_locations (source of truth)
      await knex('move_waypoints')
        .where('id', waypoint.id)
        .update({
          sequence_order: i, // New optimized order
          distance_from_origin_miles: distanceMiles,
          typical_drive_hours_from_origin: durationHours,
          segment_distance_miles: segmentDistanceMiles,
          segment_duration_hours: segmentDurationHours,
          distance_source: 'calculated',
          is_dropoff: isDropoff, // Sync from move_locations
          updated_at: knex.fn.now()
        });

      updatedWaypoints.push({
        id: waypoint.id,
        city: waypoint.city,
        state: waypoint.state,
        lat: waypoint.lat,
        lng: waypoint.lng,
        sequence_order: i,
        distance_from_origin_miles: distanceMiles,
        typical_drive_hours_from_origin: durationHours,
        segment_distance_miles: segmentDistanceMiles,
        segment_duration_hours: segmentDurationHours,
        distance_source: 'calculated',
        overnight_recommended: waypoint.overnight_recommended,
        is_dropoff: isDropoff
      });

      console.log(`[Waypoints] ${correlationId}: ${i + 1}. ${waypoint.city}, ${waypoint.state}: ${distanceMiles} mi cumulative (${segmentDistanceMiles} mi segment)${isDropoff ? ' [DROPOFF LOCATION]' : ''}`);
    }

    // Calculate total route distance including final leg to destination
    const totalDistanceMeters = legs.reduce((sum, leg) => sum + leg.distance.value, 0);
    const totalDistanceMiles = Math.round(totalDistanceMeters / 1609.34);
    const totalDurationSeconds = legs.reduce((sum, leg) => sum + leg.duration.value, 0);
    const totalDurationHours = Math.round((totalDurationSeconds / 3600) * 10) / 10;

    // Get the final leg (from last waypoint to destination)
    const finalLeg = legs[legs.length - 1];
    const finalLegDistanceMiles = Math.round(finalLeg.distance.value / 1609.34);
    const finalLegDurationHours = Math.round((finalLeg.duration.value / 3600) * 10) / 10;
    console.log(`[Waypoints] ${correlationId}: Final leg to destination: ${finalLegDistanceMiles} mi, ${finalLegDurationHours} hrs`);

    // Update saved_moves with new route data (polyline and total distance)
    const updatedRouteData = {
      ...routeData,
      route_polyline: overviewPolyline,
      total_distance_miles: totalDistanceMiles,
      total_duration_hours: totalDurationHours,
      waypoints_optimized: true,
      last_calculated: new Date().toISOString()
    };

    await knex('saved_moves')
      .where('id', moveId)
      .update({
        route_data: JSON.stringify(updatedRouteData),
        updated_at: knex.fn.now()
      });

    console.log(`[Waypoints] ${correlationId}: Route calculation complete. Total: ${totalDistanceMiles} mi, ${totalDurationHours} hrs`);

    res.json({
      success: true,
      waypoints: updatedWaypoints,
      routePolyline: overviewPolyline,
      totalDistanceMiles,
      totalDurationHours,
      numberOfLegs: legs.length,
      waypointsReordered: waypointOrder.some((idx, i) => idx !== i), // True if order changed
      finalLegDistanceMiles,
      finalLegDurationHours,
      message: `Route optimized with ${updatedWaypoints.length} waypoints`
    });

  } catch (error) {
    console.error(`[Waypoints] ${correlationId}: Error calculating route:`, error);
    res.status(500).json({ error: 'Failed to calculate route', details: error.message });
  }
});

module.exports = router;
