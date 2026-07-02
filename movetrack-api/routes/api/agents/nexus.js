const express = require('express');
const multer = require('multer');
const { authenticate, resolveEffectivePlan } = require('../../../services/infra/authService');
const nexusOrchestrator = require('../../../agents/nexusOrchestratorAgent');
const censusAgent = require('../../../agents/censusAgent');
const media = require('../../../services/inventory/mediaInventoryWorkflowService');
const mediaAssetService = require('../../../services/infra/mediaAssetService');
const gcs = require('../../../services/infra/gcsService');
const inventoryMutation = require('../../../services/inventory/inventoryMutationService');
const rateLimits = require('../../../config/rateLimits');
const sessions = require('../../../services/infra/agentSessionService');
const metrics = require('../../../services/infra/metricsService');
const { enrichMessagesWithActions, getQuickStartChips } = sessions;
const { startSSEHeartbeat } = require('../../../services/infra/sseHeartbeat');

const { isConversationStale } = require('../../../agents/schemas/orchestratorModes');
const { buildWorkflowGuidanceContext } = require('../../../agents/schemas/workflowGuidance');
const { createLogger } = require('../../../services/infra/logger');

const log = createLogger({ component: 'nexus-route' });

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
      log.error('processMessage failed', { userId, error: err.message, stack: err.stack });
      return res.status(err.status || 500).json({ error: err.message || 'Nexus processing failed' });
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
    const result = await nexusOrchestrator.processMessage(
      userId, message || '', attachments || [], plan, sendSSE
    );
    sendSSE({ type: 'done', reply: result.reply, actions: result.actions, sessionId: result.sessionId });
  } catch (err) {
    log.error('processMessage (stream) failed', { userId, error: err.message, stack: err.stack });
    sendSSE({ type: 'error', error: err.message || 'Nexus processing failed' });
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
    log.error('active-session failed', { userId, error: err.message });
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
      log.error('guidance failed', { userId, error: err.message });
      return res.status(err.status || 500).json({ error: err.message || 'Guidance request failed' });
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
    const result = await nexusOrchestrator.processMessage(
      userId, syntheticMessage, [], plan, sendSSE, { guidanceOnly: true }
    );
    const quickStartChips = await getQuickStartChips(userId);
    sendSSE({ type: 'done', reply: result.reply, actions: result.actions, sessionId: result.sessionId, quickStartChips });
  } catch (err) {
    log.error('guidance (stream) failed', { userId, error: err.message });
    sendSSE({ type: 'error', error: err.message || 'Guidance request failed' });
  } finally {
    heartbeat.stop();
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
    log.error('archive session failed', { userId, error: err.message });
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
    log.error('upload failed', { userId, error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /inventory/commit ───────────────────────────────────────────────────
// Commit items the user reviewed in the native "detected items" card. The client
// edits/keeps items itself and posts the final list here, so the commit is exact
// (no LLM re-interpretation of 40 items) and bypasses the agent's add path.
router.post('/inventory/commit', express.json(), async (req, res) => {
  const userId = req.user?.user_id;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  const items = Array.isArray(req.body?.items) ? req.body.items : [];
  if (items.length === 0) return res.status(400).json({ error: 'No items to add' });
  if (items.length > 200) return res.status(400).json({ error: 'Too many items in one request (max 200)' });

  const defaultRoom = typeof req.body?.room === 'string' ? req.body.room.trim() : '';
  const scanId = (typeof req.body?.scanId === 'string' && req.body.scanId.trim())
    ? req.body.scanId.trim().slice(0, 64)
    : null;
  const num = (v) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : undefined;
  };

  // Idempotency, keyed on scan identity — NOT on (name, room). The review card
  // is the user's curated list, so we add every reviewed item; the only thing we
  // skip is re-submitting the exact SAME card (double-tap, retry). A rescan is a
  // new card with a new scanId, so its corrected items always land. Clients that
  // don't send a scanId simply always add (the composer disables during commit).
  if (scanId) {
    let alreadyCommitted = false;
    try {
      alreadyCommitted = await censusAgent.scanAlreadyCommitted(userId, scanId);
    } catch (_) { /* fail open — never block a legitimate commit */ }
    if (alreadyCommitted) {
      return res.json({
        success: true, addedCount: 0, skippedCount: items.length, failedCount: 0,
        failures: [], alreadyCommitted: true,
      });
    }
  }

  const normalized = items
    .filter(r => r && typeof r === 'object' && String(r.name || '').trim())
    .map(r => ({
      name: String(r.name).trim().slice(0, 200),
      room: (String(r.room || '').trim() || defaultRoom || 'Unsorted').slice(0, 120),
      quantity: Number.isFinite(Number(r.quantity)) && Number(r.quantity) > 0 ? Math.floor(Number(r.quantity)) : 1,
      raw: r,
    }));

  let addedCount = 0;
  const failures = [];
  for (const it of normalized) {
    try {
      const result = await inventoryMutation.addItem(userId, {
        name: it.name,
        room_name: it.room,
        quantity: it.quantity,
        weight_lbs: num(it.raw.weightLbs),
        length_in: num(it.raw.lengthIn),
        width_in: num(it.raw.widthIn),
        height_in: num(it.raw.heightIn),
        material: it.raw.material ? String(it.raw.material).slice(0, 60) : undefined,
        fragile: it.raw.fragile === true,
        picture_url: typeof it.raw.pictureUrl === 'string' ? it.raw.pictureUrl : undefined,
        confidence_score: num(it.raw.confidence),
        confidence_source: 'scan_review',
      });
      if (result?.success) addedCount++;
      else failures.push({ name: it.name, error: result?.error || 'Could not add item' });
    } catch (err) {
      failures.push({ name: it.name, error: err.message });
    }
  }

  // This commit bypasses the chat turn entirely (that's the point — an exact
  // commit of what the user reviewed, no LLM re-interpretation), so it never
  // touches beta_interaction_logs or nexus_sessions.items_added on its own.
  // Attribute it to whichever agent session is currently active so "items
  // added this session" stays truthful across the add_item / add_items /
  // commit paths (see beta-scan-reliability-investigation.md Section 0.4).
  try {
    const activeSession = await sessions.getActiveSession(userId, ['census', 'onboarding', 'general', 'nexus']);
    await metrics.recordCommitInteraction({
      userId,
      sessionId: activeSession?.id || null,
      itemsAdded: addedCount,
      errors,
    });
  } catch (err) {
    log.error('inventory/commit metrics failed (non-fatal)', { userId, error: err.message });
  }

  if (addedCount === 0) {
    return res.status(failures.length ? 500 : 400).json({
      error: failures[0]?.error || 'No items could be added. Set up a home location first.',
      failures: failures.slice(0, 20),
    });
  }

  // Record the commit into the census transcript (with the scanId + item names)
  // so the agent knows these items are already in the inventory — and so the
  // chat "add them all" path can skip exactly this scan's items. Best-effort:
  // never fail the user's commit over a bookkeeping write.
  try {
    await censusAgent.recordCensusToolCall(
      userId,
      'add_items',
      {
        items: normalized.map(it => ({ name: it.name, room_name: it.room, quantity: it.quantity })),
        _via: 'review_card',
        _scanId: scanId || undefined,
      },
      { success: true, added: addedCount, failed: failures.length, _via: 'review_card', _scanId: scanId || undefined }
    );
  } catch (err) {
    console.error('[nexus] inventory/commit visibility record failed (non-fatal):', err.message);
  }

  res.json({
    success: true,
    addedCount,
    skippedCount: 0,
    failedCount: failures.length,
    failures: failures.slice(0, 20),
  });
});

// ─── POST /inventory/resolve-duplicates ────────────────────────────────────────
// Delete the item ids the user chose to remove in the native duplicate-review card.
router.post('/inventory/resolve-duplicates', express.json(), async (req, res) => {
  const userId = req.user?.user_id;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  const ids = Array.isArray(req.body?.removeItemIds) ? req.body.removeItemIds : [];
  if (ids.length === 0) return res.json({ success: true, removedCount: 0 });
  if (ids.length > 200) return res.status(400).json({ error: 'Too many items in one request (max 200)' });

  let removedCount = 0;
  for (const id of ids) {
    try {
      const result = await inventoryMutation.deleteItem(userId, { item_id: id });
      if (result?.success) removedCount++;
    } catch (_) { /* ownership-checked in deleteItem; skip failures */ }
  }
  res.json({ success: true, removedCount });
});

// ─── POST /rescan ───────────────────────────────────────────────────────────────
// Deterministically re-run vision analysis on an already-uploaded photo/video.
// Unlike the chat path, this ALWAYS invokes the vision tool — an explicit user
// retry (the "Rescan" button) can't be talked out of by the LLM, which in the
// beta apologized ("it's consistently failing") instead of re-running the scan.
// Returns detected items in the same shape as the SSE 'detected_items' event so
// the client shows the identical native review card.
router.post('/rescan', rateLimits.rescanLimiter, express.json(), async (req, res) => {
  const userId = req.user?.user_id;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  const url = String(req.body?.url || '');
  const mimeType = String(req.body?.mimeType || '');
  const room = (typeof req.body?.room === 'string' && req.body.room.trim())
    ? req.body.room.trim().slice(0, 120)
    : null;

  // SSRF + cross-user guard: the server raw-fetches this URL, so it must be a
  // GCS object in our bucket UNDER THE CALLER'S OWN prefix. Without this a user
  // could hit internal endpoints or rescan another user's media and read their
  // detected inventory back. Rejects anything that isn't exactly that shape.
  const allowedPrefix = `https://storage.googleapis.com/${gcs.BUCKET}/users/${userId}/`;
  if (!url.startsWith(allowedPrefix) || url.includes('..')) {
    return res.status(403).json({ error: 'That media URL is not accessible.' });
  }
  const isVideo = mimeType.startsWith('video/');
  const isImage = mimeType.startsWith('image/');
  if (!isVideo && !isImage) return res.status(400).json({ error: 'Unsupported media type' });

  const plan = (resolveEffectivePlan(req) || 'basic').toLowerCase();
  const scanId = crypto.randomUUID();

  try {
    const result = isVideo
      ? await media.analyzeVideoForInventory({ file_url: url, mime_type: mimeType, room_hint: room }, userId, plan)
      : await media.analyzePhotoForInventory({ file_url: url, mime_type: mimeType, mode: 'multi_item', room_hint: room }, userId, plan);

    if (!result || result.success === false) {
      // Honest failure — don't return a fake success with an empty list.
      return res.status(502).json({ error: (result && result.error) || 'Scan failed. Please try again.' });
    }

    const items = censusAgent.mapDetectedItemsForClient(result.items || [], room);

    // Record the rescan into the census transcript so the agent has visibility
    // of WHAT was found (names, not just a count) — a follow-up "add them all"
    // otherwise sees "found 12" with no idea which. Best-effort.
    try {
      await censusAgent.recordCensusToolCall(
        userId,
        isVideo ? 'analyze_video' : 'analyze_photo',
        { file_url: url, mime_type: mimeType, room_hint: room, _via: 'rescan', _scanId: scanId },
        {
          success: true,
          itemCount: items.length,
          items: items.map(i => ({ name: i.name, room: i.room })),
          _via: 'rescan',
          _scanId: scanId,
        }
      );
    } catch (err) {
      console.error('[nexus] rescan visibility record failed (non-fatal):', err.message);
    }

    res.json({ success: true, scanId, mediaKind: isVideo ? 'video' : 'photo', room, items, itemCount: items.length });
  } catch (err) {
    console.error('[nexus] rescan failed:', err.message);
    res.status(500).json({ error: 'Rescan failed. Please try again.' });
  }
});

// ─── POST /upload-url ──────────────────────────────────────────────────────────
// Mint a short-lived signed URL so the client can upload a large file (video)
// DIRECTLY to GCS, bypassing this API's ~32MB request cap. The client PUTs the
// bytes to `uploadUrl` (Content-Type must match), then sends `url` as the
// attachment on /message — the same public URL shape a normal upload produces.
// Registers the reservation in `image_uploads` immediately (mediaAssetService)
// so orphan cleanup and GDPR deletion see it even if the client abandons the
// upload — this direct-PUT path previously wrote no row at all.
router.post('/upload-url', express.json(), async (req, res) => {
  const userId = req.user?.user_id;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  const mimeType = String(req.body?.mimeType || '');
  const filename = String(req.body?.filename || 'upload');
  const declaredSize = Number(req.body?.byteLength);
  if (!/^(image|video)\//.test(mimeType)) {
    return res.status(400).json({ error: 'Unsupported media type' });
  }

  try {
    const asset = await mediaAssetService.reserveUpload({
      userId,
      mimeType,
      originalName: filename,
      source: 'nexus_chat',
      declaredSize: Number.isFinite(declaredSize) ? declaredSize : null,
    });
    res.json({
      uploadUrl: asset.uploadUrl,
      url: asset.url,
      gcsPath: asset.gcsPath,
      mimeType: asset.mimeType,
    });
  } catch (err) {
    log.error('upload-url failed', { userId, error: err.message });
    res.status(500).json({ error: 'Could not create an upload URL' });
  }
});

module.exports = router;
