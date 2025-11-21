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

module.exports = router;
