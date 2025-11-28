var express = require('express');
var router = express.Router();
const pgp = require('pg-promise')();
var bodyParser = require('body-parser');
var conn = require('../bin/db');

const db = conn.db;
const authService = require('../bin/authService');

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

/* GET users listing. */
router.get('/', async function(req, res, next) {
  var user_id = req.query.user_id

  try {
    await knex('users')
      .select('first_name', 'last_name', 'user_name')
      .where(
        knex.raw('id = ?', user_id)
      )
    // await db.oneOrNone('SELECT first_name, last_name, user_name FROM users WHERE user_id = $1', [user_id])
    .then(result => {
      if (result.length > 0) {
        res.send(result[0])
      } else {
        res.send('nodata')
      }
    })
    .catch(function (err) {
      return next(err);
    });
  }
  catch(e) {
    res.send(e)
  }
});

/* GET any matching usernames. */
router.get('/usercheck', async function(req, res, next) {
  var username = req.query.username

  try {
    await knex('users')
      .countDistinct('user_name')
      .where(
        knex.raw('user_name = ?', username)
      )
    // await db.oneOrNone('SELECT COUNT(DISTINCT user_name) FROM users WHERE user_name = $1', [username])
    .then(function (data) {
      if (data) {
        res.send(data)
      } else {
        res.send('nodata')
      }
    })
    .catch(function (err) {
      return next(err);
    });
  }
  catch(e) {
    res.send(e)
  }
});

/* POST a new username. */
router.post('/post', jsonParser, async function(req, res, next) {
  // const userData = {
  //   user_id: req.query.user_id,
  //   user_name: req.query.username,
  //   first_name: req.query.firstname,
  //   last_name: req.query.lastname,
  //   email: req.query.email,
  //   phone: req.query.phone
  // }

  // const insertQuery = pgp.helpers.insert(userData, null, 'users');
  
  try {
    await knex('users')
      .insert({
        id: req.query.user_id,
        user_name: req.query.username,
        first_name: req.query.firstname,
        last_name: req.query.lastname,
        email: req.query.email,
        phone: req.query.phone
      })

    // await db.none(insertQuery)
    .then(() => {
      res.sendStatus(200)
    })
    .catch(function (err) {
      return next(err)
    });
  }
  catch(e) {
    res.send(e)
  }
});

router.put('/name', jsonParser, async function(req, res, next) {
  const { user_id, first_name, last_name } = req.body || {};

  if (!user_id || !first_name || typeof first_name !== 'string' || !first_name.trim()) {
    return res.status(400).json({ error: 'user_id and first_name are required' });
  }

  try {
    const result = await knex('users')
      .update({
        first_name: first_name.trim(),
        last_name: typeof last_name === 'string' ? last_name.trim() : null
      })
      .where({ user_id })
      .returning(['user_id', 'first_name', 'last_name']);

    if (!result || !result.length) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ success: true, user: result[0] });
  } catch (error) {
    console.error('Failed to update user name:', error);
    res.status(500).json({ error: 'Failed to update user name' });
  }
});

router.put('/onboarding', authService.authenticate, async function(req, res) {
  try {
    const userId = req.user?.user_id;
    if (!userId) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    await knex('users')
      .update({
        onboarding_completed: true,
        updated_at: knex.fn.now()
      })
      .where({ user_id: userId });

    res.json({ success: true, onboarding_completed: true });
  } catch (error) {
    console.error('Failed to update onboarding status:', error);
    res.status(500).json({ success: false, error: 'Failed to update onboarding status' });
  }
});

module.exports = router;
