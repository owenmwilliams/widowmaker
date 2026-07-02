'use strict';

const conn = require('./db');
const db = conn.db;

/**
 * Per-scan recorder for one analyze_photo/analyze_video call.
 *
 * Consumes the scan pipeline's onStage events (services/inventory/scanStatus.js
 * — Pathway B's shared contract; stage names stored here are that file's
 * SCAN_STAGES values verbatim) and persists a single scan_events row when the
 * tool call finishes. Never throws — a broken recorder must not break the scan
 * it's observing.
 *
 * A result carrying `parseError` (or `success: false`) is recorded with
 * status 'error' even when items came back: a silently-truncated or
 * unparseable scan is a failure for forensic purposes, not a success with
 * fewer items.
 */
const { SCAN_STAGES } = require('../inventory/scanStatus');

function createScanRecorder(meta) {
  const stages = {};
  let errorStage = null;
  let errorMessage = null;
  let mediaBytes = null;
  let frameCount = null;
  let provider = null;
  let model = null;
  let analyzeLatencyMs = null;

  function onStage(evt) {
    try {
      if (!evt || !evt.stage || evt.status === 'start') return;
      const m = evt.meta || {};
      stages[evt.stage] = evt.status;
      if (evt.status === 'error' && !errorStage) {
        errorStage = evt.stage;
        errorMessage = m.error || m.reason || null;
      }
      if (evt.stage === SCAN_STAGES.DOWNLOAD && m.bytes != null) mediaBytes = m.bytes;
      if (evt.stage === SCAN_STAGES.EXTRACT_FRAMES && m.frameCount != null) frameCount = m.frameCount;
      if (evt.stage === SCAN_STAGES.ANALYZE) {
        if (m.provider) provider = m.provider;
        if (m.model) model = m.model;
        if (m.latencyMs != null) analyzeLatencyMs = m.latencyMs;
      }
    } catch (_) { /* observers never break the scan */ }
  }

  function finish(toolResult) {
    const r = toolResult || {};
    const parseError = r.parseError || null;
    const failed = r.success === false || !!parseError;
    recordScanEvent({
      userId: meta.userId,
      sessionId: meta.sessionId || null,
      requestId: meta.requestId || null,
      mediaKind: meta.mediaKind,
      mediaUrl: meta.mediaUrl || null,
      mediaBytes,
      frameCount,
      provider: r._visionProvider || provider || null,
      model: r.model || model || null,
      status: failed ? 'error' : 'success',
      errorStage: errorStage || (failed ? (r.failureStage || SCAN_STAGES.ANALYZE) : null),
      errorMessage: errorMessage || (failed ? (r.error || null) : null),
      stageStatus: { ...stages },
      parseError,
      latencyMs: r._visionMs != null ? r._visionMs : analyzeLatencyMs,
      tokenUsage: r.usageMetadata || null,
      itemCount: r.itemCount != null ? r.itemCount : (Array.isArray(r.items) ? r.items.length : null),
    });
  }

  return { onStage, finish };
}

/**
 * Persist one scan_events row. Fire-and-forget — errors are swallowed so
 * instrumentation never affects the scan it's observing.
 */
async function recordScanEvent(payload) {
  try {
    const {
      userId, sessionId, requestId,
      mediaKind, mediaUrl, mediaBytes, frameCount,
      provider, model,
      status, errorStage, errorMessage, stageStatus, parseError,
      latencyMs, tokenUsage, itemCount,
    } = payload;

    await db.none(
      `INSERT INTO scan_events (
        user_id, session_id, request_id,
        media_kind, media_url, media_bytes, frame_count,
        provider, model,
        status, error_stage, error_message, stage_status, parse_error,
        latency_ms, token_usage, item_count
      ) VALUES (
        $1, $2, $3,
        $4, $5, $6, $7,
        $8, $9,
        $10, $11, $12, $13::jsonb, $14,
        $15, $16::jsonb, $17
      )`,
      [
        userId, sessionId || null, requestId || null,
        mediaKind, mediaUrl || null, mediaBytes || null, frameCount || null,
        provider || null, model || null,
        status, errorStage || null, errorMessage || null,
        stageStatus ? JSON.stringify(stageStatus) : null, parseError || null,
        latencyMs || null, tokenUsage ? JSON.stringify(tokenUsage) : null, itemCount ?? null,
      ]
    );
  } catch (err) {
    console.error('[scanEvents] recordScanEvent failed (non-fatal):', err.message);
  }
}

module.exports = { createScanRecorder, recordScanEvent };
