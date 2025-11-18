const express = require('express');
const router = express.Router();
const { authenticate } = require('../bin/authService');

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
 * GET /api/saved-moves
 * Get all saved moves for the authenticated user
 */
router.get('/', authenticate, async (req, res) => {
  try {
    const userId = req.user.user_id;

    const result = await knex('saved_moves as sm')
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

    res.json(result);
  } catch (error) {
    console.error('Error fetching saved moves:', error);
    res.status(500).json({ error: 'Failed to fetch saved moves' });
  }
});

/**
 * GET /api/saved-moves/:id
 * Get a specific saved move by ID
 */
router.get('/:id', authenticate, async (req, res) => {
  try {
    const userId = req.user.user_id;
    const moveId = req.params.id;

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

    if (!result) {
      return res.status(404).json({ error: 'Saved move not found' });
    }

    // Check if cost calculations are older than 2 weeks
    const twoWeeksAgo = new Date();
    twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);

    if (result.cost_calculations_date && new Date(result.cost_calculations_date) < twoWeeksAgo) {
      result.cost_calculations_stale = true;
    } else {
      result.cost_calculations_stale = false;
    }

    res.json(result);
  } catch (error) {
    console.error('Error fetching saved move:', error);
    res.status(500).json({ error: 'Failed to fetch saved move' });
  }
});

/**
 * POST /api/saved-moves
 * Create a new saved move
 */
router.post('/', authenticate, async (req, res) => {
  try {
    const userId = req.user.user_id;
    const {
      name,
      originLocationId,
      destinationLocationId,
      moveDate,
      numHelpers,
      packingServicesRequired,
      // Origin details
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
      // Destination details
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
      // Additional
      specialRequirements,
      estimatedSquareFootage,
      useTruckRoute,
      avoidTolls,
      // Calculated metrics
      totalItems,
      totalWeightLbs,
      totalVolumeCuFt,
      estimatedDistanceMiles,
      costCalculations,
      routeData
    } = req.body;

    const result = await knex('saved_moves')
      .insert({
        user_id: userId,
        name,
        origin_location_id: originLocationId,
        destination_location_id: destinationLocationId,
        move_date: moveDate,
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

    res.status(201).json(result[0]);
  } catch (error) {
    console.error('Error creating saved move:', error);
    res.status(500).json({ error: 'Failed to create saved move', details: error.message });
  }
});

/**
 * PUT /api/saved-moves/:id
 * Update an existing saved move
 */
router.put('/:id', authenticate, async (req, res) => {
  try {
    const userId = req.user.user_id;
    const moveId = req.params.id;
    const {
      name,
      originLocationId,
      destinationLocationId,
      moveDate,
      numHelpers,
      packingServicesRequired,
      // Origin details
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
      // Destination details
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
      // Additional
      specialRequirements,
      estimatedSquareFootage,
      useTruckRoute,
      avoidTolls,
      // Calculated metrics
      totalItems,
      totalWeightLbs,
      totalVolumeCuFt,
      estimatedDistanceMiles,
      costCalculations,
      routeData,
      recalculateCosts
    } = req.body;

    const updateData = {
      name,
      origin_location_id: originLocationId,
      destination_location_id: destinationLocationId,
      move_date: moveDate,
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

    // If recalculating costs, update the timestamp
    if (recalculateCosts) {
      updateData.cost_calculations_date = knex.fn.now();
    }

    const result = await knex('saved_moves')
      .where('id', moveId)
      .andWhere('user_id', userId)
      .update(updateData)
      .returning('*');

    if (result.length === 0) {
      return res.status(404).json({ error: 'Saved move not found' });
    }

    res.json(result[0]);
  } catch (error) {
    console.error('Error updating saved move:', error);
    res.status(500).json({ error: 'Failed to update saved move', details: error.message });
  }
});

/**
 * DELETE /api/saved-moves/:id
 * Delete a saved move
 */
router.delete('/:id', authenticate, async (req, res) => {
  try {
    const userId = req.user.user_id;
    const moveId = req.params.id;

    const result = await knex('saved_moves')
      .where('id', moveId)
      .andWhere('user_id', userId)
      .del()
      .returning('id');

    if (result.length === 0) {
      return res.status(404).json({ error: 'Saved move not found' });
    }

    res.json({ success: true, message: 'Move deleted successfully' });
  } catch (error) {
    console.error('Error deleting saved move:', error);
    res.status(500).json({ error: 'Failed to delete saved move' });
  }
});

module.exports = router;
