'use strict';

/**
 * Route Service
 *
 * Route/distance/travel-time planning, waypoint management, and
 * route optimization using Google Maps or haversine fallback.
 */

const knex = require('../infra/knex');
const axios = require('axios');
const { estimateRoadDistance, estimateDriveHours } = require('./distanceService');
const { COST_PARAMS } = require('./moveCostService');
const { forwardGeocode, batchReverseGeocode, resolveCityStateFromLocation } = require('../infra/geocodingService');

const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;

// ── Private helpers ───────────────────────────────────────────────────────────

async function detachWaypointSessions(moveId, waypointIds) {
  if (!Array.isArray(waypointIds) || waypointIds.length === 0) return;
  await knex('move_sessions')
    .where('saved_move_id', moveId)
    .whereIn('start_waypoint_id', waypointIds)
    .update({ start_waypoint_id: null, updated_at: knex.fn.now() });
  await knex('move_sessions')
    .where('saved_move_id', moveId)
    .whereIn('end_waypoint_id', waypointIds)
    .update({ end_waypoint_id: null, updated_at: knex.fn.now() });
}

async function ensureAddressForRole(routeData, role, locationId) {
  if (!locationId || routeData[`${role}_address`]) return;
  const location = await knex('locations').where('id', locationId).first();
  if (!location) return;
  const components = [
    location.address || location.name,
    location.city,
    location.state,
    location.zip
  ].filter(Boolean);
  if (components.length) routeData[`${role}_address`] = components.join(', ');
  if (location.lat != null && location.lng != null) {
    routeData[`${role}_lat`] = location.lat;
    routeData[`${role}_lng`] = location.lng;
  }
}

// ── calculateRoute (Vector agent tool) ───────────────────────────────────────

/**
 * Calculate route between origin and destination.
 *
 * @param {string} userId
 * @param {object} args - { origin_text, destination_text }
 * @returns {object} - { distanceMiles, driveHours, fuelCost, ... }
 */
