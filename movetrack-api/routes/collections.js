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

/* GET rooms listing with parents. */
router.get('/', jsonParser, async function(req, res, next) {
  var user_name = req.query.user
  var location_id = req.query.location

  try {
    await knex
      .select({
        id: 'rooms.id',
        name: 'rooms.name',
        description: 'rooms.description',
        location_id: 'locations.id'
      })
      .countDistinct('containers.id', {as: 'total_containers'})
      .countDistinct('items.id', {as: 'total_items'})
      .from('locations')
      .leftJoin('permissions', 'permissions.location_id', 'locations.id')
      .leftJoin('rooms', 'rooms.location_id', 'locations.id')
      .leftJoin('containers', 'containers.room_id', 'rooms.id')
      .leftJoin('items', 'items.container_id', 'containers.id')
      .where(
        knex.raw('permissions.user_name = ?', user_name)
      )
      .andWhere(
        knex.raw('locations.id = ?', location_id)
      )
      .groupBy('rooms.id', 'rooms.name', 'rooms.description', 'locations.id')
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

/* GET room listing. */
router.get('/single', jsonParser, async function(req, res, next) {
  var user_name = req.query.user
  var room_id = req.query.room

  try {
    await knex
      .select({
        id: 'rooms.id',
        name: 'rooms.name',
        description: 'rooms.description',
        location_id: 'locations.id'
      })
      .from('locations')
      .leftJoin('permissions', 'permissions.location_id', 'locations.id')
      .leftJoin('rooms', 'rooms.location_id', 'locations.id')
      .where(knex.raw('permissions.user_name = ?', user_name))
      .andWhere(knex.raw('rooms.id = ?', room_id))
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

/* GET all rooms. */
router.get('/all', jsonParser, async function(req, res, next) {
  var user_name = req.query.user

  try {
    await knex
      .select({
        id: 'rooms.id',
        name: 'rooms.name',
        description: 'rooms.description',
        location_id: 'locations.id',
        location_name: 'locations.name'
      })
      .countDistinct('containers.id', {as: 'total_containers'})
      .countDistinct('items.id', {as: 'total_items'})
      .from('locations')
      .leftJoin('permissions', 'permissions.location_id', 'locations.id')
      .leftJoin('rooms', 'rooms.location_id', 'locations.id')
      .leftJoin('containers', 'containers.room_id', 'rooms.id')
      .leftJoin('items', 'items.container_id', 'containers.id')
      .whereNotNull('rooms.id')
      .andWhere(
        knex.raw('permissions.user_name = ?', user_name)
      )
      .groupBy('locations.id', 'locations.name', 'rooms.id', 'rooms.name', 'rooms.description')
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

/* GET all rooms grouped. */
router.get('/all/grouped', jsonParser, async function(req, res, next) {
  var user_name = req.query.user
  try {
    await knex.with(
      'ONE',
      knex.raw(
        `SELECT
          locations.id AS location_id,
          locations.name AS location_name,
          JSON_BUILD_OBJECT(
              'id', rooms.id,
              'name', rooms.name) AS rooms_json
        FROM locations
            LEFT JOIN permissions ON permissions.location_id = locations.id
            LEFT JOIN rooms ON rooms.location_id = locations.id
        WHERE permissions.user_name = ?
            AND rooms.id IS NOT NULL`,
        user_name
      )
    )
    .select('location_id', 'location_name', 
      knex.raw(`JSON_AGG(rooms_json) AS rooms`))
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
    knex.transaction(async trx => {
      await knex('collections')
      .transacting(trx)
      .insert({
        owner: req.query.user,
        name: req.query.name,
        description: req.query.description
      })
      .returning('id')
      .then(async result => {
        await knex('permissions')
        .transacting(trx)
        .insert({
          user_name: req.query.user,
          id: result[0].id,
          type: 'collection',
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

/* DELETE rooms listing. */
// THIS IS USED BY THE APPLICATION TO DELETE A COLLECTION
router.delete('/delete', jsonParser, async function(req, res, next) {
  try {
    knex.transaction(async trx => {
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

/* EDIT rooms listing. */
// THIS IS USED BY THE APPLICATION TO EDIT A COLLECTION
router.put('/update', jsonParser, async function(req, res, next) {
  try {
    knex.transaction(async trx => {
      await knex('collections')
      .transacting(trx)
      .update({
        owner: req.query.user,
        name: req.query.name,
        description: req.query.description
      })
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
