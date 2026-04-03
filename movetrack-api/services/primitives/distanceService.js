'use strict';

/**
 * Distance Service
 *
 * All distance-related logic: Haversine math, road-factor estimates,
 * polyline decoding utilities, and Google Maps Directions API integration
 * with a city-pair fallback for when the API is unavailable.
 *
 * Renamed from distanceUtils.js — all previous exports are preserved.
 */

const axios = require('axios');
const { GOOGLE_MAPS_API_KEY, isGoogleMapsConfigured } = require('../../config/google');

// ── Primitive math helpers ────────────────────────────────────────────────────

/**
 * Haversine great-circle distance between two lat/lng points, in miles.
 */
function haversineDistanceMiles(lat1, lng1, lat2, lng2) {
  const EARTH_RADIUS_MILES = 3958.8;
  const toRad = (deg) => deg * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return EARTH_RADIUS_MILES * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Estimate road distance from straight-line distance using a road factor.
 * Default 1.35 — reasonable average for US interstate travel.
 * Urban: 1.2–1.4 | Suburban/rural: 1.3–1.5 | Mountain: 1.4–1.6
 */
function estimateRoadDistance(straightLineDistance, roadFactor = 1.35) {
  return Math.round(straightLineDistance * roadFactor);
}

/**
 * Haversine + road factor in a single call.
 */
function calculateEstimatedDistance(originLat, originLng, waypointLat, waypointLng, roadFactor = 1.35) {
  const straightLineMiles = haversineDistanceMiles(originLat, originLng, waypointLat, waypointLng);
  return {
    straightLineMiles: Math.round(straightLineMiles),
    estimatedRoadMiles: estimateRoadDistance(straightLineMiles, roadFactor),
  };
}

/**
 * Decode a Google polyline and return the first point as the origin.
 */
function getOriginFromPolyline(encodedPolyline) {
  if (!encodedPolyline) return null;
  try {
    const polyline = require('@mapbox/polyline');
    const path = polyline.decode(encodedPolyline);
    return path?.length > 0 ? { lat: path[0][0], lng: path[0][1] } : null;
  } catch (err) {
    console.error('[distanceService] Error decoding polyline:', err.message);
    return null;
  }
}

/**
 * Decode a Google polyline and return the last point as the destination.
 */
function getDestinationFromPolyline(encodedPolyline) {
  if (!encodedPolyline) return null;
  try {
    const polyline = require('@mapbox/polyline');
    const path = polyline.decode(encodedPolyline);
    if (!path?.length) return null;
    const last = path[path.length - 1];
    return { lat: last[0], lng: last[1] };
  } catch (err) {
    console.error('[distanceService] Error decoding polyline:', err.message);
    return null;
  }
}

/**
 * Estimate drive hours at a given average speed.
 */
function estimateDriveHours(distanceMiles, avgSpeedMph = 60) {
  return Math.round((distanceMiles / avgSpeedMph) * 10) / 10;
}

// ── City-pair fallback lookup ─────────────────────────────────────────────────

const CITY_DISTANCES = {
  // Same-city aliases
  'nyc-ny': 0, 'ny-nyc': 0, 'new york-nyc': 0, 'nyc-new york': 0,
  'la-los angeles': 0, 'los angeles-la': 0,
  'sf-san francisco': 0, 'san francisco-sf': 0,
  // East ↔ West Coast
  'new york-los angeles': 2800, 'los angeles-new york': 2800,
  'nyc-la': 2800, 'la-nyc': 2800, 'ny-la': 2800, 'la-ny': 2800,
  'new york-san francisco': 2900, 'san francisco-new york': 2900,
  'nyc-sf': 2900, 'sf-nyc': 2900, 'ny-sf': 2900, 'sf-ny': 2900,
  'philadelphia-san francisco': 2850, 'san francisco-philadelphia': 2850,
  'philadelphia-sf': 2850, 'sf-philadelphia': 2850,
  'boston-los angeles': 3000, 'los angeles-boston': 3000,
  'boston-la': 3000, 'la-boston': 3000,
  'boston-san francisco': 3100, 'san francisco-boston': 3100,
  'boston-sf': 3100, 'sf-boston': 3100,
  'boston-seattle': 3000, 'seattle-boston': 3000,
  'washington-seattle': 2750, 'seattle-washington': 2750,
  'dc-seattle': 2750, 'seattle-dc': 2750,
  'miami-seattle': 3300, 'seattle-miami': 3300,
  'miami-san francisco': 3100, 'san francisco-miami': 3100,
  'miami-sf': 3100, 'sf-miami': 3100,
  // East Coast ↔ Pacific NW
  'new york-seattle': 2850, 'seattle-new york': 2850,
  'nyc-seattle': 2850, 'seattle-nyc': 2850, 'ny-seattle': 2850, 'seattle-ny': 2850,
  'seattle-brooklyn': 2850, 'brooklyn-seattle': 2850,
  'philadelphia-seattle': 2800, 'seattle-philadelphia': 2800,
  'boston-portland': 3100, 'portland-boston': 3100,
  // East Coast cities
  'new york-boston': 215, 'boston-new york': 215,
  'nyc-boston': 215, 'boston-nyc': 215, 'ny-boston': 215, 'boston-ny': 215,
  'new york-philadelphia': 95, 'philadelphia-new york': 95,
  'nyc-philadelphia': 95, 'philadelphia-nyc': 95,
  'new york-washington': 225, 'washington-new york': 225,
  'nyc-dc': 225, 'dc-nyc': 225, 'ny-dc': 225, 'dc-ny': 225,
  'philadelphia-washington': 140, 'washington-philadelphia': 140,
  'philadelphia-dc': 140, 'dc-philadelphia': 140,
  'boston-washington': 440, 'washington-boston': 440,
  'boston-dc': 440, 'dc-boston': 440,
  'new york-miami': 1280, 'miami-new york': 1280,
  'nyc-miami': 1280, 'miami-nyc': 1280,
  'boston-miami': 1500, 'miami-boston': 1500,
  'philadelphia-miami': 1200, 'miami-philadelphia': 1200,
  // Midwest ↔ East Coast
  'chicago-new york': 790, 'new york-chicago': 790,
  'chicago-nyc': 790, 'nyc-chicago': 790,
  'chicago-boston': 980, 'boston-chicago': 980,
  'chicago-philadelphia': 760, 'philadelphia-chicago': 760,
  'chicago-washington': 700, 'washington-chicago': 700,
  'chicago-dc': 700, 'dc-chicago': 700,
  'chicago-miami': 1380, 'miami-chicago': 1380,
  'detroit-new york': 640, 'new york-detroit': 640,
  'detroit-nyc': 640, 'nyc-detroit': 640,
  // Midwest ↔ West Coast
  'chicago-los angeles': 2015, 'los angeles-chicago': 2015,
  'chicago-la': 2015, 'la-chicago': 2015,
  'chicago-san francisco': 2130, 'san francisco-chicago': 2130,
  'chicago-sf': 2130, 'sf-chicago': 2130,
  'chicago-seattle': 2050, 'seattle-chicago': 2050,
  'chicago-denver': 1000, 'denver-chicago': 1000,
  'detroit-los angeles': 2280, 'los angeles-detroit': 2280,
  'detroit-la': 2280, 'la-detroit': 2280,
  // Mountain West
  'denver-new york': 1780, 'new york-denver': 1780,
  'denver-nyc': 1780, 'nyc-denver': 1780,
  'denver-los angeles': 1020, 'los angeles-denver': 1020,
  'denver-la': 1020, 'la-denver': 1020,
  'denver-san francisco': 1260, 'san francisco-denver': 1260,
  'denver-sf': 1260, 'sf-denver': 1260,
  'denver-seattle': 1300, 'seattle-denver': 1300,
  'denver-miami': 2100, 'miami-denver': 2100,
  'salt lake city-los angeles': 700, 'los angeles-salt lake city': 700,
  'salt lake city-la': 700, 'la-salt lake city': 700,
  'salt lake city-san francisco': 750, 'san francisco-salt lake city': 750,
  'salt lake city-sf': 750, 'sf-salt lake city': 750,
  // Southwest
  'phoenix-los angeles': 370, 'los angeles-phoenix': 370,
  'phoenix-la': 370, 'la-phoenix': 370,
  'phoenix-san diego': 355, 'san diego-phoenix': 355,
  'phoenix-denver': 865, 'denver-phoenix': 865,
  'phoenix-chicago': 1750, 'chicago-phoenix': 1750,
  'austin-houston': 165, 'houston-austin': 165,
  'dallas-houston': 240, 'houston-dallas': 240,
  'dallas-austin': 195, 'austin-dallas': 195,
  'dallas-chicago': 925, 'chicago-dallas': 925,
  'houston-chicago': 1080, 'chicago-houston': 1080,
  'dallas-los angeles': 1435, 'los angeles-dallas': 1435,
  'dallas-la': 1435, 'la-dallas': 1435,
  // West Coast
  'los angeles-san francisco': 380, 'san francisco-los angeles': 380,
  'la-sf': 380, 'sf-la': 380,
  'los angeles-san diego': 120, 'san diego-los angeles': 120,
  'la-san diego': 120, 'san diego-la': 120,
  'los angeles-seattle': 1135, 'seattle-los angeles': 1135,
  'la-seattle': 1135, 'seattle-la': 1135,
  'san francisco-seattle': 810, 'seattle-san francisco': 810,
  'sf-seattle': 810, 'seattle-sf': 810,
  'san francisco-portland': 635, 'portland-san francisco': 635,
  'sf-portland': 635, 'portland-sf': 635,
  'seattle-portland': 175, 'portland-seattle': 175,
  // South
  'atlanta-new york': 870, 'new york-atlanta': 870,
  'atlanta-nyc': 870, 'nyc-atlanta': 870,
  'atlanta-chicago': 715, 'chicago-atlanta': 715,
  'atlanta-miami': 660, 'miami-atlanta': 660,
  'atlanta-los angeles': 2180, 'los angeles-atlanta': 2180,
  'atlanta-la': 2180, 'la-atlanta': 2180,
};

/**
 * Look up a hardcoded city-pair distance in miles.
 * Falls back to 500 miles if the pair isn't found.
 */
function estimateCityDistance(origin, destination) {
  const key = `${origin.toLowerCase()}-${destination.toLowerCase()}`.replace(/[^a-z-]/g, '');
  if (CITY_DISTANCES[key] !== undefined) return CITY_DISTANCES[key];
  console.log(`[distanceService] No estimate for "${origin}" → "${destination}", using default 500mi`);
  return 500;
}

// ── Duration formatting ───────────────────────────────────────────────────────

function formatDuration(seconds) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0 && minutes > 0) return `${hours} hr ${minutes} min`;
  if (hours > 0) return `${hours} hr`;
  return `${minutes} min`;
}

