var express = require('express');
var router = express.Router();
const { authenticate, resolveEffectivePlan } = require('../../../services/infra/authService');
const { getAllLocations, getSingleLocation, getLocationCount } = require('../../../services/workflow/locationQueryService');
const { getPlacesAutocomplete, getPlaceDetails, validateAddress } = require('../../../services/infra/geocodingService');
const {
  BASIC_LOCATION_CAP,
  createLocation,
  updateLocationById,
  getLocationDeletePreview,
  executeLocationDeletion,
  deleteLocation,
} = require('../../../services/workflow/locationMutationService');

router.use(authenticate);

async function enforceLocationCap(req, res, next) {
  const plan = resolveEffectivePlan(req);
  if (plan === 'pro') return next();
  try {
    const count = await getLocationCount(req.user?.user_id);
    if (count >= BASIC_LOCATION_CAP) {
      return res.status(402).json({
        error: `Basic plan supports up to ${BASIC_LOCATION_CAP} locations. Upgrade to add more.`,
      });
    }
    next();
  } catch (err) {
    console.error('[locations] Error enforcing location cap:', err);
    res.status(500).json({ error: 'Failed to enforce plan limits' });
  }
}

/* GET all locations with aggregate counts. */
router.get('/', async function(req, res, next) {
  try {
    const data = await getAllLocations(req.user?.user_id);
    res.send(data);
  } catch (err) {
    next(err);
  }
});

/* GET single location. */
router.get('/single', async function(req, res, next) {
  try {
    const data = await getSingleLocation(req.user?.user_id, req.query.location);
    res.send(data);
  } catch (err) {
    next(err);
  }
});

/* POST create a new location. */
router.post('/post', enforceLocationCap, async function(req, res, next) {
  try {
    const data = await createLocation(req.user?.user_id, req.query);
    res.send(data);
  } catch (err) {
    next(err);
  }
});

/* GET deletion preview — shows what will be affected. */
router.get('/delete/preview', async function(req, res) {
  const userId = req.user?.user_id;
  const locationId = Number(req.query.location_id);

  if (!userId || !locationId) {
    return res.status(400).json({ error: 'location_id is required' });
  }

  try {
    const result = await getLocationDeletePreview(userId, locationId);
    if (!result.success) return res.status(result.status).json({ error: result.error });
    const { success: _s, ...payload } = result;
    res.json(payload);
  } catch (err) {
    console.error('[locations] Failed to preview deletion:', err);
    res.status(500).json({ error: 'Failed to preview deletion' });
  }
});

/* DELETE location with strategy. */
router.delete('/delete/execute', async function(req, res) {
  const userId = req.user?.user_id;
  const locationId = Number(req.body.location_id);

  if (!userId || !locationId) {
    return res.status(400).json({ error: 'location_id is required' });
  }

  try {
    const result = await executeLocationDeletion(
      userId,
      locationId,
      req.body.strategy,
      req.body.destination_location_id ? Number(req.body.destination_location_id) : null
    );

    if (!result.success) return res.status(result.status || 400).json({ error: result.error });
    res.json({ success: true, message: `Location deleted successfully using ${result.strategy} strategy`, ...result });
  } catch (err) {
    const status = err.status || 500;
    console.error('[locations] Failed to delete location:', err);
    res.status(status).json({ error: err.message || 'Failed to delete location' });
  }
});

/* DELETE location (simple, with fallback to holding area). */
router.delete('/delete', async function(req, res) {
  const userId = req.user?.user_id;
  const locationId = Number(req.query.location_id);

  if (!userId || !locationId) {
    return res.status(400).json({ error: 'location_id is required' });
  }

  try {
    const result = await deleteLocation(userId, locationId);
    res.json({ success: true, fallbackLocationId: result.fallbackLocationId, movesNeedingReview: result.movesNeedingReview });
  } catch (err) {
    const status = err.status || 500;
    console.error('[locations] Failed to delete location:', err);
    res.status(status).json({ error: err.message || 'Failed to delete location' });
  }
});

/* PUT update a location. */
router.put('/update', async function(req, res, next) {
  try {
    await updateLocationById(req.user?.user_id, req.query.location_id, req.query);
    res.send('OK');
  } catch (err) {
    next(err);
  }
});

// ─── GET /places-autocomplete ─────────────────────────────────────────────────
// Proxy for Google Places Autocomplete — used during address entry.
router.get('/places-autocomplete', async (req, res) => {
  const { input } = req.query;
  if (!input) return res.json({ predictions: [] });
  try {
    const data = await getPlacesAutocomplete(input);
    res.json(data);
  } catch (err) {
    console.error('[locations] places-autocomplete error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /places-details ──────────────────────────────────────────────────────
// Proxy for Google Places Details — resolves address components from a place_id.
router.get('/places-details', async (req, res) => {
  const { place_id } = req.query;
  if (!place_id) return res.status(400).json({ error: 'place_id required' });
  try {
    const data = await getPlaceDetails(place_id);
    res.json(data);
  } catch (err) {
    console.error('[locations] places-details error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /validate-address ───────────────────────────────────────────────────
// Validate a structured address via Google Address Validation API.
router.post('/validate-address', express.json(), async (req, res) => {
  try {
    const data = await validateAddress(req.body.address || req.body);
    res.json(data);
  } catch (err) {
    console.error('[locations] validate-address error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
