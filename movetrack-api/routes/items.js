var express = require('express');
var router = express.Router();
const pgp = require('pg-promise')();
var bodyParser = require('body-parser');
var conn = require('../bin/db');
const { QR_TYPES, buildQrUrl, generateUniqueToken, extractQrToken } = require('../services/qrService');
const { generateItemEstimate } = require('../services/itemEstimationService');

const db = conn.db;

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

function parseDimensionString(value) {
  if (!value || typeof value !== 'string') {
    return null;
  }
  const cleaned = value.toLowerCase().replace(/[^0-9.x×]/g, '');
  const parts = cleaned.split(/[x×]/).filter(Boolean);
  if (parts.length !== 3) {
    return null;
  }
  const numbers = parts.map(Number);
  if (numbers.some(num => !Number.isFinite(num) || num <= 0)) {
    return null;
  }
  return {
    length: numbers[0],
    width: numbers[1],
    height: numbers[2]
  };
}

function toOptionalNumber(value) {
  if (value === null || value === undefined) return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function normalizeTags(value) {
  if (!value && value !== '') return [];
  if (Array.isArray(value)) {
    return value
      .map((entry) => (typeof entry === 'string' ? entry.trim() : String(entry)))
      .filter(Boolean);
  }
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) {
        return parsed
          .map((entry) => (typeof entry === 'string' ? entry.trim() : String(entry)))
          .filter(Boolean);
      }
    } catch (error) {
      // Ignore JSON parse error and fall back to comma split
    }
    return value
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);
  }
  return [];
}

function buildEstimationContext(record, overrides = {}) {
  const merged = {
    ...record
  };
  const directFields = [
    'name',
    'description',
    'quantity',
    'notes',
    'material',
    'primary_color',
    'estimated_value'
  ];
  directFields.forEach((field) => {
    if (overrides[field] !== undefined && overrides[field] !== null) {
      merged[field] = overrides[field];
    }
  });

  const numericFields = ['weight_lbs', 'length_in', 'width_in', 'height_in'];
  numericFields.forEach((field) => {
    if (overrides[field] !== undefined && overrides[field] !== null) {
      merged[field] = toOptionalNumber(overrides[field]);
    }
  });

  if (overrides.tags !== undefined) {
    merged.tags = normalizeTags(overrides.tags);
  }

  return merged;
}

