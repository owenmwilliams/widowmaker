'use strict';

/**
 * moveMaturityService.js
 *
 * Evaluates how move-ready a user's plan is.
 * Covers origin/destination setup, saved moves, dates, and overall readiness.
 */

const knex = require('../infra/knex');

const MOVE_READINESS_LEVELS = Object.freeze([
  'none',
  'origin_defined',
  'origin_destination_defined',
  'planning_ready',
  'quote_ready',
]);

/**
 * Assess how ready a user's move plan is.
 *
 * @param {string} userId
 * @returns {Promise<{
 *   readiness: string,
 *   hasOrigin: boolean,
 *   hasDestination: boolean,
 *   hasSavedMove: boolean,
 *   hasMoveDates: boolean,
 *   originAddress: string|null,
 *   destinationAddress: string|null,
 *   blockers: string[]
 * }>}
 */
async function moveReadinessAssessment(userId) {
  const [locations, savedMoves] = await Promise.all([
    knex('locations')
      .select('id', 'name', 'address', 'city', 'state', 'location_type')
      .where('user_id', userId),
    knex('saved_moves')
      .select('id', 'origin_location_id', 'destination_location_id',
              'desired_start_date', 'desired_end_date')
      .where('user_id', userId)
      .orderBy('updated_at', 'desc')
      .limit(1),
  ]);

  const originLocations = locations.filter(l =>
    l.location_type === 'primary_residence' || l.location_type === 'home' || l.location_type === 'apartment' || l.location_type === 'residence'
  );
  const hasOrigin = originLocations.some(l => l.address);

  const move = savedMoves[0] || null;
  const hasDestination = move
    ? locations.some(l => String(l.id) === String(move.destination_location_id) && l.address)
    : false;
  const hasSavedMove = !!move;
  const hasMoveDates = !!(move && move.desired_start_date);

  const originAddr = originLocations.find(l => l.address);
  const destLoc = move && move.destination_location_id
    ? locations.find(l => String(l.id) === String(move.destination_location_id))
    : null;

  // Derive readiness level
  let readiness = 'none';
  if (hasOrigin && hasDestination && hasSavedMove && hasMoveDates) {
    readiness = 'quote_ready';
  } else if (hasOrigin && hasDestination && hasSavedMove) {
    readiness = 'planning_ready';
  } else if (hasOrigin && hasDestination) {
    readiness = 'origin_destination_defined';
  } else if (hasOrigin) {
    readiness = 'origin_defined';
  }

  // Collect blockers
  const blockers = [];
  if (!hasOrigin) blockers.push('No origin address set');
  if (!hasDestination) blockers.push('No destination address set');
  if (!hasSavedMove) blockers.push('No saved move created');
  if (hasSavedMove && !hasMoveDates) blockers.push('No move dates set');

  return {
    readiness,
    hasOrigin,
    hasDestination,
    hasSavedMove,
    hasMoveDates,
    originAddress: originAddr ? [originAddr.address, originAddr.city, originAddr.state].filter(Boolean).join(', ') : null,
    destinationAddress: destLoc && destLoc.address ? [destLoc.address, destLoc.city, destLoc.state].filter(Boolean).join(', ') : null,
    blockers,
  };
}

module.exports = {
  MOVE_READINESS_LEVELS,
  moveReadinessAssessment,
};
