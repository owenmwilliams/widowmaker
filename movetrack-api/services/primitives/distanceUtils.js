/**
 * Distance Calculation Utilities
 *
 * Provides Haversine distance calculation for quick estimates
 * and utilities for working with route polylines.
 */

/**
 * Calculate the Haversine distance between two points in miles
 * This gives "as-the-crow-flies" distance.
 *
 * @param {number} lat1 - Latitude of first point
 * @param {number} lng1 - Longitude of first point
 * @param {number} lat2 - Latitude of second point
 * @param {number} lng2 - Longitude of second point
 * @returns {number} Distance in miles
 */
function haversineDistanceMiles(lat1, lng1, lat2, lng2) {
  const EARTH_RADIUS_MILES = 3958.8; // Earth's radius in miles

  // Convert to radians
  const toRad = (deg) => deg * Math.PI / 180;

  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);

  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
            Math.sin(dLng / 2) * Math.sin(dLng / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return EARTH_RADIUS_MILES * c;
}

/**
 * Estimate road distance from straight-line distance
 *
 * Roads don't go in straight lines - they follow terrain, go around obstacles,
 * and connect via highways. The road factor varies by geography:
 * - Dense urban areas: 1.2-1.4
 * - Suburban/rural: 1.3-1.5
 * - Mountain/river crossings: 1.4-1.6
 *
 * We use 1.35 as a reasonable average for US interstate travel.
 *
 * @param {number} straightLineDistance - Haversine distance in miles
 * @param {number} roadFactor - Multiplier for road distance (default 1.35)
 * @returns {number} Estimated road distance in miles
 */
function estimateRoadDistance(straightLineDistance, roadFactor = 1.35) {
  return Math.round(straightLineDistance * roadFactor);
}

/**
 * Calculate estimated distance from origin to a waypoint
 * Uses Haversine + road factor for quick estimates without API calls.
 *
 * @param {number} originLat - Origin latitude
 * @param {number} originLng - Origin longitude
 * @param {number} waypointLat - Waypoint latitude
 * @param {number} waypointLng - Waypoint longitude
 * @param {number} roadFactor - Road factor multiplier (default 1.35)
 * @returns {Object} { straightLineMiles, estimatedRoadMiles }
 */
function calculateEstimatedDistance(originLat, originLng, waypointLat, waypointLng, roadFactor = 1.35) {
  const straightLineMiles = haversineDistanceMiles(originLat, originLng, waypointLat, waypointLng);
  const estimatedRoadMiles = estimateRoadDistance(straightLineMiles, roadFactor);

  return {
    straightLineMiles: Math.round(straightLineMiles),
    estimatedRoadMiles
  };
}

/**
 * Get origin coordinates from a route polyline
 * Decodes the polyline and returns the first point as origin.
 *
 * @param {string} encodedPolyline - Google Maps encoded polyline string
 * @returns {Object|null} { lat, lng } or null if invalid
 */
function getOriginFromPolyline(encodedPolyline) {
  if (!encodedPolyline) return null;

  try {
    const polyline = require('@mapbox/polyline');
    const decodedPath = polyline.decode(encodedPolyline);

    if (decodedPath && decodedPath.length > 0) {
      return {
        lat: decodedPath[0][0],
        lng: decodedPath[0][1]
      };
    }
    return null;
  } catch (error) {
    console.error('[DistanceUtils] Error decoding polyline:', error.message);
    return null;
  }
}

/**
 * Get destination coordinates from a route polyline
 * Decodes the polyline and returns the last point as destination.
 *
 * @param {string} encodedPolyline - Google Maps encoded polyline string
 * @returns {Object|null} { lat, lng } or null if invalid
 */
function getDestinationFromPolyline(encodedPolyline) {
  if (!encodedPolyline) return null;

  try {
    const polyline = require('@mapbox/polyline');
    const decodedPath = polyline.decode(encodedPolyline);

    if (decodedPath && decodedPath.length > 0) {
      const lastPoint = decodedPath[decodedPath.length - 1];
      return {
        lat: lastPoint[0],
        lng: lastPoint[1]
      };
    }
    return null;
  } catch (error) {
    console.error('[DistanceUtils] Error decoding polyline:', error.message);
    return null;
  }
}

/**
 * Estimate typical drive hours based on distance
 * Uses 60 mph average for long-distance highway driving.
 *
 * @param {number} distanceMiles - Distance in miles
 * @param {number} avgSpeedMph - Average speed in mph (default 60)
 * @returns {number} Hours rounded to 1 decimal place
 */
function estimateDriveHours(distanceMiles, avgSpeedMph = 60) {
  return Math.round((distanceMiles / avgSpeedMph) * 10) / 10;
}

module.exports = {
  haversineDistanceMiles,
  estimateRoadDistance,
  calculateEstimatedDistance,
  getOriginFromPolyline,
  getDestinationFromPolyline,
  estimateDriveHours
};
