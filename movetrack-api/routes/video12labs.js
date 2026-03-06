const express = require('express');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const sharp = require('sharp');
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

  // ── Step 2: Analyze via Gemini (inline base64) ───────────────────────────────
  const plan = (resolveEffectivePlan(req) || 'basic').toLowerCase();

  let rawText, items, parseError;
  try {
    ({ rawText, items, parseError } = await videoScanService.analyzeVideo(
      req.file.buffer,
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

    // Write the in-memory video buffer to a temp file for ffmpeg.
    // Signed URLs with query params (&, ?) break ffmpeg's input parsing.
    try {
      const ext = path.extname(req.file.originalname).toLowerCase() || '.mp4';
      tmpVideoPath = path.join(os.tmpdir(), `mtscan-${scanId}${ext}`);
      await fs.promises.writeFile(tmpVideoPath, req.file.buffer);
      videoSource = tmpVideoPath;
      thumbnailDebug.videoSourceType = 'temp_file_from_buffer';
    } catch (writeErr) {
      thumbnailDebug.errors.push(`temp file write failed: ${writeErr.message}`);
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

            // Crop to bounding box if available, otherwise use full frame
            let finalBuffer = frameBuffer;
            const bbox = item.bbox;
            if (bbox && typeof bbox.x === 'number' && typeof bbox.y === 'number'
                && typeof bbox.w === 'number' && typeof bbox.h === 'number') {
              try {
                const meta = await sharp(frameBuffer).metadata();
                const fw = meta.width;
                const fh = meta.height;
                const left = Math.max(0, Math.round(bbox.x * fw));
                const top = Math.max(0, Math.round(bbox.y * fh));
                const width = Math.min(fw - left, Math.round(bbox.w * fw));
                const height = Math.min(fh - top, Math.round(bbox.h * fh));
                if (width > 10 && height > 10) {
                  finalBuffer = await sharp(frameBuffer)
                    .extract({ left, top, width, height })
                    .jpeg({ quality: 85 })
                    .toBuffer();
                  console.log(`[videoScan] Cropped item[${idx}] to ${width}x${height}`);
                }
              } catch (cropErr) {
                console.warn(`[videoScan] Crop failed for item[${idx}], using full frame:`, cropErr.message);
              }
            }

            const thumbPath = `users/${userId}/room-scans/${scanId}/thumbnails/${idx}-t${ts}.jpg`;
            const { gcsPath: thumbGcsPath } = await gcs.uploadBuffer(finalBuffer, thumbPath, 'image/jpeg');
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
