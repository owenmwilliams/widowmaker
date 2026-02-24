const express = require('express');
const multer = require('multer');
const bodyParser = require('body-parser');
const { v4: uuidv4 } = require('uuid');
const visionService = require('../bin/visionService');

const router = express.Router();
const jsonParser = bodyParser.json({ limit: '25mb' });
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 } // 15MB max frame
});

// In-memory storage for sessions/items (admin sandbox only)
const sessions = new Map();
const TRACK_MEMORY_MS = 15000;
const MIN_CONFIDENCE = 0.4;
const MIN_FRAME_INTERVAL_MS = 2200;

function ensureAdmin(req, res, next) {
  if (!req.user || !req.user.is_admin) {
    return res.status(403).json({ success: false, error: 'Admins only' });
  }
  next();
}

router.use(ensureAdmin);

router.get('/prompt', (req, res) => {
  res.json({ prompt: visionService.MULTI_ITEM_VISION_PROMPT });
});

router.post('/sessions', (req, res) => {
  const id = uuidv4();
  const userId = req.user?.user_id || 'dev-user';
  const createdAt = new Date().toISOString();
  const prompt =
    typeof req.body?.prompt === 'string' && req.body.prompt.trim()
      ? req.body.prompt.trim()
      : visionService.MULTI_ITEM_VISION_PROMPT;
  sessions.set(id, {
    id,
    userId,
    status: 'active',
    createdAt,
    prompt,
    items: [],
    savedRuns: []
  });
  res.json({ session_id: id, created_at: createdAt, prompt });
});

router.post('/sessions/:id/end', (req, res) => {
  const session = sessions.get(req.params.id);
  if (!session) {
    return res.status(404).json({ success: false, error: 'Session not found' });
  }
  session.status = 'ended';
  session.endedAt = new Date().toISOString();
  res.json({ success: true, ended_at: session.endedAt });
});

router.patch('/sessions/:id/prompt', (req, res) => {
  const session = sessions.get(req.params.id);
  if (!session) {
    return res.status(404).json({ success: false, error: 'Session not found' });
  }
  if (session.status !== 'active') {
    return res.status(400).json({ success: false, error: 'Session already ended' });
  }
  const nextPrompt =
    typeof req.body?.prompt === 'string' && req.body.prompt.trim()
      ? req.body.prompt.trim()
      : null;
  if (!nextPrompt) {
    return res.status(400).json({ success: false, error: 'Prompt is required' });
  }
  session.prompt = nextPrompt;
  res.json({ success: true, prompt: session.prompt });
});

router.post('/sessions/:id/frame', upload.single('frame'), async (req, res) => {
  const session = sessions.get(req.params.id);
  if (!session) {
    return res.status(404).json({ success: false, error: 'Session not found' });
  }
  if (session.status !== 'active') {
    return res.status(400).json({ success: false, error: 'Session already ended' });
  }
  if (!req.file) {
    return res.status(400).json({ success: false, error: 'Frame file is required' });
  }

  try {
    const detection = await processFrame(session, req.file);
    res.json({
      success: true,
      detection
    });
  } catch (error) {
    console.error('[VisionLabVideo] Frame processing error:', error?.message || error);
    res.status(500).json({ success: false, error: error?.message || 'Detector error' });
  }
});

router.get('/sessions/:id/items', (req, res) => {
  const session = sessions.get(req.params.id);
  if (!session) {
    return res.status(404).json({ success: false, error: 'Session not found' });
  }
  res.json({ items: session.items || [] });
});

router.post('/sessions/:id/save-items', jsonParser, (req, res) => {
  const session = sessions.get(req.params.id);
  if (!session) {
    return res.status(404).json({ success: false, error: 'Session not found' });
  }
  const items = Array.isArray(req.body?.items) ? req.body.items : [];
  const prompt = typeof req.body?.prompt === 'string' ? req.body.prompt : session.prompt;
  session.savedRuns = session.savedRuns || [];
  session.savedRuns.push({
    id: uuidv4(),
    prompt,
    items,
    savedAt: new Date().toISOString()
  });
  res.json({ success: true, saved_count: items.length });
});

router.post('/sessions/:id/sam-refine', jsonParser, async (req, res) => {
  const session = sessions.get(req.params.id);
  if (!session) {
    return res.status(404).json({ success: false, error: 'Session not found' });
  }
  const { frameId, image, detections } = req.body || {};
  if (!frameId || !image || !Array.isArray(detections)) {
    return res.status(400).json({ success: false, error: 'frameId, image, and detections are required' });
  }
  try {
    const refined = await visionService.refineDetectionsWithSAM(image, detections);
    res.json({ success: true, detections: refined });
  } catch (error) {
    console.error('[VisionLabVideo] SAM refine error', error);
    res.status(500).json({ success: false, error: error?.message || 'SAM refinement failed' });
  }
});

