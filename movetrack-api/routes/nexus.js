const express = require('express');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const { authenticate, resolveEffectivePlan } = require('../bin/authService');
const nexusService = require('../bin/nexusService');
const gcs = require('../bin/gcsService');
const conn = require('../bin/db');
const db = conn.db;

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 200 * 1024 * 1024 }, // 200MB for photos + videos
});

router.use(authenticate);

// ─── POST /message ───────────────────────────────────────────────────────────
// Send a message to the Nexus agent. Returns the agent's reply and any actions taken.
router.post('/message', express.json(), async (req, res) => {
  const userId = req.user?.user_id;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  const { sessionId, message, attachments } = req.body;
  if (!message && (!attachments || attachments.length === 0)) {
    return res.status(400).json({ error: 'message or attachments required' });
  }

  const plan = (resolveEffectivePlan(req) || 'basic').toLowerCase();

  try {
    const result = await nexusService.processMessage(
      userId,
      sessionId || null,
      message || '',
      attachments || [],
      plan
    );
    res.json(result);
  } catch (err) {
    console.error('[nexus] processMessage failed:', err);
    res.status(500).json({ error: err.message || 'Nexus processing failed' });
  }
});

// ─── GET /sessions ───────────────────────────────────────────────────────────
// List the user's conversation sessions.
router.get('/sessions', async (req, res) => {
  const userId = req.user?.user_id;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const sessions = await db.any(
      `SELECT id, title, session_type, items_added, rooms_added, is_active, created_at, updated_at
       FROM nexus_sessions WHERE user_id = $1
       ORDER BY updated_at DESC LIMIT 50`,
      [userId]
    );
    res.json({ sessions });
  } catch (err) {
    console.error('[nexus] list sessions failed:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /sessions/:id ──────────────────────────────────────────────────────
// Get a specific session and its messages.
router.get('/sessions/:id', async (req, res) => {
  const userId = req.user?.user_id;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const session = await db.oneOrNone(
      `SELECT * FROM nexus_sessions WHERE id = $1 AND user_id = $2`,
      [req.params.id, userId]
    );
    if (!session) return res.status(404).json({ error: 'Session not found' });

    const messages = await db.any(
      `SELECT id, role, content, tool_name, tool_args, tool_response, attachments, created_at
       FROM nexus_messages WHERE session_id = $1
       ORDER BY created_at ASC`,
      [req.params.id]
    );

    // Filter to only user and model messages for the frontend
    const visibleMessages = messages.filter(m => m.role === 'user' || m.role === 'model');

    // Attach actions to model messages (tool calls that preceded them)
    const enriched = visibleMessages.map((msg, idx) => {
      if (msg.role === 'model') {
        // Find tool_call messages between this model message and the previous visible message
        const prevVisibleIdx = idx > 0 ? messages.indexOf(visibleMessages[idx - 1]) : -1;
        const thisIdx = messages.indexOf(msg);
        const toolCalls = messages
          .slice(prevVisibleIdx + 1, thisIdx)
          .filter(m => m.role === 'tool_call')
          .map(tc => ({
            tool: tc.tool_name,
            args: tc.tool_args,
            result: messages.find(
              m => m.role === 'tool_result' && m.tool_name === tc.tool_name &&
                   messages.indexOf(m) > messages.indexOf(tc) && messages.indexOf(m) < thisIdx
            )?.tool_response,
          }));
        return { ...msg, actions: toolCalls };
      }
      return msg;
    });

    res.json({ session, messages: enriched });
  } catch (err) {
    console.error('[nexus] get session failed:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── DELETE /sessions/:id ────────────────────────────────────────────────────
router.delete('/sessions/:id', async (req, res) => {
  const userId = req.user?.user_id;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const result = await db.result(
      `DELETE FROM nexus_sessions WHERE id = $1 AND user_id = $2`,
      [req.params.id, userId]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Session not found' });
    res.json({ success: true });
  } catch (err) {
    console.error('[nexus] delete session failed:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /upload ────────────────────────────────────────────────────────────
// Upload a photo for use in conversation.
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
