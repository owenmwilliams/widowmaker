var express = require('express');
var router = express.Router();
const pgp = require('pg-promise')();
var bodyParser = require('body-parser');
var conn = require('../bin/db');
const { QR_TYPES, buildQrUrl, generateUniqueToken, extractQrToken } = require('../services/qrService');
const { authenticate } = require('../bin/authService');

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
router.use(authenticate);

/* GET containers listing. */
router.get('/', jsonParser, async function(req, res, next) {
  const userId = req.user?.user_id;
  var location_id = req.query.location
  var collection_id = req.query.collection

  try {
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    await knex.with(
      'distinct_items',
      knex.raw(
        `SELECT DISTINCT
          containers.id,
          containers.name AS container_name,
          containers.description AS container_description,
          collections.id AS collection_id,
          locations.id AS location_id,
          items.id AS item_id,
          items.quantity AS item_quantity
        FROM locations
          LEFT JOIN permissions ON permissions.resource_id = locations.id AND permissions.resource_type = 'location'
          LEFT JOIN collections ON collections.location_id = locations.id
          LEFT JOIN containers ON containers.collection_id = collections.id
          LEFT JOIN items ON items.container_id = containers.id
        WHERE permissions.user_id = :username
          AND locations.id = :locationid
          AND collections.id = :collectionid`, {
            username: userId,
            locationid: location_id,
            collectionid: collection_id
          }
      )
    )
    .select('id', 'container_name', 'container_description', 'location_id', 'collection_id')
    .countDistinct('item_id', {as: 'total_items'})
    .sum('item_quantity', {as: 'total_count_items'})
    .from('distinct_items')
    .groupBy('id', 'container_name', 'container_description', 'location_id', 'collection_id')
    .then(function (data) {
      res.send(data)
    })
    .catch(function (err) {
      return next(err);
    })
  }
  catch(e) {
    res.send(e)
  }
});

