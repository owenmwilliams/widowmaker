const express = require('express');
const router = express.Router();
const multer = require('multer');
const { authenticate } = require('../../../services/infra/authService');
const {
  storage,
  isLocalEnvironment,
  signUrl,
  publicUrlToPath,
  generateUniqueFilename,
  streamFileToResponse,
  deleteGcsFile,
} = require('../../../services/infra/gcsService');
const knex = require('../../../services/infra/knex');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

router.use(authenticate);

// ─── POST /upload/:bucket ─────────────────────────────────────────────────────
// Upload a file to a GCS bucket. Local dev returns a base64 data URL.
// Tracks the upload in image_uploads for GDPR compliance.
router.post('/upload/:bucket', upload.single('file'), async (req, res) => {
  const { bucket } = req.params;

  if (isLocalEnvironment) {
    const base64Data = req.file.buffer.toString('base64');
    return res.json({ url: `data:${req.file.mimetype};base64,${base64Data}` });
  }

  const folder = req.query.folder || 'uploads';
  const fileName = `${folder}/${generateUniqueFilename(req.file.originalname, req.file.mimetype)}`;
  const publicUrl = `https://storage.googleapis.com/${bucket}/${fileName}`;

  try {
    const file = storage.bucket(bucket).file(fileName);
    await new Promise((resolve, reject) => {
      const stream = file.createWriteStream({ metadata: { contentType: req.file.mimetype }, resumable: false });
      stream.on('error', reject);
      stream.on('finish', resolve);
      stream.end(req.file.buffer);
    });

    // Track for GDPR cleanup (non-critical)
    knex('image_uploads').insert({
      user_id: req.user?.user_id || null,
      image_url: publicUrl,
      gcs_bucket: bucket,
      gcs_path: fileName,
      file_size: req.file.size,
      mime_type: req.file.mimetype,
      uploaded_at: new Date(),
      is_orphaned: true,
    }).catch((err) => console.error('[userFiles] Failed to track upload:', err.message));

    const signedUrl = await signUrl(fileName).catch(() => publicUrl);
    res.json({ url: publicUrl, signed_url: signedUrl, fileName, bucket, size: req.file.size });
  } catch (err) {
    console.error('[userFiles] Upload failed:', err.message);
    res.status(500).send('Internal server error.');
  }
});

// ─── GET /get/:bucket/:filename ───────────────────────────────────────────────
// Stream a GCS file to the response.
router.get('/get/:bucket/:filename', async (req, res) => {
  try {
    await streamFileToResponse(req.params.bucket, req.params.filename, res);
  } catch (err) {
    console.error('[userFiles] Stream failed:', err.message);
    res.status(500).send('Internal server error.');
  }
});

// ─── DELETE /delete/:bucket/:filename ─────────────────────────────────────────
// Delete a GCS file.
router.delete('/delete/:bucket/:filename', async (req, res) => {
  try {
    await deleteGcsFile(req.params.bucket, req.params.filename);
    res.status(200).send('File deleted successfully.');
  } catch (err) {
    console.error('[userFiles] Delete failed:', err.message);
    res.status(500).send('Internal server error.');
  }
});

// ─── GET /signed-url ──────────────────────────────────────────────────────────
// Generate a short-lived signed URL for a GCS object the caller owns.
router.get('/signed-url', async (req, res) => {
  const gcsPath = req.query.path || publicUrlToPath(req.query.url);
  if (!gcsPath) return res.status(400).json({ error: 'Provide ?path= or ?url= parameter' });

  const userId = req.user?.user_id || req.user?.uid;
  if (!userId || !gcsPath.startsWith(`users/${userId}/`)) {
    return res.status(403).json({ error: 'Access denied' });
  }

  try {
    const signedUrl = await signUrl(gcsPath);
    res.json({ signed_url: signedUrl, expires_in: 3600 });
  } catch (err) {
    console.error('[userFiles] Signed URL error:', err.message);
    res.status(500).json({ error: 'Failed to generate signed URL' });
  }
});

module.exports = router;
