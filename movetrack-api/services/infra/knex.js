'use strict';

/**
 * Shared Knex instance for transactional database operations.
 * Use this instead of creating per-module Knex instances.
 *
 * For simple queries, prefer pg-promise via services/infra/db.js.
 * For transactions (insert + permission creation, etc.), use this.
 */
const knex = require('knex')({
  client: 'pg',
  connection: {
    host: process.env.MT_DATALAYER_HOSTNAME,
    user: process.env.MT_DATALAYER_USERNAME,
    password: process.env.MT_DATALAYER_PASSWORD,
    database: process.env.MT_DATALAYER_DATABASE,
  },
  pool: { min: 0, max: 10 },
});

module.exports = knex;
