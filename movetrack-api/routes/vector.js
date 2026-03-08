const express = require('express');
const { authenticate, resolveEffectivePlan } = require('../bin/authService');
const vectorService = require('../bin/vectorService');
const conn = require('../bin/db');
const db = conn.db;

const router = express.Router();

router.use(authenticate);

// ── Helper: enrich messages with tool actions ─────────────────────────────────
function enrichMessagesWithActions(allMessages) {
  const visibleMessages = allMessages.filter(m => m.role === 'user' || m.role === 'model');
  return visibleMessages.map((msg, idx) => {
    if (msg.role === 'model') {
      const prevVisibleIdx = idx > 0 ? allMessages.indexOf(visibleMessages[idx - 1]) : -1;
      const thisIdx = allMessages.indexOf(msg);
      const toolCalls = allMessages
        .slice(prevVisibleIdx + 1, thisIdx)
        .filter(m => m.role === 'tool_call')
        .map(tc => ({
          tool: tc.tool_name,
          args: tc.tool_args,
          result: allMessages.find(
            m => m.role === 'tool_result' && m.tool_name === tc.tool_name &&
                 allMessages.indexOf(m) > allMessages.indexOf(tc) && allMessages.indexOf(m) < thisIdx
          )?.tool_response,
        }));
      return { ...msg, actions: toolCalls };
    }
    return msg;
  });
}

// ─── POST /message ───────────────────────────────────────────────────────────
router.post('/message', express.json(), async (req, res) => {
  const userId = req.user?.user_id;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  const { message } = req.body;
  if (!message) {
    return res.status(400).json({ error: 'message required' });
  }

  const plan = (resolveEffectivePlan(req) || 'basic').toLowerCase();
  const wantsStream = req.headers.accept === 'text/event-stream';

  if (!wantsStream) {
    try {
      const result = await vectorService.processMessage(userId, message, [], plan);
      return res.json(result);
    } catch (err) {
      console.error('[vector] processMessage failed:', err);
      return res.status(500).json({ error: err.message || 'Vector processing failed' });
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
    const result = await vectorService.processMessage(userId, message, [], plan, sendSSE);
    sendSSE({ type: 'done', reply: result.reply, actions: result.actions, sessionId: result.sessionId });
  } catch (err) {
    console.error('[vector] processMessage (stream) failed:', err);
    sendSSE({ type: 'error', error: err.message || 'Vector processing failed' });
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
       FROM nexus_sessions WHERE user_id = $1 AND is_active = TRUE AND session_type = 'vector'
       ORDER BY updated_at DESC LIMIT 1`,
      [userId]
    );

    if (!session) {
      return res.json({ session: null, messages: [] });
    }

    const messages = await db.any(
      `SELECT id, role, content, tool_name, tool_args, tool_response, attachments, created_at
       FROM nexus_messages WHERE session_id = $1
       ORDER BY created_at ASC`,
      [session.id]
    );

    res.json({ session, messages: enrichMessagesWithActions(messages) });
  } catch (err) {
    console.error('[vector] active-session failed:', err);
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
       WHERE id = $1 AND user_id = $2 AND is_active = TRUE AND session_type = 'vector'`,
      [req.params.id, userId]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Session not found' });
    res.json({ success: true });
  } catch (err) {
    console.error('[vector] archive session failed:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
