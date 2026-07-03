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
     ORDER BY created_at ASC, id ASC`,
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

/**
 * Enrich visible messages (user + model) with the tool actions that occurred
 * between them. Attaches an `actions` array to each model message.
 */
// Matches the scan-completion marker row written by scanJobService — the chat
// renders these as a compact "items found / reviewed" pill, not a bubble.
const SCAN_REVIEW_MARKER = /^Found (\d+) items? in .+ scan \u2014 review card shown\.$/u;

function enrichMessagesWithActions(allMessages) {
  const visibleMessages = allMessages.filter(m => m.role === 'user' || m.role === 'model');
  return visibleMessages.map((msg, idx) => {
    if (msg.role === 'model') {
      const prevVisibleIdx = idx > 0 ? allMessages.indexOf(visibleMessages[idx - 1]) : -1;
      const thisIdx = allMessages.indexOf(msg);
      const toolCalls = allMessages
        .slice(prevVisibleIdx + 1, thisIdx)
        .filter(m => m.role === 'tool_call')
        .map(tc => ({
          tool: tc.tool_name,
          args: tc.tool_args,
          result: allMessages.find(
            m => m.role === 'tool_result' && m.tool_name === tc.tool_name &&
                 allMessages.indexOf(m) > allMessages.indexOf(tc) && allMessages.indexOf(m) < thisIdx
          )?.tool_response,
        }));
      const marker = SCAN_REVIEW_MARKER.exec(msg.content || '');
      if (marker) {
        return { ...msg, actions: toolCalls, kind: 'scan_review', scanCount: parseInt(marker[1], 10) };
      }
      return { ...msg, actions: toolCalls };
    }
    return msg;
  });
}

// ── Conversation Starters / Quick-Start Chips ────────────────────────────────
// These query inventory state to generate contextual prompts for new sessions.

/**
 * Analyze inventory state and return contextual conversation starters.
 * Used to give agents a smart opening message for new sessions.
 */
async function getConversationStarters(userId) {
  const locations = await db.any(
    `SELECT id, name, location_type FROM locations WHERE user_id = $1`, [userId]
  );
  const collections = await db.any(
    `SELECT c.id, c.name, c.location_id, COUNT(i.id)::int AS item_count
     FROM collections c
     LEFT JOIN items i ON i.collection_id = c.id
     WHERE c.user_id = $1
     GROUP BY c.id`, [userId]
  );
  const itemStats = await db.oneOrNone(
    `SELECT COUNT(*)::int AS total,
            COUNT(CASE WHEN weight_lbs IS NULL OR weight_lbs = 0 THEN 1 END)::int AS missing_weight,
            COUNT(CASE WHEN length_in IS NULL OR width_in IS NULL OR height_in IS NULL THEN 1 END)::int AS missing_dimensions,
            COUNT(CASE WHEN picture_url IS NULL OR picture_url = '' THEN 1 END)::int AS missing_photos
     FROM items WHERE user_id = $1`, [userId]
  ) || { total: 0, missing_weight: 0, missing_dimensions: 0, missing_photos: 0 };

  const largestWithoutMeasurements = await db.any(
    `SELECT name, weight_lbs FROM items
     WHERE user_id = $1 AND (length_in IS NULL OR width_in IS NULL OR height_in IS NULL)
     ORDER BY COALESCE(weight_lbs, 0) DESC LIMIT 5`, [userId]
  );

  const starters = [];

  if (locations.length === 0) {
    starters.push('NEW_USER: No locations set up yet. Start with onboarding flow.');
    return starters;
  }

  if (locations.length === 1) {
    starters.push(`SINGLE_LOCATION: User only has "${locations[0].name}". Ask if they are planning a move soon or if they'd like to add a destination.`);
  }

  const emptyRooms = collections.filter(c => c.item_count === 0);
  if (emptyRooms.length > 0) {
    const names = emptyRooms.map(r => `"${r.name}"`).join(', ');
    starters.push(`EMPTY_ROOMS: ${emptyRooms.length} room(s) have no items: ${names}. Ask if they'd like to catalog these rooms.`);
  }

  if (largestWithoutMeasurements.length > 0 && itemStats.missing_dimensions > 3) {
    const itemNames = largestWithoutMeasurements.slice(0, 3).map(i => `"${i.name}"`).join(', ');
    starters.push(`MISSING_DIMENSIONS: ${itemStats.missing_dimensions} items are missing dimensions. Largest ones: ${itemNames}. Offer to help estimate measurements for these.`);
  }

  if (itemStats.missing_weight > 5) {
    starters.push(`MISSING_WEIGHT: ${itemStats.missing_weight} of ${itemStats.total} items have no weight estimate. Offer to help fill these in.`);
  }

  if (itemStats.total > 10 && itemStats.missing_photos > itemStats.total * 0.7) {
    starters.push(`MISSING_PHOTOS: ${itemStats.missing_photos} of ${itemStats.total} items have no photo. Suggest taking photos room by room.`);
  }

  if (itemStats.total > 20 && emptyRooms.length === 0 && itemStats.missing_dimensions < 3) {
    starters.push(`GREAT_PROGRESS: Inventory looks solid with ${itemStats.total} items. Ask if they'd like a summary, want to review anything, or are ready to plan their move.`);
  }

  if (collections.length > 0 && itemStats.total < 5 && itemStats.total > 0) {
    starters.push(`GETTING_STARTED: Only ${itemStats.total} items logged across ${collections.length} rooms. Encourage them to keep going — offer to work room by room.`);
  }

  return starters;
}

/**
 * Return up to 3 contextual quick-start chips based on inventory state.
 * Each chip has { label, message } — label is what the user sees, message is sent on click.
 */
