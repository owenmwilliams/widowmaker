const express = require('express');
const router = express.Router();
const { authenticate, requireProOrAdmin } = require('../../../services/infra/authService');
const svc = require('../../../services/move/moveCoordinationService');
const { getLooseItems } = require('../../../services/inventory/inventoryQueryService');

router.use(authenticate, requireProOrAdmin);

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

router.get('/sessions', async (req, res) => {
  const userId = req.user?.user_id;
  if (!userId) return res.status(400).json({ error: 'User not authenticated' });
  try {
    const rows = await svc.getSessions(userId);
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    res.json(rows);
  } catch (err) {
    console.error('[moveCoordination] getSessions:', err.message);
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

router.get('/sessions/:id', async (req, res) => {
  const userId = req.user?.user_id;
  if (!userId) return res.status(400).json({ error: 'User parameter is required' });
  try {
    const result = await svc.getSession(userId, req.params.id);
    res.json(result);
  } catch (err) {
    console.error('[moveCoordination] getSession:', err.message);
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

router.post('/sessions', async (req, res) => {
  const userId = req.user?.user_id;
  if (!userId) return res.status(400).json({ error: 'User context required' });
  try {
    const session = await svc.createSession(userId, req.body);
    res.status(201).json(session);
  } catch (err) {
    console.error('[moveCoordination] createSession:', err.message);
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

router.put('/sessions/:id/date', async (req, res) => {
  const userId = req.user?.user_id;
  const { session_date } = req.body;
  if (!userId || !session_date) return res.status(400).json({ error: 'User and session_date are required' });
  try {
    const result = await svc.updateSessionDate(userId, req.params.id, session_date);
    res.json(result);
  } catch (err) {
    console.error('[moveCoordination] updateSessionDate:', err.message);
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

router.put('/sessions/:id/status', async (req, res) => {
  const userId = req.user?.user_id;
  const { status } = req.body;
  if (!userId || !status) return res.status(400).json({ error: 'User and status are required' });
  try {
    const result = await svc.updateSessionStatus(userId, req.params.id, status);
    res.json(result);
  } catch (err) {
    console.error('[moveCoordination] updateSessionStatus:', err.message);
    const body = { error: err.message };
    if (err.conflict_move_id) body.conflict_move_id = err.conflict_move_id;
    res.status(err.statusCode || 500).json(body);
  }
});

router.put('/sessions/:id/truck', async (req, res) => {
  const userId = req.user?.user_id;
  const { truck_size, truck_identifier } = req.body;
  if (!userId || !truck_size) return res.status(400).json({ error: 'User and truck size are required' });
  try {
    const result = await svc.updateSessionTruck(userId, req.params.id, { truck_size, truck_identifier });
    res.json(result);
  } catch (err) {
    console.error('[moveCoordination] updateSessionTruck:', err.message);
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

router.post('/sessions/:id/assign-zones', async (req, res) => {
  const userId = req.user?.user_id;
  if (!userId) return res.status(400).json({ error: 'User not authenticated' });
  try {
    const result = await svc.assignZones(userId, req.params.id);
    res.json({ message: 'Loading zones assigned successfully', ...result });
  } catch (err) {
    console.error('[moveCoordination] assignZones:', err.message);
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

router.get('/sessions/:id/loading-plan', async (req, res) => {
  const userId = req.user?.user_id;
  if (!userId) return res.status(400).json({ error: 'User not authenticated' });
  try {
    const result = await svc.getLoadingPlan(userId, req.params.id);
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    res.json(result);
  } catch (err) {
    console.error('[moveCoordination] getLoadingPlan:', err.message);
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

router.put('/sessions/:session_id/containers/:container_id/zone', async (req, res) => {
  const userId = req.user?.user_id;
  if (!userId) return res.status(400).json({ error: 'User not authenticated' });
  try {
    const loadingZone = req.body.loading_zone !== undefined ? req.body.loading_zone : null;
    const result = await svc.updateContainerZone(userId, req.params.session_id, req.params.container_id, loadingZone);
    res.json(result);
  } catch (err) {
    console.error('[moveCoordination] updateContainerZone:', err.message);
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

router.put('/sessions/:session_id/items/:item_id/zone', async (req, res) => {
  const userId = req.user?.user_id;
  if (!userId) return res.status(400).json({ error: 'User not authenticated' });
  try {
    const loadingZone = req.body.loading_zone !== undefined ? req.body.loading_zone : null;
    const result = await svc.updateItemZone(userId, req.params.session_id, req.params.item_id, loadingZone);
    res.json(result);
  } catch (err) {
    console.error('[moveCoordination] updateItemZone:', err.message);
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

router.get('/sessions/:id/progress', async (req, res) => {
  const userId = req.user?.user_id;
  if (!userId) return res.status(400).json({ error: 'User parameter is required' });
  try {
    const result = await svc.getProgress(userId, req.params.id);
    res.json(result);
  } catch (err) {
    console.error('[moveCoordination] getProgress:', err.message);
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

router.delete('/sessions/:id', async (req, res) => {
  const userId = req.user?.user_id;
  if (!userId) return res.status(400).json({ error: 'User not authenticated' });
  try {
    const result = await svc.deleteSession(userId, req.params.id);
    res.json(result);
  } catch (err) {
    console.error('[moveCoordination] deleteSession:', err.message);
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Scans
// ---------------------------------------------------------------------------

router.post('/scans', async (req, res) => {
  const userId = req.user?.user_id;
  const isAdmin = !!req.user?.is_admin;
  try {
    const result = await svc.recordContainerScan(userId, isAdmin, req.body);
    res.status(201).json(result);
  } catch (err) {
    console.error('[moveCoordination] recordContainerScan:', err.message);
    const body = { error: err.message };
    if (err.container_id) body.container_id = err.container_id;
    res.status(err.statusCode || 500).json(body);
  }
});

router.get('/scans/container/:container_id', async (req, res) => {
  try {
    const rows = await svc.getContainerScans(req.params.container_id, req.query.move_session_id);
    res.json(rows);
  } catch (err) {
    console.error('[moveCoordination] getContainerScans:', err.message);
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

router.post('/scans/item', async (req, res) => {
  const userId = req.user?.user_id;
  const isAdmin = !!req.user?.is_admin;
  try {
    const result = await svc.recordItemScan(userId, isAdmin, req.body);
    res.status(201).json(result);
  } catch (err) {
    console.error('[moveCoordination] recordItemScan:', err.message);
    const body = { error: err.message };
    if (err.container_id) body.container_id = err.container_id;
    res.status(err.statusCode || 500).json(body);
  }
});

// ---------------------------------------------------------------------------
// Loose items
// ---------------------------------------------------------------------------

router.get('/loose-items', async (req, res) => {
  const userId = req.user?.user_id;
  if (!userId) return res.status(400).json({ error: 'User not authenticated' });
  try {
    const rows = await getLooseItems(userId);
    res.json(rows);
  } catch (err) {
    console.error('[moveCoordination] getLooseItems:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Damage reports
// ---------------------------------------------------------------------------

router.post('/damage-reports', async (req, res) => {
  try {
    const result = await svc.reportDamage(req.body);
    res.status(201).json(result);
  } catch (err) {
    console.error('[moveCoordination] reportDamage:', err.message);
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Crew
// ---------------------------------------------------------------------------

router.post('/crew', async (req, res) => {
  try {
    const result = await svc.addCrewMember(req.body);
    res.status(201).json(result);
  } catch (err) {
    console.error('[moveCoordination] addCrewMember:', err.message);
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

router.delete('/crew/:id', async (req, res) => {
  try {
    const result = await svc.deleteCrewMember(req.params.id);
    res.json(result);
  } catch (err) {
    console.error('[moveCoordination] deleteCrewMember:', err.message);
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Schedule generation
// ---------------------------------------------------------------------------

router.post('/generate-schedule', async (req, res) => {
  const userId = req.user?.user_id;
  if (!userId) return res.status(400).json({ error: 'User ID and saved move ID are required' });
  try {
    const result = await svc.generateScheduleFromRoute(userId, req.body);
    res.status(201).json(result);
  } catch (err) {
    console.error('[moveCoordination] generateScheduleFromRoute:', err.message);
    res.status(err.statusCode || 500).json({ error: err.message, details: err.message });
  }
});

module.exports = router;
