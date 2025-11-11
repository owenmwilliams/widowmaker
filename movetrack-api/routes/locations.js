
var express = require('express');
var router = express.Router();
var bodyParser = require('body-parser');

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

/* GET locations listing. */
router.get('/', jsonParser, async function(req, res, next) {
  var user_name = req.query.user

  
  try {
    await knex
      .select('locations.id', 'locations.name', 'locations.description', 'locations.address', 'locations.address_2', 'locations.city', 'locations.state', 'locations.zip', 'locations.location_type')
      .countDistinct('rooms.id', {as: 'total_rooms'})
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
      .groupBy('locations.id', 'locations.name', 'locations.description', 'locations.address', 'locations.address_2', 'locations.city', 'locations.state', 'locations.zip', 'locations.location_type')
    .then(data => {
      res.send(data)
    })
    .catch(function (err) {
      return next(err)
    });
  }
  catch(e) {
    res.send(e)
  }
});

/* GET location listing. */
router.get('/single', jsonParser, async function(req, res, next) {
  var user_name = req.query.user
  var location_id = req.query.location

  try {
    await knex
      .select({
        id: 'locations.id',
        name: 'locations.name',
        description: 'locations.description',
        address: 'locations.address',
        address_2: 'locations.address_2',
        city: 'locations.city',
        state: 'locations.state',
        zip: 'locations.zip',
        location_type: 'locations.location_type'
      })
      .from('locations')
      .leftJoin('permissions', 'permissions.location_id', 'locations.id')
      .where(knex.raw('permissions.user_name = ?', user_name))
      .andWhere(knex.raw('locations.id = ?', location_id))
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

/* ADD locations listing. */
// THE APPLICATION USES THIS TO POST A NEW LOCATION
router.post('/post', jsonParser, async function(req, res, next) {
  try {
    const isPrimary = req.query.is_primary === 'true' || req.query.is_primary === true;
    const locationType = req.query.location_type || (isPrimary ? 'primary_residence' : 'residence');

    const id = knex.transaction(async trx => {
      if (isPrimary) {
        await knex('locations')
          .transacting(trx)
          .update({ location_type: 'residence' })
          .where('owner', req.query.user)
          .andWhere('location_type', 'primary_residence');
      }

      await knex('locations')
      .transacting(trx)
      .insert({
        owner: req.query.user,
        name: req.query.name,
        description: req.query.description,
        address: req.query.address,
        address_2: req.query.address_2,
        city: req.query.city,
        state: req.query.state,
        zip: req.query.zip,
        location_type: locationType
      })
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

/* DELETE locations listing. */
router.delete('/delete', jsonParser, async function(req, res, next) {
  try {
    knex.transaction(async trx => {
      await knex('items')
      .transacting(trx)
      .update({
        location_id: null
      })
      .where('items.location_id', req.query.location_id)

      await knex('containers')
      .transacting(trx)
      .update({
        location_id: null
      })
      .where('containers.location_id', req.query.location_id)

      await knex('locations')
      .transacting(trx)
      .where('id', req.query.location_id)
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

/* EDIT locations listing. */
// THE APPLICATION USES THIS TO EDIT A LOCATION
router.put('/update', jsonParser, async function(req, res, next) {
  try {
    const isPrimary = req.query.is_primary === 'true' || req.query.is_primary === true;
    const locationType = req.query.location_type || (isPrimary ? 'primary_residence' : 'residence');

    knex.transaction(async trx => {
      if (isPrimary) {
        await knex('locations')
          .transacting(trx)
          .update({ location_type: 'residence' })
          .where('owner', req.query.user)
          .andWhere('location_type', 'primary_residence');
      }

      await knex('locations')
      .transacting(trx)
      .update({
        owner: req.query.user,
        name: req.query.name,
        description: req.query.description,
        address: req.query.address,
        address_2: req.query.address_2,
        city: req.query.city,
        state: req.query.state,
        zip: req.query.zip,
        location_type: locationType
      })
      .where('id', req.query.location_id)

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
