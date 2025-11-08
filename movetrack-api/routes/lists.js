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
  var user_name = req.query.user

  try {
    // // Get owned containers + items in collections 
    // let collectionsQuery = await knex('collections')
    //   .distinct({
    //     location_id: knex.raw('COALESCE(item_locations.id, container_locations.id)'),
    //     location_name: knex.raw('COALESCE(item_locations.name, container_locations.name)'),
    //     collection_id: 'collections.id',
    //     collection_name: 'collections.name',
    //     container_id: 'containers.id',
    //     container_name: 'containers.name',
    //     id: 'items.id',
    //     name: 'items.name',
    //     description: 'items.description',
    //     quantity: 'items.quantity',
    //     picture_url: 'items.picture_url'
    //   })
    //   .leftJoin('permissions as collection_permissions', 'collection_permissions.id', 'collections.id')
    //   .leftJoin('containers', 'containers.collection_id', 'collections.id')
    //   .leftJoin('items', 'items.container_id', 'containers.id')
    //   .leftJoin('locations as item_locations', 'items.location_id', 'item_locations.id')
    //   .leftJoin('locations as container_locations', 'containers.location_id', 'container_locations.id')
    //   .where(knex.raw('item_permissions.user_name = ?', user_name))
    //   .orWhere(knex.raw('collection_permissions.user_name = ?', user_name))

    // // Get owned orphaned items in collections
    // let itemsQuery = await knex('items')
    //   .distinct({
    //     location_id: 'locations.id',
    //     location_name: 'locations.name',
    //     collection_id: 'collections.id',
    //     collection_name: 'collections.name',
    //     container_id: null,
    //     container_name: null,
    //     id: 'items.id',
    //     name: 'items.name',
    //     description: 'items.description',
    //     quantity: 'items.quantity',
    //     picture_url: 'items.picture_url'
    //   })
    //   .leftJoin('collections', 'items.collection_id', 'collections.id')

    //   .leftJoin('permissions', 'permissions.id', 'items.id')
      
    //   .leftJoin('containers', 'containers.collection_id', 'collections.id')
    //   .leftJoin('locations', 'items.location_id', 'locations.id')
    //   .where(knex.raw('permissions.user_name = ?', user_name))
    //   .andWhere('containers.id', null)



    // // Get owned locations with no associated items or containers
    // let locationsQuery = knex('locations')
    //   .distinct({
    //     location_id: 'locations.id',
    //     location_name: 'locations.name',
    //     collection_id: null,
    //     collection_name: null,
    //     container_id: null,
    //     container_name: null,
    //     id: null,
    //     name: null,
    //     description: null,
    //     quantity: null,
    //     picture_url: null
    //   })
    //   .leftJoin('items', 'items.location_id', 'locations.id')
    //   .leftJoin('containers', 'containers.location_id', 'locations.id')
    //   .where(knex.raw('locations.owner = ?', user_name))
    //   .andWhere('containers.id', null)
    //   .andWhere('items.id', null)
      
    let locations = await knex('locations')
      .distinct('*')
      .where(knex.raw('locations.owner = ?', user_name))
      .then((data) => {
        return data
      })

    let collections = await knex('collections')
      .distinct('*')
      .where(knex.raw('collections.owner = ?', user_name))
      .then((data) => {
        return data
      })

    let containers = await knex('containers')
      .distinct('*')
      .where(knex.raw('containers.owner = ?', user_name))
      .then((data) => {
        return data
      })

    let items = await knex('items')
      .distinct('*')
      .where(knex.raw('items.owner = ?', user_name))
      .then((data) => {
        return data
      })

    res.json({ locations, collections, containers, items });

    // .then(function (data) {
    //   
    //   res.send(data)
    // })
    // .catch(function (err) {
    //   return next(err);
    // });
  }
  catch(e) {
    res.send(e)
  }
});

module.exports = router;
