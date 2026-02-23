const express = require('express');
const multer = require('multer');
const bodyParser = require('body-parser');
const { v4: uuidv4 } = require('uuid');
const twelveLabsService = require('../bin/twelveLabsService');

const router = express.Router();
const jsonParser = bodyParser.json({ limit: '5mb' });

// 500MB limit — TL supports up to 2GB but keep practical for sandbox
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 500 * 1024 * 1024 }
});

// Dev-only guard
const requireDev = (req, res, next) => {
  if (process.env.NODE_ENV !== 'development') {
    return res.status(404).json({
      success: false,
      error: 'This endpoint is only available in development mode.'
    });
  }
  next();
};

router.use(requireDev);

// In-memory session store (dev sandbox only)
const sessions = new Map();

// ─── POST /sessions ───────────────────────────────────────────────────────────
// Create a new analysis session.
router.post('/sessions', (req, res) => {
  const id = uuidv4();
  sessions.set(id, {
    id,
    status: 'created',     // created → uploading → indexing → ready → analyzing → done | failed
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
    error: null
  });
  res.json({ success: true, session_id: id });
});

// ─── GET /sessions/:id ────────────────────────────────────────────────────────
// Get full session state.
router.get('/sessions/:id', (req, res) => {
  const session = sessions.get(req.params.id);
  if (!session) {
    return res.status(404).json({ success: false, error: 'Session not found' });
  }
  res.json({ success: true, session });
});

// ─── POST /sessions/:id/upload ────────────────────────────────────────────────
// Upload a video file to Twelve Labs for indexing.
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

  try {
    const { taskId, indexId } = await twelveLabsService.uploadVideo(
      req.file.buffer,
      req.file.mimetype,
      req.file.originalname
    );
    session.taskId = taskId;
    session.indexId = indexId;
    session.status = 'indexing';
    session.uploadedAt = new Date().toISOString();

    res.json({
      success: true,
      task_id: taskId,
      index_id: indexId,
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
// Poll Twelve Labs indexing task status. Frontend polls this until status is 'ready'.
router.get('/sessions/:id/status', async (req, res) => {
  const session = sessions.get(req.params.id);
  if (!session) {
    return res.status(404).json({ success: false, error: 'Session not found' });
  }

  // If already past indexing, return current session status
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
      // pending, indexing, validating, etc.
      session.status = 'indexing';
    }

    res.json({ success: true, status: session.status, video_id: session.videoId });
  } catch (err) {
    console.error('[video12labs] Status poll error:', err?.message || err);
    res.status(500).json({ success: false, error: err?.message || 'Status check failed' });
  }
});

// ─── POST /sessions/:id/analyze ──────────────────────────────────────────────
// Run Pegasus analysis on the indexed video to extract a household inventory.
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
    const { rawText, items, parseError } = await twelveLabsService.analyzeVideo(
      session.videoId,
      customPrompt
    );

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
      parse_error: parseError || null
    });
  } catch (err) {
    console.error('[video12labs] Analyze error:', err?.message || err);
    session.status = 'ready'; // Reset to ready so user can retry
    session.error = err?.message || 'Analysis failed';
    res.status(500).json({ success: false, error: session.error });
  }
});

// ─── GET /prompt ──────────────────────────────────────────────────────────────
// Return the default inventory prompt so the frontend can pre-fill the textarea.
router.get('/prompt', (req, res) => {
  res.json({ prompt: twelveLabsService.INVENTORY_PROMPT });
});

module.exports = router;