/* GET items listing. */
router.get('/', jsonParser, async function(req, res, next) {
  const userId = req.user?.user_id;
  var location_id = req.query.location
  var collection_id = req.query.collection
  var container_id = req.query.container

  try {
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    await knex
      .select({
        id: 'items.id',
        name: 'items.name',
        description: 'items.description',
        quantity: 'items.quantity',
        picture_url: 'items.picture_url',
        qr_code: 'items.qr_code',
        container_id: 'containers.id',
        collection_id: 'collections.id',
        location_id: 'locations.id'
      })
      .from('locations')
      .leftJoin('permissions', function() {
        this.on('permissions.resource_id', '=', 'locations.id')
            .andOn('permissions.resource_type', '=', knex.raw('?', ['location']))
      })
      .leftJoin('collections', 'collections.location_id', 'locations.id')
      .leftJoin('containers', 'containers.collection_id', 'collections.id')
      .leftJoin('items', 'items.container_id', 'containers.id')
      .where(knex.raw('permissions.user_id = ?', userId))
      .andWhere(knex.raw('locations.id = ?', location_id))
      .andWhere(knex.raw('collections.id = ?', collection_id))
      .andWhere(knex.raw('containers.id = ?', container_id))
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



/* GET items listing. */
// THIS IS USED BY THE APPLICATION TO GET A SINGLE ITEM
router.get('/single', jsonParser, async function(req, res, next) {
  const userId = req.user?.user_id;
  var item_id = req.query.item

  try {
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    await knex
      .select({
        location_id: 'locations.id',
        location_name: 'locations.name',
        collection_id: 'collections.id',
        collection_name: 'collections.name',
        container_id: 'containers.id',
        container_name: 'containers.name',
        id: 'items.id',
        name: 'items.name',
        description: 'items.description',
        quantity: 'items.quantity',
        picture_url: 'items.picture_url',
        estimated_value: 'items.estimated_value',
        fragile: 'items.fragile',
        priority: 'items.priority',
        weight_lbs: 'items.weight_lbs',
        qr_code: 'items.qr_code',
        qr_assigned_at: 'items.qr_assigned_at',
        dimensions: knex.raw(`
          CASE
            WHEN items.length_in IS NOT NULL AND items.width_in IS NOT NULL AND items.height_in IS NOT NULL
              THEN CONCAT(items.length_in, '" × ', items.width_in, '" × ', items.height_in, '"')
            ELSE NULL
          END
        `),
        length_in: 'items.length_in',
        width_in: 'items.width_in',
        height_in: 'items.height_in',
        notes: 'items.notes',
        material: 'items.material',
        primary_color: 'items.primary_color',
        tags: 'items.tags'
      })
      .from('items')
      .leftJoin('permissions', function() {
        this.on('permissions.resource_id', '=', 'items.id')
            .andOn('permissions.resource_type', '=', knex.raw('?', ['item']))
      })
      .leftJoin('collections', 'collections.id', 'items.collection_id')
      .leftJoin('containers', 'containers.id', 'items.container_id')
      .leftJoin('locations', 'locations.id', 'collections.location_id')
      .where(knex.raw('permissions.user_id = ?', userId))
      .andWhere(knex.raw('items.id = ?', item_id))
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

router.get('/all', jsonParser, async function(req, res, next) {
  const userId = req.user?.user_id;

  try {
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    await knex('locations')
      .distinct({
        location_id: 'locations.id',
        location_name: 'locations.name',
        collection_id: 'collections.id',
        collection_name: 'collections.name',
        container_id: 'containers.id',
        container_name: 'containers.name',
        id: 'items.id',
        name: 'items.name',
        description: 'items.description',
        quantity: 'items.quantity',
        qr_code: 'items.qr_code',
        picture_url: 'items.picture_url'
      })
      .leftJoin('permissions', function() {
        this.on('permissions.resource_id', '=', 'locations.id')
            .andOn('permissions.resource_type', '=', knex.raw('?', ['location']))
      })
      .leftJoin('collections', 'collections.location_id', 'locations.id')
      .leftJoin('containers', 'containers.collection_id', 'collections.id')
      .leftJoin('items', 'items.container_id', 'containers.id')
      .whereNotNull('items.id')
      .andWhere(knex.raw('permissions.user_id = ?', userId))
    .then(function (data) {
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


// DO I NEED TO DELETE THIS?
// router.get('/single', jsonParser, async function(req, res, next) {
//   var item_id = req.query.item

//   try {
//     await knex.select('*')
//       .from('items')
//       .where('id', item_id)
//     .then(function (data) {
//       res.send(data)
//     })
//     .catch(function (err) {
//       return next(err);
//     });
//   }
//   catch(e) {
//     res.send(e)
//   }
// });

/* ADD item to a specific container. */
// THIS IS USED BY THE APPLICATION TO ADD AN ITEM TO A COLLECTION
router.post('/post', jsonParser, async function(req, res, next) {
  try {
    // Validate that collection is provided (required)
    if (!req.query.collection) {
      return res.status(400).json({ error: 'collection is required for items' });
    }
    const userId = req.user?.user_id;

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const collection = await knex('collections')
      .select('id')
      .where({ id: req.query.collection, user_id: userId })
      .first();

    if (!collection) {
      return res.status(403).json({ error: 'Not authorized to use this collection' });
    }

    if (req.query.container) {
      const container = await knex('containers')
        .select('id')
        .where({ id: req.query.container, user_id: userId })
        .first();

      if (!container) {
        return res.status(403).json({ error: 'Not authorized to use this container' });
      }
    }

    var params = {
      user_id: userId,
      name: req.query.name,
      description: req.query.description,
      quantity: req.query.quantity,
      collection_id: req.query.collection
    }

    if (req.query.container) {
      params.container_id = req.query.container
    }

    // Note: location is now inherited from collection, so we don't accept location_id parameter

    if(req.query.picture_url) {
      params.picture_url = req.query.picture_url
    } else if (req.body?.picture_url) {
      params.picture_url = req.body.picture_url
    }

    // New MoveTrack fields
    if(req.query.estimated_value) {
      params.estimated_value = req.query.estimated_value
    }
    if(req.query.fragile !== undefined) {
      params.fragile = req.query.fragile === 'true' || req.query.fragile === true
    }
    if(req.query.priority) {
      params.priority = req.query.priority
    }
    if(req.query.weight_lbs) {
      params.weight_lbs = req.query.weight_lbs
    }
    if(req.query.notes) {
      params.notes = req.query.notes
    }

    if(req.query.dimensions) {
      const parsed = parseDimensionString(req.query.dimensions)
      if (parsed) {
        if (params.length_in === undefined) {
          params.length_in = parsed.length
        }
        if (params.width_in === undefined) {
          params.width_in = parsed.width
        }
        if (params.height_in === undefined) {
          params.height_in = parsed.height
        }
      }
    }

    // Dimension fields (individual measurements)
    if(req.query.length_in !== undefined) {
      params.length_in = req.query.length_in
    }
    if(req.query.width_in !== undefined) {
      params.width_in = req.query.width_in
    }
    if(req.query.height_in !== undefined) {
      params.height_in = req.query.height_in
    }

    // Tag fields
    if(req.query.material) {
      params.material = req.query.material
    }
    if(req.query.primary_color) {
      params.primary_color = req.query.primary_color
    }
    if(req.query.tags) {
      // Handle tags array - can be JSON string or array
      if(typeof req.query.tags === 'string') {
        try {
          params.tags = JSON.parse(req.query.tags)
        } catch(e) {
          params.tags = [req.query.tags]
        }
      } else if(Array.isArray(req.query.tags)) {
        params.tags = req.query.tags
      }
    }

    knex
      .transaction(async (trx) => {
        const [item] = await knex('items')
          .transacting(trx)
          .insert(params)
          .returning(['id']);

        await knex('permissions')
          .transacting(trx)
          .insert({
            user_id: userId,
            resource_id: item.id,
            resource_type: 'item',
            permission_level: 'owner',
            granted_by: userId,
          });

        return item;
      })
      .then((item) => {
        res.send(item);
      })
      .catch((err) => {
        console.error(err);
        res.status(500).send(err);
      });
  }
  catch(e) {
    res.send(e)
  }
});
  
/* DELETE items listing. */
// THIS IS USED BY THE APPLICATION TO DELETE AN ITEM
router.delete('/delete', jsonParser, async function(req, res, next) {
  try {
    const userId = req.user?.user_id;

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const itemId = req.query.item_id;
    if (!itemId) {
      return res.status(400).json({ error: 'item_id is required' });
    }

    const ownedItem = await knex('items')
      .select('id')
      .where({ id: itemId, user_id: userId })
      .first();

    if (!ownedItem) {
      return res.status(404).json({ error: 'Item not found' });
    }

    knex.transaction(async trx => {
      await knex('permissions')
      .transacting(trx)
      .where({
        resource_id: itemId,
        resource_type: 'item'
      })
      .del()

      await knex('items')
      .transacting(trx)
      .where({
        id: itemId,
        user_id: userId
      })
      .del()

      .then(trx.commit)
      .catch(trx.rollback);
    })
    .then(() => {
      res.send('OK')
    })
  }

  catch(e) {
    res.send(e)
  }
});

/* EDIT items listing. */
// THIS IS USED BY THE APPLICATION TO EDIT AN ITEM
router.put('/update', jsonParser, async function(req, res, next) {
  try {
    // Validate that item_id is provided - prevent accidental mass updates
    if (!req.query.item_id) {
      return res.status(400).json({
        error: 'item_id is required for updates',
        message: 'Cannot update without specifying which item to update'
      });
    }
    const userId = req.user?.user_id;

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // CRITICAL FIX: Only update fields that are explicitly provided
    // Do NOT set fields to null unless explicitly requested
    var params = {}

    // Only update these fields if they are provided
    if (req.query.name !== undefined) {
      params.name = req.query.name
    }
    if (req.query.description !== undefined) {
      params.description = req.query.description
    }
    if (req.query.quantity !== undefined) {
      params.quantity = req.query.quantity
    }
    if (req.query.collection !== undefined) {
      const collection = await knex('collections')
        .select('id')
        .where({ id: req.query.collection, user_id: userId })
        .first();

      if (!collection) {
        return res.status(403).json({ error: 'Not authorized to use this collection' });
      }

      params.collection_id = req.query.collection
    }

    // Only update these if explicitly provided (don't force null)
    if (req.query.container !== undefined) {
      if (req.query.container) {
        const container = await knex('containers')
          .select('id')
          .where({ id: req.query.container, user_id: userId })
          .first();

        if (!container) {
          return res.status(403).json({ error: 'Not authorized to use this container' });
        }
      }
      params.container_id = req.query.container
    }

    // Note: location is now inherited from collection, so we don't accept location_id parameter

    if(req.query.picture_url !== undefined) {
      params.picture_url = req.query.picture_url
    }

    // New MoveTrack fields
    if(req.query.estimated_value !== undefined) {
      params.estimated_value = req.query.estimated_value
    }
    if(req.query.fragile !== undefined) {
      params.fragile = req.query.fragile === 'true' || req.query.fragile === true
    }
    if(req.query.priority !== undefined) {
      params.priority = req.query.priority
    }
    if(req.query.weight_lbs !== undefined) {
      params.weight_lbs = req.query.weight_lbs
    }
    if(req.query.notes !== undefined) {
      params.notes = req.query.notes
    }

    if(req.query.dimensions !== undefined) {
      const parsed = parseDimensionString(req.query.dimensions)
      if (parsed) {
        params.length_in = params.length_in !== undefined ? params.length_in : parsed.length
        params.width_in = params.width_in !== undefined ? params.width_in : parsed.width
        params.height_in = params.height_in !== undefined ? params.height_in : parsed.height
      }
    }

    // Dimension fields (individual measurements)
    if(req.query.length_in !== undefined) {
      params.length_in = req.query.length_in
    }
    if(req.query.width_in !== undefined) {
      params.width_in = req.query.width_in
    }
    if(req.query.height_in !== undefined) {
      params.height_in = req.query.height_in
    }

    // Tag fields
    if(req.query.material !== undefined) {
      params.material = req.query.material
    }
    if(req.query.primary_color !== undefined) {
      params.primary_color = req.query.primary_color
    }
    if(req.query.tags !== undefined) {
      // Handle tags array - can be JSON string or array
      if(typeof req.query.tags === 'string') {
        try {
          params.tags = JSON.parse(req.query.tags)
        } catch(e) {
          params.tags = [req.query.tags]
        }
      } else if(Array.isArray(req.query.tags)) {
        params.tags = req.query.tags
      }
    }

    // Log the update for debugging/audit purposes
    console.log(`[ITEMS UPDATE] User: ${userId}, Item ID: ${req.query.item_id}, Fields: ${Object.keys(params).join(', ')}`);

    knex.transaction(async trx => {
      await knex('items')
      .transacting(trx)
      .update(params)
      .where({
        id: req.query.item_id,
        user_id: userId
      })
      .then(trx.commit)
      .catch(trx.rollback);
    })
    .then(async (data) => {
      // If picture_url was updated, mark the image as linked (no longer orphaned)
      if (params.picture_url) {
        try {
          await knex('image_uploads')
            .update({
              linked_to_item_id: req.query.item_id,
              linked_at: new Date(),
              is_orphaned: false
            })
            .where('image_url', params.picture_url);
          console.log(`[DB] Marked image as linked: ${params.picture_url} -> item ${req.query.item_id}`);
        } catch (linkError) {
          console.error('[DB] Failed to mark image as linked (non-critical):', linkError);
          // Don't fail the item update if image tracking fails
        }
      }
      res.send('OK')
    })
  }
  catch(e) {
    res.send(e)
  }
});

router.post('/:itemId/ai-estimate', jsonParser, async function(req, res) {
  const requestUserId = req.user?.user_id;
  if (!requestUserId) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }

  if (!process.env.TOGETHER_API_KEY) {
    return res.status(503).json({ success: false, error: 'LLM estimation service is not configured' });
  }

  const itemId = req.params.itemId;
  if (!itemId) {
    return res.status(400).json({ success: false, error: 'Item ID is required' });
  }

  try {
    console.log('[AI Estimate] Incoming request:', {
      itemId,
      requestUserId,
      hasUserFromToken: Boolean(req.user?.user_id)
    });
    const itemRecord = await knex('items')
      .select({
        id: 'items.id',
        name: 'items.name',
        description: 'items.description',
        quantity: 'items.quantity',
        weight_lbs: 'items.weight_lbs',
        length_in: 'items.length_in',
        width_in: 'items.width_in',
        height_in: 'items.height_in',
        notes: 'items.notes',
        material: 'items.material',
        primary_color: 'items.primary_color',
        tags: 'items.tags',
        estimated_value: 'items.estimated_value',
        picture_url: 'items.picture_url',
        collection_name: 'collections.name',
        container_name: 'containers.name',
        location_name: 'locations.name'
      })
      .leftJoin('permissions', function() {
        this.on('permissions.resource_id', '=', 'items.id')
          .andOn('permissions.resource_type', '=', knex.raw('?', ['item']));
      })
      .leftJoin('collections', 'collections.id', 'items.collection_id')
      .leftJoin('locations', 'locations.id', 'collections.location_id')
      .leftJoin('containers', 'containers.id', 'items.container_id')
      .where('items.id', itemId)
      .andWhere('permissions.user_id', requestUserId)
      .first();

    if (!itemRecord) {
      console.warn('[AI Estimate] Item not found or inaccessible', { itemId, requestUserId });
      return res.status(404).json({ success: false, error: 'Item not found or not accessible' });
    }

    const overrideFields = req.body?.overrideFields || {};
    const tags = normalizeTags(itemRecord.tags);
    const contextSnapshot = buildEstimationContext(
      {
        ...itemRecord,
        tags
      },
      overrideFields
    );

    const estimationResult = await generateItemEstimate(contextSnapshot, {
      model: req.body?.model
    });

    const estimate = estimationResult.estimate || {};
    const payload = {
      item_id: itemRecord.id,
      user_id: requestUserId,
      provider: estimationResult.provider,
      model: estimationResult.model,
      prompt: estimationResult.prompt,
      request_context: contextSnapshot,
      response_text: estimationResult.rawText,
      response_json: estimationResult.parsed || null,
      estimated_weight_lbs: estimate.weight_lbs?.value ?? null,
      estimated_length_in: estimate.dimensions?.length_in?.value ?? null,
      estimated_width_in: estimate.dimensions?.width_in?.value ?? null,
      estimated_height_in: estimate.dimensions?.height_in?.value ?? null,
      volume_cuft: estimate.volume_cuft ?? null,
      confidence:
        estimate.confidence ??
        estimate.weight_lbs?.confidence ??
        estimate.dimensions?.length_in?.confidence ??
        null,
      notes: estimate.notes || null,
      token_usage: estimationResult.usage || null
    };

    const inserted = await knex('item_estimate_events').insert(payload).returning(['id', 'created_at']);
    const logEntry = inserted?.[0] || null;

    return res.json({
      success: true,
      estimate: {
        id: logEntry?.id ?? null,
        provider: estimationResult.provider,
        model: estimationResult.model,
        created_at: logEntry?.created_at ?? null,
        weight_lbs: estimate.weight_lbs || null,
        dimensions: estimate.dimensions || null,
        volume_cuft: estimate.volume_cuft ?? null,
        confidence: estimate.confidence ?? null,
        notes: estimate.notes || null
      }
    });
  } catch (error) {
    console.error('[items] Failed to generate AI estimate:', {
      itemId,
      requestUserId,
      message: error?.message,
      stack: error?.stack
    });
    return res.status(502).json({
      success: false,
      error: error.message || 'Failed to generate estimate'
    });
  }
});

router.post('/:id/qr', jsonParser, async function(req, res) {
  try {
    const { id } = req.params;
    const userId = req.user?.user_id;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const item = await knex('items')
      .select('id', 'user_id', 'qr_code')
      .where({ id })
      .first();

    if (!item) {
      return res.status(404).json({ error: 'Item not found' });
    }

    if (String(item.user_id) !== String(userId)) {
      return res.status(403).json({ error: 'Not authorized to modify this item' });
    }

    const shouldRegenerate =
      req.query.regenerate === 'true' ||
      req.body?.regenerate === true;

    const requestedToken = req.body?.token || req.query?.token;
    const normalizedToken = requestedToken ? extractQrToken(requestedToken) : null;

    if (normalizedToken) {
      const existsInItems = await knex('items').where({ qr_code: normalizedToken }).first();
      const existsInContainers = await knex('containers').where({ qr_code: normalizedToken }).first();
      if (
        (existsInItems && existsInItems.id !== item.id) ||
        existsInContainers
      ) {
        return res.status(409).json({ error: 'QR code already in use' });
      }
    } else if (item.qr_code && !shouldRegenerate) {
      return res.json({
        token: item.qr_code,
        url: buildQrUrl(QR_TYPES.item, item.qr_code),
        existing: true,
      });
    }

    const tokenValue =
      normalizedToken || (await generateUniqueToken(knex, 'items', 'it'));

    await knex('items')
      .where({ id })
      .update({
        qr_code: tokenValue,
        qr_assigned_at: knex.fn.now(),
      });

    return res.json({
      token: tokenValue,
      url: buildQrUrl(QR_TYPES.item, tokenValue),
      regenerated: shouldRegenerate || Boolean(normalizedToken),
    });
  } catch (error) {
    console.error('Error creating item QR code:', error);
    return res.status(500).json({ error: 'Failed to create QR code' });
  }
});

module.exports = router;
