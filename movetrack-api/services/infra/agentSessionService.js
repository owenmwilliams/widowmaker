/**
 * agentSessionService.js
 *
 * Shared DB helpers for nexus_sessions / nexus_messages.
 * All three agent routes (nexus, census, vector) delegate here.
 */

const conn = require('./db');
const db = conn.db;

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Build the SQL IN-list condition for one or more session types. */
function sessionTypeCondition(sessionType) {
  if (Array.isArray(sessionType)) {
    const list = sessionType.map(t => `'${t}'`).join(', ');
    return `session_type IN (${list})`;
  }
  return `session_type = '${sessionType}'`;
}

// ── Exports ───────────────────────────────────────────────────────────────────

/**
 * Return the most-recently-updated active session for a user.
 * @param {string} userId
 * @param {string|string[]} sessionType  e.g. 'nexus' or ['census','onboarding','general']
 * @param {string} [extraColumns]  optional extra columns to SELECT (comma-prefixed)
 */
async function getActiveSession(userId, sessionType, extraColumns = '') {
  const condition = sessionTypeCondition(sessionType);
  return db.oneOrNone(
    `SELECT id, title, session_type, is_active, created_at, updated_at${extraColumns}
     FROM nexus_sessions
     WHERE user_id = $1 AND is_active = TRUE AND ${condition}
     ORDER BY updated_at DESC LIMIT 1`,
    [userId]
  );
}

/**
 * Return all messages for a session, oldest first.
 */
async function getSessionMessages(sessionId) {
  return db.any(
    `SELECT id, role, content, tool_name, tool_args, tool_response, attachments, created_at
     FROM nexus_messages WHERE session_id = $1
     ORDER BY created_at ASC`,
    [sessionId]
  );
}

/**
 * Return up to `limit` sessions for a user, newest first.
 */
async function listSessions(userId, limit = 50) {
  return db.any(
    `SELECT id, title, session_type, items_added, rooms_added, is_active, created_at, updated_at
     FROM nexus_sessions WHERE user_id = $1
     ORDER BY updated_at DESC LIMIT $2`,
    [userId, limit]
  );
}

/**
 * Return a single session by id (must belong to userId).
 */
async function getSession(userId, sessionId) {
  return db.oneOrNone(
    `SELECT * FROM nexus_sessions WHERE id = $1 AND user_id = $2`,
    [sessionId, userId]
  );
}

/**
 * Soft-delete (archive) a session. Returns the pg-promise result object.
 * Optionally restrict to a specific session type.
 */
async function archiveSession(sessionId, userId, sessionType = null) {
  const typeClause = sessionType
    ? ` AND ${sessionTypeCondition(sessionType)}`
    : '';
  return db.result(
    `UPDATE nexus_sessions SET is_active = FALSE, updated_at = NOW()
     WHERE id = $1 AND user_id = $2 AND is_active = TRUE${typeClause}`,
    [sessionId, userId]
  );
}

module.exports = {
  getActiveSession,
  getSessionMessages,
  listSessions,
  getSession,
  archiveSession
};
