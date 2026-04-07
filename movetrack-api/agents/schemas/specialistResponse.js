'use strict';

const SPECIALIST_STATUSES = Object.freeze([
  'in_progress',
  'awaiting_decision',
  'awaiting_user_input',
  'completed',
  'failed',
  'blocked',
]);

const ORCHESTRATOR_RECOMMENDATIONS = Object.freeze([
  'continue',
  'ask_user',
  'stop_and_summarize',
  'switch_agent',
  'retry_step',
  'abort',
]);

const STEP_STATUSES = Object.freeze(['started', 'partial', 'completed', 'failed']);

const AGENTS = Object.freeze(['census', 'vector']);

/**
 * Validates a SpecialistResponse payload. Throws on invalid.
 */
function validateSpecialistResponse(payload) {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Invalid specialist payload: not an object');
  }

  const p = payload;

  if (!p.status || !SPECIALIST_STATUSES.includes(p.status)) {
    throw new Error(`Invalid or missing status: ${p.status}`);
  }
  if (!p.agent || !AGENTS.includes(p.agent)) {
    throw new Error(`Invalid or missing agent: ${p.agent}`);
  }
  if (!p.workflow || typeof p.workflow !== 'string') {
    throw new Error('Missing or invalid workflow');
  }
  if (!p.step || typeof p.step !== 'string') {
    throw new Error('Missing or invalid step');
  }
  if (!p.step_status || !STEP_STATUSES.includes(p.step_status)) {
    throw new Error(`Invalid or missing step_status: ${p.step_status}`);
  }
  if (!p.summary || typeof p.summary !== 'string') {
    throw new Error('Missing or invalid summary');
  }
  if (typeof p.user_action_required !== 'boolean') {
    throw new Error('Missing user_action_required (must be boolean)');
  }
  if (
    !p.recommended_orchestrator_action ||
    !ORCHESTRATOR_RECOMMENDATIONS.includes(p.recommended_orchestrator_action)
  ) {
    throw new Error(
      `Invalid or missing recommended_orchestrator_action: ${p.recommended_orchestrator_action}`
    );
  }

  return {
    status: p.status,
    agent: p.agent,
    workflow: p.workflow,
    step: p.step,
    step_status: p.step_status,
    summary: p.summary,
    confidence: typeof p.confidence === 'number' ? p.confidence : undefined,
    user_action_required: p.user_action_required,
    recommended_orchestrator_action: p.recommended_orchestrator_action,
    next_suggested_step: p.next_suggested_step ?? null,
    state_delta: p.state_delta ?? {},
    artifacts: p.artifacts ?? {},
    warnings: p.warnings ?? [],
    errors: p.errors ?? [],
  };
}

/**
 * Parse a ```json fenced block from Gemini's text output.
 * Returns the parsed object or null if no valid JSON block found.
 */
function parseJsonBlock(text) {
  const match = text.match(/```json\s*\n?([\s\S]*?)\n?```/);
  if (!match) return null;
  try {
    return JSON.parse(match[1].trim());
  } catch {
    return null;
  }
}

/**
 * Derive deterministic fields from the agent's tool actions.
 */
function deriveFieldsFromActions(actions, agentName, maxRoundsHit = false) {
  const errors = [];
  const warnings = [];
  const artifacts = {};

  for (const action of actions) {
    const result = action.result;
    if (!result) continue;

    if (result.success === false && result.error) {
      errors.push(`${action.tool}: ${result.error}`);
    }
    if (result.warnings) {
      warnings.push(...result.warnings);
    }

    // Collect notable artifacts
    if (result.item_id) {
      if (!artifacts.item_ids) artifacts.item_ids = [];
      artifacts.item_ids.push(result.item_id);
    }
    if (result.items && Array.isArray(result.items)) {
      artifacts.items_count = (artifacts.items_count || 0) + result.items.length;
    }
    if (result.recommendation) {
      artifacts.recommendation = result.recommendation;
    }
  }

  const hasErrors = errors.length > 0;
  const status = hasErrors ? 'failed' : maxRoundsHit ? 'in_progress' : 'completed';
  const step_status = hasErrors ? 'failed' : 'completed';

  return { status, step_status, errors, warnings, artifacts };
}

/**
 * Build a validated SpecialistResponse by merging deterministic agent fields
 * with Gemini-provided contextual fields.
 *
 * @param {object} agentFields - Deterministic fields from agent code
 * @param {object} geminiFields - Fields parsed from Gemini's JSON output
 * @returns {object} Validated SpecialistResponse
 */
function buildSpecialistResponse(agentFields, geminiFields) {
  const merged = {
    ...geminiFields,
    ...agentFields, // agent-derived fields override Gemini where both exist
    // But Gemini owns these contextual fields:
    summary: geminiFields.summary || agentFields.summary,
    workflow: geminiFields.workflow || agentFields.workflow || 'unknown',
    step: geminiFields.step || agentFields.step || 'unknown',
    confidence: geminiFields.confidence,
    recommended_orchestrator_action:
      geminiFields.recommended_orchestrator_action ||
      agentFields.recommended_orchestrator_action ||
      'continue',
    next_suggested_step: geminiFields.next_suggested_step ?? null,
    state_delta: geminiFields.state_delta ?? {},
    // Merge arrays
    warnings: [
      ...(agentFields.warnings || []),
      ...(geminiFields.warnings || []),
    ],
    errors: [
      ...(agentFields.errors || []),
      ...(geminiFields.errors || []),
    ],
    // Merge artifacts
    artifacts: {
      ...(agentFields.artifacts || {}),
      ...(geminiFields.artifacts || {}),
    },
  };

  // Derive user_action_required from recommendation if not explicitly set
  if (typeof merged.user_action_required !== 'boolean') {
    merged.user_action_required = merged.recommended_orchestrator_action === 'ask_user';
  }

  return validateSpecialistResponse(merged);
}

/**
 * Build a fallback SpecialistResponse when Gemini doesn't return valid JSON.
 * Wraps raw text as the summary with safe defaults.
 */
function buildFallbackResponse(rawText, agentName, actions, maxRoundsHit = false) {
  const derived = deriveFieldsFromActions(actions, agentName, maxRoundsHit);
  console.warn(`[${agentName}] Gemini did not return structured JSON, using fallback`);

  return validateSpecialistResponse({
    status: derived.status,
    agent: agentName,
    workflow: 'unknown',
    step: 'unknown',
    step_status: derived.step_status,
    summary: rawText,
    user_action_required: false,
    recommended_orchestrator_action: 'continue',
    next_suggested_step: null,
    state_delta: {},
    artifacts: derived.artifacts,
    warnings: [...derived.warnings, 'Gemini did not return structured JSON — fallback used'],
    errors: derived.errors,
  });
}

module.exports = {
  SPECIALIST_STATUSES,
  ORCHESTRATOR_RECOMMENDATIONS,
  STEP_STATUSES,
  AGENTS,
  validateSpecialistResponse,
  parseJsonBlock,
  deriveFieldsFromActions,
  buildSpecialistResponse,
  buildFallbackResponse,
};
