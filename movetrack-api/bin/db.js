const pgp = require('pg-promise')();

const user = process.env.MT_DATALAYER_USERNAME;
const passwd = process.env.MT_DATALAYER_PASSWORD;
const hostname = process.env.MT_DATALAYER_HOSTNAME;
const port = process.env.MT_DATALAYER_PORT;
const database = process.env.MT_DATALAYER_DATABASE;

// Check if we're using Cloud SQL Unix socket (production)
let connectionString;
if (hostname && hostname.startsWith('/cloudsql/')) {
    // Unix socket connection for Cloud Run
    connectionString = {
        host: hostname,
        port: port,
        database: database,
        user: user,
        password: passwd
    };
} else {
    // TCP connection for local development
    connectionString = `postgres://${user}:${passwd}@${hostname}:${port}/${database}`;
}
    
const db = pgp(connectionString);

exports.db = db;