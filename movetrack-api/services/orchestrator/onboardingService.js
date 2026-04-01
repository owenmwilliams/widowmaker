'use strict';

const knex = require('../infra/knex');
const conn = require('../infra/db');
const db = conn.db;

/**
 * Set the user's name and goal during onboarding.
 */
async function setUserProfile(userId, args = {}) {
  const updates = {};
  if (args.first_name) updates.first_name = args.first_name;
  if (args.last_name) updates.last_name = args.last_name;
  updates.updated_at = new Date();
  await knex('users').where({ user_id: userId }).update(updates);
  if (args.goal) console.log(`[orchestrator] User goal set: ${args.goal}`);
  return { success: true, name: `${args.first_name || ''} ${args.last_name || ''}`.trim() };
}

/**
 * Create a new location (home address) during onboarding.
 */
async function setLocation(userId, args = {}) {
  const params = {
    user_id: userId,
    name: args.name || 'Home',
    location_type: 'primary_residence',
  };
  if (args.address) params.address = args.address;
  if (args.city) params.city = args.city;
  if (args.state) params.state = args.state;
  if (args.zip) params.zip = args.zip;

  const [location] = await knex.transaction(async (trx) => {
    const [loc] = await knex('locations').transacting(trx).insert(params).returning(['id', 'name']);
    await knex('permissions').transacting(trx).insert({
      user_id: userId,
      resource_id: loc.id,
      resource_type: 'location',
      permission_level: 'owner',
      granted_by: userId,
    });
    return [loc];
  });

  console.log(`[orchestrator] Created location: "${args.name}" (id: ${location.id})`);
  return { success: true, locationId: location.id, name: args.name };
}

/**
 * Mark the user's onboarding as complete.
 */
async function markOnboardingComplete(userId) {
  await db.none(
    `UPDATE users SET onboarding_completed = true, updated_at = NOW() WHERE user_id = $1`,
    [userId]
  );
  console.log(`[orchestrator] Onboarding marked complete for user: ${userId}`);
  return { success: true, message: 'Onboarding marked complete.' };
}

module.exports = {
  setUserProfile,
  setLocation,
  markOnboardingComplete,
};
