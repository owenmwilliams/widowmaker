'use strict';

const conn = require('./db');
const db = conn.db;

/**
 * Log one interaction to beta_interaction_logs.
 * Fire-and-forget — errors are swallowed so they never affect the user.
 */
async function logInteraction(payload) {
  try {
    const { userId, sessionId, timing = {}, context = {}, vision = {}, error = {} } = payload;

    await db.none(
      `INSERT INTO beta_interaction_logs (
        user_id, session_id,
        total_latency_ms, ttfe_ms, gemini_latency_ms, vision_latency_ms,
        had_attachments, attachment_count, attachment_types,
        tool_calls, tool_call_count, items_added_this_turn,
        detected_item_count, avg_confidence, min_confidence, vision_provider,
        gemini_model, gemini_rounds,
        had_error, error_message
      ) VALUES (
        $1, $2,
        $3, $4, $5, $6,
        $7, $8, $9::text[],
        $10::text[], $11, $12,
        $13, $14, $15, $16,
        $17, $18,
        $19, $20
      )`,
      [
        userId, sessionId || null,
        timing.totalMs || null, timing.ttfeMs || null,
        timing.geminiMs || null, timing.visionMs || null,
        !!context.hadAttachments, context.attachmentCount || 0,
        context.attachmentTypes || null,
        context.toolCalls || null,
        (context.toolCalls || []).length, context.itemsAdded || 0,
        vision.detectedItemCount || null, vision.avgConfidence || null,
        vision.minConfidence || null, vision.provider || null,
        context.geminiModel || null, context.geminiRounds || 1,
        !!error.hadError, error.message || null
      ]
    );
  } catch (err) {
    console.error('[metrics] logInteraction failed (non-fatal):', err.message);
  }
}

/**
 * Record items added outside a chat turn (the native review-card commit path,
 * POST /inventory/commit). Without this, items_added_this_turn undercounts —
 * the commit route writes items straight to `items` and never touches
 * beta_interaction_logs or nexus_sessions.items_added, so a session's "items
 * added" total silently excludes everything committed via the native card.
 * Same hook shape as the chat-turn logInteraction call so both paths roll up
 * identically in reportingService.
 */
async function recordCommitInteraction({ userId, sessionId, itemsAdded, errors = [] }) {
  try {
    if (sessionId) {
      await db.none(
        `UPDATE nexus_sessions SET items_added = items_added + $1, updated_at = NOW() WHERE id = $2`,
        [itemsAdded, sessionId]
      );
    }
  } catch (err) {
    console.error('[metrics] recordCommitInteraction session update failed (non-fatal):', err.message);
  }

  return logInteraction({
    userId, sessionId,
    context: {
      toolCalls: ['inventory_commit'],
      itemsAdded,
    },
    error: {
      hadError: itemsAdded === 0 && errors.length > 0,
      message: errors[0] || null,
    },
  });
}

/**
 * Log item-level feedback (correct / wrong / hallucinated).
 */
async function logItemFeedback(itemId, userId, feedback, interactionLogId = null) {
  try {
    await db.none(
      `INSERT INTO item_feedback (item_id, user_id, interaction_log_id, feedback)
       VALUES ($1, $2, $3, $4)`,
      [itemId, userId, interactionLogId || null, feedback]
    );
  } catch (err) {
    console.error('[metrics] logItemFeedback failed (non-fatal):', err.message);
  }
}

module.exports = { logInteraction, logItemFeedback, recordCommitInteraction };