// ── Primary API ───────────────────────────────────────────────────────────────

/**
 * Calculate driving distance between two addresses.
 * Uses Google Directions API when configured; falls back to city-pair lookup.
 *
 * @param {object} params
 * @param {string} params.origin
 * @param {string} params.destination
 * @param {string[]} [params.waypoints]
 * @param {boolean} [params.avoidTolls]
 * @param {boolean} [params.truckRoute]
 */
async function calculateDrivingDistance({ origin, destination, waypoints = [], avoidTolls = false, truckRoute = false }) {
  if (isGoogleMapsConfigured()) {
    try {
      const params = {
        origin,
        destination,
        mode: 'driving',
        units: 'imperial',
        key: GOOGLE_MAPS_API_KEY,
      };

      if (waypoints.length > 0) params.waypoints = waypoints.join('|');

      const avoid = [];
      if (avoidTolls) avoid.push('tolls');
      if (avoid.length > 0) params.avoid = avoid.join('|');

      const response = await axios.get('https://maps.googleapis.com/maps/api/directions/json', {
        params,
        timeout: 10000,
      });

      const data = response.data;
      if (data.status === 'OK' && data.routes?.length > 0) {
        const route = data.routes[0];
        let totalDistanceMeters = 0;
        let totalDurationSeconds = 0;

        const legs = route.legs.map((leg) => {
          totalDistanceMeters += leg.distance.value;
          totalDurationSeconds += leg.duration.value;
          return {
            start_address: leg.start_address,
            end_address: leg.end_address,
            distance_miles: Math.round(leg.distance.value * 0.000621371),
            distance_text: leg.distance.text,
            duration_seconds: leg.duration.value,
            duration_text: leg.duration.text,
          };
        });

        const distanceMiles = Math.round(totalDistanceMeters * 0.000621371);
        const estimatedTolls = !avoidTolls && distanceMiles > 100
          ? Math.round(distanceMiles * 0.15)
          : 0;

        return {
          success: true,
          distance_miles: distanceMiles,
          distance_text: `${distanceMiles} mi`,
          duration_seconds: totalDurationSeconds,
          duration_text: formatDuration(totalDurationSeconds),
          origin_address: route.legs[0].start_address,
          destination_address: route.legs[route.legs.length - 1].end_address,
          source: 'google_maps',
          route_polyline: route.overview_polyline.points,
          route_summary: route.summary || 'Route via highways',
          warnings: route.warnings || [],
          estimated_tolls: estimatedTolls,
          truck_friendly: truckRoute,
          legs,
          waypoints_count: waypoints.length,
          overnight_stops: distanceMiles > 500 ? Math.ceil(distanceMiles / 500) - 1 : 0,
        };
      }

      console.warn('[distanceService] Google Directions returned no routes:', data.status, data.error_message);
    } catch (apiErr) {
      console.warn('[distanceService] Google Maps unavailable, using fallback:', apiErr.message);
    }
  }

  const estimatedDistance = estimateCityDistance(origin, destination);
  return {
    success: true,
    distance_miles: estimatedDistance,
    distance_text: `${estimatedDistance} mi`,
    duration_seconds: Math.round((estimatedDistance / 60) * 3600),
    duration_text: `${Math.round(estimatedDistance / 60)} hours`,
    origin_address: origin,
    destination_address: destination,
    source: 'estimated',
    note: 'Distance is estimated. For accurate routing, configure Google Maps API key.',
  };
}

module.exports = {
  // Primitives (previously in distanceUtils.js)
  haversineDistanceMiles,
  estimateRoadDistance,
  calculateEstimatedDistance,
  getOriginFromPolyline,
  getDestinationFromPolyline,
  estimateDriveHours,
  // Higher-level API
  estimateCityDistance,
  calculateDrivingDistance,
};
