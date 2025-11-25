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

/* GET all hierarchy items. */
// THIS IS USED BY THE APPLICATION TO GET THE HIERARCHY OF ITEMS

// We want to get a list of (a) all items with associated containers / locations / collections
// and (b) all containers with associated locations / collections
// and (c) all collections without any associations
// and (d) all locations without any associations
router.get('/', jsonParser, async function(req, res, next) {
  const userId = req.query.user;

  if (!userId) {
    return res.status(400).json({ error: 'User id is required' });
  }

  try {
    // Filter out truck locations - they are managed separately via move-day routes
    const locations = await knex('locations')
      .select('*')
      .where('locations.user_id', userId)
      .andWhere(function() {
        this.whereNull('location_type')
          .orWhereNot('location_type', 'truck');
      });

    const collections = await knex('collections')
      .select('collections.*', 'locations.name as location_name')
      .leftJoin('locations', 'collections.location_id', 'locations.id')
      .where('collections.user_id', userId);

    const containers = await knex('containers')
      .select(
        'containers.*',
        'collections.location_id',
        'locations.name as location_name'
      )
      .leftJoin('collections', 'containers.collection_id', 'collections.id')
      .leftJoin('locations', 'collections.location_id', 'locations.id')
      .where('containers.user_id', userId);

    const items = await knex('items')
      .select(
        'items.*',
        'collections.location_id',
        'locations.name as location_name'
      )
      .leftJoin('collections', 'items.collection_id', 'collections.id')
      .leftJoin('locations', 'collections.location_id', 'locations.id')
      .where('items.user_id', userId);

    res.json({ locations, collections, containers, items });
  } catch (e) {
    res.send(e);
  }
});

module.exports = router;
