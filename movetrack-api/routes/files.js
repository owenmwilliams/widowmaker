const express = require('express');
var router = express.Router();
const { Storage } = require('@google-cloud/storage');
const multer = require('multer');
const path = require('path');

const isLocalEnvironment = process.env.NODE_ENV !== 'production'; // Detect local development environment

const storageOptions = {
  projectId: 'take-stock-364901',
};

if (isLocalEnvironment) {
  storageOptions.keyFilename = path.join(__dirname, '../devkeys/take-stock-364901-c11c49339bff.json');
}

const storage = new Storage(storageOptions);

// Set up Google Cloud Storage client
// const storage = new Storage({
//   keyFilename: path.join(__dirname, '../devkeys/take-stock-364901-c11c49339bff.json'),
//   projectId: 'take-stock-364901'
// });

// Set up Multer for handling file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 20 * 1024 * 1024, // 5MB limit
  },
});

// Middleware to handle CORS
// app.use((req, res, next) => {
//   res.setHeader('Access-Control-Allow-Origin', '*');
//   res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
//   res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
//   next();
// });

// Route to upload a file to a Google Cloud Storage bucket
// THI IS USED BY THE APPLICATION TO UPLOAD A FILE TO THE BUCKET
router.post('/upload/:bucket', upload.single('file'), async (req, res) => {
  const { bucket } = req.params;
  const bucketInstance = storage.bucket(bucket);
  const fileName = req.query.folder + '/' + req.query.name;
  const file = bucketInstance.file(fileName);

  // file.name = req.folder.concat(req.file.originalname)
  try {
    const blobStream = file.createWriteStream();
    blobStream.on('error', (error) => {
      console.error('Error uploading file:', error);
      res.status(500).send('Internal server error.');
    });
    blobStream.on('finish', () => {
      const publicUrl = `https://storage.googleapis.com/${bucket}/${file.name}`;
      res.status(200).json({ url: publicUrl });
    });
    blobStream.end(req.file.buffer);
  } catch (error) {
    console.error('Error uploading file:', error);
    res.status(500).send('Internal server error.');
  }
});

// Route to retrieve a file from a Google Cloud Storage bucket
router.get('/get/:bucket/:filename', async (req, res) => {
  const { bucket, filename } = req.params;
  const bucketInstance = storage.bucket(bucket);
  const file = bucketInstance.file(filename);

  try {
    const [exists] = await file.exists();
    if (!exists) {
      return res.status(404).send('File not found.');
    }

    const readStream = file.createReadStream();
    readStream.pipe(res);
  } catch (error) {
    console.error('Error retrieving file:', error);
    res.status(500).send('Internal server error.');
  }
});

// router.listen(port, () => {
//   console.log(`Server listening on port ${port}`);
// });

// Route to delete a file from a Google Cloud Storage bucket
router.delete('/delete/:bucket/:filename', async (req, res) => {
  const { bucket, filename } = req.params;

  console.log(bucket)
  console.log(filename)

  const bucketInstance = storage.bucket(bucket);
  const file = bucketInstance.file(filename);

  try {
    const [exists] = await file.exists();
    if (!exists) {
      return res.status(404).send('File not found.');
    }

    await file.delete();
    res.status(200).send('File deleted successfully.');
  } catch (error) {
    console.error('Error deleting file:', error);
    res.status(500).send('Internal server error.');
  }
});

// Route to create a new bucket
router.post('/create/:bucket', async (req, res) => {
  const { bucket } = req.params;
  const bucketInstance = storage.bucket(bucket);

  console.log('trying something: ', storage)

  try {
    const [exists] = await bucketInstance.exists();
    if (exists) {
      return res.status(409).send('Bucket already exists.');
    }

    await storage.createBucket(bucket);
    res.status(200).send('Bucket created successfully.');
  } catch (error) {
    console.error('Error creating bucket:', error);
    res.status(500).send('Internal server error.');
  }
});

module.exports = router;