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
 * GET /api/saved-moves/:id/eligible-sources
 * Return available starting locations for new sessions:
 * 1. Move's origin location
 * 2. Ending location of ANY other session (regardless of completion status)
 *    This allows users to plan all sessions in advance
 */
router.get('/:id/eligible-sources', authenticate, async (req, res) => {
  try {
    const userId = req.user.user_id;
    const moveId = req.params.id;

    const move = await knex('saved_moves as sm')
      .select(
        'sm.id',
        'sm.origin_location_id',
        'sm.destination_location_id',
        'sm.desired_start_date',
        'sm.desired_end_date',
        'ol.name as origin_location_name'
      )
      .leftJoin('locations as ol', 'sm.origin_location_id', 'ol.id')
      .where('sm.id', moveId)
      .andWhere('sm.user_id', userId)
      .first();

    if (!move) {
      return res.status(404).json({ error: 'Saved move not found' });
    }

    const sources = [];

    if (move.origin_location_id) {
      sources.push({
        location_id: move.origin_location_id,
        label: move.origin_location_name || 'Move Origin',
        source_type: 'origin'
      });
    }

    // Get session_end_location_id from ALL sessions (not just completed ones)
    // This allows users to plan sessions in advance
    const existingSessions = await knex('move_sessions as ms')
      .select(
        'ms.id',
        'ms.session_name',
        'ms.session_end_location_id',
        'loc.name as end_location_name'
      )
      .leftJoin('locations as loc', 'ms.session_end_location_id', 'loc.id')
      .where('ms.saved_move_id', moveId)
      .andWhere('ms.user_id', userId)
      .whereNotNull('ms.session_end_location_id')
      .orderBy('ms.updated_at', 'desc');

    // Use string comparison for consistent Set behavior
    const seen = new Set(sources.map(src => String(src.location_id)));
    existingSessions.forEach(session => {
      const endLocationId = String(session.session_end_location_id);
      if (!session.session_end_location_id || seen.has(endLocationId)) {
        return;
      }
      seen.add(endLocationId);
      sources.push({
        location_id: session.session_end_location_id,
        label: session.end_location_name || `Session ${session.session_name || session.id}`,
        source_type: 'session',
        session_id: session.id,
        session_name: session.session_name || null
      });
    });

    res.json({
      move: {
        id: move.id,
        desired_start_date: move.desired_start_date,
        desired_end_date: move.desired_end_date
      },
      sources
    });
  } catch (error) {
    console.error('Error fetching eligible session sources:', error);
    res.status(500).json({ error: 'Failed to load eligible session sources' });
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

    // Fetch move_locations (multi-location data) including location details
    const moveLocations = await knex('move_locations as ml')
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

    result.move_locations = moveLocations;

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
      desiredStartDate,
      desiredEndDate,
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
      // Multi-location data
      moveLocations
    } = req.body;

    const resolvedStart = desiredStartDate || moveDate;
    const resolvedEnd = desiredEndDate || resolvedStart || moveDate;

    if (resolvedStart && resolvedEnd && new Date(resolvedStart) > new Date(resolvedEnd)) {
      return res.status(400).json({ error: 'Desired start date must be before desired end date' });
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

    // Save move_locations if provided (multi-location support)
    if (moveLocations && Array.isArray(moveLocations) && moveLocations.length > 0) {
      const moveLocationInserts = moveLocations.map(loc => ({
        move_id: newMove.id,
        location_id: loc.locationId,
        location_role: loc.locationRole || 'intermediate',
        sequence_order: loc.sequenceOrder || 0,
        has_loading: loc.hasLoading || false,
        has_unloading: loc.hasUnloading || false
      }));

      await knex('move_locations').insert(moveLocationInserts);
    }

    res.status(201).json(newMove);
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
      desiredStartDate,
      desiredEndDate,
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
      recalculateCosts,
      // Multi-location data
      moveLocations
    } = req.body;

    const resolvedStart = desiredStartDate || moveDate;
    const resolvedEnd = desiredEndDate || resolvedStart || moveDate;

    if (resolvedStart && resolvedEnd && new Date(resolvedStart) > new Date(resolvedEnd)) {
      return res.status(400).json({ error: 'Desired start date must be before desired end date' });
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

    // Update move_locations if provided (multi-location support)
    // Delete existing entries and insert new ones
    if (moveLocations && Array.isArray(moveLocations)) {
      // Delete existing move_locations for this move
      await knex('move_locations').where('move_id', moveId).del();

      // Insert new move_locations if any
      if (moveLocations.length > 0) {
        const moveLocationInserts = moveLocations.map(loc => ({
          move_id: parseInt(moveId),
          location_id: loc.locationId,
          location_role: loc.locationRole || 'intermediate',
          sequence_order: loc.sequenceOrder || 0,
          has_loading: loc.hasLoading || false,
          has_unloading: loc.hasUnloading || false
        }));

        await knex('move_locations').insert(moveLocationInserts);
      }
    }

    res.json(result[0]);
  } catch (error) {
    console.error('Error updating saved move:', error);
    res.status(500).json({ error: 'Failed to update saved move', details: error.message });
  }
});

/**
 * DELETE /api/saved-moves/:id
 * Delete a saved move and all related data
 */
router.delete('/:id', authenticate, async (req, res) => {
  try {
    const userId = req.user.user_id;
    const moveId = req.params.id;

    // Verify the move exists and belongs to the user
    const move = await knex('saved_moves')
      .where('id', moveId)
      .andWhere('user_id', userId)
      .first();

    if (!move) {
      return res.status(404).json({ error: 'Saved move not found' });
    }

    // Delete related records in correct order (child tables first)
    // 1. Delete move_waypoints
    await knex('move_waypoints')
      .where('saved_move_id', moveId)
      .del();

    // 2. Delete move_locations
    await knex('move_locations')
      .where('move_id', moveId)
      .del();

    // 3. Delete move_sessions (which will cascade to move_timeline, move_crew, etc.)
    await knex('move_sessions')
      .where('saved_move_id', moveId)
      .andWhere('user_id', userId)
      .del();

    // 4. Finally delete the saved_move itself
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
    res.status(500).json({ error: 'Failed to delete saved move', details: error.message });
  }
});

module.exports = router;
