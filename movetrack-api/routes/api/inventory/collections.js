const express = require('express');
const router = express.Router();
const { authenticate } = require('../../../services/infra/authService');
const {
  getCollectionsByLocation,
  getSingleCollection,
  getAllCollections,
  getAllCollectionsGrouped,
} = require('../../../services/inventory/inventoryStructureQueryService');
const {
  createCollection,
  deleteCollection,
  updateCollection,
} = require('../../../services/inventory/inventoryMutationService');

router.use(authenticate);

router.get('/', async (req, res, next) => {
  const userId = req.user?.user_id;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const data = await getCollectionsByLocation(userId, req.query.location);
    res.send(data);
  } catch (err) {
    next(err);
  }
});

router.get('/single', async (req, res, next) => {
  const userId = req.user?.user_id;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const data = await getSingleCollection(userId, req.query.collection);
    res.send(data);
  } catch (err) {
    next(err);
  }
});

router.get('/all', async (req, res, next) => {
  const userId = req.user?.user_id;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const data = await getAllCollections(userId);
    res.send(data);
  } catch (err) {
    next(err);
  }
});

router.get('/all/grouped', async (req, res, next) => {
  const userId = req.user?.user_id;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const data = await getAllCollectionsGrouped(userId);
    res.send(data);
  } catch (err) {
    next(err);
  }
});

router.post('/post', async (req, res, next) => {
  const userId = req.user?.user_id;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  if (!req.query.location) return res.status(400).json({ error: 'location is required for collections' });

  try {
    const result = await createCollection(userId, {
      location: req.query.location,
      name: req.query.name,
      description: req.query.description,
    });
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
  if (!req.query.collection_id) return res.status(400).json({ error: 'collection_id is required' });

  try {
    const result = await deleteCollection(userId, req.query.collection_id);
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
  if (!req.query.collection_id) return res.status(400).json({ error: 'collection_id is required' });

  try {
    const result = await updateCollection(userId, req.query.collection_id, {
      name: req.query.name,
      description: req.query.description,
      location: req.query.location,
    });
    if (result?.success === false) {
      return res.status(403).json({ error: result.error });
    }
    res.send('OK');
  } catch (err) {
    next(err);
  }
});

module.exports = router;
