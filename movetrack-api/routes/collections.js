// NEW COLLECTIONS FILE AFTER MIGRATION TO DATALAYER SERVICE

var express = require('express');
var router = express.Router();
const pgp = require('pg-promise')();
var bodyParser = require('body-parser');
var conn = require('../bin/db');
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

/* GET collections listing with parents. */
router.get('/', jsonParser, async function(req, res, next) {
  const userId = req.user?.user_id;
  var location_id = req.query.location

  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    await knex
      .select({
        id: 'collections.id',
        name: 'collections.name',
        description: 'collections.description',
        location_id: 'locations.id'
      })
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
      .andWhere(
        knex.raw('locations.id = ?', location_id)
      )
      .groupBy('collections.id', 'collections.name', 'collections.description', 'locations.id')
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

/* GET collection listing. */
router.get('/single', jsonParser, async function(req, res, next) {
  const userId = req.user?.user_id;
  var collection_id = req.query.collection

  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    await knex
      .select({
        id: 'collections.id',
        name: 'collections.name',
        description: 'collections.description',
        location_id: 'locations.id'
      })
      .from('locations')
      .leftJoin('permissions', function() {
        this.on('permissions.resource_id', '=', 'locations.id')
            .andOn('permissions.resource_type', '=', knex.raw('?', ['location']))
      })
      .leftJoin('collections', 'collections.location_id', 'locations.id')
      .where(knex.raw('permissions.user_id = ?', userId))
      .andWhere(knex.raw('collections.id = ?', collection_id))
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

/* GET all collections. */
router.get('/all', jsonParser, async function(req, res, next) {
  const userId = req.user?.user_id;

  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    await knex
      .select({
        id: 'collections.id',
        name: 'collections.name',
        description: 'collections.description',
        location_id: 'locations.id',
        location_name: 'locations.name'
      })
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
      .whereNotNull('collections.id')
      .andWhere(
        knex.raw('permissions.user_id = ?', userId)
      )
      .groupBy('locations.id', 'locations.name', 'collections.id', 'collections.name', 'collections.description')
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

/* GET all collections grouped. */
router.get('/all/grouped', jsonParser, async function(req, res, next) {
  const userId = req.user?.user_id;

  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    await knex.with(
      'ONE',
      knex.raw(
        `SELECT
          locations.id AS location_id,
          locations.name AS location_name,
          JSON_BUILD_OBJECT(
              'id', collections.id,
              'name', collections.name) AS collections_json
        FROM locations
            LEFT JOIN permissions ON permissions.resource_id = locations.id AND permissions.resource_type = 'location'
            LEFT JOIN collections ON collections.location_id = locations.id
        WHERE permissions.user_id = ?
            AND collections.id IS NOT NULL`,
        userId
      )
    )
    .select('location_id', 'location_name', 
      knex.raw(`JSON_AGG(collections_json) AS collections`))
    .from('ONE')
    .groupBy('location_id','location_name')
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

/* ADD collection. */
// THIS IS USED BY THE APPLICATION TO ADD A COLLECTION
router.post('/post', jsonParser, async function(req, res, next) {
  try {
    // Validate that location is provided
    if (!req.query.location) {
      return res.status(400).json({ error: 'location is required for collections' });
    }
    const userId = req.user?.user_id;

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const location = await knex('locations')
      .select('id')
      .where({ id: req.query.location, user_id: userId })
      .first();

    if (!location) {
      return res.status(403).json({ error: 'Not authorized to use this location' });
    }

    knex
      .transaction(async (trx) => {
        const [collection] = await knex('collections')
          .transacting(trx)
          .insert({
            user_id: userId,
            name: req.query.name,
            description: req.query.description,
            location_id: req.query.location,
          })
          .returning(['id']);

        await knex('permissions')
          .transacting(trx)
          .insert({
            user_id: userId,
            resource_id: collection.id,
            resource_type: 'collection',
            permission_level: 'owner',
            granted_by: userId,
          });

        return collection;
      })
      .then((collection) => res.send(collection))
      .catch((err) => {
        console.error(err);
        res.status(500).send(err);
      });
  }

  catch(e) {
    res.send(e)
  }
});

/* DELETE collections listing. */
// THIS IS USED BY THE APPLICATION TO DELETE A COLLECTION
router.delete('/delete', jsonParser, async function(req, res, next) {
  try {
    const userId = req.user?.user_id;

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const collectionId = req.query.collection_id;
    if (!collectionId) {
      return res.status(400).json({ error: 'collection_id is required' });
    }

    const ownedCollection = await knex('collections')
      .select('id')
      .where({ id: collectionId, user_id: userId })
      .first();

    if (!ownedCollection) {
      return res.status(404).json({ error: 'Collection not found' });
    }

    knex.transaction(async trx => {
      await knex('permissions')
      .transacting(trx)
      .where({
        resource_id: collectionId,
        resource_type: 'collection'
      })
      .del()

      await knex('items')
      .transacting(trx)
      .where({
        collection_id: collectionId,
        user_id: userId
      })
      .del()

      await knex('containers')
      .transacting(trx)
      .where({
        collection_id: collectionId,
        user_id: userId
      })
      .del()

      await knex('collections')
      .transacting(trx)
      .where({
        id: collectionId,
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

/* EDIT collections listing. */
// THIS IS USED BY THE APPLICATION TO EDIT A COLLECTION
router.put('/update', jsonParser, async function(req, res, next) {
  try {
    const userId = req.user?.user_id;

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const collectionId = req.query.collection_id;
    if (!collectionId) {
      return res.status(400).json({ error: 'collection_id is required' });
    }

    if (req.query.location !== undefined) {
      const location = await knex('locations')
        .select('id')
        .where({ id: req.query.location, user_id: userId })
        .first();

      if (!location) {
        return res.status(403).json({ error: 'Not authorized to use this location' });
      }
    }

    // Build update object dynamically
    const updateData = {
      name: req.query.name,
      description: req.query.description,
    };

    // Add location_id if provided
    if (req.query.location !== undefined) {
      updateData.location_id = req.query.location;
    }

    knex.transaction(async trx => {
      await knex('collections')
      .transacting(trx)
      .update(updateData)
      .where({
        id: collectionId,
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

module.exports = router;
