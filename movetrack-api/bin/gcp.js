const Knex = require('knex');

// createUnixSocketPool initializes a Unix socket connection pool for
// a Cloud SQL instance of Postgres.
const createUnixSocketPool = async () => {
  // Note: Saving credentials in environment variables is convenient, but not
  // secure - consider a more secure solution such as
  // Cloud Secret Manager (https://cloud.google.com/secret-manager) to help
  // keep secrets safe.
  return Knex({
    client: 'pg',
    connection: {
      user: process.env.MT_DATALAYER_USERNAME, // e.g. 'my-user'
      password: process.env.MT_DATALAYER_PASSWORD, // e.g. 'my-user-password'
      database: process.env.MT_DATALAYER_DATABASE, // e.g. 'my-database'
      host: process.env.MT_DATALAYER_HOSTNAME //INSTANCE_UNIX_SOCKET, // e.g. '/cloudsql/project:region:instance'
    },
    // ... Specify additional properties here.
  });
};

module.exports = createUnixSocketPool;

// host : process.env.MT_DATALAYER_HOSTNAME,
// port : process.env.MT_DATALAYER_PORT,
// user : process.env.MT_DATALAYER_USERNAME,
// password : process.env.MT_DATALAYER_PASSWORD,
// database : process.env.MT_DATALAYER_DATABASE