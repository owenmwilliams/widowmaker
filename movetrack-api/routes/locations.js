
var express = require('express');
var router = express.Router();
var bodyParser = require('body-parser');
const { authenticate, resolveEffectivePlan } = require('../bin/authService');

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
const BASIC_LOCATION_CAP = 2;

router.use(authenticate);

async function enforceLocationCap(req, res, next) {
  const plan = resolveEffectivePlan(req);
  if (plan === 'pro') return next();
  try {
    const userId = req.user?.user_id;
    const countResult = await knex('locations').count('* as cnt').where('user_id', userId);
    const currentCount = Number(countResult?.[0]?.cnt || 0);
    if (currentCount >= BASIC_LOCATION_CAP) {
      return res.status(402).json({ error: `Basic plan supports up to ${BASIC_LOCATION_CAP} locations. Upgrade to add more.` });
    }
    next();
  } catch (err) {
    console.error('Error enforcing location cap:', err);
    res.status(500).json({ error: 'Failed to enforce plan limits' });
  }
}

/* GET locations listing. */
router.get('/', jsonParser, async function(req, res, next) {
  const userId = req.user?.user_id;


  try {
    await knex
      .select('locations.id', 'locations.name', 'locations.description', 'locations.address', 'locations.address_2', 'locations.city', 'locations.state', 'locations.zip', 'locations.location_type')
      .countDistinct('collections.id', {as: 'total_rooms'})
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
  const userId = req.user?.user_id;
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
      .leftJoin('permissions', function() {
        this.on('permissions.resource_id', '=', 'locations.id')
            .andOn('permissions.resource_type', '=', knex.raw('?', ['location']))
      })
      .where(knex.raw('permissions.user_id = ?', userId))
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
router.post('/post', jsonParser, enforceLocationCap, async function(req, res, next) {
  try {
    const userId = req.user?.user_id;
    const isPrimary = req.query.is_primary === 'true' || req.query.is_primary === true;
    const locationType = req.query.location_type || (isPrimary ? 'primary_residence' : 'residence');

    const id = knex.transaction(async trx => {
      if (isPrimary) {
        await knex('locations')
          .transacting(trx)
          .update({ location_type: 'residence' })
          .where('user_id', userId)
          .andWhere('location_type', 'primary_residence');
      }

      await knex('locations')
      .transacting(trx)
      .insert({
        user_id: userId,
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
    const userId = req.user?.user_id;
    const isPrimary = req.query.is_primary === 'true' || req.query.is_primary === true;
    const locationType = req.query.location_type || (isPrimary ? 'primary_residence' : 'residence');

    knex.transaction(async trx => {
      if (isPrimary) {
        await knex('locations')
          .transacting(trx)
          .update({ location_type: 'residence' })
          .where('user_id', userId)
          .andWhere('location_type', 'primary_residence');
      }

      await knex('locations')
      .transacting(trx)
      .update({
        user_id: userId,
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
