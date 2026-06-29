var express = require('express');
var router = express.Router();
const { signItemUrls } = require('../../../services/infra/gcsService');
const gcs = require('../../../services/infra/gcsService');
const { parseDimensionString, normalizeTags } = require('../../../services/inventory/itemParsingUtils');
const { getItemsByContainer, getSingleItem, getAllItems } = require('../../../services/inventory/inventoryItemQueryService');
const { parsePagination } = require('../../../services/infra/pagination');
const { createItem, updateItemById, deleteItem, assignItemQr } = require('../../../services/inventory/inventoryMutationService');
const { runItemEstimate } = require('../../../services/inventory/itemEstimationService');
const { markAssetLinkedByUrl } = require('../../../services/infra/mediaAssetService');

/* GET items by container. */
router.get('/', async function(req, res, next) {
  const userId = req.user?.user_id;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const data = await getItemsByContainer(userId, {
      locationId: req.query.location,
      collectionId: req.query.collection,
      containerId: req.query.container,
    });
    res.send(await signItemUrls(data));
  } catch (err) {
    next(err);
  }
});

/* GET single item with full context. */
router.get('/single', async function(req, res, next) {
  const userId = req.user?.user_id;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const data = await getSingleItem(userId, req.query.item);
    res.send(await signItemUrls(data));
  } catch (err) {
    next(err);
  }
});

/* GET all items for user. */
router.get('/all', async function(req, res, next) {
  const userId = req.user?.user_id;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  try {
    // Bounded by a safety cap; supports optional ?limit= & ?offset= paging.
    const data = await getAllItems(userId, parsePagination(req.query));
    res.send(await signItemUrls(data));
  } catch (err) {
    next(err);
  }
});

/* POST add item to a collection/container. */
router.post('/post', async function(req, res, next) {
  const userId = req.user?.user_id;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  if (!req.query.collection) {
    return res.status(400).json({ error: 'collection is required for items' });
  }

  try {
    const params = {
      collection_id: req.query.collection,
      name: req.query.name,
      description: req.query.description,
      quantity: req.query.quantity,
    };

    if (req.query.container) params.container_id = req.query.container;

    const rawPicture = req.query.picture_url || req.body?.picture_url;
    if (rawPicture) params.picture_url = gcs.toPublicUrl(rawPicture);

    if (req.query.estimated_value !== undefined) params.estimated_value = req.query.estimated_value;
    if (req.query.fragile !== undefined) params.fragile = req.query.fragile === 'true' || req.query.fragile === true;
    if (req.query.priority !== undefined) params.priority = req.query.priority;
    if (req.query.weight_lbs !== undefined) params.weight_lbs = req.query.weight_lbs;
    if (req.query.notes !== undefined) params.notes = req.query.notes;

    if (req.query.dimensions) {
      const parsed = parseDimensionString(req.query.dimensions);
      if (parsed) {
        if (params.length_in === undefined) params.length_in = parsed.length;
        if (params.width_in === undefined) params.width_in = parsed.width;
        if (params.height_in === undefined) params.height_in = parsed.height;
      }
    }
    if (req.query.length_in !== undefined) params.length_in = req.query.length_in;
    if (req.query.width_in !== undefined) params.width_in = req.query.width_in;
    if (req.query.height_in !== undefined) params.height_in = req.query.height_in;

    if (req.query.material !== undefined) params.material = req.query.material;
    if (req.query.primary_color !== undefined) params.primary_color = req.query.primary_color;
    if (req.query.tags !== undefined) params.tags = normalizeTags(req.query.tags);

    const result = await createItem(userId, params);
    if (!result.success) {
      return res.status(result.status || 500).json({ error: result.error });
    }
    res.send(result.item);
  } catch (err) {
    next(err);
  }
});

/* DELETE item. */
router.delete('/delete', async function(req, res, next) {
  const userId = req.user?.user_id;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  const itemId = req.query.item_id;
  if (!itemId) return res.status(400).json({ error: 'item_id is required' });

  try {
    const result = await deleteItem(userId, { item_id: itemId });
    if (!result.success) {
      return res.status(404).json({ error: result.error });
    }
    res.send('OK');
  } catch (err) {
    next(err);
  }
});

