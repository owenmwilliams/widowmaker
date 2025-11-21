var express = require('express');
var router = express.Router();
const pgp = require('pg-promise')();
var bodyParser = require('body-parser');
var conn = require('../bin/db');

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

/* GET collections listing with parents. */
router.get('/', jsonParser, async function(req, res, next) {
  var user_id = req.query.user
  var location_id = req.query.location

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
        knex.raw('permissions.user_id = ?', user_id)
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
  var user_id = req.query.user
  var collection_id = req.query.collection

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
      .where(knex.raw('permissions.user_id = ?', user_id))
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
  var user_id = req.query.user

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
        knex.raw('permissions.user_id = ?', user_id)
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
  var user_id = req.query.user
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
        user_id
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

    knex.transaction(async trx => {
      await knex('collections')
      .transacting(trx)
      .insert({
        owner_id: req.query.user,
        name: req.query.name,
        description: req.query.description,
        location_id: req.query.location
      })
      .returning('id')
      .then(async result => {
        await knex('permissions')
        .transacting(trx)
        .insert({
          user_id: req.query.user,
          resource_id: result[0].id,
          resource_type: 'collection',
          permission_level: 'owner',
          granted_by: req.query.user
        })
        .returning('id')
        .then(result => {
          res.send(result)
        })
      })
      .then(trx.commit)
      .catch(trx.rollback);
    })
    .then((data) => {
      res.send(data)
    })
  }

  catch(e) {
    res.send(e)
  }
});

/* DELETE collections listing. */
// THIS IS USED BY THE APPLICATION TO DELETE A COLLECTION
router.delete('/delete', jsonParser, async function(req, res, next) {
  try {
    knex.transaction(async trx => {
      await knex('permissions')
      .transacting(trx)
      .where({
        resource_id: req.query.collection_id,
        resource_type: 'collection'
      })
      .del()

      await knex('items')
      .transacting(trx)
      .where('items.collection_id', req.query.collection_id)
      .del()

      await knex('containers')
      .transacting(trx)
      .where('containers.collection_id', req.query.collection_id)
      .del()

      await knex('collections')
      .transacting(trx)
      .where('id', req.query.collection_id)
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
    // Build update object dynamically
    const updateData = {
      owner_id: req.query.user,
      name: req.query.name,
      description: req.query.description
    };

    // Add location_id if provided
    if (req.query.location !== undefined) {
      updateData.location_id = req.query.location;
    }

    knex.transaction(async trx => {
      await knex('collections')
      .transacting(trx)
      .update(updateData)
      .where('id', req.query.collection_id)

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
