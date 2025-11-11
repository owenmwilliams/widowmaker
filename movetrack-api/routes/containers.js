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

/* GET containers listing. */
router.get('/', jsonParser, async function(req, res, next) {
  var user_name = req.query.user
  var location_id = req.query.location
  var room_id = req.query.room

  try {
    await knex.with(
      'distinct_items',
      knex.raw(
        `SELECT DISTINCT
          containers.id,
          containers.name AS container_name,
          containers.description AS container_description,
          rooms.id AS room_id,
          locations.id AS location_id,
          items.id AS item_id,
          items.quantity AS item_quantity
        FROM locations
          LEFT JOIN permissions ON permissions.location_id = locations.id
          LEFT JOIN rooms ON rooms.location_id = locations.id
          LEFT JOIN containers ON containers.room_id = rooms.id
          LEFT JOIN items ON items.container_id = containers.id
        WHERE permissions.user_name = :username
          AND locations.id = :locationid
          AND rooms.id = :roomid`, {
            username: user_name,
            locationid: location_id,
            roomid: room_id
          }
      )
    )
    .select('id', 'container_name', 'container_description', 'location_id', 'room_id')
    .countDistinct('item_id', {as: 'total_items'})
    .sum('item_quantity', {as: 'total_count_items'})
    .from('distinct_items')
    .groupBy('id', 'container_name', 'container_description', 'location_id', 'room_id')
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
  var user_name = req.query.user
  var container_id = req.query.container

  try {
    await knex
      .select({
        id: 'containers.id',
        name: 'containers.name',
        description: 'containers.description',
        room_id: 'rooms.id',
        location_id: 'locations.id',
        max_weight_lbs: 'containers.max_weight_lbs',
        max_volume_cuft: 'containers.max_volume_cuft',
        box_size: 'containers.box_size'
      })
      .from('locations')
      .leftJoin('permissions', 'permissions.location_id', 'locations.id')
      .leftJoin('rooms', 'rooms.location_id', 'locations.id')
      .leftJoin('containers', 'containers.room_id', 'rooms.id')
      .where(knex.raw('permissions.user_name = ?', user_name))
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
  var user_name = req.query.user

  try {

    await knex.with(
      'distinct_items',
      knex.raw(
        `SELECT DISTINCT
          locations.id AS location_id,
          locations.name AS location_name,
          rooms.id AS room_id,
          rooms.name AS room_name,
          containers.id,
          containers.name AS container_name,
          containers.description AS container_description,
          items.id AS item_id,
          items.quantity AS item_quantity
        FROM locations
          LEFT JOIN permissions ON permissions.location_id = locations.id
          LEFT JOIN rooms ON rooms.location_id = locations.id
          LEFT JOIN containers ON containers.room_id = rooms.id
          LEFT JOIN items ON items.container_id = containers.id
        WHERE permissions.user_name = ?`, user_name
      )
    )
    .select('location_id', 'location_name', 'room_id', 'room_name', 'id', 'container_name', 'container_description')
    .countDistinct('item_id', {as: 'total_items'})
    .sum('item_quantity', {as: 'total_count_items'})
    .from('distinct_items')
    .whereNotNull('id')
    .groupBy('location_id', 'location_name', 'room_id', 'room_name', 'id', 'container_name', 'container_description')
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
  var user_name = req.query.user

  try {
    await knex.raw(`
      WITH TWO AS (
        WITH ONE AS (
        SELECT
            locations.id AS location_id,
            locations.name AS location_name,
            rooms.id AS room_id,
            rooms.name AS room_name,
            JSON_BUILD_OBJECT(
                'id', containers.id,
                'name', containers.name) AS containers_json
        FROM locations
            LEFT JOIN permissions ON permissions.location_id = locations.id
            LEFT JOIN rooms ON rooms.location_id = locations.id
            LEFT JOIN containers ON containers.room_id = rooms.id
        WHERE permissions.user_name = ?
            AND containers.id IS NOT NULL
        )
        SELECT
            location_id,
            location_name,
            room_id,
            room_name,
            JSON_AGG(containers_json) AS containers
        FROM ONE
        GROUP BY 1, 2, 3, 4
    )
    
    SELECT
        location_id,
        location_name,
        JSON_AGG(rooms_json) AS rooms
    FROM(
        SELECT 
            location_id,
            location_name,
            JSON_BUILD_OBJECT(
                'id', room_id,
                'name', room_name,
                'containers', containers
            ) AS rooms_json
        FROM TWO
    ) AS TWO_FROM
    GROUP BY 1, 2
    `, user_name)
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
    var params = {
      owner: req.query.user,
      name: req.query.name,
      description: req.query.description,
      collection_id: req.query.collection
    };

    if (req.query.location_id) {
      params.location_id = req.query.location_id;
    }

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

    knex.transaction(async trx => {
      await knex('containers')
      .transacting(trx)
      .insert(params)
      .returning('id')
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

/* DELETE containers listing. */
// THIS IS USED BY THE APPLICATION TO DELETE A CONTAINER
router.delete('/delete', jsonParser, async function(req, res, next) {
  try {
    knex.transaction(async trx => {
      await knex('items')
      .transacting(trx)
      .update({
        container_id: null
      })
      .where('items.container_id', req.query.container_id)

      await knex('containers')
      .transacting(trx)
      .where('id', req.query.container_id)
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
    var containerParams = {
      owner: req.query.user,
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

    var itemParams = {};

    if (req.query.collection) {
      itemParams.collection_id = req.query.collection;
    }

    if (req.query.location) {
      containerParams.location_id = req.query.location
      itemParams.location_id = req.query.location
    }

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
        .where('container_id', req.query.container_id)
      }

      await knex('containers')
      .transacting(trx)
      .update(containerParams)
      .where('id', req.query.container_id)

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
