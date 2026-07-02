'use strict';

const conn = require('../infra/db');
const db = conn.db;
const { getInventoryTextSummary } = require('../inventory/inventorySummaryQueryService');
const censusAgent = require('../../agents/censusAgent');
const vectorAgent = require('../../agents/vectorAgent');
const onboarding = require('./onboardingService');
const locationMutation = require('./locationMutationService');
const inventoryMutation = require('../inventory/inventoryMutationService');
const shareService = require('../inventory/shareService');
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
      // Auto-forward any attachments on this turn to Census — it's the only
      // agent that analyzes media. Relying on the orchestrator LLM to set
      // include_attachments dropped photos/videos whenever it forgot the flag
      // (Census then received the URL as prose and analyzed nothing — see
      // beta-scan-reliability-investigation.md Section 3.8 / 0.3).
      const workerAttachments = Array.isArray(attachments) && attachments.length > 0 ? attachments : [];
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

    // Create a public, mover-shareable inventory link the user can text/email.
    async create_share(args = {}) {
      const share = await shareService.createShare(userId, {
        title: args.title || null,
        moveId: args.move_id || null,
      });
      return { success: true, url: share.url, token: share.token };
    },

    // Create rooms directly (deterministic, budget-free). Room creation is a
    // pure DB mutation with no LLM step, so the orchestrator does it itself
    // instead of spending a delegation on Census. This keeps onboarding's room
    // setup from ever being dropped by delegation-budget exhaustion — the beta's
    // "processing limit left the Bathroom uncreated" bug (investigation 0.4).
    async create_rooms(args = {}) {
      const raw = Array.isArray(args.rooms) ? args.rooms : (args.rooms ? [args.rooms] : []);
      const names = [...new Set(raw.map(n => String(n || '').trim()).filter(Boolean))].slice(0, 20);
      if (names.length === 0) return { success: false, error: 'No room names provided' };

      // Rooms need a home location. Check once up front so "no location yet"
      // returns one clear message instead of an identical per-room failure list
      // (rooms are created during onboarding right after set_location).
      const locationId = await inventoryMutation.getPrimaryLocationId(userId);
      if (!locationId) {
        return {
          success: false,
          created: [],
          roomsCreated: 0,
          failed: [],
          error: 'No home location set yet — set the location first, then I can create the rooms.',
        };
      }

      const created = [];
      const failed = [];
      for (const name of names) {
        try {
          const r = await inventoryMutation.addRoom(userId, { name });
          if (r && r.success) created.push(r.name || name);
          else failed.push({ name, error: r?.error || 'unknown' });
        } catch (e) {
          failed.push({ name, error: e.message });
        }
      }
      return {
        success: created.length > 0,
        created,
        roomsCreated: created.length,
        failed,
        error: created.length === 0 ? (failed[0]?.error || 'No rooms created') : undefined,
      };
    },
  };
}

module.exports = { buildToolHandlers };