async function calculateRoute(userId, args) {
  let originCity, originState, destCity, destState;

  if (args.origin_text) {
    const parts = args.origin_text.split(',').map(s => s.trim());
    originCity = parts[0];
    originState = parts[1] || '';
  } else {
    const loc = await knex('locations')
      .select('city', 'state')
      .where({ user_id: userId, location_type: 'primary_residence' })
      .first();
    if (!loc) {
      return { success: false, error: 'No origin location found. Please provide an origin or set your primary location.' };
    }
    originCity = loc.city;
    originState = loc.state;
  }

  if (args.destination_text) {
    const parts = args.destination_text.split(',').map(s => s.trim());
    destCity = parts[0];
    destState = parts[1] || '';
  } else {
    return { success: false, error: 'Please provide a destination city/address.' };
  }

  if (!originCity) {
    return { success: false, error: 'Could not determine origin city.' };
  }

  let distanceMiles = null;
  let driveHours = null;
  let routeSource = 'estimated';

  try {
    const fetch = require('node-fetch');
    const apiKey = process.env.GOOGLE_MAPS_API_KEY;
    if (apiKey) {
      const origin = `${originCity}, ${originState}`;
      const destination = `${destCity}, ${destState}`;
      const url = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${encodeURIComponent(origin)}&destinations=${encodeURIComponent(destination)}&units=imperial&key=${apiKey}`;
      const resp = await fetch(url);
      const data = await resp.json();
      const element = data.rows?.[0]?.elements?.[0];
      if (element?.status === 'OK') {
        distanceMiles = Math.round(element.distance.value / 1609.34);
        driveHours = Math.round((element.duration.value / 3600) * 10) / 10;
        routeSource = 'google_maps';
      }
    }
  } catch (err) {
    console.warn('[route] Google Maps lookup failed:', err.message);
  }

  if (!distanceMiles) {
    const straightLine = 500;
    distanceMiles = Math.round(estimateRoadDistance(straightLine));
    driveHours = estimateDriveHours(distanceMiles);
    routeSource = 'haversine_estimate';
  }

  const fuelCost = Math.round(distanceMiles * COST_PARAMS.fuelCostPerMile);
  const driveDays = Math.ceil(driveHours / 8);
  const overnightStops = Math.max(0, driveDays - 1);

  return {
    success: true,
    origin: `${originCity}, ${originState}`,
    destination: `${destCity}, ${destState}`,
    distanceMiles,
    driveHours,
    driveDays,
    overnightStops,
    estimatedFuelCost: fuelCost,
    overnightCost: overnightStops * COST_PARAMS.overnightStopCost,
    routeSource,
  };
}

// ── syncDropoffWaypoints ──────────────────────────────────────────────────────

/**
 * Sync move_waypoints rows to match the intermediate drop-off locations on a
 * saved move. Called after create/update of a saved move.
 */
async function syncDropoffWaypoints(moveId, userId) {
  try {
    const dropoffs = await knex('move_locations as ml')
      .leftJoin('locations as loc', 'ml.location_id', 'loc.id')
      .select(
        'ml.location_id',
        'ml.sequence_order',
        'loc.name as location_name',
        'loc.city as loc_city',
        'loc.state as loc_state',
        'loc.country as loc_country',
        'loc.address as loc_address',
        'loc.zip as loc_zip',
        'loc.lat as loc_lat',
        'loc.lng as loc_lng'
      )
      .where('ml.move_id', moveId)
      .andWhere('ml.location_role', 'intermediate')
      .orderBy('ml.sequence_order', 'asc');

    const dropoffIds = dropoffs.map(d => d.location_id).filter(Boolean);

    if (!dropoffIds.length) {
      const waypointIds = await knex('move_waypoints')
        .where('saved_move_id', moveId)
        .whereNotNull('location_id')
        .pluck('id');
      if (waypointIds.length) {
        await detachWaypointSessions(moveId, waypointIds);
        await knex('move_waypoints').whereIn('id', waypointIds).del();
      }
      return;
    }

    const obsoleteWaypointIds = await knex('move_waypoints')
      .where('saved_move_id', moveId)
      .whereNotNull('location_id')
      .whereNotIn('location_id', dropoffIds)
      .pluck('id');

    if (obsoleteWaypointIds.length) {
      await detachWaypointSessions(moveId, obsoleteWaypointIds);
      await knex('move_waypoints').whereIn('id', obsoleteWaypointIds).del();
    }

    const existingWaypoints = await knex('move_waypoints')
      .where('saved_move_id', moveId)
      .whereNotNull('location_id');

    const existingByLocation = new Map(
      existingWaypoints.map(wp => [Number(wp.location_id), wp])
    );

    for (let index = 0; index < dropoffs.length; index++) {
      const dropoff = dropoffs[index];
      const locationId = dropoff.location_id;
      if (!locationId) continue;

      const { city, state, country } = resolveCityStateFromLocation(dropoff);
      let lat = dropoff.loc_lat;
      let lng = dropoff.loc_lng;

      if (lat == null || lng == null) {
        const addressParts = [];
        if (dropoff.loc_address) addressParts.push(dropoff.loc_address);
        if (dropoff.loc_city || city) addressParts.push(dropoff.loc_city || city);
        if (state) addressParts.push(state);
        if (dropoff.loc_zip) addressParts.push(dropoff.loc_zip);
        const addressOverride = addressParts.length > 0 ? addressParts.join(', ') : null;

        try {
          const geocodeResult = await forwardGeocode(
            city || dropoff.location_name || addressOverride,
            state || null,
            country,
            { correlationId: `dropoff-${moveId}-${locationId}`, addressOverride }
          );
          if (geocodeResult?.lat != null && geocodeResult?.lng != null) {
            lat = geocodeResult.lat;
            lng = geocodeResult.lng;
          }
        } catch (geoError) {
          console.warn(`[route] Geocoding drop-off ${locationId} failed`, geoError.message);
        }
      }

      const numericSequence =
        dropoff.sequence_order !== null && dropoff.sequence_order !== undefined
          ? Number(dropoff.sequence_order)
          : NaN;
      const baseOrder = Number.isFinite(numericSequence) ? numericSequence : index;
      const sequenceOrder = baseOrder + 1;
      const cityLabel = city || dropoff.location_name || 'Drop-off stop';
      const notesLabel = `Drop-off at ${cityLabel}${state ? `, ${state}` : ''}`;

      const payload = {
        city: cityLabel,
        state: state || null,
        country: country || 'USA',
        lat: lat || null,
        lng: lng || null,
        sequence_order: sequenceOrder,
        is_dropoff: true,
        source: 'dropoff_location',
        location_id: locationId,
        notes: notesLabel,
        updated_at: knex.fn.now()
      };

      const existing = existingByLocation.get(Number(locationId));
      if (existing) {
        await knex('move_waypoints').where('id', existing.id).update(payload);
      } else {
        await knex('move_waypoints').insert({
          saved_move_id: moveId,
          user_id: userId,
          ...payload,
          created_at: knex.fn.now()
        });
      }
    }
  } catch (error) {
    console.error(`[route] Failed to sync drop-off waypoints for move ${moveId}`, error);
  }
}

// ── Waypoint CRUD ─────────────────────────────────────────────────────────────

async function getWaypoints(userId, moveId) {
  const move = await knex('saved_moves')
    .where('id', moveId)
    .andWhere('user_id', userId)
    .first();
  if (!move) {
    const err = new Error('Saved move not found');
    err.statusCode = 404;
    throw err;
  }
  return knex('move_waypoints')
    .where('saved_move_id', moveId)
    .orderBy('sequence_order', 'asc');
}

async function createWaypoint(userId, moveId, body) {
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
  } = body;

  const move = await knex('saved_moves')
    .where('id', moveId)
    .andWhere('user_id', userId)
    .first();
  if (!move) {
    const err = new Error('Saved move not found');
    err.statusCode = 404;
    throw err;
  }
  if (!city) {
    const err = new Error('City is required');
    err.statusCode = 400;
    throw err;
  }

  let waypointLat = lat;
  let waypointLng = lng;
  if (waypointLat == null || waypointLng == null) {
    console.log(`[route] Forward geocoding: ${city}, ${state || 'USA'}`);
    const geocodeResult = await forwardGeocode(city, state, country, {
      correlationId: `waypoint-create-${moveId}`
    });
    if (geocodeResult.lat != null && geocodeResult.lng != null) {
      waypointLat = geocodeResult.lat;
      waypointLng = geocodeResult.lng;
      console.log(`[route] Geocoded ${city}, ${state} -> ${waypointLat}, ${waypointLng}`);
    } else {
      console.warn(`[route] Could not geocode ${city}, ${state} - marker may not appear on map`);
    }
  }

  let order = sequenceOrder;
  if (order === undefined || order === null) {
    const maxOrder = await knex('move_waypoints')
      .where('saved_move_id', moveId)
      .max('sequence_order as max')
      .first();
    order = (maxOrder?.max || 0) + 1;
  }

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

  return result[0];
}

async function updateWaypoint(userId, waypointId, body) {
  const existing = await knex('move_waypoints')
    .where('id', waypointId)
    .andWhere('user_id', userId)
    .first();
  if (!existing) {
    const err = new Error('Waypoint not found');
    err.statusCode = 404;
    throw err;
  }

  const {
    city, state, country, lat, lng, source,
    distanceFromOriginMiles, typicalDriveHoursFromOrigin,
    notes, overnightRecommended, isDropoff, sequenceOrder
  } = body;

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

  const cityChanged = city !== undefined && city !== existing.city;
  const stateChanged = state !== undefined && state !== existing.state;
  if ((cityChanged || stateChanged) && lat === undefined && lng === undefined) {
    const updatedCity = city !== undefined ? city : existing.city;
    const updatedState = state !== undefined ? state : existing.state;
    const updatedCountry = country !== undefined ? country : existing.country;
    console.log(`[route] Forward geocoding updated location: ${updatedCity}, ${updatedState}`);
    const geocodeResult = await forwardGeocode(updatedCity, updatedState, updatedCountry, {
      correlationId: `waypoint-update-${waypointId}`
    });
    if (geocodeResult.lat != null && geocodeResult.lng != null) {
      updateData.lat = geocodeResult.lat;
      updateData.lng = geocodeResult.lng;
      updateData.source = 'manual_geocoded';
    }
  }

  updateData.updated_at = knex.fn.now();

  const result = await knex('move_waypoints')
    .where('id', waypointId)
    .andWhere('user_id', userId)
    .update(updateData)
    .returning('*');

  return result[0];
}

async function deleteWaypoint(userId, waypointId) {
  const existing = await knex('move_waypoints')
    .where('id', waypointId)
    .andWhere('user_id', userId)
    .first();
  if (!existing) {
    const err = new Error('Waypoint not found');
    err.statusCode = 404;
    throw err;
  }

  const affectedSessions = await knex('move_sessions')
    .where(function () {
      this.where('start_waypoint_id', waypointId).orWhere('end_waypoint_id', waypointId);
    })
    .select('id');

  if (affectedSessions.length > 0) {
    await knex('move_sessions')
      .where(function () {
        this.where('start_waypoint_id', waypointId).orWhere('end_waypoint_id', waypointId);
      })
      .del();
    console.log(`[route] Deleted ${affectedSessions.length} sessions referencing waypoint ${waypointId}`);
  }

  await knex('move_waypoints').where('id', waypointId).andWhere('user_id', userId).del();

  return {
    success: true,
    message: 'Waypoint deleted successfully',
    sessionsDeleted: affectedSessions.length
  };
}

async function reorderWaypoints(userId, moveId, waypointIds) {
  if (!Array.isArray(waypointIds)) {
    const err = new Error('waypointIds must be an array');
    err.statusCode = 400;
    throw err;
  }

  const move = await knex('saved_moves')
    .where('id', moveId)
    .andWhere('user_id', userId)
    .first();
  if (!move) {
    const err = new Error('Saved move not found');
    err.statusCode = 404;
    throw err;
  }

  await knex.transaction(async trx => {
    for (let i = 0; i < waypointIds.length; i++) {
      await trx('move_waypoints')
        .where('id', waypointIds[i])
        .andWhere('saved_move_id', moveId)
        .andWhere('user_id', userId)
        .update({ sequence_order: i, updated_at: knex.fn.now() });
    }
  });

  return knex('move_waypoints')
    .where('saved_move_id', moveId)
    .orderBy('sequence_order', 'asc');
}

// ── Waypoint suggestion ───────────────────────────────────────────────────────

async function suggestWaypoints(body) {
  const { routePolyline, totalDistanceMiles, maxDailyMiles = 600 } = body;

  if (!routePolyline) {
    const err = new Error('routePolyline is required');
    err.statusCode = 400;
    throw err;
  }

  if (!totalDistanceMiles || totalDistanceMiles < maxDailyMiles) {
    return { suggestions: [], message: 'Distance too short for waypoint suggestions' };
  }

  const numStops = Math.ceil(totalDistanceMiles / maxDailyMiles) - 1;
  if (numStops <= 0) {
    return { suggestions: [], message: 'No stops needed for this distance' };
  }

  const polyline = require('@mapbox/polyline');
  let decodedPath;
  try {
    decodedPath = polyline.decode(routePolyline);
  } catch (decodeError) {
    console.error('[route] Error decoding polyline:', decodeError);
    const err = new Error('Invalid polyline format');
    err.statusCode = 400;
    throw err;
  }

  if (!decodedPath || decodedPath.length < 2) {
    const err = new Error('Polyline too short');
    err.statusCode = 400;
    throw err;
  }

  const coordsToGeocode = [];
  for (let i = 1; i <= numStops; i++) {
    const fraction = i / (numStops + 1);
    const pathIndex = Math.floor(fraction * (decodedPath.length - 1));
    const point = decodedPath[Math.min(pathIndex, decodedPath.length - 1)];
    coordsToGeocode.push({ id: i, lat: point[0], lng: point[1], fraction });
  }

  const geocodeResults = await batchReverseGeocode(coordsToGeocode, {
    correlationId: 'suggest',
    delayBetweenRequests: 300
  });

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

  return { suggestions, numStops, totalDistanceMiles, maxDailyMiles };
}

async function suggestAndSaveWaypoints(userId, moveId, body) {
  const { routePolyline, totalDistanceMiles, maxDailyMiles = 600, clearExisting = false } = body;

  const move = await knex('saved_moves')
    .where('id', moveId)
    .andWhere('user_id', userId)
    .first();
  if (!move) {
    const err = new Error('Saved move not found');
    err.statusCode = 404;
    throw err;
  }

  if (!routePolyline || !totalDistanceMiles) {
    const err = new Error('routePolyline and totalDistanceMiles are required');
    err.statusCode = 400;
    throw err;
  }

  if (clearExisting) {
    const deletableIds = await knex('move_waypoints')
      .where('saved_move_id', moveId)
      .andWhere('user_id', userId)
      .whereNot('source', 'dropoff_location')
      .pluck('id');
    if (deletableIds.length) {
      await detachWaypointSessions(moveId, deletableIds);
      await knex('move_waypoints').whereIn('id', deletableIds).del();
    }
  }

  const polyline = require('@mapbox/polyline');
  let decodedPath;
  try {
    decodedPath = polyline.decode(routePolyline);
  } catch (decodeError) {
    const err = new Error('Invalid polyline format');
    err.statusCode = 400;
    throw err;
  }

  const correlationId = `suggest-save-${moveId}-${Date.now()}`;
  console.log(`[route] ${correlationId}: Starting intelligent waypoint suggestion`);

  const dropoffWaypoints = await knex('move_waypoints')
    .where('saved_move_id', moveId)
    .where('is_dropoff', true)
    .whereNotNull('lat')
    .whereNotNull('lng')
    .orderBy('distance_from_origin_miles', 'asc');

  console.log(`[route] ${correlationId}: Found ${dropoffWaypoints.length} drop-off waypoint(s) to route through`);

  const segments = [];
  if (dropoffWaypoints.length === 0) {
    segments.push({
      startMiles: 0,
      endMiles: totalDistanceMiles,
      distanceMiles: totalDistanceMiles,
      description: 'Origin to Destination'
    });
  } else {
    segments.push({
      startMiles: 0,
      endMiles: dropoffWaypoints[0].distance_from_origin_miles,
      distanceMiles: dropoffWaypoints[0].distance_from_origin_miles,
      description: `Origin to ${dropoffWaypoints[0].city}, ${dropoffWaypoints[0].state}`
    });
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
    const lastDropoff = dropoffWaypoints[dropoffWaypoints.length - 1];
    segments.push({
      startMiles: lastDropoff.distance_from_origin_miles,
      endMiles: totalDistanceMiles,
      distanceMiles: totalDistanceMiles - lastDropoff.distance_from_origin_miles,
      description: `${lastDropoff.city}, ${lastDropoff.state} to Destination`
    });
  }

  let routeData = move.route_data
    ? (typeof move.route_data === 'string' ? JSON.parse(move.route_data) : move.route_data)
    : {};

  await ensureAddressForRole(routeData, 'origin', move.origin_location_id);
  await ensureAddressForRole(routeData, 'destination', move.destination_location_id);

  if (!routeData?.origin_address || !routeData?.destination_address) {
    const err = new Error('Saved move is missing origin or destination address');
    err.statusCode = 400;
    throw err;
  }

  const coordsToGeocode = [];
  let stopCounter = 1;

  for (let segIdx = 0; segIdx < segments.length; segIdx++) {
    const segment = segments[segIdx];
    const numStopsInSegment = Math.floor(segment.distanceMiles / maxDailyMiles);

    if (numStopsInSegment === 0) {
      console.log(`[route] ${correlationId}:   ${segment.description}: No stops needed (${segment.distanceMiles} < ${maxDailyMiles} miles)`);
      continue;
    }

    let segmentOrigin, segmentDestination;
    if (segIdx === 0) {
      segmentOrigin = routeData.origin_address;
    } else {
      const prevDropoff = dropoffWaypoints[segIdx - 1];
      segmentOrigin = `${prevDropoff.lat},${prevDropoff.lng}`;
    }
    if (segIdx < dropoffWaypoints.length) {
      const dropoff = dropoffWaypoints[segIdx];
      segmentDestination = `${dropoff.lat},${dropoff.lng}`;
    } else {
      segmentDestination = routeData.destination_address;
    }

    const segmentWaypoints = [];
    for (let i = 1; i <= numStopsInSegment; i++) {
      const fractionInSegment = i / (numStopsInSegment + 1);
      const milesIntoSegment = segment.distanceMiles * fractionInSegment;
      const totalMilesFromOrigin = (Number(segment.startMiles) || 0) + milesIntoSegment;
      const fraction = totalMilesFromOrigin / (Number(totalDistanceMiles) || 1);
      const pathIndex = Math.floor(fraction * (decodedPath.length - 1));

      if (isNaN(pathIndex)) {
        console.error(`[route] Error: pathIndex is NaN for segment ${segIdx}`);
        continue;
      }

      const point = decodedPath[Math.min(pathIndex, decodedPath.length - 1)];
      if (!point) continue;

      segmentWaypoints.push({
        lat: point[0],
        lng: point[1],
        estimatedDistance: Math.round(totalMilesFromOrigin)
      });
    }

    const waypointsParam = segmentWaypoints.map(w => `${w.lat},${w.lng}`).join('|');
    const url = `https://maps.googleapis.com/maps/api/directions/json?origin=${encodeURIComponent(segmentOrigin)}&destination=${encodeURIComponent(segmentDestination)}&waypoints=optimize:true|${encodeURIComponent(waypointsParam)}&key=${GOOGLE_MAPS_API_KEY}`;

    console.log(`[route] ${correlationId}: Segment ${segIdx + 1}/${segments.length}: ${segment.description} (${segmentWaypoints.length} stops)`);
    const response = await axios.get(url, { timeout: 30000 });

    if (response.data.status !== 'OK') {
      console.error(`[route] ${correlationId}: Segment ${segIdx + 1} error: ${response.data.status} — falling back to evenly-spaced`);
      for (const wp of segmentWaypoints) {
        coordsToGeocode.push({
          id: stopCounter++,
          lat: wp.lat,
          lng: wp.lng,
          distanceFromOrigin: wp.estimatedDistance,
          segmentDescription: segment.description,
          segmentIndex: segIdx
        });
      }
      continue;
    }

    const route = response.data.routes[0];
    const legs = route.legs;
    const waypointOrder = route.waypoint_order || [];
    const optimizedSegmentWaypoints = waypointOrder.length > 0
      ? waypointOrder.map(idx => segmentWaypoints[idx])
      : segmentWaypoints;

    let cumulativeSegmentDistance = (Number(segment.startMiles) || 0) * 1609.34;
    for (let i = 0; i < legs.length - 1; i++) {
      const leg = legs[i];
      cumulativeSegmentDistance += leg.distance.value;
      const wp = optimizedSegmentWaypoints[i];
      coordsToGeocode.push({
        id: stopCounter++,
        lat: wp.lat,
        lng: wp.lng,
        distanceFromOrigin: Math.round(cumulativeSegmentDistance / 1609.34),
        segmentDescription: segment.description,
        segmentIndex: segIdx
      });
    }
  }

  if (coordsToGeocode.length === 0) {
    console.log(`[route] ${correlationId}: No overnight stops needed`);
    return { waypoints: [], message: 'No overnight stops needed for this route' };
  }

  console.log(`[route] ${correlationId}: Geocoding ${coordsToGeocode.length} suggested stop(s)`);
  const geocodeResults = await batchReverseGeocode(coordsToGeocode, {
    correlationId,
    delayBetweenRequests: 300
  });

  const savedWaypoints = [];
  let currentSequence = 1;

  for (let i = 0; i < segments.length; i++) {
    const segmentSuggestions = coordsToGeocode.filter(c => c.segmentIndex === i);

    for (const coord of segmentSuggestions) {
      const geocode = geocodeResults.get(coord.id) || {};
      const distanceFromOrigin = coord.distanceFromOrigin;
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
          sequence_order: currentSequence++
        })
        .returning('*');

      savedWaypoints.push(savedWaypoint);
      console.log(`[route] ${correlationId}: Saved ${geocode.city || 'Stop'}, ${geocode.state || ''} (${distanceFromOrigin} mi) seq=${savedWaypoint.sequence_order}`);
    }

    if (i < dropoffWaypoints.length) {
      const dropoff = dropoffWaypoints[i];
      await knex('move_waypoints')
        .where('id', dropoff.id)
        .update({ sequence_order: currentSequence++, updated_at: knex.fn.now() });
    }
  }

  console.log(`[route] ${correlationId}: Completed — saved ${savedWaypoints.length} waypoint(s)`);
  return {
    waypoints: savedWaypoints,
    message: `Added ${savedWaypoints.length} suggested overnight stop(s) for your route`
  };
}

