const express = require('express');
const router = express.Router();
const multer = require('multer');
const { authenticate } = require('../../../services/infra/authService');
const {
  isLocalEnvironment,
  signUrl,
  publicUrlToPath,
  streamFileToResponse,
  deleteGcsFile,
} = require('../../../services/infra/gcsService');
const mediaAssetService = require('../../../services/infra/mediaAssetService');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

// ─── GET /local/:bucket/* ─────────────────────────────────────────────────────
// Local-dev only: stream a file from .local-storage so uploads done via
// mediaAssetService in local mode can be previewed in the UI. No auth here —
// local dev only, scoped to LOCAL_STORAGE_ROOT by the service's path resolver.
router.get('/local/:bucket/*', (req, res) => {
  if (!isLocalEnvironment) {
    return res.status(404).send('Not found');
  }
  const gcsPath = req.params[0];
  const absPath = mediaAssetService.resolveLocalPath(req.params.bucket, gcsPath);
  if (!absPath) return res.status(400).send('Invalid path');
  res.sendFile(absPath, (err) => {
    if (err && !res.headersSent) {
      res.status(404).send('File not found');
    }
  });
});

router.use(authenticate);

// ─── POST /upload/:bucket ─────────────────────────────────────────────────────
// Upload a file and create an image_uploads row. The :bucket param is kept for
// backward compatibility with existing frontend callers but all writes go
// through mediaAssetService, which decides the canonical path and storage
// backend (GCS in prod, .local-storage in dev).
router.post('/upload/:bucket', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const userId = req.user?.user_id;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const asset = await mediaAssetService.ingestUpload({
      userId,
      buffer: req.file.buffer,
      mimeType: req.file.mimetype,
      originalName: req.file.originalname,
      source: 'inventory_item',
      folderHint: req.query.folder || 'uploads',
      bucket: req.params.bucket,
      metadata: { requested_bucket: req.params.bucket },
    });

    res.json({
      url: asset.url,
      signed_url: asset.url,
      fileName: asset.gcsPath,
      bucket: asset.bucket,
      size: asset.size,
      assetId: asset.assetId,
    });
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
