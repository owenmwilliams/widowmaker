const express = require('express');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const gcs = require('../bin/gcsService');
const videoScanService = require('../bin/videoScanService');
const { extractSharpestFrame } = require('../bin/frameExtractor');
const { authenticate, resolveEffectivePlan } = require('../bin/authService');

const router = express.Router();

// 500MB limit for video uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 500 * 1024 * 1024 }
});

// Pro-or-admin guard — video scanning requires a pro plan
function ensureProOrAdmin(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ success: false, error: 'Not authenticated' });
  }
  const plan = req.user.plan || 'basic';
  if (req.user.is_admin || plan === 'pro') return next();
  return res.status(403).json({ success: false, error: 'Pro plan required for video scanning' });
}

// ─── GET /debug/ffmpeg ────────────────────────────────────────────────────────
// Placed before auth middleware so it can be hit without a token.
router.get('/debug/ffmpeg', async (req, res) => {
  const diag = { ffmpegPath: null, ffmpegExists: false, sharpOk: false, env: process.env.NODE_ENV };
  try {
    const ffmpegPath = require('ffmpeg-static');
    diag.ffmpegPath = ffmpegPath;
    diag.ffmpegExists = require('fs').existsSync(ffmpegPath);

    const sharp = require('sharp');
    const buf = await sharp({ create: { width: 4, height: 4, channels: 3, background: 'red' } }).jpeg().toBuffer();
    diag.sharpOk = buf.length > 0;
    diag.sharpBufferSize = buf.length;
  } catch (err) {
    diag.error = err.message;
  }
  res.json(diag);
});

router.use(authenticate);
router.use(ensureProOrAdmin);

// ─── POST /upload ─────────────────────────────────────────────────────────────
// Single request: upload video to GCS → analyze via Gemini → extract thumbnails.
// Replaces the old session-based flow (create session → upload → poll → analyze).
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
    await gcs.uploadBuffer(req.file.buffer, videoGcsPath, req.file.mimetype);
    console.log(`[videoScan] GCS upload OK: ${videoGcsPath} (${req.file.buffer.length} bytes)`);
  } catch (err) {
    console.error('[videoScan] GCS upload failed:', err?.message);
    return res.status(500).json({ success: false, error: `Video upload failed: ${err?.message}` });
  }

  // ── Step 2: Analyze via Gemini using gs:// URI ──────────────────────────────
  const plan = (resolveEffectivePlan(req) || 'basic').toLowerCase();
  const gcsUri = `gs://${gcs.BUCKET}/${videoGcsPath}`;

  let rawText, items, parseError;
  try {
    ({ rawText, items, parseError } = await videoScanService.analyzeVideoFromGcs(
      gcsUri,
      req.file.mimetype,
      plan
    ));
  } catch (err) {
    console.error('[videoScan] Gemini analysis failed:', err?.message);
    return res.status(500).json({ success: false, error: err?.message || 'Video analysis failed' });
  }

  // ── Step 3: Thumbnail extraction ────────────────────────────────────────────
  const thumbnailDebug = {
    attempted: false,
    skippedReason: null,
    totalItems: items.length,
    successCount: 0,
    errors: []
  };

  if (gcs.isLocalEnvironment) {
    thumbnailDebug.skippedReason = 'local environment';
  } else if (items.length === 0) {
    thumbnailDebug.skippedReason = 'no items detected';
  }

  if (!thumbnailDebug.skippedReason && items.length > 0) {
    thumbnailDebug.attempted = true;
    console.log(`[videoScan] Extracting thumbnails for ${items.length} items`);

    const fs = require('fs');
    const os = require('os');
    const path = require('path');
    let videoSource = null;
    let tmpVideoPath = null;

    // Get a video source for ffmpeg: signed URL if possible, else download to temp file
    try {
      videoSource = await gcs.signUrl(videoGcsPath);
      thumbnailDebug.videoSourceType = 'signed_url';
    } catch (signErr) {
      console.warn(`[videoScan] signUrl failed, downloading to temp file: ${signErr.message}`);
      try {
        tmpVideoPath = path.join(os.tmpdir(), `mtscan-${scanId}.mp4`);
        const [buffer] = await gcs.storage.bucket(gcs.BUCKET).file(videoGcsPath).download();
        await fs.promises.writeFile(tmpVideoPath, buffer);
        videoSource = tmpVideoPath;
        thumbnailDebug.videoSourceType = 'temp_file';
      } catch (dlErr) {
        thumbnailDebug.errors.push(`video download failed: ${dlErr.message}`);
      }
    }

    if (videoSource) {
      try {
        const thumbnailPromises = items.map(async (item, idx) => {
          const ts = item.timestamp_seconds;
          if (typeof ts !== 'number') {
            thumbnailDebug.errors.push(`item[${idx}]: no timestamp_seconds`);
            return item;
          }
          try {
            const frameBuffer = await extractSharpestFrame(videoSource, ts);
            if (!frameBuffer) {
              thumbnailDebug.errors.push(`item[${idx}] t=${ts}s: ffmpeg returned no frames`);
              return item;
            }
            const thumbPath = `users/${userId}/room-scans/${scanId}/thumbnails/${idx}-t${ts}.jpg`;
            const { gcsPath: thumbGcsPath } = await gcs.uploadBuffer(frameBuffer, thumbPath, 'image/jpeg');
            item.thumbnailUrl = thumbGcsPath
              ? `https://storage.googleapis.com/${gcs.BUCKET}/${thumbGcsPath}`
              : null;
            if (item.thumbnailUrl) thumbnailDebug.successCount++;
          } catch (itemErr) {
            thumbnailDebug.errors.push(`item[${idx}] t=${ts}s: ${itemErr.message}`);
          }
          return item;
        });

        items = await Promise.all(thumbnailPromises);
        console.log(`[videoScan] Thumbnails: ${thumbnailDebug.successCount}/${items.length} succeeded`);
      } catch (err) {
        thumbnailDebug.errors.push(`top-level: ${err.message}`);
      }
    }

    if (tmpVideoPath) {
      require('fs').promises.unlink(tmpVideoPath).catch(() => {});
    }
  }

  // ── Step 4: Video signed URL for the review screen ──────────────────────────
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
    thumbnail_debug: thumbnailDebug
  });
});

// ─── GET /prompt ──────────────────────────────────────────────────────────────
router.get('/prompt', (req, res) => {
  res.json({ prompt: videoScanService.INVENTORY_PROMPT });
});

module.exports = router;