// ── Route optimization ────────────────────────────────────────────────────────

async function calculateOptimizedRoute(userId, moveId) {
  const correlationId = `calc-route-${Date.now()}`;
  console.log(`[route] ${correlationId}: Starting optimized route calculation`);

  const move = await knex('saved_moves')
    .where('id', moveId)
    .andWhere('user_id', userId)
    .first();
  if (!move) {
    const err = new Error('Saved move not found');
    err.statusCode = 404;
    throw err;
  }

  console.log(`[route] ${correlationId}: Syncing drop-off waypoints`);
  await syncDropoffWaypoints(moveId, userId);

  const waypoints = await knex('move_waypoints')
    .where('saved_move_id', moveId)
    .orderBy('sequence_order', 'asc');

  if (waypoints.length === 0) {
    const err = new Error('No waypoints to calculate');
    err.statusCode = 400;
    throw err;
  }

  const dropoffWaypoints = waypoints.filter(w => w.is_dropoff === true);
  const dropoffsWithoutCoords = dropoffWaypoints.filter(w => w.lat == null || w.lng == null);
  if (dropoffsWithoutCoords.length > 0) {
    const missingCities = dropoffsWithoutCoords.map(w => w.city || 'Unknown').join(', ');
    const err = new Error('Some drop-off locations are missing coordinates');
    err.statusCode = 400;
    err.details = `The following drop-off location(s) could not be geocoded: ${missingCities}. Please verify the addresses are correct.`;
    err.missingDropoffs = dropoffsWithoutCoords.map(w => ({
      city: w.city,
      state: w.state,
      locationId: w.location_id
    }));
    throw err;
  }

  const waypointsWithCoords = waypoints.filter(w => w.lat != null && w.lng != null);
  if (waypointsWithCoords.length !== waypoints.length) {
    const err = new Error('Some waypoints are missing coordinates. Please ensure all waypoints have been geocoded.');
    err.statusCode = 400;
    throw err;
  }

  let routeData = move.route_data
    ? (typeof move.route_data === 'string' ? JSON.parse(move.route_data) : move.route_data)
    : {};

  await ensureAddressForRole(routeData, 'origin', move.origin_location_id);
  await ensureAddressForRole(routeData, 'destination', move.destination_location_id);

  if (!routeData?.origin_address || !routeData?.destination_address) {
    const err = new Error('Saved move is missing origin or destination address');
    err.statusCode = 400;
    throw err;
  }

  const fixedWaypoints = waypointsWithCoords.filter(w => w.is_dropoff || w.source === 'manual');
  const suggestedWaypoints = waypointsWithCoords.filter(w => !w.is_dropoff && w.source === 'suggested');
  const sortedFixedWaypoints = fixedWaypoints.sort((a, b) => a.sequence_order - b.sequence_order);

  console.log(`[route] ${correlationId}: Fixed: ${fixedWaypoints.length} (${dropoffWaypoints.length} drop-offs), Suggested: ${suggestedWaypoints.length}`);

  const segments = [];
  if (sortedFixedWaypoints.length === 0) {
    segments.push({
      origin: routeData.origin_address,
      destination: routeData.destination_address,
      suggestedWaypoints,
      fixedWaypoints: [],
      description: 'Origin to Destination'
    });
  } else {
    let currentOrigin = routeData.origin_address;
    let lastSequenceOrder = -1;

    for (let i = 0; i < sortedFixedWaypoints.length; i++) {
      const fixedWaypoint = sortedFixedWaypoints[i];
      const fixedAddress = `${fixedWaypoint.lat},${fixedWaypoint.lng}`;
      const segmentSuggested = suggestedWaypoints.filter(
        w => w.sequence_order > lastSequenceOrder && w.sequence_order < fixedWaypoint.sequence_order
      );
      const segmentFixed = sortedFixedWaypoints.filter(
        (w, idx) => idx < i && w.sequence_order > lastSequenceOrder && w.sequence_order < fixedWaypoint.sequence_order
      );
      const waypointType = fixedWaypoint.is_dropoff ? 'drop-off' : 'manual stop';
      segments.push({
        origin: currentOrigin,
        destination: fixedAddress,
        destinationFixedWaypoint: fixedWaypoint,
        suggestedWaypoints: segmentSuggested,
        fixedWaypoints: segmentFixed,
        description: `${i === 0 ? 'Origin' : sortedFixedWaypoints[i - 1].city} → ${fixedWaypoint.city}, ${fixedWaypoint.state} (${waypointType})`
      });
      currentOrigin = fixedAddress;
      lastSequenceOrder = fixedWaypoint.sequence_order;
    }

    const finalSuggested = suggestedWaypoints.filter(w => w.sequence_order > lastSequenceOrder);
    segments.push({
      origin: currentOrigin,
      destination: routeData.destination_address,
      suggestedWaypoints: finalSuggested,
      fixedWaypoints: [],
      description: `${sortedFixedWaypoints[sortedFixedWaypoints.length - 1].city} → Destination`
    });
  }

  const allPolylines = [];
  const optimizedWaypoints = [];
  let globalSequenceOrder = 0;
  let cumulativeDistanceMeters = 0;
  let cumulativeDurationSeconds = 0;

  for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex++) {
    const segment = segments[segmentIndex];
    console.log(`[route] ${correlationId}: Optimizing segment ${segmentIndex + 1}/${segments.length}: ${segment.description}`);

    const allSegmentWaypoints = [
      ...segment.fixedWaypoints.sort((a, b) => a.sequence_order - b.sequence_order),
      ...segment.suggestedWaypoints
    ];

    const hasOptimizableWaypoints = segment.suggestedWaypoints.length > 0;
    const waypointsParam = allSegmentWaypoints.length > 0
      ? allSegmentWaypoints.map(w => `${w.lat},${w.lng}`).join('|')
      : '';

    let url = `https://maps.googleapis.com/maps/api/directions/json?origin=${encodeURIComponent(segment.origin)}&destination=${encodeURIComponent(segment.destination)}&key=${GOOGLE_MAPS_API_KEY}`;
    if (waypointsParam) {
      const optimizeFlag = hasOptimizableWaypoints && segment.fixedWaypoints.length === 0 ? 'optimize:true|' : '';
      url += `&waypoints=${optimizeFlag}${encodeURIComponent(waypointsParam)}`;
    }

    const response = await axios.get(url, { timeout: 30000 });

    if (response.data.status !== 'OK') {
      console.error(`[route] ${correlationId}: Segment ${segmentIndex + 1} error: ${response.data.status}`);
      const err = new Error(`Google Directions API error on segment ${segmentIndex + 1}: ${response.data.status}`);
      err.statusCode = 400;
      err.details = response.data.error_message;
      throw err;
    }

    const route = response.data.routes[0];
    const legs = route.legs;
    const waypointOrder = route.waypoint_order || [];
    allPolylines.push(route.overview_polyline?.points);

    let segmentWaypointsOrdered = [];
    if (waypointOrder.length > 0) {
      segmentWaypointsOrdered = waypointOrder.map(idx => allSegmentWaypoints[idx]);
    } else if (allSegmentWaypoints.length > 0) {
      segmentWaypointsOrdered = allSegmentWaypoints;
    }

    for (let i = 0; i < legs.length; i++) {
      const leg = legs[i];
      cumulativeDistanceMeters += leg.distance.value;
      cumulativeDurationSeconds += leg.duration.value;

      if (i < segmentWaypointsOrdered.length) {
        const waypoint = segmentWaypointsOrdered[i];
        optimizedWaypoints.push({
          ...waypoint,
          sequence_order: globalSequenceOrder++,
          distance_from_origin_miles: Math.round(cumulativeDistanceMeters / 1609.34),
          typical_drive_hours_from_origin: Math.round((cumulativeDurationSeconds / 3600) * 10) / 10,
          segment_distance_miles: Math.round(leg.distance.value / 1609.34),
          segment_duration_hours: Math.round((leg.duration.value / 3600) * 10) / 10
        });
      }
    }

    if (segment.destinationFixedWaypoint) {
      const fixedWaypoint = segment.destinationFixedWaypoint;
      const lastLeg = legs[legs.length - 1];
      cumulativeDistanceMeters += lastLeg.distance.value;
      cumulativeDurationSeconds += lastLeg.duration.value;
      optimizedWaypoints.push({
        ...fixedWaypoint,
        sequence_order: globalSequenceOrder++,
        distance_from_origin_miles: Math.round(cumulativeDistanceMeters / 1609.34),
        typical_drive_hours_from_origin: Math.round((cumulativeDurationSeconds / 3600) * 10) / 10,
        segment_distance_miles: Math.round(lastLeg.distance.value / 1609.34),
        segment_duration_hours: Math.round((lastLeg.duration.value / 3600) * 10) / 10
      });
    }
  }

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
        updated_at: knex.fn.now()
      });
    updatedWaypoints.push(waypoint);
  }

  const totalDistanceMiles = Math.round(cumulativeDistanceMeters / 1609.34);
  const totalDurationHours = Math.round((cumulativeDurationSeconds / 3600) * 10) / 10;

  // Re-fetch final leg info from last segment
  const lastSegment = segments[segments.length - 1];
  let finalLegDistanceMiles = 0;
  let finalLegDurationHours = 0;
  if (lastSegment) {
    const lastResponse = await axios.get(
      `https://maps.googleapis.com/maps/api/directions/json?origin=${encodeURIComponent(lastSegment.origin)}&destination=${encodeURIComponent(lastSegment.destination)}&key=${GOOGLE_MAPS_API_KEY}`,
      { timeout: 30000 }
    );
    if (lastResponse.data.status === 'OK') {
      const lastLegs = lastResponse.data.routes[0].legs;
      const finalLeg = lastLegs[lastLegs.length - 1];
      finalLegDistanceMiles = Math.round(finalLeg.distance.value / 1609.34);
      finalLegDurationHours = Math.round((finalLeg.duration.value / 3600) * 10) / 10;
    }
  }

  const updatedRouteData = {
    ...routeData,
    route_polyline: allPolylines[0] || '',
    total_distance_miles: totalDistanceMiles,
    total_duration_hours: totalDurationHours,
    waypoints_optimized: true,
    last_calculated: new Date().toISOString(),
    optimization_method: 'segment-based'
  };

  await knex('saved_moves')
    .where('id', moveId)
    .update({ route_data: JSON.stringify(updatedRouteData), updated_at: knex.fn.now() });

  console.log(`[route] ${correlationId}: Optimization complete — ${totalDistanceMiles} mi, ${totalDurationHours} hrs, ${segments.length} segment(s)`);

  return {
    success: true,
    waypoints: updatedWaypoints,
    routePolyline: allPolylines[0] || '',
    totalDistanceMiles,
    totalDurationHours,
    numberOfSegments: segments.length,
    finalLegDistanceMiles,
    finalLegDurationHours,
    message: `Route optimized across ${segments.length} segment(s) with ${updatedWaypoints.length} waypoint(s)`
  };
}

