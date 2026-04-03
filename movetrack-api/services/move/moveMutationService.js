'use strict';

/**
 * Move Mutation Service
 *
 * Create, update, and delete saved moves.
 */

const knex = require('../infra/knex');

// Imported lazily to avoid a circular dependency at module load time.
// routeService imports geocodingService; moveMutationService imports routeService.
function getRouteService() {
  return require('./routeService');
}

async function createSavedMove(userId, body) {
  const {
    name,
    originLocationId,
    destinationLocationId,
    moveDate,
    desiredStartDate,
    desiredEndDate,
    numHelpers,
    packingServicesRequired,
    hasStairs,
    numberOfFlights,
    hasElevator,
    elevatorType,
    elevatorDistance,
    elevatorReservationRequired,
    parkingSituation,
    parkingDistance,
    entryType,
    entryChallenges,
    accessNotes,
    destHasStairs,
    destNumberOfFlights,
    destHasElevator,
    destElevatorType,
    destElevatorDistance,
    destElevatorReservationRequired,
    destParkingSituation,
    destParkingDistance,
    destEntryType,
    destEntryChallenges,
    destAccessNotes,
    specialRequirements,
    estimatedSquareFootage,
    useTruckRoute,
    avoidTolls,
    totalItems,
    totalWeightLbs,
    totalVolumeCuFt,
    estimatedDistanceMiles,
    costCalculations,
    routeData,
    moveLocations
  } = body;

  const resolvedStart = desiredStartDate || moveDate;
  const resolvedEnd = desiredEndDate || resolvedStart || moveDate;

  if (resolvedStart && resolvedEnd && new Date(resolvedStart) > new Date(resolvedEnd)) {
    const err = new Error('Desired start date must be before desired end date');
    err.statusCode = 400;
    throw err;
  }

  const result = await knex('saved_moves')
    .insert({
      user_id: userId,
      name,
      origin_location_id: originLocationId,
      destination_location_id: destinationLocationId,
      move_date: moveDate,
      desired_start_date: resolvedStart,
      desired_end_date: resolvedEnd,
      num_helpers: numHelpers,
      packing_services_required: packingServicesRequired,
      has_stairs: hasStairs,
      number_of_flights: numberOfFlights,
      has_elevator: hasElevator,
      elevator_type: elevatorType,
      elevator_distance: elevatorDistance,
      elevator_reservation_required: elevatorReservationRequired,
      parking_situation: parkingSituation,
      parking_distance: parkingDistance,
      entry_type: entryType,
      entry_challenges: JSON.stringify(entryChallenges || []),
      access_notes: accessNotes,
      dest_has_stairs: destHasStairs,
      dest_number_of_flights: destNumberOfFlights,
      dest_has_elevator: destHasElevator,
      dest_elevator_type: destElevatorType,
      dest_elevator_distance: destElevatorDistance,
      dest_elevator_reservation_required: destElevatorReservationRequired,
      dest_parking_situation: destParkingSituation,
      dest_parking_distance: destParkingDistance,
      dest_entry_type: destEntryType,
      dest_entry_challenges: JSON.stringify(destEntryChallenges || []),
      dest_access_notes: destAccessNotes,
      special_requirements: specialRequirements,
      estimated_square_footage: estimatedSquareFootage,
      use_truck_route: useTruckRoute,
      avoid_tolls: avoidTolls,
      total_items: totalItems,
      total_weight_lbs: totalWeightLbs,
      total_volume_cu_ft: totalVolumeCuFt,
      estimated_distance_miles: estimatedDistanceMiles,
      cost_calculations: JSON.stringify(costCalculations),
      route_data: JSON.stringify(routeData),
      cost_calculations_date: knex.fn.now()
    })
    .returning('*');

  const newMove = result[0];

  if (Array.isArray(moveLocations) && moveLocations.length > 0) {
    await knex('move_locations').insert(
      moveLocations.map(loc => ({
        move_id: newMove.id,
        location_id: loc.locationId,
        location_role: loc.locationRole || 'intermediate',
        sequence_order: loc.sequenceOrder || 0,
        has_loading: loc.hasLoading || false,
        has_unloading: loc.hasUnloading || false
      }))
    );
  }

  await getRouteService().syncDropoffWaypoints(newMove.id, userId);

  return newMove;
}

