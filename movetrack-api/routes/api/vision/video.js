const express = require('express');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const gcs = require('../../../services/infra/gcsService');
const videoService = require('../../../services/infra/vision/videoService');
const { extractThumbnails, getInfraDiagnostics } = require('../../../services/infra/vision/frameExtractor');
const { authenticate, resolveEffectivePlan } = require('../../../services/infra/authService');
const { ensureProOrAdmin } = require('../../../services/workflow/userService');

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 500 * 1024 * 1024 },
});

// ─── GET /debug/ffmpeg ────────────────────────────────────────────────────────
// Diagnostic endpoint — no auth required.
router.get('/debug/ffmpeg', async (req, res) => {
  const diag = await getInfraDiagnostics();
  res.json(diag);
});

router.use(authenticate);
router.use(ensureProOrAdmin);

// ─── POST /upload ─────────────────────────────────────────────────────────────
// Upload video → Gemini analysis → thumbnail extraction → signed URL.
router.post('/upload', upload.single('video'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, error: 'A video file is required (field name: "video")' });
  }
  if (!req.file.mimetype.startsWith('video/')) {
    return res.status(400).json({ success: false, error: 'File must be a video' });
  }

  const scanId = uuidv4();
  const userId = req.user?.user_id || req.user?.uid || 'unknown';
  const videoGcsPath = `users/${userId}/room-scans/${scanId}/${req.file.originalname}`;

  // ── Step 1: Upload to GCS ───────────────────────────────────────────────────
  try {
    await gcs.uploadVideoScan(req.file.buffer, userId, scanId, req.file.originalname, req.file.mimetype);
    console.log(`[videoScan] GCS upload OK: ${videoGcsPath}`);
  } catch (err) {
    console.error('[videoScan] GCS upload failed:', err?.message);
    return res.status(500).json({ success: false, error: `Video upload failed: ${err?.message}` });
  }

  // ── Step 2: Analyze via Gemini ──────────────────────────────────────────────
  const plan = (resolveEffectivePlan(req) || 'basic').toLowerCase();
  const promptOverride = typeof req.body?.prompt === 'string' && req.body.prompt.trim()
    ? req.body.prompt.trim()
    : null;

  let rawText, items, parseError;
  try {
    ({ rawText, items, parseError } = await videoService.analyzeVideo(
      req.file.buffer, req.file.mimetype, plan, promptOverride
    ));
  } catch (err) {
    console.error('[videoScan] Gemini analysis failed:', err?.message);
    return res.status(500).json({ success: false, error: err?.message || 'Video analysis failed' });
  }

  // ── Step 3: Thumbnail extraction ────────────────────────────────────────────
  const thumbnailDebug = { attempted: false, skippedReason: null, totalItems: items.length, successCount: 0, errors: [] };

  if (gcs.isLocalEnvironment) {
    thumbnailDebug.skippedReason = 'local environment';
  } else if (items.length === 0) {
    thumbnailDebug.skippedReason = 'no items detected';
  } else {
    thumbnailDebug.attempted = true;
    const fs = require('fs');
    const os = require('os');
    const path = require('path');
    let tmpVideoPath = null;
    try {
      const ext = path.extname(req.file.originalname).toLowerCase() || '.mp4';
      tmpVideoPath = path.join(os.tmpdir(), `mtscan-${scanId}${ext}`);
      await fs.promises.writeFile(tmpVideoPath, req.file.buffer);
      const result = await extractThumbnails(tmpVideoPath, items, userId, scanId, gcs);
      thumbnailDebug.successCount = result.successCount;
      thumbnailDebug.errors = result.errors;
    } catch (err) {
      thumbnailDebug.errors.push(`thumbnail extraction failed: ${err.message}`);
    } finally {
      if (tmpVideoPath) require('fs').promises.unlink(tmpVideoPath).catch(() => {});
    }
  }

  // ── Step 4: Signed URL ──────────────────────────────────────────────────────
  let videoSignedUrl = null;
  if (!gcs.isLocalEnvironment) {
    videoSignedUrl = await gcs.signUrl(videoGcsPath)
      .catch(() => `https://storage.googleapis.com/${gcs.BUCKET}/${videoGcsPath}`);
  }

  res.json({
    success: true,
    items,
    item_count: items.length,
    raw_analysis: rawText,
    parse_error: parseError || null,
    video_gcs_path: videoGcsPath,
    video_signed_url: videoSignedUrl,
    thumbnail_debug: thumbnailDebug,
  });
});

// ─── GET /prompt ──────────────────────────────────────────────────────────────
// Returns the Gemini prompt template used for video analysis.
router.get('/prompt', (req, res) => {
  res.json({ prompt: videoService.INVENTORY_PROMPT });
});

module.exports = router;
