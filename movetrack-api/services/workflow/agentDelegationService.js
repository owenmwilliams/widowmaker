'use strict';

const conn = require('../infra/db');
const db = conn.db;
const { getInventoryTextSummary } = require('../inventory/inventorySummaryQueryService');
const censusAgent = require('../../agents/censusAgent');
const vectorAgent = require('../../agents/vectorAgent');
const onboarding = require('./onboardingService');
const locationMutation = require('./locationMutationService');
const { validateSpecialistResponse } = require('../../agents/schemas/specialistResponse');

/**
 * Build tool handlers for the Nexus orchestrator agent.
 * Wraps worker agent delegation and onboarding tools.
 */
function buildToolHandlers(userId, attachments, plan, onEvent) {
  // Wrap onEvent so worker agents' 'done' and 'error' events don't leak
  // into the orchestrator's SSE stream (orchestrator emits its own 'done').
  // Tag each bubbled-up event with the source agent name and delegationId.
  const makeWorkerEvent = onEvent
    ? (agentName, delegationId) => (event) => {
        if (event.type !== 'done' && event.type !== 'error') {
          onEvent({ ...event, source: agentName, ...(delegationId ? { delegationId } : {}) });
        }
      }
    : () => null;

  return {
    async delegate_to_census(args, delegationId) {
      const workerAttachments = args.include_attachments ? attachments : [];
      const result = await censusAgent.processMessage(
        userId, args.message, workerAttachments, plan, makeWorkerEvent('census', delegationId)
      );
      try {
        const validated = validateSpecialistResponse(result);
        return { ...validated, actions: result.actions || [], sessionId: result.sessionId };
      } catch (err) {
        console.error('[delegation] Census response validation failed:', err.message, result);
        return {
          status: 'failed', agent: 'census', workflow: 'unknown', step: 'unknown',
          step_status: 'failed', summary: result.summary || result.reply || 'Census returned an invalid response.',
          user_action_required: false, recommended_orchestrator_action: 'continue',
          next_suggested_step: null, state_delta: {}, artifacts: {},
          warnings: ['Specialist response validation failed: ' + err.message], errors: [],
          actions: result.actions || [], sessionId: result.sessionId,
        };
      }
    },

    async delegate_to_vector(args, delegationId) {
      const result = await vectorAgent.processMessage(
        userId, args.message, [], plan, makeWorkerEvent('vector', delegationId)
      );
      try {
        const validated = validateSpecialistResponse(result);
        return { ...validated, actions: result.actions || [], sessionId: result.sessionId };
      } catch (err) {
        console.error('[delegation] Vector response validation failed:', err.message, result);
        return {
          status: 'failed', agent: 'vector', workflow: 'unknown', step: 'unknown',
          step_status: 'failed', summary: result.summary || result.reply || 'Vector returned an invalid response.',
          user_action_required: false, recommended_orchestrator_action: 'continue',
          next_suggested_step: null, state_delta: {}, artifacts: {},
          warnings: ['Specialist response validation failed: ' + err.message], errors: [],
          actions: result.actions || [], sessionId: result.sessionId,
        };
      }
    },

    async get_inventory_status() {
      const snapshot = await getInventoryTextSummary(userId);
      return { success: true, snapshot };
    },

    async get_user_profile() {
      const user = await db.oneOrNone(
        `SELECT first_name, last_name, email, onboarding_completed FROM users WHERE user_id = $1`,
        [userId]
      );
      const locations = await db.any(
        `SELECT id, name, type, is_primary FROM locations WHERE user_id = $1 ORDER BY is_primary DESC, name ASC`,
        [userId]
      );
      return {
        success: true,
        user: user ? {
          name: `${user.first_name || ''} ${user.last_name || ''}`.trim(),
          email: user.email,
          onboarding_completed: user.onboarding_completed,
        } : null,
        locations: locations.map(l => ({ id: l.id, name: l.name, type: l.type, isPrimary: l.is_primary })),
      };
    },

    // Onboarding tools (owned by orchestrator)
    async set_user_profile(args) {
      return onboarding.setUserProfile(userId, args);
    },

    async set_location(args) {
      return locationMutation.setLocation(userId, args);
    },

    async update_location(args) {
      return locationMutation.updateLocation(userId, args);
    },

    async mark_onboarding_complete() {
      return onboarding.markOnboardingComplete(userId);
    },
  };
}

module.exports = { buildToolHandlers };
