const express = require('express');
const multer = require('multer');
const bodyParser = require('body-parser');
const { v4: uuidv4 } = require('uuid');
const gcs = require('../bin/gcsService');
const twelveLabsService = require('../bin/twelveLabsService');
const { extractSharpestFrame } = require('../bin/frameExtractor');
const { authenticate } = require('../bin/authService');

const router = express.Router();
const jsonParser = bodyParser.json({ limit: '5mb' });

// 500MB limit — TL supports up to 2GB but keep practical for sandbox
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

router.use(authenticate);
router.use(ensureProOrAdmin);

// In-memory session store
const sessions = new Map();

// ─── POST /sessions ───────────────────────────────────────────────────────────
router.post('/sessions', (req, res) => {
  const id = uuidv4();
  sessions.set(id, {
    id,
    status: 'created',
    taskId: null,
    videoId: null,
    indexId: null,
    filename: null,
    uploadedAt: null,
    readyAt: null,
    analyzedAt: null,
    items: [],
    rawAnalysis: null,
    parseError: null,
    error: null,
    videoGcsPath: null
  });
  res.json({ success: true, session_id: id });
});

// ─── GET /sessions/:id ────────────────────────────────────────────────────────
router.get('/sessions/:id', (req, res) => {
  const session = sessions.get(req.params.id);
  if (!session) {
    return res.status(404).json({ success: false, error: 'Session not found' });
  }
  res.json({ success: true, session });
});

// ─── POST /sessions/:id/upload ────────────────────────────────────────────────
// Upload a video file to Twelve Labs for indexing, and in parallel to GCS.
router.post('/sessions/:id/upload', upload.single('video'), async (req, res) => {
  const session = sessions.get(req.params.id);
  if (!session) {
    return res.status(404).json({ success: false, error: 'Session not found' });
  }
  if (!req.file) {
    return res.status(400).json({ success: false, error: 'A video file is required (field name: "video")' });
  }
  if (!req.file.mimetype.startsWith('video/')) {
    return res.status(400).json({ success: false, error: 'File must be a video' });
  }

  session.status = 'uploading';
  session.filename = req.file.originalname;

  const userId = req.user?.user_id || req.user?.uid || 'unknown';
  const videoGcsPath = `users/${userId}/room-scans/${session.id}/${req.file.originalname}`;

  try {
    // Upload to Twelve Labs and GCS in parallel
    const [tlResult, gcsResult] = await Promise.all([
      twelveLabsService.uploadVideo(
        req.file.buffer,
        req.file.mimetype,
        req.file.originalname
      ),
      gcs.uploadBuffer(req.file.buffer, videoGcsPath, req.file.mimetype)
        .catch((err) => {
          console.error('[video12labs] GCS upload failed (non-fatal):', err?.message);
          return { gcsPath: null, signedUrl: null };
        })
    ]);

    session.taskId = tlResult.taskId;
    session.indexId = tlResult.indexId;
    session.status = 'indexing';
    session.uploadedAt = new Date().toISOString();
    session.videoGcsPath = gcsResult.gcsPath;
    session._userId = userId;

    res.json({
      success: true,
      task_id: tlResult.taskId,
      index_id: tlResult.indexId,
      status: session.status
    });
  } catch (err) {
    console.error('[video12labs] Upload error:', err?.message || err);
    session.status = 'failed';
    session.error = err?.message || 'Upload failed';
    res.status(500).json({ success: false, error: session.error });
  }
});

// ─── GET /sessions/:id/status ─────────────────────────────────────────────────
router.get('/sessions/:id/status', async (req, res) => {
  const session = sessions.get(req.params.id);
  if (!session) {
    return res.status(404).json({ success: false, error: 'Session not found' });
  }

  if (!session.taskId || session.status === 'ready' || session.status === 'done' || session.status === 'failed') {
    return res.json({ success: true, status: session.status, video_id: session.videoId });
  }

  try {
    const { status, videoId } = await twelveLabsService.getTaskStatus(session.taskId);

    if (status === 'ready') {
      session.status = 'ready';
      session.videoId = videoId;
      session.readyAt = new Date().toISOString();
    } else if (status === 'failed') {
      session.status = 'failed';
      session.error = 'Twelve Labs indexing failed';
    } else {
      session.status = 'indexing';
    }

    res.json({ success: true, status: session.status, video_id: session.videoId });
  } catch (err) {
    console.error('[video12labs] Status poll error:', err?.message || err);
    res.status(500).json({ success: false, error: err?.message || 'Status check failed' });
  }
});

