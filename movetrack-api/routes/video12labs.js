const express = require('express');
const multer = require('multer');
const bodyParser = require('body-parser');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { Storage } = require('@google-cloud/storage');
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

// ── GCS client (same pattern as files.js) ────────────────────────────────────
const isLocalEnvironment = process.env.NODE_ENV !== 'production';
const GCS_BUCKET = 'movetrack-item-photos';

const storageOptions = { projectId: 'widowmaker-477505' };
if (isLocalEnvironment) {
  const localKeyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS
    || path.join(__dirname, '../devkeys/service-account.json');
  storageOptions.keyFilename = localKeyPath;
}
const gcsStorage = new Storage(storageOptions);

/**
 * Upload a video buffer to GCS. Returns { url, gcsPath }.
 * In local dev, returns placeholder values without uploading.
 */
async function uploadVideoToGcs(buffer, mimeType, filename, userId, sessionId) {
  const gcsPath = `users/${userId}/room-scans/${sessionId}/${filename}`;
  const publicUrl = `https://storage.googleapis.com/${GCS_BUCKET}/${gcsPath}`;

  if (isLocalEnvironment) {
    console.log('[GCS] Local dev — skipping video upload, returning placeholder');
    return { url: publicUrl, gcsPath: null };
  }

  const file = gcsStorage.bucket(GCS_BUCKET).file(gcsPath);
  await new Promise((resolve, reject) => {
    const stream = file.createWriteStream({
      metadata: { contentType: mimeType },
      resumable: false
    });
    stream.on('error', reject);
    stream.on('finish', resolve);
    stream.end(buffer);
  });

  console.log(`[GCS] Uploaded video: ${gcsPath}`);
  return { url: publicUrl, gcsPath };
}

/**
 * Upload a JPEG frame buffer to GCS and return its public URL.
 */
async function uploadThumbnailToGcs(jpegBuffer, gcsPath) {
  const file = gcsStorage.bucket(GCS_BUCKET).file(gcsPath);
  await new Promise((resolve, reject) => {
    const stream = file.createWriteStream({
      metadata: { contentType: 'image/jpeg' },
      resumable: false
    });
    stream.on('error', reject);
    stream.on('finish', resolve);
    stream.end(jpegBuffer);
  });
  return `https://storage.googleapis.com/${GCS_BUCKET}/${gcsPath}`;
}

/**
 * Generate a short-lived signed URL for a GCS object so ffmpeg can read it.
 */
async function getSignedUrl(gcsPath) {
  const [url] = await gcsStorage
    .bucket(GCS_BUCKET)
    .file(gcsPath)
    .getSignedUrl({
      version: 'v4',
      action: 'read',
      expires: Date.now() + 60 * 60 * 1000 // 1 hour
    });
  return url;
}

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
    videoGcsUrl: null,
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

  try {
    // Upload to Twelve Labs and GCS in parallel
    const [tlResult, gcsResult] = await Promise.all([
      twelveLabsService.uploadVideo(
        req.file.buffer,
        req.file.mimetype,
        req.file.originalname
      ),
      uploadVideoToGcs(
        req.file.buffer,
        req.file.mimetype,
        req.file.originalname,
        userId,
        session.id
      ).catch((err) => {
        console.error('[video12labs] GCS upload failed (non-fatal):', err?.message);
        return { url: null, gcsPath: null };
      })
    ]);

    session.taskId = tlResult.taskId;
    session.indexId = tlResult.indexId;
    session.status = 'indexing';
    session.uploadedAt = new Date().toISOString();
    session.videoGcsUrl = gcsResult.url;
    session.videoGcsPath = gcsResult.gcsPath;
    // Store userId for use in thumbnail paths during analyze
    session._userId = userId;

    res.json({
      success: true,
      task_id: tlResult.taskId,
      index_id: tlResult.indexId,
      status: session.status,
      video_gcs_url: gcsResult.url
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
    if (!isLocalEnvironment && session.videoGcsPath && items.length > 0) {
      console.log(`[video12labs] Extracting thumbnails for ${items.length} items from ${session.videoGcsPath}`);
      try {
        const signedUrl = await getSignedUrl(session.videoGcsPath);
        const userId = session._userId || 'unknown';

        const thumbnailPromises = items.map(async (item, idx) => {
          const ts = item.timestamp_seconds;
          if (typeof ts !== 'number') return item;

          const frameBuffer = await extractSharpestFrame(signedUrl, ts);
          if (!frameBuffer) return item;

          const thumbPath = `users/${userId}/room-scans/${session.id}/thumbnails/${idx}-t${ts}.jpg`;
          item.thumbnailUrl = await uploadThumbnailToGcs(frameBuffer, thumbPath).catch((err) => {
            console.warn('[video12labs] Thumbnail upload failed:', err.message);
            return null;
          });
          return item;
        });

        items = await Promise.all(thumbnailPromises);
        console.log(`[video12labs] Thumbnails done`);
      } catch (err) {
        console.error('[video12labs] Thumbnail extraction failed (non-fatal):', err.message);
        // Items still returned, just without thumbnailUrl
      }
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
      video_gcs_url: session.videoGcsUrl || null
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
