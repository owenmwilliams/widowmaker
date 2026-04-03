const express = require('express');
const router = express.Router();
const { authenticate } = require('../../../services/infra/authService');
const {
  getContainersByCollection,
  getSingleContainer,
  getAllContainers,
  getAllContainersGrouped,
} = require('../../../services/inventory/inventoryQueryService');
const {
  createContainer,
  deleteContainer,
  updateContainer,
  assignContainerQr,
} = require('../../../services/inventory/inventoryMutationService');

router.use(authenticate);

router.get('/', async (req, res, next) => {
  const userId = req.user?.user_id;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const data = await getContainersByCollection(userId, req.query.location, req.query.collection);
    res.send(data);
  } catch (err) {
    next(err);
  }
});

router.get('/single', async (req, res, next) => {
  const userId = req.user?.user_id;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const data = await getSingleContainer(userId, req.query.container);
    res.send(data);
  } catch (err) {
    next(err);
  }
});

router.get('/all', async (req, res, next) => {
  const userId = req.user?.user_id;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const data = await getAllContainers(userId);
    res.send(data);
  } catch (err) {
    next(err);
  }
});

router.get('/all/grouped', async (req, res, next) => {
  const userId = req.user?.user_id;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const data = await getAllContainersGrouped(userId);
    res.send(data);
  } catch (err) {
    next(err);
  }
});

router.post('/post', async (req, res, next) => {
  const userId = req.user?.user_id;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  if (!req.query.collection) return res.status(400).json({ error: 'collection is required for containers' });

  try {
    const result = await createContainer(userId, { ...req.query });
    if (result?.success === false) {
      return res.status(403).json({ error: result.error });
    }
    res.send(result);
  } catch (err) {
    next(err);
  }
});

router.delete('/delete', async (req, res, next) => {
  const userId = req.user?.user_id;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  if (!req.query.container_id) return res.status(400).json({ error: 'container_id is required' });

  try {
    const result = await deleteContainer(userId, req.query.container_id);
    if (result?.success === false) {
      return res.status(404).json({ error: result.error });
    }
    res.send('OK');
  } catch (err) {
    next(err);
  }
});

router.put('/update', async (req, res, next) => {
  const userId = req.user?.user_id;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  if (!req.query.container_id) return res.status(400).json({ error: 'container_id is required' });

  try {
    const result = await updateContainer(userId, req.query.container_id, { ...req.query });
    if (result?.success === false) {
      return res.status(403).json({ error: result.error });
    }
    res.send('OK');
  } catch (err) {
    next(err);
  }
});

router.post('/:id/qr', async (req, res) => {
  const userId = req.user?.user_id;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const token = req.body?.token || req.query?.token;
    const regenerate = req.query.regenerate || req.body?.regenerate;
    const result = await assignContainerQr(userId, req.params.id, { token, regenerate });

    if (!result.success) {
      return res.status(result.status || 400).json({ error: result.error });
    }
    const { success: _s, status: _st, ...payload } = result;
    res.json(payload);
  } catch (err) {
    console.error('Error creating container QR code:', err);
    res.status(500).json({ error: 'Failed to create QR code' });
  }
});

module.exports = router;