async function updateSavedMove(userId, moveId, body) {
  const {
    name,
    originLocationId,
    destinationLocationId,
    moveDate,
    desiredStartDate,
    desiredEndDate,
    numHelpers,
    packingServicesRequired,
    hasStairs,
    numberOfFlights,
    hasElevator,
    elevatorType,
    elevatorDistance,
    elevatorReservationRequired,
    parkingSituation,
    parkingDistance,
    entryType,
    entryChallenges,
    accessNotes,
    destHasStairs,
    destNumberOfFlights,
    destHasElevator,
    destElevatorType,
    destElevatorDistance,
    destElevatorReservationRequired,
    destParkingSituation,
    destParkingDistance,
    destEntryType,
    destEntryChallenges,
    destAccessNotes,
    specialRequirements,
    estimatedSquareFootage,
    useTruckRoute,
    avoidTolls,
    totalItems,
    totalWeightLbs,
    totalVolumeCuFt,
    estimatedDistanceMiles,
    costCalculations,
    routeData,
    recalculateCosts,
    moveLocations
  } = body;

  const resolvedStart = desiredStartDate || moveDate;
  const resolvedEnd = desiredEndDate || resolvedStart || moveDate;

  if (resolvedStart && resolvedEnd && new Date(resolvedStart) > new Date(resolvedEnd)) {
    const err = new Error('Desired start date must be before desired end date');
    err.statusCode = 400;
    throw err;
  }

  const updateData = {
    name,
    origin_location_id: originLocationId,
    destination_location_id: destinationLocationId,
    move_date: moveDate,
    desired_start_date: resolvedStart,
    desired_end_date: resolvedEnd,
    num_helpers: numHelpers,
    packing_services_required: packingServicesRequired,
    has_stairs: hasStairs,
    number_of_flights: numberOfFlights,
    has_elevator: hasElevator,
    elevator_type: elevatorType,
    elevator_distance: elevatorDistance,
    elevator_reservation_required: elevatorReservationRequired,
    parking_situation: parkingSituation,
    parking_distance: parkingDistance,
    entry_type: entryType,
    entry_challenges: JSON.stringify(entryChallenges || []),
    access_notes: accessNotes,
    dest_has_stairs: destHasStairs,
    dest_number_of_flights: destNumberOfFlights,
    dest_has_elevator: destHasElevator,
    dest_elevator_type: destElevatorType,
    dest_elevator_distance: destElevatorDistance,
    dest_elevator_reservation_required: destElevatorReservationRequired,
    dest_parking_situation: destParkingSituation,
    dest_parking_distance: destParkingDistance,
    dest_entry_type: destEntryType,
    dest_entry_challenges: JSON.stringify(destEntryChallenges || []),
    dest_access_notes: destAccessNotes,
    special_requirements: specialRequirements,
    estimated_square_footage: estimatedSquareFootage,
    use_truck_route: useTruckRoute,
    avoid_tolls: avoidTolls,
    total_items: totalItems,
    total_weight_lbs: totalWeightLbs,
    total_volume_cu_ft: totalVolumeCuFt,
    estimated_distance_miles: estimatedDistanceMiles,
    cost_calculations: JSON.stringify(costCalculations),
    route_data: JSON.stringify(routeData)
  };

  if (recalculateCosts) {
    updateData.cost_calculations_date = knex.fn.now();
  }

  const result = await knex('saved_moves')
    .where('id', moveId)
    .andWhere('user_id', userId)
    .update(updateData)
    .returning('*');

  if (result.length === 0) {
    const err = new Error('Saved move not found');
    err.statusCode = 404;
    throw err;
  }

  if (Array.isArray(moveLocations)) {
    await knex('move_locations').where('move_id', moveId).del();
    if (moveLocations.length > 0) {
      await knex('move_locations').insert(
        moveLocations.map(loc => ({
          move_id: parseInt(moveId),
          location_id: loc.locationId,
          location_role: loc.locationRole || 'intermediate',
          sequence_order: loc.sequenceOrder || 0,
          has_loading: loc.hasLoading || false,
          has_unloading: loc.hasUnloading || false
        }))
      );
    }
  }

  await getRouteService().syncDropoffWaypoints(moveId, userId);

  return result[0];
}

async function deleteSavedMove(userId, moveId) {
  const move = await knex('saved_moves')
    .where('id', moveId)
    .andWhere('user_id', userId)
    .first();

  if (!move) {
    const err = new Error('Saved move not found');
    err.statusCode = 404;
    throw err;
  }

  await knex('move_waypoints').where('saved_move_id', moveId).del();
  await knex('move_locations').where('move_id', moveId).del();
  await knex('move_sessions')
    .where('saved_move_id', moveId)
    .andWhere('user_id', userId)
    .del();

  const result = await knex('saved_moves')
    .where('id', moveId)
    .andWhere('user_id', userId)
    .del()
    .returning('id');

  if (result.length === 0) {
    const err = new Error('Saved move not found');
    err.statusCode = 404;
    throw err;
  }

  return { success: true, message: 'Move deleted successfully' };
}

module.exports = {
  createSavedMove,
  updateSavedMove,
  deleteSavedMove
};