/* GET container listing. */
router.get('/single', jsonParser, async function(req, res, next) {
  const userId = req.user?.user_id;
  var container_id = req.query.container

  try {
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    await knex
      .select({
        id: 'containers.id',
        name: 'containers.name',
        description: 'containers.description',
        qr_code: 'containers.qr_code',
        qr_assigned_at: 'containers.qr_assigned_at',
        collection_id: 'collections.id',
        location_id: 'locations.id',
        max_weight_lbs: 'containers.max_weight_lbs',
        max_volume_cuft: 'containers.max_volume_cuft',
        box_size: 'containers.box_size',
        inner_length_in: 'containers.inner_length_in',
        inner_width_in: 'containers.inner_width_in',
        inner_height_in: 'containers.inner_height_in'
      })
      .from('locations')
      .leftJoin('permissions', function() {
        this.on('permissions.resource_id', '=', 'locations.id')
            .andOn('permissions.resource_type', '=', knex.raw('?', ['location']))
      })
      .leftJoin('collections', 'collections.location_id', 'locations.id')
      .leftJoin('containers', 'containers.collection_id', 'collections.id')
      .where(knex.raw('permissions.user_id = ?', userId))
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

/* GET all containers. */
router.get('/all', jsonParser, async function(req, res, next) {
  const userId = req.user?.user_id;

  try {
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    await knex.with(
      'distinct_items',
      knex.raw(
        `SELECT DISTINCT
          locations.id AS location_id,
          locations.name AS location_name,
          collections.id AS collection_id,
          collections.name AS collection_name,
          containers.id,
          containers.name AS container_name,
          containers.description AS container_description,
          items.id AS item_id,
          items.quantity AS item_quantity
        FROM locations
          LEFT JOIN permissions ON permissions.resource_id = locations.id AND permissions.resource_type = 'location'
          LEFT JOIN collections ON collections.location_id = locations.id
          LEFT JOIN containers ON containers.collection_id = collections.id
          LEFT JOIN items ON items.container_id = containers.id
        WHERE permissions.user_id = ?`, userId
      )
    )
    .select('location_id', 'location_name', 'collection_id', 'collection_name', 'id', 'container_name', 'container_description')
    .countDistinct('item_id', {as: 'total_items'})
    .sum('item_quantity', {as: 'total_count_items'})
    .from('distinct_items')
    .whereNotNull('id')
    .groupBy('location_id', 'location_name', 'collection_id', 'collection_name', 'id', 'container_name', 'container_description')
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

/* GET all containers grouped. */
//** YOU CAN COME BACK TO THIS LATER AND KNEX-IFY IT */
router.get('/all/grouped', jsonParser, async function(req, res, next) {
  const userId = req.user?.user_id;

  try {
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    await knex.raw(`
      WITH TWO AS (
        WITH ONE AS (
        SELECT
            locations.id AS location_id,
            locations.name AS location_name,
            collections.id AS collection_id,
            collections.name AS collection_name,
            JSON_BUILD_OBJECT(
                'id', containers.id,
                'name', containers.name) AS containers_json
        FROM locations
            LEFT JOIN permissions ON permissions.resource_id = locations.id AND permissions.resource_type = 'location'
            LEFT JOIN collections ON collections.location_id = locations.id
            LEFT JOIN containers ON containers.collection_id = collections.id
        WHERE permissions.user_id = ?
            AND containers.id IS NOT NULL
        )
        SELECT
            location_id,
            location_name,
            collection_id,
            collection_name,
            JSON_AGG(containers_json) AS containers
        FROM ONE
        GROUP BY 1, 2, 3, 4
    )
    
    SELECT
        location_id,
        location_name,
        JSON_AGG(collections_json) AS collections
    FROM(
        SELECT 
            location_id,
            location_name,
            JSON_BUILD_OBJECT(
                'id', collection_id,
                'name', collection_name,
                'containers', containers
            ) AS collections_json
        FROM TWO
    ) AS TWO_FROM
    GROUP BY 1, 2
    `, userId)
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

/* ADD container to a specific room. */
// THIS IS USED BY THE APPLICATION TO ADD A CONTAINER TO A COLLECTION
router.post('/post', jsonParser, async function(req, res, next) {
  try {
    // Validate that collection is provided (required)
    if (!req.query.collection) {
      return res.status(400).json({ error: 'collection is required for containers' });
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

    var params = {
      user_id: userId,
      name: req.query.name,
      description: req.query.description,
      collection_id: req.query.collection
    };

    // Note: location is now inherited from collection, so we don't accept location_id parameter

    // New MoveTrack fields
    if (req.query.box_number) {
      params.box_number = req.query.box_number;
    }
    if (req.query.box_type) {
      params.box_type = req.query.box_type;
    }
    if (req.query.sealed !== undefined) {
      params.sealed = req.query.sealed === 'true' || req.query.sealed === true;
    }
    if (req.query.weight_lbs) {
      params.weight_lbs = req.query.weight_lbs;
    }
    if (req.query.fragile_contents !== undefined) {
      params.fragile_contents = req.query.fragile_contents === 'true' || req.query.fragile_contents === true;
    }
    if (req.query.qr_code) {
      params.qr_code = req.query.qr_code;
    }
    if (req.query.color_code) {
      params.color_code = req.query.color_code;
    }

    // Container capacity fields
    if (req.query.max_weight_lbs) {
      params.max_weight_lbs = req.query.max_weight_lbs;
    }
    if (req.query.max_volume_cuft) {
      params.max_volume_cuft = req.query.max_volume_cuft;
    }
    if (req.query.box_size) {
      params.box_size = req.query.box_size;
    }
    if (req.query.inner_length_in !== undefined) {
      params.inner_length_in = req.query.inner_length_in;
    }
    if (req.query.inner_width_in !== undefined) {
      params.inner_width_in = req.query.inner_width_in;
    }
    if (req.query.inner_height_in !== undefined) {
      params.inner_height_in = req.query.inner_height_in;
    }

    knex
      .transaction(async (trx) => {
        const [container] = await knex('containers')
          .transacting(trx)
          .insert(params)
          .returning(['id']);

        await knex('permissions')
          .transacting(trx)
          .insert({
            user_id: userId,
            resource_id: container.id,
            resource_type: 'container',
            permission_level: 'owner',
            granted_by: userId,
          });

        return container;
      })
      .then((container) => res.send(container))
      .catch((err) => {
        console.error(err);
        res.status(500).send(err);
      });
  }
  catch(e) {
    res.send(e)
  }
});

/* DELETE containers listing. */
// THIS IS USED BY THE APPLICATION TO DELETE A CONTAINER
router.delete('/delete', jsonParser, async function(req, res, next) {
  try {
    const userId = req.user?.user_id;

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const containerId = req.query.container_id;
    if (!containerId) {
      return res.status(400).json({ error: 'container_id is required' });
    }

    const ownedContainer = await knex('containers')
      .select('id')
      .where({ id: containerId, user_id: userId })
      .first();

    if (!ownedContainer) {
      return res.status(404).json({ error: 'Container not found' });
    }

    knex.transaction(async trx => {
      await knex('permissions')
      .transacting(trx)
      .where({
        resource_id: containerId,
        resource_type: 'container'
      })
      .del()

      await knex('items')
      .transacting(trx)
      .update({
        container_id: null
      })
      .where({
        container_id: containerId,
        user_id: userId
      })

      await knex('containers')
      .transacting(trx)
      .where({
        id: containerId,
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


/* EDIT containers listing. */
// THIS IS USED BY THE APPLICATION TO EDIT A CONTAINER
router.put('/update', jsonParser, async function(req, res, next) {
  try {
    const userId = req.user?.user_id;

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const containerId = req.query.container_id;
    if (!containerId) {
      return res.status(400).json({ error: 'container_id is required' });
    }

    if (req.query.collection) {
      const collection = await knex('collections')
        .select('id')
        .where({ id: req.query.collection, user_id: userId })
        .first();

      if (!collection) {
        return res.status(403).json({ error: 'Not authorized to use this collection' });
      }
    }

    var containerParams = {
      name: req.query.name,
      description: req.query.description,
      collection_id: req.query.collection,
    }

    // New MoveTrack fields
    if (req.query.box_number !== undefined) {
      containerParams.box_number = req.query.box_number;
    }
    if (req.query.box_type !== undefined) {
      containerParams.box_type = req.query.box_type;
    }
    if (req.query.sealed !== undefined) {
      containerParams.sealed = req.query.sealed === 'true' || req.query.sealed === true;
      if (containerParams.sealed) {
        containerParams.sealed_at = new Date();
      }
    }
    if (req.query.weight_lbs !== undefined) {
      containerParams.weight_lbs = req.query.weight_lbs;
    }
    if (req.query.fragile_contents !== undefined) {
      containerParams.fragile_contents = req.query.fragile_contents === 'true' || req.query.fragile_contents === true;
    }
    if (req.query.qr_code !== undefined) {
      containerParams.qr_code = req.query.qr_code;
    }
    if (req.query.color_code !== undefined) {
      containerParams.color_code = req.query.color_code;
    }

    // Container capacity fields
    if (req.query.max_weight_lbs !== undefined) {
      containerParams.max_weight_lbs = req.query.max_weight_lbs;
    }
    if (req.query.max_volume_cuft !== undefined) {
      containerParams.max_volume_cuft = req.query.max_volume_cuft;
    }
    if (req.query.box_size !== undefined) {
      containerParams.box_size = req.query.box_size;
    }
    if (req.query.inner_length_in !== undefined) {
      containerParams.inner_length_in = req.query.inner_length_in;
    }
    if (req.query.inner_width_in !== undefined) {
      containerParams.inner_width_in = req.query.inner_width_in;
    }
    if (req.query.inner_height_in !== undefined) {
      containerParams.inner_height_in = req.query.inner_height_in;
    }

    var itemParams = {};

    if (req.query.collection) {
      itemParams.collection_id = req.query.collection;
    }

    // Note: location is now inherited from collection for both containers and items,
    // so we don't accept location_id parameter

    // Remove undefined values from containerParams
    Object.keys(containerParams).forEach(key => {
      if (containerParams[key] === undefined) {
        delete containerParams[key];
      }
    });

    knex.transaction(async trx => {
      // Only update items if there are fields to update
      if (Object.keys(itemParams).length > 0) {
        await knex('items')
        .transacting(trx)
        .update(itemParams)
        .where({
          container_id: containerId,
          user_id: userId
        })
      }

      await knex('containers')
      .transacting(trx)
      .update(containerParams)
      .where({
        id: containerId,
        user_id: userId
      })

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

router.post('/:id/qr', jsonParser, async function(req, res) {
  try {
    const { id } = req.params;
    const userId = req.user?.user_id;

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const container = await knex('containers')
      .select('id', 'user_id', 'qr_code')
      .where({ id })
      .first();

    if (!container) {
      return res.status(404).json({ error: 'Container not found' });
    }

    if (String(container.user_id) !== String(userId)) {
      return res.status(403).json({ error: 'Not authorized to modify this container' });
    }

    const shouldRegenerate =
      req.query.regenerate === 'true' ||
      req.body?.regenerate === true;

    const requestedToken = req.body?.token || req.query?.token;
    const normalizedToken = requestedToken ? extractQrToken(requestedToken) : null;

    if (normalizedToken) {
      const existsInContainers = await knex('containers').where({ qr_code: normalizedToken }).first();
      const existsInItems = await knex('items').where({ qr_code: normalizedToken }).first();
      if (
        (existsInContainers && existsInContainers.id !== container.id) ||
        existsInItems
      ) {
        return res.status(409).json({ error: 'QR code already in use' });
      }
    } else if (container.qr_code && !shouldRegenerate) {
      return res.json({
        token: container.qr_code,
        url: buildQrUrl(QR_TYPES.container, container.qr_code),
        existing: true,
      });
    }

    const tokenValue =
      normalizedToken || (await generateUniqueToken(knex, 'containers', 'ct'));

    await knex('containers')
      .where({ id })
      .update({
        qr_code: tokenValue,
        qr_assigned_at: knex.fn.now(),
      });

    return res.json({
      token: tokenValue,
      url: buildQrUrl(QR_TYPES.container, tokenValue),
      regenerated: shouldRegenerate || Boolean(normalizedToken),
    });
  } catch (error) {
    console.error('Error creating container QR code:', error);
    return res.status(500).json({ error: 'Failed to create QR code' });
  }
});

module.exports = router;
