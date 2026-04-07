'use strict';

const { inventoryReadinessAssessment } = require('../../services/inventory/inventoryMaturityService');
const { moveReadinessAssessment } = require('../../services/move/moveMaturityService');

// ── Maturity Enums ───────────────────────────────────────────────────────────

const INVENTORY_MATURITY_LEVELS = Object.freeze([
  'none', 'seeded', 'basic', 'reasonable', 'mature', 'quote_ready',
]);

const MOVE_READINESS_LEVELS = Object.freeze([
  'none', 'origin_defined', 'origin_destination_defined', 'planning_ready', 'quote_ready',
]);

const QUOTE_READINESS_LEVELS = Object.freeze(['none', 'partial', 'ready']);

// ── Maturity Mapping ─────────────────────────────────────────────────────────

/**
 * Map inventoryReadinessAssessment status to the guidance maturity enum.
 */
function mapInventoryMaturity(assessment) {
  const { status, overall } = assessment;
  if (status === 'not_started') return 'none';
  if (status === 'early') return overall >= 15 ? 'seeded' : 'none';
  if (status === 'in_progress') return overall >= 55 ? 'reasonable' : 'basic';
  if (status === 'almost_ready') return 'mature';
  if (status === 'ready') return 'quote_ready';
  return 'none';
}

/**
 * Derive quoteReadiness from inventory + move readiness.
 */
function deriveQuoteReadiness(inventoryMaturity, moveReadiness) {
  if (
    (inventoryMaturity === 'mature' || inventoryMaturity === 'quote_ready') &&
    (moveReadiness === 'planning_ready' || moveReadiness === 'quote_ready')
  ) {
    return 'ready';
  }
  if (
    inventoryMaturity !== 'none' && inventoryMaturity !== 'seeded' &&
    moveReadiness !== 'none'
  ) {
    return 'partial';
  }
  return 'none';
}

// ── Guidance Context Builder ─────────────────────────────────────────────────

/**
 * Build the full WorkflowGuidanceContext for a user.
 *
 * @param {string} userId
 * @returns {Promise<{
 *   inventoryMaturity: string,
 *   moveReadiness: string,
 *   quoteReadiness: string,
 *   blockers: string[],
 *   opportunities: string[],
 *   recommendedNextSteps: Array<{ action: string, reason: string, priority: number }>
 * }>}
 */
async function buildWorkflowGuidanceContext(userId) {
  const [inventoryAssessment, moveAssessment] = await Promise.all([
    inventoryReadinessAssessment(userId),
    moveReadinessAssessment(userId),
  ]);

  const inventoryMaturity = mapInventoryMaturity(inventoryAssessment);
  const moveReadiness = moveAssessment.readiness;
  const quoteReadiness = deriveQuoteReadiness(inventoryMaturity, moveReadiness);

  // Collect blockers from both assessments
  const blockers = [...moveAssessment.blockers];
  if (inventoryMaturity === 'none') {
    blockers.push('No inventory started');
  }

  // Build opportunities from inventory next steps
  const opportunities = [];
  for (const step of inventoryAssessment.nextSteps || []) {
    opportunities.push(step);
  }

  // Build recommended next steps (prioritized)
  const steps = [];
  let priority = 1;

  // Highest priority: get started if nothing exists
  if (inventoryMaturity === 'none') {
    steps.push({ action: 'Start cataloging items', reason: 'No inventory yet — this is the first step', priority: priority++ });
  }

  // Origin/destination gaps
  if (!moveAssessment.hasOrigin) {
    steps.push({ action: 'Set up origin address', reason: 'Needed to plan the move', priority: priority++ });
  }
  if (!moveAssessment.hasDestination) {
    steps.push({ action: 'Add destination address', reason: 'Required for route planning and quotes', priority: priority++ });
  }

  // Inventory depth
  if (inventoryMaturity === 'seeded' || inventoryMaturity === 'basic') {
    steps.push({ action: 'Continue building inventory', reason: `Inventory is ${inventoryMaturity} — add more items for better estimates`, priority: priority++ });
  }

  // Move dates
  if (moveAssessment.hasSavedMove && !moveAssessment.hasMoveDates) {
    steps.push({ action: 'Set target move dates', reason: 'Dates help with scheduling and pricing', priority: priority++ });
  }

  // Quote readiness
  if (quoteReadiness === 'partial') {
    steps.push({ action: 'Fill remaining gaps for a quote', reason: 'Almost ready — a few more details needed', priority: priority++ });
  }
  if (quoteReadiness === 'ready') {
    steps.push({ action: 'Get a move estimate', reason: 'Enough data for a meaningful estimate', priority: priority++ });
  }

  return {
    inventoryMaturity,
    moveReadiness,
    quoteReadiness,
    blockers,
    opportunities,
    recommendedNextSteps: steps.slice(0, 4), // cap at top 4
  };
}

// ── Prompt Formatting ────────────────────────────────────────────────────────

/**
 * Format the workflow guidance context as text for system prompt injection.
 *
 * @param {{ inventoryMaturity: string, moveReadiness: string, quoteReadiness: string, blockers: string[], opportunities: string[], recommendedNextSteps: Array<{ action: string, reason: string, priority: number }> }} ctx
 * @returns {string}
 */
function formatGuidanceForPrompt(ctx) {
  const lines = [];

  lines.push(`Inventory maturity: ${ctx.inventoryMaturity}`);
  lines.push(`Move readiness: ${ctx.moveReadiness}`);
  lines.push(`Quote readiness: ${ctx.quoteReadiness}`);

  if (ctx.blockers.length > 0) {
    lines.push(`Blockers: ${ctx.blockers.join('; ')}`);
  }
  if (ctx.opportunities.length > 0) {
    lines.push(`Opportunities: ${ctx.opportunities.join('; ')}`);
  }
  if (ctx.recommendedNextSteps.length > 0) {
    lines.push('Recommended next steps:');
    for (const step of ctx.recommendedNextSteps) {
      lines.push(`  ${step.priority}. ${step.action} — ${step.reason}`);
    }
  }

  return lines.join('\n');
}

module.exports = {
  INVENTORY_MATURITY_LEVELS,
  MOVE_READINESS_LEVELS,
  QUOTE_READINESS_LEVELS,
  mapInventoryMaturity,
  deriveQuoteReadiness,
  buildWorkflowGuidanceContext,
  formatGuidanceForPrompt,
};