/* PUT update item. */
router.put('/update', async function(req, res, next) {
  const userId = req.user?.user_id;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  if (!req.query.item_id) {
    return res.status(400).json({
      error: 'item_id is required for updates',
      message: 'Cannot update without specifying which item to update',
    });
  }

  try {
    const params = {};

    if (req.query.name !== undefined) params.name = req.query.name;
    if (req.query.description !== undefined) params.description = req.query.description;
    if (req.query.quantity !== undefined) params.quantity = req.query.quantity;
    if (req.query.collection !== undefined) params.collection_id = req.query.collection;
    if (req.query.container !== undefined) params.container_id = req.query.container || null;

    if (req.query.picture_url !== undefined) {
      params.picture_url = req.query.picture_url ? gcs.toPublicUrl(req.query.picture_url) : req.query.picture_url;
    }

    if (req.query.estimated_value !== undefined) params.estimated_value = req.query.estimated_value;
    if (req.query.fragile !== undefined) params.fragile = req.query.fragile === 'true' || req.query.fragile === true;
    if (req.query.priority !== undefined) params.priority = req.query.priority;
    if (req.query.weight_lbs !== undefined) params.weight_lbs = req.query.weight_lbs;
    if (req.query.notes !== undefined) params.notes = req.query.notes;

    if (req.query.dimensions !== undefined) {
      const parsed = parseDimensionString(req.query.dimensions);
      if (parsed) {
        if (params.length_in === undefined) params.length_in = parsed.length;
        if (params.width_in === undefined) params.width_in = parsed.width;
        if (params.height_in === undefined) params.height_in = parsed.height;
      }
    }
    if (req.query.length_in !== undefined) params.length_in = req.query.length_in;
    if (req.query.width_in !== undefined) params.width_in = req.query.width_in;
    if (req.query.height_in !== undefined) params.height_in = req.query.height_in;

    if (req.query.material !== undefined) params.material = req.query.material;
    if (req.query.primary_color !== undefined) params.primary_color = req.query.primary_color;
    if (req.query.tags !== undefined) params.tags = normalizeTags(req.query.tags);

    const result = await updateItemById(userId, req.query.item_id, params);
    if (!result.success) {
      return res.status(result.status || 500).json({ error: result.error });
    }

    if (params.picture_url) {
      await markAssetLinkedByUrl(params.picture_url, req.query.item_id);
    }

    res.send('OK');
  } catch (err) {
    next(err);
  }
});

/* POST AI estimate for an item. */
router.post('/:itemId/ai-estimate', async function(req, res) {
  const userId = req.user?.user_id;
  if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });

  if (!process.env.GOOGLE_AI_API_KEY) {
    return res.status(503).json({ success: false, error: 'LLM estimation service is not configured' });
  }

  const { itemId } = req.params;

  try {
    const result = await runItemEstimate(
      userId,
      itemId,
      req.body?.overrideFields || {},
      req.body?.model || null
    );

    const estimate = result.estimate || {};
    return res.json({
      success: true,
      estimate: {
        id: result.logEntry?.id ?? null,
        provider: result.provider,
        model: result.model,
        created_at: result.logEntry?.created_at ?? null,
        weight_lbs: estimate.weight_lbs || null,
        dimensions: estimate.dimensions || null,
        volume_cuft: estimate.volume_cuft ?? null,
        confidence: estimate.confidence ?? null,
        notes: estimate.notes || null,
      },
    });
  } catch (err) {
    if (err.status === 404) {
      return res.status(404).json({ success: false, error: err.message });
    }
    console.error('[items] AI estimate failed:', { itemId, userId, message: err.message, stage: err.stage });
    return res.status(502).json({ success: false, error: err.message || 'Failed to generate estimate' });
  }
});

/* POST assign/regenerate QR code for an item. */
router.post('/:id/qr', async function(req, res) {
  const userId = req.user?.user_id;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  const { id } = req.params;

  try {
    const result = await assignItemQr(userId, id, {
      token: req.body?.token || req.query?.token,
      regenerate: req.query.regenerate === 'true' || req.body?.regenerate === true,
    });

    if (!result.success) {
      return res.status(result.status || 500).json({ error: result.error });
    }

    const { success: _s, status: _st, ...payload } = result;
    return res.json(payload);
  } catch (err) {
    console.error('[items] QR assign failed:', err);
    return res.status(500).json({ error: 'Failed to create QR code' });
  }
});

module.exports = router;
