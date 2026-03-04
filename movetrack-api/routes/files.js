const express = require('express');
var router = express.Router();
const { Storage } = require('@google-cloud/storage');
const multer = require('multer');
const path = require('path');
const crypto = require('crypto');
const { authenticate, resolveEffectivePlan } = require('../bin/authService');
const knex = require('knex')({
  client: 'pg',
  connection: {
    host: process.env.MT_DATALAYER_HOSTNAME,
    port: process.env.MT_DATALAYER_PORT,
    user: process.env.MT_DATALAYER_USERNAME,
    password: process.env.MT_DATALAYER_PASSWORD,
    database: process.env.MT_DATALAYER_DATABASE
  }
});

const isLocalEnvironment = process.env.NODE_ENV !== 'production'; // Detect local development environment

const storageOptions = {
  projectId: 'widowmaker-477505',
};

if (isLocalEnvironment) {
  const localKeyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS
    || path.join(__dirname, '../devkeys/service-account.json');
  storageOptions.keyFilename = localKeyPath;
}

const storage = new Storage(storageOptions);

// Set up Google Cloud Storage client
// const storage = new Storage({
//   keyFilename: path.join(__dirname, '../devkeys/service-account.json'),
//   projectId: 'widowmaker-477505'
// });

// Set up Multer for handling file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 20 * 1024 * 1024, // 5MB limit
  },
});

router.use(authenticate);

// Middleware to handle CORS
// app.use((req, res, next) => {
//   res.setHeader('Access-Control-Allow-Origin', '*');
//   res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
//   res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
//   next();
// });

// Helper function to generate unique filename
function generateUniqueFilename(originalName, mimetype) {
  const timestamp = Date.now();
  const randomHash = crypto.randomBytes(8).toString('hex');
  const ext = mimetype.split('/')[1] || 'jpg';
  // Sanitize original name (remove extension and special chars)
  const safeName = originalName
    .replace(/\.[^/.]+$/, '')
    .replace(/[^a-zA-Z0-9]/g, '_')
    .substring(0, 50);
  return `${timestamp}_${randomHash}_${safeName}.${ext}`;
}

// Route to upload a file to a Google Cloud Storage bucket
// THI IS USED BY THE APPLICATION TO UPLOAD A FILE TO THE BUCKET
router.post('/upload/:bucket', upload.single('file'), async (req, res) => {
  const { bucket } = req.params;

  // In local development, store images as base64 data URLs instead of uploading to GCS
  if (isLocalEnvironment) {
    try {
      // Read the file buffer and convert to base64 data URL
      const base64Data = req.file.buffer.toString('base64');
      const dataUrl = `data:${req.file.mimetype};base64,${base64Data}`;

      console.log(`[LOCAL DEV] Image stored as data URL (${Math.round(base64Data.length / 1024)}KB)`);

      // Return the data URL as if it were a public URL
      res.status(200).json({ url: dataUrl });
      return;
    } catch (error) {
      console.error('Error processing file in local dev:', error);
      res.status(500).send('Internal server error.');
      return;
    }
  }

  // Production: Upload to GCS with unique filename
  const bucketInstance = storage.bucket(bucket);

  // Generate unique filename to prevent overwrites
  const folder = req.query.folder || 'uploads';
  const uniqueFilename = generateUniqueFilename(
    req.file.originalname || 'image',
    req.file.mimetype
  );
  const fileName = `${folder}/${uniqueFilename}`;
  const file = bucketInstance.file(fileName);

  try {
    const blobStream = file.createWriteStream({
      metadata: {
        contentType: req.file.mimetype,
        metadata: {
          originalName: req.file.originalname,
          uploadedAt: new Date().toISOString(),
        }
      },
      resumable: false
    });
    blobStream.on('error', (error) => {
      console.error('Error uploading file:', error);
      res.status(500).send('Internal server error.');
    });
    blobStream.on('finish', async () => {
      const publicUrl = `https://storage.googleapis.com/${bucket}/${file.name}`;
      console.log(`[GCS] Uploaded: ${file.name} (${Math.round(req.file.size / 1024)}KB)`);

      // Track upload in database for GDPR compliance and cleanup
      try {
        await knex('image_uploads').insert({
          user_id: req.user?.user_id || null,
          image_url: publicUrl,
          gcs_bucket: bucket,
          gcs_path: file.name,
          file_size: req.file.size,
          mime_type: req.file.mimetype,
          uploaded_at: new Date(),
          is_orphaned: true, // Will be set to false when linked to an item
        });
        console.log(`[DB] Tracked upload: ${publicUrl}`);
      } catch (dbError) {
        console.error('[DB] Failed to track upload (non-critical):', dbError);
        // Don't fail the upload if tracking fails
      }

      res.status(200).json({
        url: publicUrl,
        fileName: file.name,
        bucket: bucket,
        size: req.file.size
      });
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
