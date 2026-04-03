const express = require('express');
const multer = require('multer');
const { authenticate, resolveEffectivePlan } = require('../../../services/infra/authService');
const censusAgentService = require('../../../agents/censusAgent');
const census = require('../../../services/inventory/censusService');
const gcs = require('../../../services/infra/gcsService');
const sessions = require('../../../services/infra/agentSessionService');
const { enrichMessagesWithActions } = require('../../../services/primitives/enrichMessages');

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 200 * 1024 * 1024 }, // 200MB for photos + videos
});

router.use(authenticate);

// ─── POST /message ───────────────────────────────────────────────────────────
// Send a message to the Census agent with SSE streaming for progress updates.
router.post('/message', express.json(), async (req, res) => {
  const userId = req.user?.user_id;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  const { message, attachments } = req.body;
  if (!message && (!attachments || attachments.length === 0)) {
    return res.status(400).json({ error: 'message or attachments required' });
  }

  const plan = (resolveEffectivePlan(req) || 'basic').toLowerCase();
  const wantsStream = req.headers.accept === 'text/event-stream';

  if (!wantsStream) {
    // Legacy non-streaming path
    try {
      const result = await censusAgentService.processMessage(
        userId, message || '', attachments || [], plan
      );
      return res.json(result);
    } catch (err) {
      console.error('[census] processMessage failed:', err);
      return res.status(500).json({ error: err.message || 'Census processing failed' });
    }
  }

  // SSE streaming path
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no', // Disable nginx buffering
  });

  const sendSSE = (event) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  try {
    const result = await censusAgentService.processMessage(
      userId, message || '', attachments || [], plan, sendSSE
    );
    // Final done event with the full result (in case client missed it from the service)
    sendSSE({ type: 'done', reply: result.reply, actions: result.actions, sessionId: result.sessionId });
  } catch (err) {
    console.error('[census] processMessage (stream) failed:', err);
    sendSSE({ type: 'error', error: err.message || 'Census processing failed' });
  } finally {
    res.end();
  }
});

// ─── GET /active-session ────────────────────────────────────────────────────
// Get the user's active session with messages (auto-resume on open).
router.get('/active-session', async (req, res) => {
  const userId = req.user?.user_id;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const session = await sessions.getActiveSession(
      userId, ['census', 'onboarding', 'general'],
      ', items_added, rooms_added'
    );

    const quickStartChips = await census.getQuickStartChips(userId);

    if (!session) {
      return res.json({ session: null, messages: [], quickStartChips, shouldAutoGreet: true });
    }

    const messages = await sessions.getSessionMessages(session.id);

    // Auto-greet if session is stale (no activity for 30+ minutes)
    const AUTO_GREET_MINUTES = 30;
    const lastActivity = new Date(session.updated_at);
    const minutesSinceActivity = (Date.now() - lastActivity.getTime()) / 60000;
    const shouldAutoGreet = minutesSinceActivity >= AUTO_GREET_MINUTES;

    res.json({ session, messages: enrichMessagesWithActions(messages), quickStartChips, shouldAutoGreet });
  } catch (err) {
    console.error('[census] active-session failed:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /sessions ───────────────────────────────────────────────────────────
// List the user's conversation sessions (kept for backward compat).
router.get('/sessions', async (req, res) => {
  const userId = req.user?.user_id;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const sessionList = await sessions.listSessions(userId);
    res.json({ sessions: sessionList });
  } catch (err) {
    console.error('[census] list sessions failed:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /sessions/:id ──────────────────────────────────────────────────────
// Get a specific session and its messages (kept for backward compat).
router.get('/sessions/:id', async (req, res) => {
  const userId = req.user?.user_id;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const session = await sessions.getSession(userId, req.params.id);
    if (!session) return res.status(404).json({ error: 'Session not found' });

    const messages = await sessions.getSessionMessages(session.id);
    res.json({ session, messages: enrichMessagesWithActions(messages) });
  } catch (err) {
    console.error('[census] get session failed:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── DELETE /sessions/:id ────────────────────────────────────────────────────
// Archive the session (soft delete) — used for "Start fresh".
router.delete('/sessions/:id', async (req, res) => {
  const userId = req.user?.user_id;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const result = await sessions.archiveSession(req.params.id, userId);
    if (result.rowCount === 0) return res.status(404).json({ error: 'Session not found' });
    res.json({ success: true });
  } catch (err) {
    console.error('[census] archive session failed:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /upload ────────────────────────────────────────────────────────────
// Upload a photo or video for use in conversation.
router.post('/upload', upload.single('file'), async (req, res) => {
  const userId = req.user?.user_id;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  try {
    const { url, mimeType, gcsPath } = await gcs.uploadAgentFile(
      userId, req.file.buffer, req.file.mimetype, req.file.originalname
    );
    res.json({ url, mimeType, gcsPath });
  } catch (err) {
    console.error('[census] upload failed:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /feedback ──────────────────────────────────────────────────────────
// Record item-level feedback for precision/hallucination tracking.
router.post('/feedback', express.json(), async (req, res) => {
  const userId = req.user?.user_id;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  const { itemId, feedback, interactionLogId } = req.body;
  if (!itemId || !feedback) return res.status(400).json({ error: 'itemId and feedback required' });
  if (!['correct', 'wrong', 'hallucinated'].includes(feedback)) {
    return res.status(400).json({ error: 'feedback must be: correct, wrong, or hallucinated' });
  }

  try {
    const metricsService = require('../../../services/infra/metricsService');
    await metricsService.logItemFeedback(itemId, userId, feedback, interactionLogId || null);
    res.json({ success: true });
  } catch (err) {
    console.error('[census] feedback failed:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
