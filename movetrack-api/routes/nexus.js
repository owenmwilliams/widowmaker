const express = require('express');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const { authenticate, resolveEffectivePlan } = require('../services/infra/authService');
const nexusOrchestrator = require('../agents/nexusOrchestratorAgent');
const census = require('../services/inventory/censusService');
const gcs = require('../services/infra/gcsService');
const conn = require('../services/infra/db');
const db = conn.db;
const { enrichMessagesWithActions } = require('../services/primitives/enrichMessages');

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
    const session = await db.oneOrNone(
      `SELECT id, title, session_type, is_active, created_at, updated_at
       FROM nexus_sessions WHERE user_id = $1 AND is_active = TRUE
       AND session_type = 'nexus'
       ORDER BY updated_at DESC LIMIT 1`,
      [userId]
    );

    const quickStartChips = await census.getQuickStartChips(userId);

    if (!session) {
      return res.json({ session: null, messages: [], quickStartChips });
    }

    const messages = await db.any(
      `SELECT id, role, content, tool_name, tool_args, tool_response, attachments, created_at
       FROM nexus_messages WHERE session_id = $1
       ORDER BY created_at ASC`,
      [session.id]
    );

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
    const result = await db.result(
      `UPDATE nexus_sessions SET is_active = FALSE, updated_at = NOW()
       WHERE id = $1 AND user_id = $2 AND is_active = TRUE AND session_type = 'nexus'`,
      [req.params.id, userId]
    );
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
    const fileId = uuidv4();
    const ext = req.file.originalname?.split('.').pop() || 'jpg';
    const gcsPath = `users/${userId}/nexus/${fileId}.${ext}`;

    await gcs.uploadBuffer(req.file.buffer, gcsPath, req.file.mimetype);

    let url;
    if (gcs.isLocalEnvironment) {
      url = `https://storage.googleapis.com/${gcs.BUCKET}/${gcsPath}`;
    } else {
      url = await gcs.signUrl(gcsPath).catch(() =>
        `https://storage.googleapis.com/${gcs.BUCKET}/${gcsPath}`
      );
    }

    res.json({ url, mimeType: req.file.mimetype, gcsPath });
  } catch (err) {
    console.error('[nexus] upload failed:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
