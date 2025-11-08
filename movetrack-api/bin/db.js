const pgp = require('pg-promise')();

const user = process.env.MT_DATALAYER_USERNAME;
const passwd = process.env.MT_DATALAYER_PASSWORD;
const hostname = process.env.MT_DATALAYER_HOSTNAME;
const port = process.env.MT_DATALAYER_PORT;
const database = process.env.MT_DATALAYER_DATABASE;
    
const db = pgp(`postgres://${user}:${passwd}@${hostname}:${port}/${database}`);

exports.db = db;