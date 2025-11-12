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

/* GET items listing. */
router.get('/', jsonParser, async function(req, res, next) {
  var user_name = req.query.user
  var location_id = req.query.location
  var room_id = req.query.room
  var container_id = req.query.container

  try {
    await knex
      .select({
        id: 'items.id',
        name: 'items.name',
        description: 'items.description',
        quantity: 'items.quantity',
        picture_url: 'items.picture_url',
        container_id: 'containers.id',
        room_id: 'rooms.id',
        location_id: 'locations.id'
      })
      .from('locations')
      .leftJoin('permissions', 'permissions.location_id', 'locations.id')
      .leftJoin('rooms', 'rooms.location_id', 'locations.id')
      .leftJoin('containers', 'containers.room_id', 'rooms.id')
      .leftJoin('items', 'items.container_id', 'containers.id')
      .where(knex.raw('permissions.user_name = ?', user_name))
      .andWhere(knex.raw('locations.id = ?', location_id))
      .andWhere(knex.raw('rooms.id = ?', room_id))
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
  var user_name = req.query.user
  var item_id = req.query.item

  try {
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
        dimensions: 'items.dimensions',
        notes: 'items.notes',
        material: 'items.material',
        primary_color: 'items.primary_color',
        tags: 'items.tags'
      })
      .from('items')
      .leftJoin('permissions', 'permissions.id', 'items.id')
      .leftJoin('collections', 'collections.id', 'items.collection_id')
      .leftJoin('containers', 'containers.id', 'items.container_id')
      .leftJoin('locations', 'locations.id', 'items.location_id')
      .where(knex.raw('permissions.user_name = ?', user_name))
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
  var user_name = req.query.user

  try {
    await knex('locations')
      .distinct({
        location_id: 'locations.id',
        location_name: 'locations.name',
        room_id: 'rooms.id',
        room_name: 'rooms.name',
        container_id: 'containers.id',
        container_name: 'containers.name',
        id: 'items.id',
        name: 'items.name',
        description: 'items.description',
        quantity: 'items.quantity',
        picture_url: 'items.picture_url'
      })
      .leftJoin('permissions', 'permissions.location_id', 'locations.id')
      .leftJoin('rooms', 'rooms.location_id', 'locations.id')
      .leftJoin('containers', 'containers.room_id', 'rooms.id')
      .leftJoin('items', 'items.container_id', 'containers.id')
      .whereNotNull('items.id')
      .andWhere(knex.raw('permissions.user_name = ?', user_name))
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
    var params = {
      owner: req.query.user,
      name: req.query.name,
      description: req.query.description,
      quantity: req.query.quantity,
      collection_id: req.query.collection
    }

    if (req.query.container) {
      params.container_id = req.query.container
    }

    if (req.query.location) {
      params.location_id = req.query.location
    }

    if(req.query.picture_url) {
      params.picture_url = req.query.picture_url
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
    if(req.query.dimensions) {
      params.dimensions = req.query.dimensions
    }
    if(req.query.notes) {
      params.notes = req.query.notes
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

    knex.transaction(async trx => {
      await knex('items')
      .transacting(trx)
      .insert(params)
      .returning('id')
      .then(async result => {
        await knex('permissions')
        .transacting(trx)
        .insert({
          user_name: req.query.user,
          id: result[0].id,
          type: 'item',
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
  
/* DELETE items listing. */
// THIS IS USED BY THE APPLICATION TO DELETE AN ITEM
router.delete('/delete', jsonParser, async function(req, res, next) {
  try {
    knex.transaction(async trx => {
      await knex('items')
      .transacting(trx)
      .where('id', req.query.item_id)
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

    // CRITICAL FIX: Only update fields that are explicitly provided
    // Do NOT set fields to null unless explicitly requested
    var params = {}

    // Required fields for identification
    if (req.query.user !== undefined) {
      params.owner = req.query.user
    }

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
      params.collection_id = req.query.collection
    }

    // Only update these if explicitly provided (don't force null)
    if (req.query.container !== undefined) {
      params.container_id = req.query.container
    }

    if (req.query.location !== undefined) {
      params.location_id = req.query.location
    }

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
    if(req.query.dimensions !== undefined) {
      params.dimensions = req.query.dimensions
    }
    if(req.query.notes !== undefined) {
      params.notes = req.query.notes
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
    console.log(`[ITEMS UPDATE] User: ${req.query.user}, Item ID: ${req.query.item_id}, Fields: ${Object.keys(params).join(', ')}`);

    knex.transaction(async trx => {
      await knex('items')
      .transacting(trx)
      .update(params)
      .where('id', req.query.item_id)
      .then(trx.commit)
      .catch(trx.rollback);
    })
    .then((data) => {
      res.send('OK')
    })
  }
  catch(e) {
    res.send(e)
  }
});

module.exports = router;
