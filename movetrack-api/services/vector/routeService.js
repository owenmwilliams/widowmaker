'use strict';

/**
 * Route Service
 *
 * Route/distance/travel-time planning using Google Maps or haversine fallback.
 */

const knex = require('../infra/knex');
const { estimateRoadDistance, estimateDriveHours } = require('../shared/distanceUtils');
const { COST_PARAMS } = require('./moveCostService');

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

  // Try Google Maps Distance Matrix first
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
    console.warn('[vector] Google Maps lookup failed:', err.message);
  }

  // Fallback: haversine estimate
  if (!distanceMiles) {
    const straightLine = 500; // conservative fallback
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

module.exports = {
  calculateRoute,
};
