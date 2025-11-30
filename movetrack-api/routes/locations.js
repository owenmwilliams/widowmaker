
var express = require('express');
var router = express.Router();
var bodyParser = require('body-parser');
const { authenticate, resolveEffectivePlan } = require('../bin/authService');
const { forwardGeocode } = require('../services/geocodingService');

const knex = require('knex')({
  client: 'pg',
  connection: {
    host : process.env.MT_DATALAYER_HOSTNAME,
    user : process.env.MT_DATALAYER_USERNAME,
    password : process.env.MT_DATALAYER_PASSWORD,
    database : process.env.MT_DATALAYER_DATABASE
  }
});

var jsonParser = bodyParser.json();
const BASIC_LOCATION_CAP = 2;

router.use(authenticate);

const HOLDING_LOCATION_TYPE = 'holding_area';
const HOLDING_LOCATION_NAME = 'Unassigned Items';
const HOLDING_LOCATION_DESCRIPTION = 'Auto-generated holding area for reassigned items';

const parseCoordinateInput = (value) => {
  if (value === undefined || value === null || value === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

async function geocodeLocationPayload(payload, correlationId) {
  const addressParts = [
    payload.address,
    payload.address_2,
    payload.city,
    payload.state,
    payload.zip
  ].filter(Boolean);

  const query = addressParts.join(', ').trim() || payload.city || payload.name;

  if (!query) {
    return { lat: null, lng: null };
  }

  try {
    const result = await forwardGeocode(query, null, payload.country || 'USA', {
      correlationId
    });

    if (result?.lat != null && result?.lng != null) {
      return { lat: result.lat, lng: result.lng };
    }
  } catch (error) {
    console.warn(`[Locations] Failed to geocode "${query}":`, error.message);
  }

  return { lat: null, lng: null };
}

async function enforceLocationCap(req, res, next) {
  const plan = resolveEffectivePlan(req);
  if (plan === 'pro') return next();
  try {
    const userId = req.user?.user_id;
    const countResult = await knex('locations').count('* as cnt').where('user_id', userId);
    const currentCount = Number(countResult?.[0]?.cnt || 0);
    if (currentCount >= BASIC_LOCATION_CAP) {
      return res.status(402).json({ error: `Basic plan supports up to ${BASIC_LOCATION_CAP} locations. Upgrade to add more.` });
    }
    next();
  } catch (err) {
    console.error('Error enforcing location cap:', err);
    res.status(500).json({ error: 'Failed to enforce plan limits' });
  }
}

async function ensureHoldingLocation(trx, userId) {
  const existing = await trx('locations')
    .where({ user_id: userId, location_type: HOLDING_LOCATION_TYPE })
    .first();

  if (existing) {
    return existing.id;
  }

  const [created] = await trx('locations')
    .insert({
      user_id: userId,
      name: HOLDING_LOCATION_NAME,
      description: HOLDING_LOCATION_DESCRIPTION,
      location_type: HOLDING_LOCATION_TYPE
    })
    .returning(['id']);

  if (created?.id) {
    await trx('permissions')
      .insert({
        user_id: userId,
        resource_id: created.id,
        resource_type: 'location',
        permission_level: 'owner',
        granted_by: userId
      })
      .onConflict(['user_id', 'resource_id', 'resource_type'])
      .ignore();
    return created.id;
  }

  throw new Error('Failed to create holding location');
}

/* GET locations listing. */
router.get('/', jsonParser, async function(req, res, next) {
  const userId = req.user?.user_id;


  try {
    await knex
      .select(
        'locations.id',
        'locations.name',
        'locations.description',
        'locations.address',
        'locations.address_2',
        'locations.city',
        'locations.state',
        'locations.zip',
        'locations.country',
        'locations.location_type',
        'locations.lat',
        'locations.lng'
      )
      .countDistinct('collections.id', {as: 'total_rooms'})
      .countDistinct('containers.id', {as: 'total_containers'})
      .countDistinct('items.id', {as: 'total_items'})
      .from('locations')
      .leftJoin('permissions', function() {
        this.on('permissions.resource_id', '=', 'locations.id')
            .andOn('permissions.resource_type', '=', knex.raw('?', ['location']))
      })
      .leftJoin('collections', 'collections.location_id', 'locations.id')
      .leftJoin('containers', 'containers.collection_id', 'collections.id')
      .leftJoin('items', 'items.container_id', 'containers.id')
      .where(
        knex.raw('permissions.user_id = ?', userId)
      )
      .groupBy(
        'locations.id',
        'locations.name',
        'locations.description',
        'locations.address',
        'locations.address_2',
        'locations.city',
        'locations.state',
        'locations.zip',
        'locations.country',
        'locations.location_type',
        'locations.lat',
        'locations.lng'
      )
    .then(data => {
      res.send(data)
    })
    .catch(function (err) {
      return next(err)
    });
  }
  catch(e) {
    res.send(e)
  }
});

/* GET location listing. */
router.get('/single', jsonParser, async function(req, res, next) {
  const userId = req.user?.user_id;
  var location_id = req.query.location

  try {
    await knex
      .select({
        id: 'locations.id',
        name: 'locations.name',
        description: 'locations.description',
        address: 'locations.address',
        address_2: 'locations.address_2',
        city: 'locations.city',
        state: 'locations.state',
        zip: 'locations.zip',
        location_type: 'locations.location_type',
        country: 'locations.country',
        lat: 'locations.lat',
        lng: 'locations.lng'
      })
      .from('locations')
      .leftJoin('permissions', function() {
        this.on('permissions.resource_id', '=', 'locations.id')
            .andOn('permissions.resource_type', '=', knex.raw('?', ['location']))
      })
      .where(knex.raw('permissions.user_id = ?', userId))
      .andWhere(knex.raw('locations.id = ?', location_id))
    .then(data => {
      res.send(data)
    })
    .catch(function (err) {
      return next(err);
    });
  }
  catch(e) {
    res.send(e)
  }
});

/* ADD locations listing. */
// THE APPLICATION USES THIS TO POST A NEW LOCATION
router.post('/post', jsonParser, enforceLocationCap, async function(req, res, next) {
  try {
    const userId = req.user?.user_id;
    const isPrimary = req.query.is_primary === 'true' || req.query.is_primary === true;
    const locationType = req.query.location_type || (isPrimary ? 'primary_residence' : 'residence');
    const country = req.query.country || 'USA';

    const latInput = parseCoordinateInput(req.query.lat);
    const lngInput = parseCoordinateInput(req.query.lng);

    const basePayload = {
      user_id: userId,
      name: req.query.name,
      description: req.query.description,
      address: req.query.address,
      address_2: req.query.address_2,
      city: req.query.city,
      state: req.query.state,
      zip: req.query.zip,
      country,
      location_type: locationType,
      lat: latInput,
      lng: lngInput
    };

    if (basePayload.lat == null || basePayload.lng == null) {
      const geocodeResult = await geocodeLocationPayload(basePayload, `location-create-${userId || 'anon'}`);
      basePayload.lat = geocodeResult.lat;
      basePayload.lng = geocodeResult.lng;
    }

    const data = await knex.transaction(async trx => {
      if (isPrimary) {
        await trx('locations')
          .update({ location_type: 'residence' })
          .where('user_id', userId)
          .andWhere('location_type', 'primary_residence');
      }

      const inserted = await trx('locations')
        .insert(basePayload)
        .returning('id');

      return inserted;
    });

    res.send(data);
  } catch (e) {
    res.send(e);
  }
});

/* GET deletion preview - shows what will be affected */
router.get('/delete/preview', async function(req, res) {
  try {
    const userId = req.user?.user_id;
    const locationId = Number(req.query.location_id);

    if (!userId || !locationId) {
      return res.status(400).json({ error: 'location_id is required' });
    }

    // Check if location exists and belongs to user
    const location = await knex('locations')
      .where({ id: locationId, user_id: userId })
      .first();

    if (!location) {
      return res.status(404).json({ error: 'Location not found' });
    }

    if (location.location_type === HOLDING_LOCATION_TYPE) {
      return res.status(400).json({ error: 'Cannot delete the default holding location' });
    }

    // Get counts of what will be affected
    const [collectionsCount] = await knex('collections')
      .count('* as count')
      .where({ location_id: locationId, user_id: userId });

    const [itemsCount] = await knex('items')
      .count('* as count')
      .where({ collection_id: knex('collections').select('id').where({ location_id: locationId, user_id: userId }) });

    const [containersCount] = await knex('containers')
      .count('* as count')
      .where({ collection_id: knex('collections').select('id').where({ location_id: locationId, user_id: userId }) });

    // Get count of affected moves
    const affectedMoveIds = new Set();

    // Find moves with this location as origin or destination
    const originMoves = await knex('saved_moves')
      .where({ user_id: userId, origin_location_id: locationId })
      .pluck('id');
    originMoves.forEach(id => affectedMoveIds.add(id));

    const destMoves = await knex('saved_moves')
      .where({ user_id: userId, destination_location_id: locationId })
      .pluck('id');
    destMoves.forEach(id => affectedMoveIds.add(id));

    // Find moves with waypoints at this location
    const waypointMoves = await knex('move_waypoints')
      .where({ location_id: locationId })
      .pluck('saved_move_id');
    waypointMoves.forEach(id => affectedMoveIds.add(id));

    // Find moves in move_locations
    const moveLocationMoves = await knex('move_locations')
      .where({ location_id: locationId })
      .pluck('move_id');
    moveLocationMoves.forEach(id => affectedMoveIds.add(id));

    const affectedMovesCount = affectedMoveIds.size;

    // Get names of affected moves for display
    const affectedMoveNames = affectedMovesCount > 0
      ? await knex('saved_moves')
          .select('id', 'name')
          .whereIn('id', Array.from(affectedMoveIds))
          .orderBy('name')
      : [];

    // Get user's other locations (for reassignment option)
    const otherLocations = await knex('locations')
      .select('id', 'name', 'location_type', 'address', 'city', 'state')
      .where({ user_id: userId })
      .whereNot({ id: locationId })
      .orderBy('name');

    res.json({
      location: {
        id: location.id,
        name: location.name,
        location_type: location.location_type
      },
      affectedData: {
        collections: Number(collectionsCount.count),
        items: Number(itemsCount.count),
        containers: Number(containersCount.count),
        moves: affectedMovesCount
      },
      affectedMoves: affectedMoveNames,
      availableDestinations: otherLocations,
      deletionStrategies: [
        {
          id: 'reassign',
          name: 'Move to another location',
          description: 'Collections and items will be moved to the selected location',
          moveBehavior: affectedMovesCount > 0
            ? `${affectedMovesCount} saved move(s) will be updated to use the new location`
            : 'No moves will be affected',
          recommended: otherLocations.length > 0,
          requiresDestination: true
        },
        {
          id: 'unassigned',
          name: 'Move to Unassigned Items',
          description: 'Collections will be moved to a holding area',
          moveBehavior: affectedMovesCount > 0
            ? `${affectedMovesCount} saved move(s) will be permanently deleted`
            : 'No moves will be affected',
          recommended: otherLocations.length === 0,
          requiresDestination: false
        },
        {
          id: 'delete_all',
          name: 'Delete all inventory',
          description: 'Permanently delete all collections, items, and containers at this location',
          moveBehavior: affectedMovesCount > 0
            ? `${affectedMovesCount} saved move(s) will be permanently deleted`
            : 'No moves will be affected',
          recommended: false,
          requiresDestination: false,
          requiresConfirmation: true
        }
      ]
    });
  } catch (error) {
    console.error('Failed to preview location deletion:', error);
    res.status(500).json({ error: 'Failed to preview deletion' });
  }
});

/* DELETE locations with strategy support */
router.delete('/delete/execute', jsonParser, async function(req, res) {
  try {
    const userId = req.user?.user_id;
    const locationId = Number(req.body.location_id);
    const strategy = req.body.strategy; // 'reassign', 'unassigned', or 'delete_all'
    const destinationLocationId = req.body.destination_location_id ? Number(req.body.destination_location_id) : null;

    if (!userId || !locationId) {
      return res.status(400).json({ error: 'location_id is required' });
    }

    if (!strategy || !['reassign', 'unassigned', 'delete_all'].includes(strategy)) {
      return res.status(400).json({ error: 'Invalid deletion strategy. Must be: reassign, unassigned, or delete_all' });
    }

    if (strategy === 'reassign' && !destinationLocationId) {
      return res.status(400).json({ error: 'destination_location_id is required for reassign strategy' });
    }

    const result = await knex.transaction(async trx => {
      // Verify location exists and belongs to user
      const location = await trx('locations')
        .where({ id: locationId, user_id: userId })
        .first();

      if (!location) {
        throw Object.assign(new Error('Location not found'), { status: 404 });
      }

      if (location.location_type === HOLDING_LOCATION_TYPE) {
        throw Object.assign(new Error('Cannot delete the default holding location'), { status: 400 });
      }

      // If reassigning, verify destination location exists and belongs to user
      if (strategy === 'reassign') {
        const destLocation = await trx('locations')
          .where({ id: destinationLocationId, user_id: userId })
          .first();

        if (!destLocation) {
          throw Object.assign(new Error('Destination location not found'), { status: 404 });
        }
      }

      const movesNeedingReview = new Set();
      let deletedCounts = { collections: 0, items: 0, containers: 0 };
      let targetLocationId = null;

      // Execute based on strategy
      if (strategy === 'delete_all') {
        // Strategy 1: Delete all collections (cascades to items/containers)
        const collectionsToDelete = await trx('collections')
          .where({ location_id: locationId, user_id: userId })
          .select('id');

        const collectionIds = collectionsToDelete.map(c => c.id);

        if (collectionIds.length > 0) {
          // Count what will be deleted
          const [itemsCount] = await trx('items')
            .count('* as count')
            .whereIn('collection_id', collectionIds);

          const [containersCount] = await trx('containers')
            .count('* as count')
            .whereIn('collection_id', collectionIds);

          deletedCounts.items = Number(itemsCount.count);
          deletedCounts.containers = Number(containersCount.count);
          deletedCounts.collections = collectionIds.length;

          // Delete collections (items and containers cascade)
          await trx('collections')
            .whereIn('id', collectionIds)
            .delete();
        }

      } else {
        // Strategy 2 & 3: Move collections to destination
        if (strategy === 'reassign') {
          targetLocationId = destinationLocationId;
        } else { // strategy === 'unassigned'
          targetLocationId = await ensureHoldingLocation(trx, userId);
        }

        // Move collections to target location
        const movedCount = await trx('collections')
          .where({ location_id: locationId, user_id: userId })
          .update({ location_id: targetLocationId, updated_at: knex.fn.now() });

        deletedCounts.moved = movedCount;
      }

      // Handle moves based on strategy
      if (strategy === 'reassign') {
        // STRATEGY 1: REASSIGN - Update moves to point to new location

        // Update saved_moves origin
        const originMovesUpdated = await trx('saved_moves')
          .where({ user_id: userId, origin_location_id: locationId })
          .update({ origin_location_id: targetLocationId, updated_at: knex.fn.now() });

        // Update saved_moves destination
        const destMovesUpdated = await trx('saved_moves')
          .where({ user_id: userId, destination_location_id: locationId })
          .update({ destination_location_id: targetLocationId, updated_at: knex.fn.now() });

        deletedCounts.movesUpdated = originMovesUpdated + destMovesUpdated;

        // Update waypoints to point to new location
        const waypointsUpdated = await trx('move_waypoints')
          .where({ location_id: locationId })
          .update({ location_id: targetLocationId });

        deletedCounts.waypointsUpdated = waypointsUpdated;

        // Update move_locations to point to new location
        await trx('move_locations')
          .where({ location_id: locationId })
          .update({ location_id: targetLocationId });

        // Update move sessions
        await trx('move_sessions')
          .where({ session_start_location_id: locationId, user_id: userId })
          .update({ session_start_location_id: targetLocationId, updated_at: knex.fn.now() });

        await trx('move_sessions')
          .where({ session_end_location_id: locationId, user_id: userId })
          .update({ session_end_location_id: targetLocationId, updated_at: knex.fn.now() });

        await trx('move_sessions')
          .where({ truck_location_id: locationId, user_id: userId })
          .update({ truck_location_id: targetLocationId, updated_at: knex.fn.now() });

      } else {
        // STRATEGY 2 & 3: UNASSIGNED or DELETE_ALL - Delete all associated moves

        // Get all affected move IDs before deletion
        const affectedMoveIds = new Set();

        // Find moves with this location as origin or destination
        const originMoves = await trx('saved_moves')
          .where({ user_id: userId, origin_location_id: locationId })
          .pluck('id');
        originMoves.forEach(id => affectedMoveIds.add(id));

        const destMoves = await trx('saved_moves')
          .where({ user_id: userId, destination_location_id: locationId })
          .pluck('id');
        destMoves.forEach(id => affectedMoveIds.add(id));

        // Find moves with waypoints at this location
        const waypointMoves = await trx('move_waypoints')
          .where({ location_id: locationId })
          .pluck('saved_move_id');
        waypointMoves.forEach(id => affectedMoveIds.add(id));

        // Find moves in move_locations
        const moveLocationMoves = await trx('move_locations')
          .where({ location_id: locationId })
          .pluck('move_id');
        moveLocationMoves.forEach(id => affectedMoveIds.add(id));

        const affectedMoveIdsArray = Array.from(affectedMoveIds);

        if (affectedMoveIdsArray.length > 0) {
          // Delete waypoints first
          await trx('move_waypoints')
            .whereIn('saved_move_id', affectedMoveIdsArray)
            .del();

          // Delete move_locations
          await trx('move_locations')
            .whereIn('move_id', affectedMoveIdsArray)
            .del();

          // Delete move_sessions
          const sessionsDeleted = await trx('move_sessions')
            .whereIn('saved_move_id', affectedMoveIdsArray)
            .del();

          // Delete saved_moves
          const movesDeleted = await trx('saved_moves')
            .whereIn('id', affectedMoveIdsArray)
            .del();

          deletedCounts.movesDeleted = movesDeleted;
          deletedCounts.sessionsDeleted = sessionsDeleted;
        } else {
          deletedCounts.movesDeleted = 0;
          deletedCounts.sessionsDeleted = 0;
        }
      }

      // Finally, delete the location
      await trx('locations')
        .where({ id: locationId, user_id: userId })
        .del();

      return {
        strategy,
        targetLocationId,
        deletedCounts,
        movesNeedingReview: Array.from(movesNeedingReview)
      };
    });

    res.json({
      success: true,
      message: `Location deleted successfully using ${strategy} strategy`,
      ...result
    });
  } catch (error) {
    const status = error.status || 500;
    console.error('Failed to delete location:', error);
    res.status(status).json({ error: error.message || 'Failed to delete location' });
  }
});

/* DELETE locations listing. */
router.delete('/delete', jsonParser, async function(req, res) {
  try {
    const userId = req.user?.user_id;
    const locationId = Number(req.query.location_id);

    if (!userId || !locationId) {
      return res.status(400).json({ error: 'location_id is required' });
    }

    const result = await knex.transaction(async trx => {
      const location = await trx('locations')
        .where({ id: locationId, user_id: userId })
        .first();

      if (!location) {
        throw Object.assign(new Error('Location not found'), { status: 404 });
      }

      if (location.location_type === HOLDING_LOCATION_TYPE) {
        throw Object.assign(new Error('Cannot delete the default holding location'), { status: 400 });
      }

      const fallbackId = await ensureHoldingLocation(trx, userId);
      const movesNeedingReview = new Set();

      await trx('collections')
        .where({ location_id: locationId, user_id: userId })
        .update({ location_id: fallbackId, updated_at: knex.fn.now() });

      await trx('containers')
        .where({ location_id: locationId, user_id: userId })
        .update({ location_id: fallbackId, updated_at: knex.fn.now() });

      await trx('items')
        .where({ location_id: locationId, user_id: userId })
        .update({ location_id: null, updated_at: knex.fn.now() });

      await trx('move_sessions')
        .where({ session_start_location_id: locationId, user_id: userId })
        .update({ session_start_location_id: fallbackId, updated_at: knex.fn.now() });

      await trx('move_sessions')
        .where({ session_end_location_id: locationId, user_id: userId })
        .update({ session_end_location_id: fallbackId, updated_at: knex.fn.now() });

      // Remove move_locations entries referencing this location
      const affectedMoveIds = await trx('move_locations')
        .where({ location_id: locationId })
        .pluck('move_id');

      if (affectedMoveIds.length) {
        await trx('move_locations')
          .where({ location_id: locationId })
          .del();
        affectedMoveIds.forEach(id => movesNeedingReview.add(id));
      }

      // Update saved_moves origin/destination if necessary
      const originMoves = await trx('saved_moves')
        .where({ user_id: userId, origin_location_id: locationId })
        .pluck('id');
      if (originMoves.length) {
        await trx('saved_moves')
          .whereIn('id', originMoves)
          .update({ origin_location_id: fallbackId, updated_at: knex.fn.now() });
        originMoves.forEach(id => movesNeedingReview.add(id));
      }

      const destinationMoves = await trx('saved_moves')
        .where({ user_id: userId, destination_location_id: locationId })
        .pluck('id');
      if (destinationMoves.length) {
        await trx('saved_moves')
          .whereIn('id', destinationMoves)
          .update({ destination_location_id: fallbackId, updated_at: knex.fn.now() });
        destinationMoves.forEach(id => movesNeedingReview.add(id));
      }

      // Remove waypoints that are tied to this location
      const waypointRows = await trx('move_waypoints')
        .select('id', 'saved_move_id')
        .where({ location_id: locationId });

      if (waypointRows.length) {
        const waypointIds = waypointRows.map(row => row.id);

        for (const row of waypointRows) {
          await trx('move_sessions')
            .where({ saved_move_id: row.saved_move_id })
            .andWhere('start_waypoint_id', row.id)
            .update({ start_waypoint_id: null, updated_at: knex.fn.now() });

          await trx('move_sessions')
            .where({ saved_move_id: row.saved_move_id })
            .andWhere('end_waypoint_id', row.id)
            .update({ end_waypoint_id: null, updated_at: knex.fn.now() });

          movesNeedingReview.add(row.saved_move_id);
        }

        await trx('move_waypoints')
          .whereIn('id', waypointIds)
          .del();
      }

      await trx('locations')
        .where({ id: locationId, user_id: userId })
        .del();

      return {
        fallbackLocationId: fallbackId,
        movesNeedingReview: Array.from(movesNeedingReview)
      };
    });

    res.json({
      success: true,
      fallbackLocationId: result.fallbackLocationId,
      movesNeedingReview: result.movesNeedingReview
    });
  } catch (error) {
    const status = error.status || 500;
    console.error('Failed to delete location:', error);
    res.status(status).json({ error: error.message || 'Failed to delete location' });
  }
});

/* EDIT locations listing. */
// THE APPLICATION USES THIS TO EDIT A LOCATION
router.put('/update', jsonParser, async function(req, res, next) {
  try {
    const userId = req.user?.user_id;
    const isPrimary = req.query.is_primary === 'true' || req.query.is_primary === true;
    const locationType = req.query.location_type || (isPrimary ? 'primary_residence' : 'residence');
    const country = req.query.country || 'USA';

    const latInput = parseCoordinateInput(req.query.lat);
    const lngInput = parseCoordinateInput(req.query.lng);

    const updatePayload = {
      user_id: userId,
      name: req.query.name,
      description: req.query.description,
      address: req.query.address,
      address_2: req.query.address_2,
      city: req.query.city,
      state: req.query.state,
      zip: req.query.zip,
      country,
      location_type: locationType,
      updated_at: knex.fn.now(),
      lat: latInput,
      lng: lngInput
    };

    if (updatePayload.lat == null || updatePayload.lng == null) {
      const geocodeResult = await geocodeLocationPayload(
        { ...updatePayload, user_id: userId },
        `location-update-${req.query.location_id || 'unknown'}`
      );
      updatePayload.lat = geocodeResult.lat;
      updatePayload.lng = geocodeResult.lng;
    }

    await knex.transaction(async trx => {
      if (isPrimary) {
        await trx('locations')
          .update({ location_type: 'residence' })
          .where('user_id', userId)
          .andWhere('location_type', 'primary_residence');
      }

      await trx('locations')
        .update(updatePayload)
        .where('id', req.query.location_id)
        .andWhere('user_id', userId);
    });

    res.send('OK');
  }
  catch(e) {
    res.send(e)
  }
});

module.exports = router;