async function recalculateRoute(userId, moveId) {
  const correlationId = `recalc-route-${Date.now()}`;
  console.log(`[route] ${correlationId}: Recalculating route distances (no reordering)`);

  const move = await knex('saved_moves')
    .where('id', moveId)
    .andWhere('user_id', userId)
    .first();
  if (!move) {
    const err = new Error('Saved move not found');
    err.statusCode = 404;
    throw err;
  }

  const waypoints = await knex('move_waypoints')
    .where('saved_move_id', moveId)
    .orderBy('sequence_order', 'asc');

  if (waypoints.length === 0) {
    const err = new Error('No waypoints to calculate');
    err.statusCode = 400;
    throw err;
  }

  let routeData = move.route_data
    ? (typeof move.route_data === 'string' ? JSON.parse(move.route_data) : move.route_data)
    : {};

  await ensureAddressForRole(routeData, 'origin', move.origin_location_id);
  await ensureAddressForRole(routeData, 'destination', move.destination_location_id);

  if (!routeData?.origin_address || !routeData?.destination_address) {
    const err = new Error('Saved move is missing origin or destination address');
    err.statusCode = 400;
    throw err;
  }

  const waypointsWithCoords = waypoints.filter(w => w.lat != null && w.lng != null);
  const waypointsParam = waypointsWithCoords.map(w => `${w.lat},${w.lng}`).join('|');

  let url = `https://maps.googleapis.com/maps/api/directions/json?origin=${encodeURIComponent(routeData.origin_address)}&destination=${encodeURIComponent(routeData.destination_address)}&key=${GOOGLE_MAPS_API_KEY}`;
  if (waypointsParam) {
    url += `&waypoints=${encodeURIComponent(waypointsParam)}`;
  }

  console.log(`[route] ${correlationId}: Calling Google Directions (${waypointsWithCoords.length} waypoints, no optimization)`);
  const response = await axios.get(url, { timeout: 30000 });

  if (response.data.status !== 'OK') {
    const err = new Error(`Google Directions API error: ${response.data.status}`);
    err.statusCode = 400;
    err.details = response.data.error_message;
    throw err;
  }

  const route = response.data.routes[0];
  const legs = route.legs;

  let cumulativeDistanceMeters = 0;
  let cumulativeDurationSeconds = 0;
  const updatedWaypoints = [];

  for (let i = 0; i < legs.length; i++) {
    const leg = legs[i];
    cumulativeDistanceMeters += leg.distance.value;
    cumulativeDurationSeconds += leg.duration.value;

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
    }
  }

  const totalDistanceMiles = Math.round(cumulativeDistanceMeters / 1609.34);
  const totalDurationHours = Math.round((cumulativeDurationSeconds / 3600) * 10) / 10;
  const finalLeg = legs[legs.length - 1];
  const finalLegDistanceMiles = Math.round(finalLeg.distance.value / 1609.34);
  const finalLegDurationHours = Math.round((finalLeg.duration.value / 3600) * 10) / 10;

  const updatedRouteData = {
    ...routeData,
    route_polyline: route.overview_polyline?.points || '',
    total_distance_miles: totalDistanceMiles,
    total_duration_hours: totalDurationHours,
    waypoints_optimized: false,
    last_calculated: new Date().toISOString()
  };

  await knex('saved_moves')
    .where('id', moveId)
    .update({ route_data: JSON.stringify(updatedRouteData), updated_at: knex.fn.now() });

  console.log(`[route] ${correlationId}: Recalculation complete — ${totalDistanceMiles} mi, ${totalDurationHours} hrs`);

  return {
    success: true,
    waypoints: updatedWaypoints,
    routePolyline: route.overview_polyline?.points || '',
    totalDistanceMiles,
    totalDurationHours,
    finalLegDistanceMiles,
    finalLegDurationHours,
    message: `Route recalculated with ${updatedWaypoints.length} waypoint(s) in current order`
  };
}

module.exports = {
  calculateRoute,
  syncDropoffWaypoints,
  getWaypoints,
  createWaypoint,
  updateWaypoint,
  deleteWaypoint,
  reorderWaypoints,
  suggestWaypoints,
  suggestAndSaveWaypoints,
  calculateOptimizedRoute,
  recalculateRoute
};
