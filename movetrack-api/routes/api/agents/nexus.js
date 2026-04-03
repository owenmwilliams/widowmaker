const express = require('express');
const multer = require('multer');
const { authenticate, resolveEffectivePlan } = require('../../../services/infra/authService');
const nexusOrchestrator = require('../../agents/nexusOrchestratorAgent');
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
// Send a message to the Nexus orchestrator with SSE streaming.
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
    try {
      const result = await nexusOrchestrator.processMessage(
        userId, message || '', attachments || [], plan
      );
      return res.json(result);
    } catch (err) {
      console.error('[nexus] processMessage failed:', err);
      return res.status(500).json({ error: err.message || 'Nexus processing failed' });
    }
  }

  // SSE streaming path
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  const sendSSE = (event) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  try {
    const result = await nexusOrchestrator.processMessage(
      userId, message || '', attachments || [], plan, sendSSE
    );
    sendSSE({ type: 'done', reply: result.reply, actions: result.actions, sessionId: result.sessionId });
  } catch (err) {
    console.error('[nexus] processMessage (stream) failed:', err);
    sendSSE({ type: 'error', error: err.message || 'Nexus processing failed' });
  } finally {
    res.end();
  }
});

// ─── GET /active-session ────────────────────────────────────────────────────
router.get('/active-session', async (req, res) => {
  const userId = req.user?.user_id;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const session = await sessions.getActiveSession(userId, 'nexus');
    const quickStartChips = await census.getQuickStartChips(userId);

    if (!session) {
      return res.json({ session: null, messages: [], quickStartChips });
    }

    const messages = await sessions.getSessionMessages(session.id);
    res.json({ session, messages: enrichMessagesWithActions(messages), quickStartChips });
  } catch (err) {
    console.error('[nexus] active-session failed:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── DELETE /sessions/:id ────────────────────────────────────────────────────
router.delete('/sessions/:id', async (req, res) => {
  const userId = req.user?.user_id;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const result = await sessions.archiveSession(req.params.id, userId, 'nexus');
    if (result.rowCount === 0) return res.status(404).json({ error: 'Session not found' });
    res.json({ success: true });
  } catch (err) {
    console.error('[nexus] archive session failed:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /upload ────────────────────────────────────────────────────────────
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
    console.error('[nexus] upload failed:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