async function getQuickStartChips(userId) {
  const locations = await db.any(
    `SELECT id, name FROM locations WHERE user_id = $1`, [userId]
  );
  const collections = await db.any(
    `SELECT c.id, c.name, COUNT(i.id)::int AS item_count
     FROM collections c
     LEFT JOIN items i ON i.collection_id = c.id
     WHERE c.user_id = $1
     GROUP BY c.id`, [userId]
  );
  const itemStats = await db.oneOrNone(
    `SELECT COUNT(*)::int AS total,
            COUNT(CASE WHEN weight_lbs IS NULL OR weight_lbs = 0 THEN 1 END)::int AS missing_weight,
            COUNT(CASE WHEN length_in IS NULL OR width_in IS NULL OR height_in IS NULL THEN 1 END)::int AS missing_dimensions,
            COUNT(CASE WHEN picture_url IS NULL OR picture_url = '' THEN 1 END)::int AS missing_photos
     FROM items WHERE user_id = $1`, [userId]
  ) || { total: 0, missing_weight: 0, missing_dimensions: 0, missing_photos: 0 };

  const candidates = [];
  const totalItems = itemStats.total;
  const roomNames = collections.map(c => c.name.toLowerCase());
  const emptyRooms = collections.filter(c => c.item_count === 0);
  const sparseRooms = collections.filter(c => c.item_count > 0 && c.item_count < 3);
  const populatedRooms = collections.filter(c => c.item_count > 5);
  const hasKitchen = roomNames.some(r => r.includes('kitchen'));
  const hasLivingRoom = roomNames.some(r => r.includes('living'));

  if (locations.length === 0) {
    candidates.push({ label: "I'm planning a move", message: "I'm planning a move", priority: 100 });
    candidates.push({ label: 'Help me get organized', message: 'I want to catalog and organize my stuff', priority: 90 });
    candidates.push({ label: "Let's go room by room", message: "Let's go room by room and catalog everything", priority: 90 });
  }

  if (collections.length > 0 && totalItems < 10) {
    const room = emptyRooms.length > 0 ? emptyRooms[0].name : collections[0].name;
    candidates.push({ label: `📸 Scan my ${room}`, message: `I want to scan my ${room} with a photo or video`, priority: 82 });
    candidates.push({ label: `✏️ Type my items`, message: `I'll list my ${room} items by text`, priority: 81 });
    candidates.push({ label: `🪄 Fill it in for me`, message: `Auto-generate typical items for my ${room}`, priority: 80 });
  }
  if (collections.length < 3 || !hasKitchen || !hasLivingRoom) {
    candidates.push({ label: 'What rooms should I add?', message: 'What rooms am I missing?', priority: 75 });
  }

  if (emptyRooms.length > 0 && totalItems >= 10) {
    const room = emptyRooms[0].name;
    candidates.push({ label: `Catalog my ${room}`, message: `Let's add items to the ${room}`, priority: 60 });
  }
  if (itemStats.missing_weight > 10) {
    candidates.push({ label: 'Add weights to my items', message: 'Can you help estimate weights for items missing them?', priority: 60 });
  }
  if (itemStats.missing_dimensions > 10) {
    candidates.push({ label: `Add dimensions to ${itemStats.missing_dimensions} items`, message: 'Help me add dimensions to items that need them', priority: 60 });
  }
  if (sparseRooms.length > 0) {
    const room = sparseRooms[0].name;
    candidates.push({ label: `Scan ${room} with a photo`, message: `I want to take a photo of my ${room} to catalog it`, priority: 60 });
  }

  if (populatedRooms.length > 0) {
    const room = populatedRooms[0].name;
    candidates.push({ label: `Review my ${room}`, message: `Can you review what's in my ${room}?`, priority: 50 });
  }
  if (totalItems > 10 && itemStats.missing_photos > totalItems * 0.3) {
    candidates.push({ label: `${itemStats.missing_photos} items need photos`, message: 'Which items are missing photos?', priority: 50 });
  }
  if (totalItems > 10) {
    candidates.push({ label: 'What am I missing?', message: 'What items or rooms might I be forgetting?', priority: 50 });
  }

  if (totalItems > 15) {
    candidates.push({ label: 'How big is my move?', message: 'Based on my inventory, how big is my move?', priority: 45 });
  }
  if (totalItems > 20) {
    candidates.push({ label: 'Estimate my costs', message: 'Can you estimate the cost of my move?', priority: 45 });
    candidates.push({ label: 'What truck do I need?', message: 'What size truck do I need for my move?', priority: 45 });
  }

  if (totalItems > 15) {
    candidates.push({ label: 'Show my inventory summary', message: 'Give me a summary of my inventory', priority: 40 });
  }
  if (totalItems > 20) {
    candidates.push({ label: "How's my progress?", message: 'How complete is my inventory? What still needs work?', priority: 40 });
  }

  const nonEmptyRooms = collections.filter(c => c.item_count > 0);
  if (nonEmptyRooms.length > 0) {
    const room = nonEmptyRooms[0].name;
    candidates.push({ label: `Add items to ${room}`, message: `I want to add more items to ${room}`, priority: 30 });
  }
  if (nonEmptyRooms.length > 1) {
    const room = nonEmptyRooms[1].name;
    candidates.push({ label: `What's in my ${room}?`, message: `What do I have in my ${room}?`, priority: 30 });
  }

  candidates.sort((a, b) => b.priority - a.priority);
  return candidates.slice(0, 3).map(({ label, message }) => ({ label, message }));
}

module.exports = {
  getActiveSession,
  getSessionMessages,
  listSessions,
  getSession,
  archiveSession,
  enrichMessagesWithActions,
  getConversationStarters,
  getQuickStartChips,
};
