'use strict';

/**
 * Move Query Service
 *
 * Read-only queries for saved moves.
 */

const knex = require('../infra/knex');

async function getSavedMoves(userId) {
  return knex('saved_moves as sm')
    .select(
      'sm.*',
      'ol.name as origin_location_name',
      'ol.address as origin_address',
      'ol.city as origin_city',
      'ol.state as origin_state',
      'dl.name as destination_location_name',
      'dl.address as destination_address',
      'dl.city as destination_city',
      'dl.state as destination_state'
    )
    .leftJoin('locations as ol', 'sm.origin_location_id', 'ol.id')
    .leftJoin('locations as dl', 'sm.destination_location_id', 'dl.id')
    .where('sm.user_id', userId)
    .orderBy('sm.updated_at', 'desc');
}

async function getSavedMove(userId, moveId) {
  const result = await knex('saved_moves as sm')
    .select(
      'sm.*',
      'ol.name as origin_location_name',
      'dl.name as destination_location_name'
    )
    .leftJoin('locations as ol', 'sm.origin_location_id', 'ol.id')
    .leftJoin('locations as dl', 'sm.destination_location_id', 'dl.id')
    .where('sm.id', moveId)
    .andWhere('sm.user_id', userId)
    .first();

  if (!result) return null;

  const twoWeeksAgo = new Date();
  twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);
  result.cost_calculations_stale =
    !!(result.cost_calculations_date && new Date(result.cost_calculations_date) < twoWeeksAgo);

  result.move_locations = await knex('move_locations as ml')
    .select(
      'ml.id',
      'ml.location_id',
      'ml.location_role',
      'ml.sequence_order',
      'ml.has_loading',
      'ml.has_unloading',
      'loc.name as location_name',
      'loc.address',
      'loc.city',
      'loc.state',
      'loc.zip',
      'loc.lat',
      'loc.lng',
      'loc.entry_type',
      'loc.number_of_flights',
      'loc.has_elevator',
      'loc.elevator_type',
      'loc.elevator_distance',
      'loc.elevator_reservation_required',
      'loc.parking_situation',
      'loc.parking_distance',
      'loc.entry_challenges',
      'loc.access_notes'
    )
    .leftJoin('locations as loc', 'ml.location_id', 'loc.id')
    .where('ml.move_id', moveId)
    .orderBy('ml.sequence_order', 'asc');

  return result;
}

async function getEligibleSources(userId, moveId) {
  const move = await knex('saved_moves as sm')
    .select(
      'sm.id',
      'sm.origin_location_id',
      'sm.destination_location_id',
      'sm.desired_start_date',
      'sm.desired_end_date',
      'ol.name as origin_location_name',
      'ol.location_type as origin_location_type'
    )
    .leftJoin('locations as ol', 'sm.origin_location_id', 'ol.id')
    .where('sm.id', moveId)
    .andWhere('sm.user_id', userId)
    .first();

  if (!move) return null;

  const sources = [];

  if (move.origin_location_id) {
    sources.push({
      location_id: move.origin_location_id,
      label: move.origin_location_name || 'Move Origin',
      source_type: 'origin',
      location_type: move.origin_location_type || null
    });
  }

  const existingSessions = await knex('move_sessions as ms')
    .select(
      'ms.id',
      'ms.session_name',
      'ms.session_end_location_id',
      'loc.name as end_location_name',
      'loc.location_type as end_location_type'
    )
    .leftJoin('locations as loc', 'ms.session_end_location_id', 'loc.id')
    .where('ms.saved_move_id', moveId)
    .andWhere('ms.user_id', userId)
    .whereNotNull('ms.session_end_location_id')
    .orderBy('ms.updated_at', 'desc');

  const seen = new Set(sources.map(src => String(src.location_id)));
  existingSessions.forEach(session => {
    const endLocationId = String(session.session_end_location_id);
    if (!session.session_end_location_id || seen.has(endLocationId)) return;
    seen.add(endLocationId);
    sources.push({
      location_id: session.session_end_location_id,
      label: session.end_location_name || `Session ${session.session_name || session.id}`,
      source_type: session.end_location_type === 'truck' ? 'truck' : 'session',
      location_type: session.end_location_type || null,
      session_id: session.id,
      session_name: session.session_name || null
    });
  });

  return {
    move: {
      id: move.id,
      desired_start_date: move.desired_start_date,
      desired_end_date: move.desired_end_date
    },
    sources
  };
}

module.exports = {
  getSavedMoves,
  getSavedMove,
  getEligibleSources
};