// ─── POST /sessions/:id/analyze ──────────────────────────────────────────────
// Run Pegasus analysis then extract per-item thumbnails from the GCS video.
router.post('/sessions/:id/analyze', jsonParser, async (req, res) => {
  const session = sessions.get(req.params.id);
  if (!session) {
    return res.status(404).json({ success: false, error: 'Session not found' });
  }
  if (session.status !== 'ready' && session.status !== 'done') {
    return res.status(400).json({
      success: false,
      error: `Video must be indexed before analysis. Current status: ${session.status}`
    });
  }
  if (!session.videoId) {
    return res.status(400).json({ success: false, error: 'No video ID available for analysis' });
  }

  session.status = 'analyzing';
  const customPrompt = typeof req.body?.prompt === 'string' && req.body.prompt.trim()
    ? req.body.prompt.trim()
    : null;

  try {
    let { rawText, items, parseError } = await twelveLabsService.analyzeVideo(
      session.videoId,
      customPrompt
    );

    // ── Per-item thumbnail extraction ─────────────────────────────────────────
    // Only in production where real GCS video exists. Uses a short-lived signed
    // URL so ffmpeg can fast-seek to each timestamp without downloading the full
    // video to disk.
    if (!gcs.isLocalEnvironment && session.videoGcsPath && items.length > 0) {
      console.log(`[video12labs] Extracting thumbnails for ${items.length} items from ${session.videoGcsPath}`);
      try {
        const videoSignedUrl = await gcs.signUrl(session.videoGcsPath);
        const userId = session._userId || 'unknown';

        const thumbnailPromises = items.map(async (item, idx) => {
          const ts = item.timestamp_seconds;
          if (typeof ts !== 'number') return item;

          const frameBuffer = await extractSharpestFrame(videoSignedUrl, ts);
          if (!frameBuffer) return item;

          const thumbPath = `users/${userId}/room-scans/${session.id}/thumbnails/${idx}-t${ts}.jpg`;
          const { signedUrl } = await gcs.uploadBuffer(frameBuffer, thumbPath, 'image/jpeg').catch((err) => {
            console.warn('[video12labs] Thumbnail upload failed:', err.message);
            return { signedUrl: null };
          });
          item.thumbnailUrl = signedUrl;
          return item;
        });

        items = await Promise.all(thumbnailPromises);
        console.log(`[video12labs] Thumbnails done`);
      } catch (err) {
        console.error('[video12labs] Thumbnail extraction failed (non-fatal):', err.message);
      }
    }

    // Generate a signed URL for the video itself (1h TTL, for the review screen)
    let videoSignedUrl = null;
    if (!gcs.isLocalEnvironment && session.videoGcsPath) {
      videoSignedUrl = await gcs.signUrl(session.videoGcsPath).catch(() => null);
    }

    session.status = 'done';
    session.items = items;
    session.rawAnalysis = rawText;
    session.parseError = parseError || null;
    session.analyzedAt = new Date().toISOString();

    res.json({
      success: true,
      items,
      item_count: items.length,
      raw_analysis: rawText,
      parse_error: parseError || null,
      video_gcs_path: session.videoGcsPath || null,
      video_signed_url: videoSignedUrl
    });
  } catch (err) {
    console.error('[video12labs] Analyze error:', err?.message || err);
    session.status = 'ready';
    session.error = err?.message || 'Analysis failed';
    res.status(500).json({ success: false, error: session.error });
  }
});

// ─── GET /prompt ──────────────────────────────────────────────────────────────
router.get('/prompt', (req, res) => {
  res.json({ prompt: twelveLabsService.INVENTORY_PROMPT });
});

module.exports = router;
