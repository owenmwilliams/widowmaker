'use strict';

const conn = require('../infra/db');
const db = conn.db;
const census = require('../census/censusService');
const censusAgent = require('../../agents/censusAgent');
const vectorAgent = require('../../agents/vectorAgent');
const onboarding = require('./onboardingService');

/**
 * Build tool handlers for the Nexus orchestrator agent.
 * Wraps worker agent delegation and onboarding tools.
 */
function buildToolHandlers(userId, attachments, plan, onEvent) {
  // Wrap onEvent so worker agents' 'done' and 'error' events don't leak
  // into the orchestrator's SSE stream (orchestrator emits its own 'done')
  const workerEvent = onEvent
    ? (event) => { if (event.type !== 'done' && event.type !== 'error') onEvent(event); }
    : null;

  return {
    async delegate_to_census(args) {
      const workerAttachments = args.include_attachments ? attachments : [];
      const result = await censusAgent.processMessage(
        userId, args.message, workerAttachments, plan, workerEvent
      );
      return {
        success: true,
        reply: result.reply,
        actions: result.actions || [],
        sessionId: result.sessionId,
      };
    },

    async delegate_to_vector(args) {
      const result = await vectorAgent.processMessage(
        userId, args.message, [], plan, workerEvent
      );
      return {
        success: true,
        reply: result.reply,
        actions: result.actions || [],
        sessionId: result.sessionId,
      };
    },

    async get_inventory_status() {
      const snapshot = await census.getInventorySnapshot(userId);
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
      return onboarding.setLocation(userId, args);
    },

    async mark_onboarding_complete() {
      return onboarding.markOnboardingComplete(userId);
    },
  };
}

module.exports = { buildToolHandlers };
