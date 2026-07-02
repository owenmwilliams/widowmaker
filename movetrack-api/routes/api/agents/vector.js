const express = require('express');
const { authenticate, resolveEffectivePlan } = require('../../../services/infra/authService');
const vectorService = require('../../../agents/vectorAgent');
const sessions = require('../../../services/infra/agentSessionService');
const { enrichMessagesWithActions } = sessions;
const { startSSEHeartbeat } = require('../../../services/infra/sseHeartbeat');

const router = express.Router();

router.use(authenticate);

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

  const heartbeat = startSSEHeartbeat(res);
  const sendSSE = (event) => {
    heartbeat.touch();
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  try {
    const result = await vectorService.processMessage(userId, message, [], plan, sendSSE);
    sendSSE({ type: 'done', reply: result.reply, actions: result.actions, sessionId: result.sessionId });
  } catch (err) {
    console.error('[vector] processMessage (stream) failed:', err);
    sendSSE({ type: 'error', error: err.message || 'Vector processing failed' });
  } finally {
    heartbeat.stop();
    res.end();
  }
});

// ─── GET /active-session ────────────────────────────────────────────────────
router.get('/active-session', async (req, res) => {
  const userId = req.user?.user_id;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const session = await sessions.getActiveSession(userId, 'vector');

    if (!session) {
      return res.json({ session: null, messages: [] });
    }

    const messages = await sessions.getSessionMessages(session.id);
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
    const result = await sessions.archiveSession(req.params.id, userId, 'vector');
    if (result.rowCount === 0) return res.status(404).json({ error: 'Session not found' });
    res.json({ success: true });
  } catch (err) {
    console.error('[vector] archive session failed:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
