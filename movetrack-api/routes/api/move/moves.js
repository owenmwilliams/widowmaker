const express = require('express');
const router = express.Router();
const { authenticate } = require('../../../services/infra/authService');
const { calculateDrivingDistance } = require('../../../services/move/distanceService');
const trucks = require('../../../services/move/trucksService');
const moveQuery = require('../../../services/move/moveQueryService');
const moveMutation = require('../../../services/move/moveMutationService');

router.use(authenticate);

// ---------------------------------------------------------------------------
// Saved moves CRUD  (this router is also mounted at /api/saved-moves)
// ---------------------------------------------------------------------------

router.get('/', async (req, res) => {
  try {
    res.json(await moveQuery.getSavedMoves(req.user.user_id));
  } catch (err) {
    console.error('[moves] getSavedMoves:', err.message);
    res.status(500).json({ error: 'Failed to fetch saved moves' });
  }
});

router.get('/:id/eligible-sources', async (req, res) => {
  try {
    const result = await moveQuery.getEligibleSources(req.user.user_id, req.params.id);
    if (!result) return res.status(404).json({ error: 'Saved move not found' });
    res.json(result);
  } catch (err) {
    console.error('[moves] getEligibleSources:', err.message);
    res.status(500).json({ error: 'Failed to load eligible session sources' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const result = await moveQuery.getSavedMove(req.user.user_id, req.params.id);
    if (!result) return res.status(404).json({ error: 'Saved move not found' });
    res.json(result);
  } catch (err) {
    console.error('[moves] getSavedMove:', err.message);
    res.status(500).json({ error: 'Failed to fetch saved move' });
  }
});

router.post('/', async (req, res) => {
  try {
    const result = await moveMutation.createSavedMove(req.user.user_id, req.body);
    res.status(201).json(result);
  } catch (err) {
    console.error('[moves] createSavedMove:', err.message);
    res.status(err.statusCode || 500).json({ error: err.message, details: err.message });
  }
});

router.put('/:id', async (req, res) => {
  try {
    res.json(await moveMutation.updateSavedMove(req.user.user_id, req.params.id, req.body));
  } catch (err) {
    console.error('[moves] updateSavedMove:', err.message);
    res.status(err.statusCode || 500).json({ error: err.message, details: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    res.json(await moveMutation.deleteSavedMove(req.user.user_id, req.params.id));
  } catch (err) {
    console.error('[moves] deleteSavedMove:', err.message);
    res.status(err.statusCode || 500).json({ error: err.message, details: err.message });
  }
});

// ---------------------------------------------------------------------------
// Distance calculation  (mounted at /move/distance)
// ---------------------------------------------------------------------------

router.post('/distance', async (req, res) => {
  const { origin, destination, waypoints, avoidTolls, truckRoute } = req.body;

  if (!origin || !destination) {
    return res.status(400).json({ error: 'origin and destination are required' });
  }

  try {
    const result = await calculateDrivingDistance({ origin, destination, waypoints, avoidTolls, truckRoute });
    res.json(result);
  } catch (err) {
    console.error('[move] distance calculation failed:', err.message);
    res.status(500).json({ error: 'Failed to calculate distance', details: err.message });
  }
});

// ---------------------------------------------------------------------------
// Truck routes
// ---------------------------------------------------------------------------

router.get('/moves/:moveId/trucks', async (req, res) => {
  const userId = req.user?.user_id;
  if (!userId) return res.status(400).json({ error: 'User not authenticated' });
  try {
    res.json(await trucks.getTrucksForMove(userId, req.params.moveId));
  } catch (err) {
    console.error('[move] getTrucksForMove:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get('/trucks', async (req, res) => {
  const userId = req.user?.user_id;
  if (!userId) return res.status(400).json({ error: 'User not authenticated' });
  try {
    res.json(await trucks.getAllTrucks(userId));
  } catch (err) {
    console.error('[move] getAllTrucks:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get('/trucks/:id', async (req, res) => {
  const userId = req.user?.user_id;
  if (!userId) return res.status(400).json({ error: 'User not authenticated' });
  try {
    const truck = await trucks.getTruck(userId, req.params.id);
    if (!truck) return res.status(404).json({ error: 'Truck not found' });
    res.json(truck);
  } catch (err) {
    console.error('[move] getTruck:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.put('/trucks/:id', async (req, res) => {
  const userId = req.user?.user_id;
  if (!userId) return res.status(400).json({ error: 'User not authenticated' });
  try {
    const result = await trucks.updateTruck(userId, req.params.id, req.body);
    if (!result) return res.status(404).json({ error: 'Truck not found' });
    res.json(result);
  } catch (err) {
    console.error('[move] updateTruck:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.delete('/trucks/:id', async (req, res) => {
  const userId = req.user?.user_id;
  if (!userId) return res.status(400).json({ error: 'User not authenticated' });
  try {
    const result = await trucks.deleteTruck(userId, req.params.id);
    if (!result) return res.status(404).json({ error: 'Truck not found' });
    res.json({ message: 'Truck deleted successfully', ...result });
  } catch (err) {
    console.error('[move] deleteTruck:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
