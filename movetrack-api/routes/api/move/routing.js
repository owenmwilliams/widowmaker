const express = require('express');
const router = express.Router();
const { authenticate } = require('../../../services/infra/authService');
const route = require('../../../services/move/routeService');

router.use(authenticate);

// ---------------------------------------------------------------------------
// Waypoint CRUD
// ---------------------------------------------------------------------------

router.get('/:moveId', async (req, res) => {
  try {
    res.json(await route.getWaypoints(req.user.user_id, req.params.moveId));
  } catch (err) {
    console.error('[routing] getWaypoints:', err.message);
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

router.post('/:moveId', async (req, res) => {
  try {
    const result = await route.createWaypoint(req.user.user_id, req.params.moveId, req.body);
    res.status(201).json(result);
  } catch (err) {
    console.error('[routing] createWaypoint:', err.message);
    res.status(err.statusCode || 500).json({ error: err.message, details: err.message });
  }
});

router.put('/:waypointId', async (req, res) => {
  try {
    res.json(await route.updateWaypoint(req.user.user_id, req.params.waypointId, req.body));
  } catch (err) {
    console.error('[routing] updateWaypoint:', err.message);
    res.status(err.statusCode || 500).json({ error: err.message, details: err.message });
  }
});

router.delete('/:waypointId', async (req, res) => {
  try {
    res.json(await route.deleteWaypoint(req.user.user_id, req.params.waypointId));
  } catch (err) {
    console.error('[routing] deleteWaypoint:', err.message);
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Reorder
// ---------------------------------------------------------------------------

router.post('/:moveId/reorder', async (req, res) => {
  try {
    res.json(await route.reorderWaypoints(req.user.user_id, req.params.moveId, req.body.waypointIds));
  } catch (err) {
    console.error('[routing] reorderWaypoints:', err.message);
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Suggestion
// ---------------------------------------------------------------------------

router.post('/suggest', async (req, res) => {
  try {
    res.json(await route.suggestWaypoints(req.body));
  } catch (err) {
    console.error('[routing] suggestWaypoints:', err.message);
    res.status(err.statusCode || 500).json({ error: err.message, details: err.message });
  }
});

router.post('/:moveId/suggest-and-save', async (req, res) => {
  try {
    const result = await route.suggestAndSaveWaypoints(req.user.user_id, req.params.moveId, req.body);
    res.status(201).json(result);
  } catch (err) {
    console.error('[routing] suggestAndSaveWaypoints:', err.message);
    res.status(err.statusCode || 500).json({ error: err.message, details: err.message });
  }
});

// ---------------------------------------------------------------------------
// Route calculation
// ---------------------------------------------------------------------------

router.post('/:moveId/calculate-route', async (req, res) => {
  try {
    res.json(await route.calculateOptimizedRoute(req.user.user_id, req.params.moveId));
  } catch (err) {
    console.error('[routing] calculateOptimizedRoute:', err.message);
    const body = { error: err.message };
    if (err.details) body.details = err.details;
    if (err.missingDropoffs) body.missingDropoffs = err.missingDropoffs;
    res.status(err.statusCode || 500).json(body);
  }
});

router.post('/:moveId/recalculate-route', async (req, res) => {
  try {
    res.json(await route.recalculateRoute(req.user.user_id, req.params.moveId));
  } catch (err) {
    console.error('[routing] recalculateRoute:', err.message);
    const body = { error: err.message };
    if (err.details) body.details = err.details;
    res.status(err.statusCode || 500).json(body);
  }
});

module.exports = router;
