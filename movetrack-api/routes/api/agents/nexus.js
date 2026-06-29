const express = require('express');
const multer = require('multer');
const { authenticate, resolveEffectivePlan } = require('../../../services/infra/authService');
const nexusOrchestrator = require('../../../agents/nexusOrchestratorAgent');
const mediaAssetService = require('../../../services/infra/mediaAssetService');
const sessions = require('../../../services/infra/agentSessionService');
const { enrichMessagesWithActions, getQuickStartChips } = sessions;

const { isConversationStale } = require('../../../agents/schemas/orchestratorModes');
const { buildWorkflowGuidanceContext } = require('../../../agents/schemas/workflowGuidance');

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
    const quickStartChips = await getQuickStartChips(userId);

    if (!session) {
      return res.json({ session: null, messages: [], quickStartChips, guidance: null });
    }

    const messages = await sessions.getSessionMessages(session.id);

    // Compute staleness + workflow guidance for the frontend
    // Check both last user message AND last model message to prevent runaway guidance.
    // If guidance (model message) was sent recently, the session isn't stale.
    const lastUserMsg = messages.filter(m => m.role === 'user').pop();
    const lastModelMsg = messages.filter(m => m.role === 'model').pop();
    const lastUserMessageAt = lastUserMsg ? new Date(lastUserMsg.created_at).getTime() : Date.now();
    const lastModelMessageAt = lastModelMsg ? new Date(lastModelMsg.created_at).getTime() : 0;
    const lastActivityAt = Math.max(lastUserMessageAt, lastModelMessageAt);
    const stale = isConversationStale(lastActivityAt);

    const workflowGuidance = await buildWorkflowGuidanceContext(userId);

    res.json({
      session,
      messages: enrichMessagesWithActions(messages),
      quickStartChips,
      guidance: {
        isStale: stale,
        interactionModeHint: stale ? 'guide' : 'execute',
        ...workflowGuidance,
      },
    });
  } catch (err) {
    console.error('[nexus] active-session failed:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /guidance ──────────────────────────────────────────────────────────
// System-initiated guidance request. Called by the frontend when the session is
// stale. Triggers a Gemini response in guidance mode without persisting a user
// message. Returns the guidance reply + updated quick-start chips.
router.post('/guidance', express.json(), async (req, res) => {
  const userId = req.user?.user_id;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  const plan = (resolveEffectivePlan(req) || 'basic').toLowerCase();
  const syntheticMessage = 'The user just opened the chat after being away. Summarize where they left off, highlight the most important gaps, and suggest 1–2 next steps.';

  const wantsStream = req.headers.accept === 'text/event-stream';

  if (!wantsStream) {
    try {
      const result = await nexusOrchestrator.processMessage(
        userId, syntheticMessage, [], plan, null, { guidanceOnly: true }
      );
      const quickStartChips = await getQuickStartChips(userId);
      return res.json({ ...result, quickStartChips });
    } catch (err) {
      console.error('[nexus] guidance failed:', err);
      return res.status(500).json({ error: err.message || 'Guidance request failed' });
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
      userId, syntheticMessage, [], plan, sendSSE, { guidanceOnly: true }
    );
    const quickStartChips = await getQuickStartChips(userId);
    sendSSE({ type: 'done', reply: result.reply, actions: result.actions, sessionId: result.sessionId, quickStartChips });
  } catch (err) {
    console.error('[nexus] guidance (stream) failed:', err);
    sendSSE({ type: 'error', error: err.message || 'Guidance request failed' });
  } finally {
    res.end();
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
// Persist a chat attachment via mediaAssetService. Returns an assetId that the
// frontend must include on the next /message call so the backend can link the
// asset to the created nexus_messages row.
router.post('/upload', upload.single('file'), async (req, res) => {
  const userId = req.user?.user_id;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  try {
    const asset = await mediaAssetService.ingestUpload({
      userId,
      buffer: req.file.buffer,
      mimeType: req.file.mimetype,
      originalName: req.file.originalname,
      source: 'nexus_chat',
    });
    res.json({
      assetId: asset.assetId,
      url: asset.url,
      mimeType: asset.mimeType,
      gcsPath: asset.gcsPath,
    });
  } catch (err) {
    console.error('[nexus] upload failed:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
