'use strict';

// ── Constants ────────────────────────────────────────────────────────────────

const INTERACTION_MODES = Object.freeze(['execute', 'guide']);

const STALE_SESSION_THRESHOLD_MS = 60 * 60 * 1000; // 1 hour

const CONTEXT_REQUEST_PATTERNS = Object.freeze([
  'where were we',
  'where did we leave off',
  'what should i do next',
  "what's next",
  'whats next',
  'pick back up',
  'continue where we left off',
  'what do i do next',
  'where am i',
  "what's left",
  'whats left',
]);

// ── Detectors ────────────────────────────────────────────────────────────────

/**
 * Check if the conversation is stale (> 1 hour since last user message).
 *
 * @param {number|Date} lastUserMessageAt - timestamp of last user message
 * @param {number} [now] - current time in ms (defaults to Date.now())
 * @returns {boolean}
 */
function isConversationStale(lastUserMessageAt, now) {
  const lastMs = lastUserMessageAt instanceof Date
    ? lastUserMessageAt.getTime()
    : Number(lastUserMessageAt);
  const nowMs = now ?? Date.now();
  return nowMs - lastMs > STALE_SESSION_THRESHOLD_MS;
}

/**
 * Check if the user's message is explicitly requesting context/progress.
 * Pattern-matched against known re-entry phrases.
 *
 * @param {string} message
 * @returns {boolean}
 */
function explicitlyRequestsContext(message) {
  const normalized = message.toLowerCase();
  return CONTEXT_REQUEST_PATTERNS.some(p => normalized.includes(p));
}

// ── Interaction Mode Policy ──────────────────────────────────────────────────

/**
 * Choose the interaction mode based on input signals.
 *
 * Policy:
 * - Direct request with high confidence → execute
 * - Explicit context request → guide
 * - Stale + low confidence → guide
 * - Otherwise → execute
 *
 * @param {object} input
 * @param {boolean} input.hasDirectUserRequest
 * @param {number} input.intentConfidence - 0 to 1
 * @param {boolean} input.isConversationStale
 * @param {boolean} input.explicitlyRequestsContext
 * @returns {'execute'|'guide'}
 */
function chooseInteractionMode(input) {
  if (input.hasDirectUserRequest && input.intentConfidence >= 0.7) {
    return 'execute';
  }

  if (input.explicitlyRequestsContext) {
    return 'guide';
  }

  if (input.isConversationStale && input.intentConfidence < 0.7) {
    return 'guide';
  }

  return 'execute';
}

// ── Intent Detection (model-assisted) ────────────────────────────────────────

/**
 * Build a prompt for Gemini Flash to assess user intent.
 *
 * @param {string} message - the user's message
 * @returns {string}
 */
function buildIntentDetectionPrompt(message) {
  return `Assess this user message and determine if it contains a direct, actionable request.

USER MESSAGE:
"${message}"

A "direct request" means the user is asking for a specific task to be performed, such as:
- Adding, editing, or removing items from inventory
- Calculating routes, costs, or estimates
- Showing a summary or report
- Finishing a specific room or task
- Getting a quote or recommendation

NOT a direct request:
- Greetings ("hey", "hi", "hello")
- Vague messages ("okay", "sure", "thanks")
- Context-seeking ("where were we", "what's next")
- Single-word acknowledgments

Respond with ONLY a JSON object:
{"hasDirectUserRequest": true/false, "intentConfidence": 0.0-1.0, "intentType": "brief description or null"}`;
}

/**
 * Parse the intent detection response from Gemini.
 * Returns parsed object or null if unparseable.
 *
 * @param {string} text - raw model response
 * @returns {{ hasDirectUserRequest: boolean, intentConfidence: number, intentType: string|null }|null}
 */
function parseIntentDetectionResponse(text) {
  // Try JSON parse first
  try {
    const obj = JSON.parse(text.trim());
    if (typeof obj.hasDirectUserRequest === 'boolean' && typeof obj.intentConfidence === 'number') {
      return {
        hasDirectUserRequest: obj.hasDirectUserRequest,
        intentConfidence: Math.max(0, Math.min(1, obj.intentConfidence)),
        intentType: obj.intentType || null,
      };
    }
  } catch { /* fall through */ }

  // Try extracting from ```json block
  const jsonMatch = text.match(/```json\s*\n?([\s\S]*?)\n?```/);
  if (jsonMatch) {
    try {
      const obj = JSON.parse(jsonMatch[1].trim());
      if (typeof obj.hasDirectUserRequest === 'boolean' && typeof obj.intentConfidence === 'number') {
        return {
          hasDirectUserRequest: obj.hasDirectUserRequest,
          intentConfidence: Math.max(0, Math.min(1, obj.intentConfidence)),
          intentType: obj.intentType || null,
        };
      }
    } catch { /* fall through */ }
  }

  return null;
}

module.exports = {
  INTERACTION_MODES,
  STALE_SESSION_THRESHOLD_MS,
  CONTEXT_REQUEST_PATTERNS,
  isConversationStale,
  explicitlyRequestsContext,
  chooseInteractionMode,
  buildIntentDetectionPrompt,
  parseIntentDetectionResponse,
};
