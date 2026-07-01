'use strict';

const { ORCHESTRATOR_RECOMMENDATIONS } = require('./specialistResponse');

const ALL_DECISIONS = [...ORCHESTRATOR_RECOMMENDATIONS];

const AGENT_LIMITS = Object.freeze({
  orchestratorMaxToolRounds: 5,
  specialistMaxToolRounds: 8,
  specialistMaxRetries: 1,
  // Onboarding can create several rooms and fill a room or two in one turn; give
  // it a little headroom so it doesn't hit the round-limit fallback.
  maxDelegationsPerTurn: 6,
  maxCrossAgentBouncesPerTurn: 2,
  maxParallelDelegations: 3,
});

const DECISION_DESCRIPTIONS = Object.freeze({
  continue: 'Continue the current workflow — present the summary and keep the conversation going.',
  ask_user: 'Present the summary and ask the user what they want to do next.',
  stop_and_summarize: 'Present a final summary of what was accomplished. No further delegation.',
  switch_agent: 'The user needs the other specialist — delegate to them as a follow-up.',
  retry_step: 'The last step failed in a way that might succeed on retry.',
  abort: 'Unrecoverable failure — tell the user something went wrong.',
});

/**
 * Hard guards that deterministically narrow the allowed decision set.
 *
 * @param {object} ctx
 * @param {number} ctx.retriesUsed
 * @param {boolean} ctx.hardFailure - specialist status=failed AND errors present
 * @param {boolean} ctx.userActionRequired
 * @param {string} ctx.specialistStatus
 * @param {string} ctx.specialistRecommendation
 * @param {number} ctx.specialistInvocationsThisTurn
 * @param {number} ctx.crossAgentBounces - times decision engine picked switch_agent this turn
 * @returns {string[]} allowed decisions
 */
function getAllowedDecisions(ctx) {
  let allowed = [...ALL_DECISIONS];

  // Guard: retries exhausted → can't retry
  if (ctx.retriesUsed >= AGENT_LIMITS.specialistMaxRetries) {
    allowed = allowed.filter(d => d !== 'retry_step');
  }

  // Guard: hard failure → only retry or abort
  if (ctx.hardFailure) {
    allowed = allowed.filter(d => d === 'retry_step' || d === 'abort');
    // If retry also removed by exhaustion, only abort remains
    return allowed.length > 0 ? allowed : ['abort'];
  }

  // Guard: user action required → only ask_user or abort
  if (ctx.userActionRequired) {
    allowed = allowed.filter(d => d === 'ask_user' || d === 'abort');
    return allowed.length > 0 ? allowed : ['ask_user'];
  }

  // Guard: blocked → can't continue as if nothing happened
  if (ctx.specialistStatus === 'blocked') {
    allowed = allowed.filter(d => d !== 'continue');
  }

  // Guard: cross-agent bounce limit reached → can't switch again
  if ((ctx.crossAgentBounces || 0) >= AGENT_LIMITS.maxCrossAgentBouncesPerTurn) {
    allowed = allowed.filter(d => d !== 'switch_agent');
  }

  return allowed;
}

/**
 * Validate that a decision is in the allowed set.
 * Returns the decision if valid, throws otherwise.
 */
function validateDecision(decision, allowed) {
  if (!allowed.includes(decision)) {
    throw new Error(
      `Invalid orchestrator decision "${decision}". Allowed: [${allowed.join(', ')}]`
    );
  }
  return decision;
}

/**
 * Build a focused prompt for Gemini to reason over allowed decisions.
 */
function buildDecisionPrompt(response, ctx, allowed) {
  const optionsList = allowed
    .map(d => `- "${d}": ${DECISION_DESCRIPTIONS[d]}`)
    .join('\n');

  return `A specialist agent just completed work. Decide what the orchestrator should do next.

SPECIALIST RESPONSE:
- Agent: ${response.agent}
- Status: ${response.status}
- Workflow: ${response.workflow}
- Step: ${response.step} (${response.step_status})
- Summary: ${response.summary}
- Confidence: ${response.confidence ?? 'N/A'}
- Specialist recommends: ${response.recommended_orchestrator_action}
- Next suggested step: ${response.next_suggested_step || 'none'}
- User action required: ${response.user_action_required}
- Errors: ${response.errors?.length ? response.errors.join('; ') : 'none'}
- Warnings: ${response.warnings?.length ? response.warnings.join('; ') : 'none'}

CONTEXT:
- Retries used: ${ctx.retriesUsed}/${ctx.maxRetries}
- Specialist invocations this turn: ${ctx.specialistInvocationsThisTurn}

ALLOWED DECISIONS (choose exactly one):
${optionsList}

Respond with ONLY a JSON object: {"decision": "<one of the allowed values>", "reason": "<brief explanation>"}`;
}

/**
 * Parse the decision from a Gemini response text.
 * Returns the decision string or null if unparseable.
 */
function parseDecisionResponse(text) {
  // Try JSON parse first
  try {
    const obj = JSON.parse(text.trim());
    if (obj.decision) return obj.decision;
  } catch { /* fall through */ }

  // Try extracting from ```json block
  const jsonMatch = text.match(/```json\s*\n?([\s\S]*?)\n?```/);
  if (jsonMatch) {
    try {
      const obj = JSON.parse(jsonMatch[1].trim());
      if (obj.decision) return obj.decision;
    } catch { /* fall through */ }
  }

  // Try matching a bare quoted decision
  const bareMatch = text.match(/"(continue|ask_user|stop_and_summarize|switch_agent|retry_step|abort)"/);
  if (bareMatch) return bareMatch[1];

  return null;
}

/**
 * Choose execution mode for image-heavy requests.
 * Determines whether images should go to one census call or be split across parallel calls.
 *
 * @param {{ imageCount: number, imagesLikelyRelated: boolean, independentGroups: number }} input
 * @returns {'single_batch' | 'parallel_groups' | 'sequential'}
 */
function chooseExecutionMode({ imageCount, imagesLikelyRelated, independentGroups }) {
  if (imagesLikelyRelated) return 'single_batch';
  if (independentGroups > 1) return 'parallel_groups';
  return 'sequential';
}

module.exports = {
  ALL_DECISIONS,
  AGENT_LIMITS,
  DECISION_DESCRIPTIONS,
  getAllowedDecisions,
  validateDecision,
  buildDecisionPrompt,
  parseDecisionResponse,
  chooseExecutionMode,
};