module.exports = router;

async function processFrame(session, file) {
  try {
    const now = Date.now();
    if (session.lastProcessedAt && now - session.lastProcessedAt < MIN_FRAME_INTERVAL_MS) {
      return { skipped: true, reason: 'throttled' };
    }
    session.lastProcessedAt = now;
    const base64 = file.buffer.toString('base64');
    const mimeType = file.mimetype;
    const detection = await visionService.analyzeMultiItemPhoto(base64, mimeType, 'together', {
      prompt: session.prompt
    });
    const timestamp = Date.now();
    console.log('[VisionLabVideo] Detector result summary:', {
      sessionId: session.id,
      itemCount: Array.isArray(detection?.items) ? detection.items.length : 'n/a'
    });
    console.log('[VisionLabVideo] Detector raw payload:', JSON.stringify(detection, null, 2));

    if (Array.isArray(detection?.items)) {
      detection.items.forEach((raw) => {
        const confidence = Number(raw.confidence || 0);
        if (confidence < MIN_CONFIDENCE) return;
        const normalized = normalizeDetection(raw);
        const trackId = assignTrack(session, normalized);
        const snapshotUrl = `data:${mimeType};base64,${base64}`;

        const existing = session.items.find((item) => item.track_id === trackId);
        if (!existing) {
          session.items.unshift({
            id: uuidv4(),
            session_id: session.id,
            track_id: trackId,
            label: normalized.label,
            description: normalized.reasoning,
            status: 'ready',
            confidence,
            snapshot_url: snapshotUrl,
            raw_detection: raw,
            created_at: new Date(timestamp).toISOString(),
            updated_at: new Date(timestamp).toISOString()
          });
        } else if (confidence > Number(existing.confidence || 0)) {
          existing.label = normalized.label;
          existing.description = normalized.reasoning;
          existing.snapshot_url = snapshotUrl;
          existing.confidence = confidence;
          existing.raw_detection = raw;
          existing.updated_at = new Date(timestamp).toISOString();
        }
      });

      cleanupTracks(session, timestamp);
    }

    return detection;
  } catch (error) {
    console.error('[VisionLabVideo] Failed to process frame', error);
    throw error;
  }
}

function normalizeDetection(raw) {
  return {
    label: raw.name || raw.label || 'Item',
    reasoning: raw.reasoning || 'Detected item from video frame',
    bbox: raw.boundingBox || raw.bbox || null,
    confidence: Number(raw.confidence || 0)
  };
}

function assignTrack(session, detection) {
  if (!session.tracks) {
    session.tracks = [];
  }

  const now = Date.now();
  let bestMatch = null;
  let bestIou = 0;

  if (detection.bbox) {
    for (const track of session.tracks) {
      const iouScore = iou(track.bbox, detection.bbox);
      if (iouScore > 0.45 && iouScore > bestIou) {
        bestMatch = track;
        bestIou = iouScore;
      }
    }
  }

  if (bestMatch) {
    bestMatch.bbox = detection.bbox || bestMatch.bbox;
    bestMatch.updatedAt = now;
    return bestMatch.id;
  }

  const id = uuidv4();
  session.tracks.push({
    id,
    bbox: detection.bbox || null,
    updatedAt: now
  });
  return id;
}

function cleanupTracks(session, now) {
  if (!session.tracks) return;
  session.tracks = session.tracks.filter((track) => now - track.updatedAt <= TRACK_MEMORY_MS);
}

function iou(a, b) {
  if (!a || !b) return 0;
  const ax1 = a.x;
  const ay1 = a.y;
  const ax2 = a.x + a.width;
  const ay2 = a.y + a.height;
  const bx1 = b.x;
  const by1 = b.y;
  const bx2 = b.x + b.width;
  const by2 = b.y + b.height;

  const interX1 = Math.max(ax1, bx1);
  const interY1 = Math.max(ay1, by1);
  const interX2 = Math.min(ax2, bx2);
  const interY2 = Math.min(ay2, by2);

  const interArea = Math.max(0, interX2 - interX1) * Math.max(0, interY2 - interY1);
  if (interArea <= 0) return 0;

  const areaA = (ax2 - ax1) * (ay2 - ay1);
  const areaB = (bx2 - bx1) * (by2 - by1);
  if (areaA <= 0 || areaB <= 0) return 0;

  return interArea / (areaA + areaB - interArea);
}
