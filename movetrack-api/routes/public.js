var express = require('express');
var router = express.Router();
var bodyParser = require('body-parser');
var conn = require('../services/infra/db');

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
  // Get key from environment variable
  const encryptionKey = process.env.URL_ENCRYPTION_KEY;

  // Get the encrypted data and the initialization vector
  const encrypted = req.query.encrypted;
  const iv = req.query.iv;

  console.log('encrypted', encrypted)
  console.log('iv', iv)

  // const inputDecoder = new TextDecoder();
  // Convert the encrypted data to an ArrayBuffer
  const encryptedBuffer = Buffer.from(encrypted, 'base64');
  const encryptedArrayBuffer = encryptedBuffer.buffer.slice(encryptedBuffer.byteOffset, encryptedBuffer.byteOffset + encryptedBuffer.byteLength);

  console.log('encryptedArrayBuffer', encryptedArrayBuffer)

  // const ivDecoder = new TextDecoder();
  // Convert base64 to Buffer
  const ivBuffer = Buffer.from(iv, 'base64');

  // Convert Buffer to Uint8Array
  const ivArray = new Uint8Array(ivBuffer);

  console.log('ivArray', ivArray);

  // Convert the key to an ArrayBuffer
  const keyEncoder = new TextEncoder();
  const keyArrayBuffer = keyEncoder.encode(encryptionKey);

  // Import the key
  const importedKey = await crypto.subtle.importKey(
      "raw",
      keyArrayBuffer,
      { name: "AES-GCM" },
      true,
      ["encrypt", "decrypt"]
    );

  // Decrypt the data using AES-GCM
  const decryptedData = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: ivArray },
    importedKey,
    encryptedArrayBuffer
  );

  // Convert the decrypted data to a string
  const decoder = new TextDecoder();
  const decrypted = decoder.decode(decryptedData);

  console.log('decrypted', decrypted)

  var item_id = decrypted.split('/')[0]
  var user_id = decrypted.split('/')[1]

  console.log('item_id', item_id)
  console.log('user_id', user_id)

  try {
    await knex
      .select({
        name: 'items.name',
        description: 'items.description',
        picture_url: 'items.picture_url'
      })
      .from('items')
      .leftJoin('collections', 'items.collection_id', 'collections.id')
      .leftJoin('containers', 'items.container_id', 'containers.id')
      .leftJoin('locations', 'items.location_id', 'locations.id')
      .where(knex.raw('items.id = ?', item_id))
      .andWhere(knex.raw('items.user_id = ?', user_id))
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

// Route to upload a file to a Google Cloud Storage bucket
// THIS IS USED BY WEB3 TO STORE METADATA

// router.post('/upload/:bucket', upload.single('file'), async (req, res) => {
//   const { bucket } = req.params;
//   const bucketInstance = storage.bucket(bucket);
//   const fileName = req.query.folder + '/' + req.query.name;
//   const file = bucketInstance.file(fileName);

//   // file.name = req.folder.concat(req.file.originalname)
//   try {
//     const blobStream = file.createWriteStream();
//     blobStream.on('error', (error) => {
//       console.error('Error uploading file:', error);
//       res.status(500).send('Internal server error.');
//     });
//     blobStream.on('finish', () => {
//       const publicUrl = `https://storage.googleapis.com/${bucket}/${file.name}`;
//       res.status(200).json({ url: publicUrl });
//     });
//     blobStream.end(req.file.buffer);
//   } catch (error) {
//     console.error('Error uploading file:', error);
//     res.status(500).send('Internal server error.');
//   }
// });

module.exports = router;
