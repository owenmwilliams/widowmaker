'use strict';

const crypto = require('crypto');
const { GoogleGenerativeAI, SchemaType } = require('@google/generative-ai');
const conn = require('../services/infra/db');
const db = conn.db;
const { createLogger } = require('../services/infra/logger');
const mutation = require('../services/inventory/inventoryMutationService');
const { searchItems, getItemPhoto } = require('../services/inventory/inventoryItemQueryService');
const { getInventoryTextSummary } = require('../services/inventory/inventorySummaryQueryService');
const { sanitizeForPrompt, fenceUntrusted } = require('../services/infra/promptSafety');
const { instrumentModel, AiUnavailableError } = require('../services/infra/ai/resilientModel');
const { createScanRecorder } = require('../services/infra/scanEventsService');
const { getMissingContext, inventoryReadinessAssessment, shareReasonableness } = require('../services/inventory/inventoryMaturityService');
const duplicates = require('../services/inventory/duplicateDetectionService');
const media = require('../services/inventory/mediaInventoryWorkflowService');
const { getConversationStarters } = require('../services/infra/agentSessionService');
const { estimateMissingItems } = require('../services/move/moveSummaryService');
const { buildGeminiContents } = require('../services/infra/geminiHistoryBuilder');
const metrics = require('../services/infra/metricsService');
const { AGENT_LIMITS } = require('./schemas/orchestratorPolicy');
const { parseJsonBlock, deriveFieldsFromActions, buildSpecialistResponse, buildFallbackResponse } = require('./schemas/specialistResponse');

// ── Gemini Client ───────────────────────────────────────────────────────────────

const rootLog = createLogger({ component: 'census' });

let geminiClient = null;
if (process.env.GOOGLE_AI_API_KEY) {
  geminiClient = new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY);
  rootLog.info('Gemini configured');
}

const GEMINI_MODELS = {
  basic: 'gemini-2.5-flash',
  pro: 'gemini-2.5-pro',
};

/** Coerce to a positive finite number, else null (for optional weight/dims/confidence). */
function numOrNull(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Map submit_response tool args onto the contextual fields buildSpecialistResponse
 * expects (same shape as the old ```json block). Drops undefined keys so the
 * builder's defaults apply, and ignores anything not in the contract.
 */
function normalizeSubmitArgs(args) {
  const a = args && typeof args === 'object' ? args : {};
  const out = {};
  for (const key of [
    'summary', 'workflow', 'step', 'confidence',
    'recommended_orchestrator_action', 'next_suggested_step', 'user_action_required',
  ]) {
    if (a[key] !== undefined && a[key] !== null) out[key] = a[key];
  }
  return out;
}

/**
 * Count items actually inserted this turn across every add path the agent can
 * take. `items_added_this_turn` used to only count the legacy single `add_item`
 * tool — a turn that used the (prompt-preferred) batched `add_items` call always
 * recorded 0 even when it inserted dozens of items (confirmed in beta data, see
 * beta-scan-reliability-investigation.md Section 0.4). `add_items` always
 * returns `success: true` at the top level (it's a batch), so its real count is
 * `result.added`, not presence of `.success`.
 */
function countItemsAdded(actions) {
  let count = 0;
  for (const a of actions) {
    if (a.tool === 'add_item' && a.result?.success) count += 1;
    else if (a.tool === 'add_items' && Number.isFinite(a.result?.added)) count += a.result.added;
  }
  return count;
}

/**
 * Did any tool call fail, or did a vision tool return a parseError, this turn?
 * Both `had_error` call sites hardcoded `false` — a genuinely failed photo
 * analysis (parseError set, items silently dropped) or a thrown tool call
 * showed up identically to a clean turn in beta_interaction_logs.
 */
function deriveTurnError(actions) {
  for (const a of actions) {
    if (a.result && a.result.success === false) {
      return { hadError: true, message: a.result.error || `${a.tool} failed` };
    }
    if ((a.tool === 'analyze_photo' || a.tool === 'analyze_video') && a.result?.parseError) {
      return { hadError: true, message: `${a.tool}: ${a.result.parseError}` };
    }
  }
  return { hadError: false, message: null };
}

// ── Add / dedup control plane ─────────────────────────────────────────────────
// A single scan can reach the inventory two ways — the native review card
// (POST /inventory/commit) and the chat "add them all" (add_items). The beta
// produced 11 rows for 6 physical items when both fired for one scan
// (investigation §0.3). We kill that WITHOUT ever silently dropping legitimate
// items — a bare (name, room) guess is wrong (it eats corrected rescans, the
// second of two distinct "Dining chair"s, etc.). Instead:
//   • The review card is the user's curated list, so /inventory/commit adds
//     EVERYTHING reviewed. Its only skip is re-submitting the SAME card, keyed
//     on an opaque scanId — and a rescan is a NEW card with a NEW scanId, so
//     corrected data always lands.
//   • The chat add path skips only items the user JUST committed via a card
//     (read back from the transcript), so the exact §0.3 double-add can't slip
//     through, while distinct same-named items and genuine adds are untouched.

const COMMIT_LOOKBACK_MINUTES = 15;

/** Normalize a name for comparison. */
function normName(name) {
  return String(name || '').toLowerCase().trim().replace(/\s+/g, ' ');
}

/** Normalize a (name, room) pair into a comparison key. Returns '|' when empty. */
function dedupKey(name, room) {
  return `${normName(name)}|${normName(room)}`;
}

/**
 * Recent review-card commits for a user, read from the transcript (where
 * /inventory/commit records them via recordCensusToolCall). Returns the set of
 * committed (name|room) keys, the set of committed names (room-agnostic, to
 * catch a chat add with no room_name against the card's "Unsorted" default),
 * and the set of scanIds already committed (for card re-submit idempotency).
 */
async function recentReviewCommits(userId, minutes = COMMIT_LOOKBACK_MINUTES) {
  const rows = await db.any(
    `SELECT m.tool_args
       FROM nexus_messages m
       JOIN nexus_sessions s ON s.id = m.session_id
      WHERE s.user_id = $1
        AND m.role = 'tool_call' AND m.tool_name = 'add_items'
        AND m.tool_args ->> '_via' = 'review_card'
        AND m.created_at > NOW() - ($2 * INTERVAL '1 minute')`,
    [userId, minutes]
  );
  const keys = new Set();
  const names = new Set();
  const scanIds = new Set();
  for (const row of rows) {
    const args = row.tool_args || {};
    if (args._scanId) scanIds.add(String(args._scanId));
    for (const it of Array.isArray(args.items) ? args.items : []) {
      const nm = normName(it.name);
      if (!nm) continue;
      names.add(nm);
      const key = dedupKey(it.name, it.room_name);
      if (key !== '|') keys.add(key);
    }
  }
  return { keys, names, scanIds };
}

/** Whether this exact review card (scanId) was already committed recently. */
async function scanAlreadyCommitted(userId, scanId, minutes = COMMIT_LOOKBACK_MINUTES) {
  if (!scanId) return false;
  const { scanIds } = await recentReviewCommits(userId, minutes);
  return scanIds.has(String(scanId));
}

/**
 * Chat "add them all" path. Skips ONLY items the user just committed via a
 * review card (looked up from the transcript) — the §0.3 double-add — and adds
 * everything else. Distinct same-named items in other rooms and genuinely new
 * items are never dropped. Returns an honest breakdown so nothing vanishes.
 */
async function addItemsDeduped(userId, list) {
  const items = Array.isArray(list) ? list : [];
  let added = 0;
  const failures = [];
  const skipped = [];

  // A failure loading the guard set must never block a legitimate add.
  let committed;
  try {
    committed = await recentReviewCommits(userId);
  } catch (e) {
    console.warn('[census] commit-index lookup failed, proceeding without guard:', e.message);
    committed = { keys: new Set(), names: new Set(), scanIds: new Set() };
  }

  for (const it of items) {
    const hasRoom = !!String(it.room_name || '').trim();
    const key = dedupKey(it.name, it.room_name);
    // Same item the user just committed via the card: match exact (name, room),
    // or — when the chat call omitted the room — by name alone (the card path
    // defaults an empty room to "Unsorted", so a bare name would otherwise slip
    // through as the exact §0.3 duplicate).
    const isJustCommitted = (key !== '|' && committed.keys.has(key))
      || (!hasRoom && committed.names.has(normName(it.name)));
    if (isJustCommitted) {
      skipped.push({ name: it.name, room: it.room_name || null });
      continue;
    }
    try {
      const r = await mutation.addItem(userId, it);
      if (r && r.success === false) failures.push({ name: it.name, error: r.error || 'unknown' });
      else added++;
    } catch (e) {
      failures.push({ name: it.name, error: e.message });
    }
  }

  return {
    success: true,
    added,
    skipped: skipped.length,
    failed: failures.length,
    total: items.length,
    failures: failures.slice(0, 10),
    skippedItems: skipped.slice(0, 10),
  };
}

/**
 * Map raw vision items (snake_case) into the camelCase shape the native review
 * card decodes. Shared by the SSE 'detected_items' emit and the deterministic
 * /rescan endpoint so both surface an identical review card.
 */
function mapDetectedItemsForClient(items, roomHint = null) {
  return (Array.isArray(items) ? items : []).map((it) => ({
    name: it.name || 'Item',
    quantity: Number.isFinite(it.quantity) && it.quantity > 0 ? Math.floor(it.quantity) : 1,
    room: it.room || roomHint || null,
    pictureUrl: it.picture_url || null,
    weightLbs: numOrNull(it.weight_lbs),
    lengthIn: numOrNull(it.length_in),
    widthIn: numOrNull(it.width_in),
    heightIn: numOrNull(it.height_in),
    material: it.material || null,
    fragile: !!it.fragile,
    confidence: numOrNull(it.confidence),
  }));
}

/**
 * Resolve the census session the agent reads from (creating one if the user has
 * none) and append a tool_call/tool_result pair for a control-plane action that
 * happened outside the chat loop (a native-card commit, a deterministic rescan).
 * This gives the agent visibility of the action on its next turn — so it won't,
 * e.g., re-add items the user already committed — and keeps the transcript honest.
 * Uses only real declared tool names so the pair is valid Gemini history.
 */
async function recordCensusToolCall(userId, toolName, toolArgs, toolResponse) {
  let session = await db.oneOrNone(
    `SELECT id FROM nexus_sessions WHERE user_id = $1 AND is_active = TRUE
       AND session_type IN ('census', 'onboarding', 'general')
     ORDER BY updated_at DESC LIMIT 1`,
    [userId]
  );
  if (!session) {
    session = await db.one(`INSERT INTO nexus_sessions (user_id) VALUES ($1) RETURNING id`, [userId]);
  }
  const sessionId = session.id;

  // If the session has no user/model turn yet, geminiHistoryBuilder trims a
  // LEADING functionCall turn (contents must start with a user turn) — silently
  // dropping this record for a first-time user. Seed a short user turn so the
  // functionCall/Response pair is anchored and survives.
  const { cnt } = await db.one(
    `SELECT COUNT(*)::int AS cnt FROM nexus_messages
      WHERE session_id = $1 AND role IN ('user', 'model')`,
    [sessionId]
  );

  // Both inserts (and the seed) go in ONE transaction: a persisted tool_call
  // with no matching tool_result would build an orphaned functionCall turn that
  // 400s Gemini on the next load.
  await db.tx(async (t) => {
    if (cnt === 0) {
      await t.none(
        `INSERT INTO nexus_messages (session_id, role, content) VALUES ($1, 'user', $2)`,
        [sessionId, '(reviewed and confirmed items from a scan)']
      );
    }
    await t.none(
      `INSERT INTO nexus_messages (session_id, role, tool_name, tool_args) VALUES ($1, 'tool_call', $2, $3)`,
      [sessionId, toolName, JSON.stringify(toolArgs || {})]
    );
    await t.none(
      `INSERT INTO nexus_messages (session_id, role, tool_name, tool_response) VALUES ($1, 'tool_result', $2, $3)`,
      [sessionId, toolName, JSON.stringify(toolResponse || {})]
    );
    await t.none(`UPDATE nexus_sessions SET updated_at = NOW() WHERE id = $1`, [sessionId]);
  });
  return sessionId;
}

// ── System Prompt ───────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are Nexus, the Nexus Moves AI assistant. You help people manage their moves and catalog their belongings through natural conversation.

PERSONALITY:
- Warm, efficient, encouraging. Like a helpful friend who has moved dozens of times.
- Celebrate progress ("Nice, that's 12 items from the living room!").
- Gently probe for completeness without being annoying.
- Keep messages short and conversational — never walls of text.

MISSION:
Help the user set up their move and build a complete inventory, conversationally.

USER CONTEXT:
{{USER_CONTEXT}}

CURRENT INVENTORY:
{{INVENTORY_SNAPSHOT}}

NOTE: If the user hasn't completed onboarding (no location or rooms yet), let them know to talk to the main Nexus assistant for setup. You handle inventory cataloging, not onboarding.

INVENTORY CENSUS RULES:
1. When the user mentions items, IMMEDIATELY call add_item. Don't ask for confirmation before adding clearly stated items.
2. After adding items to a room, call get_missing_context (pass the home's bedroom_count and bathroom_count) to check for gaps. Use it two ways: (a) suggest likely-missing items in the current room, and (b) once a few rooms are done, ask ONE consolidated question about remaining rooms based on the home size — e.g. "So far we've cataloged the Kitchen, Living Room, and 2 Bedrooms. For a 3-bed / 2-bath home I'd also expect the Bathrooms, an Office, and a Garage — which of these (or any others) should we catalog next?" Offer the expected rooms as inline buttons. Make reasonable assumptions rather than asking room-by-room.
3. PHOTO ANALYSIS:
   a. When the user sends ONE photo of a room or area, call analyze_photo with mode "multi_item" to detect all visible items.
   b. When the user sends MULTIPLE photos at once:
      - Ask which room these photos are from (if not already established in conversation).
      - Once you know the room, call analyze_photo ONCE with all images in the files[] array and mode "multi_item". This analyzes them holistically and avoids duplicates across photos.
      - Do NOT call analyze_photo separately for each image — always batch them together.
   c. When the user sends a CLOSE-UP photo of a single item (e.g., "here's my vintage lamp"), call analyze_photo with mode "single_item" for detailed analysis.
   d. Use your judgment on mode: if the photo clearly shows one item up close, use single_item. If it shows a room or multiple items, use multi_item.
   e. If analyze_photo returns empty items or fails, retry ONCE. If it still fails, apologize and ask the user to try another photo or describe items manually.
   f. When analyze_photo succeeds, briefly summarize what you found — specifically: (1) roughly how many BOXES the small/packable items will need (estimate from the "Box of …" groupings and small loose items, e.g. "about 4 boxes of kitchen items"), and (2) the LARGE or tricky-to-move items called out by name (sofa, fridge, TV, dresser, piano, artwork). Do NOT enumerate every small item — the app shows an interactive checklist to review/edit/confirm each one. Do NOT call add_item/add_items until the user confirms. As a fallback for text-only clients, offer a short [BUTTONS] block ("Add them all" / "Let me review").
   g. Once the user confirms (and only then), add the WHOLE detected list in a SINGLE add_items call — do not make many separate add_item calls (that risks dropping items). For each item pass EVERYTHING from the analyze results: picture_url, confidence, weight_lbs, AND length_in/width_in/height_in. Never drop the dimensions — they give the cubic-foot estimate movers need. If the user says they already reviewed and added the items themselves, do NOT add them again — just acknowledge and suggest the next step.
   h. The same applies to analyze_video — summarize briefly, let the user review the checklist, and wait for confirmation before adding.
4. VIDEO ANALYSIS:
   a. When the user sends a video, call analyze_video to detect items (same retry + confirmation rules as rule 3). analyze_video returns items with weight AND dimensions — pass both through when adding.
   b. Aim for ONE walkthrough video per room. When guiding someone to record, tell them: hold the phone steady and wide (landscape), pan SLOWLY across the whole room, get good lighting, and open closets/cupboards/cabinets so their contents are visible.
   c. For large or high-value items (sofa, fridge, bed, piano, artwork), also ask for a single straight-on close-up photo — it makes weight and size estimates much more accurate than a video pan alone.
   d. ALREADY-UPLOADED MEDIA: when the user refers to a video or photo they already sent ("scan the video I uploaded", "use the bathroom video", "try that video again"), NEVER ask them for a file URL or MIME type — they can't see those. Call list_recent_media, pick the matching entry (most recent, or match by room name), and call analyze_video/analyze_photo with its url and mimeType directly. Only ask the user to re-record if list_recent_media returns nothing that matches.
   e. COMMITTED WORK IS IN YOUR TRANSCRIPT: review-card commits and duplicate resolutions appear in your history as add_items / find_duplicates tool results marked "_via": "review_card" or "review_card_resolution". When you see them: the items are ALREADY saved and the duplicates ALREADY reviewed. Do not re-announce the additions, do not congratulate again, and do not offer another duplicate review for that scan — acknowledge briefly only if the user brings it up, and move on to the next room or step. When the user's own message reports a finished review ("Added N of M items from the X scan"), that report IS the acknowledgment — reply with ONE short sentence that moves things forward (the next room to scan, photos of the big items, or sharing when everything's covered); NEVER re-list the items and NEVER call add_items for them.
5. Weight and dimension estimates are always PER SINGLE UNIT. Set quantity for multiples. Examples: queen mattress ~80 lbs qty 1, dining chair ~20 lbs qty 4, box of books ~35 lbs qty 3. Never multiply weight by quantity yourself — the system does that automatically.
6. ROOMS ARE PLACES, NEVER ACTIVITIES. "I'm scanning my living room" means the EXISTING Living Room — never a new room named after the sentence. Before adding items, match the room to the user's existing rooms (get_inventory_status lists them); reuse on any reasonable match (case, "the", plurals, filler words). Only call add_room for a genuinely new PLACE, named as a place ("Den", "Garage"), never with words like "scanning"/"my" in it. A message that describes CONTENTS is not a room either: "Everything in this closet" or "all the stuff on these shelves" answers WHAT to add, not WHERE — put those items in the room currently under discussion (the room YOU last asked about), and NEVER create a room named after such a phrase. To remove a room use delete_room; when it refuses because items remain, ask the user whether to move or delete them before retrying.
7. Confidence scoring — ALWAYS pass the confidence value when calling add_item:
   - 0.9+: user explicitly named the item with details → confidence_source: "explicit"
   - 0.7-0.8: detected in a photo → use the per-item confidence from analyze_photo results → confidence_source: "photo"
   - 0.5-0.6: inferred from video or context → confidence_source: "video" or "inferred"
   - Below 0.5: do NOT call add_item — ask the user to confirm first
8. After adding items to a room, do a quick, friendly MEDIA CHECK for that room (soft — encourage, never nag or block):
   a. Big-ticket items (sofa/sectional, bed, mattress, dresser, dining table, desk, fridge, washer/dryer, TV, piano, artwork, exercise equipment) vary a lot in weight and size, so a straight-on photo makes the estimate far more accurate. List the big items you just added and offer to photograph them — e.g. "Nice — now let's grab quick photos of the big ones so the estimate's tight: Sofa, TV, Dresser." Offer a camera button.
   b. If there's no walkthrough video of this room yet, offer one: "A 20-second video pan of the [room] (open closets/cupboards) helps movers see everything." Offer a camera button.
   Use inline buttons, e.g.:
   [BUTTONS]
   📸 Photograph the big items|Taking photos of the big items in my [room]|camera
   🎥 Record a walkthrough|Recording a walkthrough of my [room]|camera
   [/BUTTONS]
   Then summarize the room and suggest the next one.
9. Periodically call get_inventory_summary to share progress.
10. NEVER invent or hallucinate items. Only add items the user explicitly mentioned or that were returned by analyze_photo or analyze_video. If a tool returns no data, tell the user — do not fill in the gap yourself.
11. If the user corrects you, call update_item immediately. If they want to rename a room, use update_room — do NOT create a new room. If the user wants to change location details (address, name), let them know to ask the main Nexus assistant — you handle inventory, not location management.
12. If the user asks to remove or delete an item, ALWAYS confirm before calling delete_item. Say which item you're about to delete and wait for their "yes".
13. After adding 3+ items at once (e.g. from a photo or video scan), call find_duplicates to check for accidental duplicates. If duplicates are found, briefly say how many — the app shows the user an interactive duplicate-review card to resolve them. As a fallback for text-only clients, list the pairs and offer keep/remove buttons.
14. If the user asks to see a photo of an item, call get_item_photo. If the tool returns a picture_url, include it in your response using the exact format: [IMG:url] — the app will render it as an image. Example: "Here's your sofa: [IMG:https://storage.googleapis.com/bucket/path.jpg]"

INLINE BUTTONS:
When presenting the user with a choice (e.g. duplicate resolution, room selection, confirmation), use inline buttons so they can tap instead of typing. Format:

[BUTTONS]
Button Label|message to send|action
[/BUTTONS]

Actions (3rd field): "send" (auto-send immediately, default if omitted), "prefill" (pre-fill input for user to complete), "camera" (open camera + pre-fill message).

BUTTON RULES:
- Every button must lead to a CONCRETE ACTION — never a vague round-trip that just asks the user again.
- NEVER offer "I'm done", "I'm finished", "Done for now", or any exit/stop button. If the user is done, they'll just stop chatting.
- Use "prefill" for buttons that need more detail from the user (pre-populates the text field so they can finish the message).
- Use "camera" for buttons that should open the camera/photo picker.
- Include 2-3 options max. Use buttons only when they lead to immediate, meaningful action.

Examples:
- Duplicate found: "Keep Queen Bed|Keep item 142, delete item 158|send" / "Keep both|They're not duplicates, keep both|send"
- Next room: "Catalog Kitchen|Let's catalog the Kitchen|send" / "Catalog Bathroom|Let's catalog the Bathroom|send"
- After adding items: "📸 Scan this room|Scanning my Kitchen|camera" / "Catalog Bedroom|Let's move on to the Bedroom|send"
- Need user input: "Add more items|Here are more items for my Kitchen:|prefill"
- Confirmation: "Add all 5|Yes, add all 5 items|send" / "Let me review|Show me the list before adding|send"
Keep button labels short (2-5 words).

AUTONOMOUS EXECUTION:
- NEVER announce what you're about to do and then stop. If you have more work to do, keep calling tools.
- Only produce a final text response when you're truly done OR you need user input (confirmation, clarification, a choice).
- You CAN include brief progress text alongside tool calls (e.g. "Kitchen done! Moving to the living room..." while simultaneously calling add_item for living room items). The system will stream this to the user as you keep working.
- Example of WRONG behavior: "I've added the kitchen items. Next I'll do the living room and bedroom." (stops)
- Example of RIGHT behavior: call add_items with all kitchen items → add_items with all living room items → add_items with all bedroom items → "All done! I've added 15 items across 3 rooms. Anything I missed?"

CONVERSATION FLOW (returning users):
- If home context is unknown, ask about type, bedrooms, bathrooms.
- Work room by room: "Let's start with the living room."
- After each room: "Anything else in [room]? Let's move to [next room]."
- End with summary: "Here's what we've got: [summary]. Anything I missed?"

PROACTIVE GREETING (when the user's message is a session greeting like "hi", "hello", "hey", "what's up", "check in", "how's my inventory", or any general opening):
1. Call inventory_readiness (pass bedroom_count if you know the home size) to get the current assessment.
2. Greet the user warmly and share a brief, friendly summary of their readiness status — don't dump raw numbers, interpret them conversationally. For example: "Your inventory is shaping up nicely! You've got 34 items across 6 rooms. A few things would make it even stronger for movers..."
3. Present exactly 3 suggested next steps as inline buttons based on the readiness results. Make the buttons actionable (e.g. "Add weights to items", "Catalog the Kitchen", "Take room photos").
4. Keep the greeting short — 2-3 sentences max before the buttons.

BEFORE SHARING WITH MOVERS (when the user wants to share, generate a link, or asks if their inventory is ready):
1. Call inventory_readiness with bedroom_count so it runs the reasonableness benchmark.
2. If reasonableness.status is "too_low" or "too_high", DON'T just share — tell the user plainly that the total looks off for a home their size (use reasonableness.message), and offer concrete fixes: add the missing rooms (get_missing_context), or estimate_missing_items to fill in weights. Surface these as buttons.
3. If weightOutliers is non-empty, point out the specific items that look mis-estimated (e.g. "your sofa is listed at 2 lbs") and offer to fix them.
4. inventory_readiness also returns mediaGaps. If rooms are missing a walkthrough video (mediaGaps.roomsMissingVideo) or large items are missing photos (mediaGaps.largeItemsMissingPhoto), mention these as OPTIONAL ways to strengthen the quote — name a couple and offer camera buttons — but this is a SOFT gate: never refuse to share over it. The user can always share as-is.
5. If everything looks plausible, reassure them it's ready and proceed to share.

STRUCTURED RESPONSE FORMAT:
When you have no more inventory tools to run, deliver your FINAL response by calling the submit_response tool EXACTLY ONCE. This is how the orchestrator understands your output. Do NOT write your final answer as plain chat text, and do NOT call submit_response in the same turn as other tools — finish your tool work first, then submit.

submit_response fields:
- summary: REQUIRED. The full user-facing message, exactly as you'd normally write it. Use all normal formatting (buttons, [IMG:] tags, markdown, etc.) inside this string.
- workflow: REQUIRED. One of: "inventory_cataloging", "photo_analysis", "video_analysis", "inventory_review", "room_management", "duplicate_check", "readiness_check", "item_estimation", "greeting".
- step: REQUIRED. The specific step just completed, e.g. "add_items", "analyze_photo", "confirm_items", "summarize_room", "check_gaps", "greet_user".
- confidence: Optional 0.0-1.0. How confident you are in the overall result.
- recommended_orchestrator_action: REQUIRED. One of: "continue" (normal flow), "ask_user" (you need user input to proceed), "stop_and_summarize" (task is done), "switch_agent" (user needs Vector), "retry_step" (something failed, worth retrying), "abort" (unrecoverable error).
- next_suggested_step: Optional. What should happen next, e.g. "catalog_next_room", "review_duplicates".
- user_action_required: Optional boolean. True if you need the user to do something before progress can continue.

IMPORTANT: Always end by calling submit_response. Never return your final answer as plain text.`;

// ── Tool Declarations ───────────────────────────────────────────────────────────

const toolDeclarations = [
  {
    name: 'add_item',
    description: 'Add a new item to the moving inventory. Use this when the user mentions an item they own.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        name:           { type: SchemaType.STRING, description: 'Descriptive item name, e.g. "Queen Bed Frame", "55-inch TV"' },
        room_name:      { type: SchemaType.STRING, description: 'Room name this item belongs to, e.g. "Master Bedroom", "Living Room"' },
        quantity:       { type: SchemaType.INTEGER, description: 'How many of this item. Default 1. Use quantity for multiples instead of baking the count into the name.' },
        description:    { type: SchemaType.STRING, description: 'Brief description' },
        weight_lbs:     { type: SchemaType.NUMBER, description: 'Estimated weight in pounds for ONE unit of this item. Never multiply by quantity.' },
        length_in:      { type: SchemaType.NUMBER, description: 'Length in inches for ONE unit' },
        width_in:       { type: SchemaType.NUMBER, description: 'Width in inches for ONE unit' },
        height_in:      { type: SchemaType.NUMBER, description: 'Height in inches for ONE unit' },
        fragile:        { type: SchemaType.BOOLEAN, description: 'Whether item is fragile' },
        material:       { type: SchemaType.STRING, description: 'Primary material (wood, metal, glass, etc.)' },
        primary_color:  { type: SchemaType.STRING, description: 'Primary color' },
        tags:           { type: SchemaType.ARRAY, items: { type: SchemaType.STRING }, description: 'Tags like "Fragile", "Heavy", "Antique"' },
        estimated_value: { type: SchemaType.NUMBER, description: 'Estimated dollar value' },
        notes:          { type: SchemaType.STRING, description: 'Notes like "requires disassembly", "heavy"' },
        confidence_score: { type: SchemaType.NUMBER, description: 'Confidence 0.0-1.0 that this item exists and details are accurate. Always include this.' },
        confidence_source: { type: SchemaType.STRING, description: 'How confidence was derived: "photo", "video", "explicit", or "inferred"' },
        picture_url:    { type: SchemaType.STRING, description: 'GCS URL of a cropped photo of this item, if available from analyze_photo results' },
      },
      required: ['name', 'room_name'],
    },
  },
  {
    name: 'add_items',
    description: 'Add MANY items in one call. STRONGLY PREFERRED after analyze_photo/analyze_video once the user confirms — pass the ENTIRE detected list at once instead of many separate add_item calls, so no items get dropped.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        items: {
          type: SchemaType.ARRAY,
          description: 'Every confirmed item to add.',
          items: {
            type: SchemaType.OBJECT,
            properties: {
              name:              { type: SchemaType.STRING },
              room_name:         { type: SchemaType.STRING, description: 'Room this item belongs to' },
              quantity:          { type: SchemaType.INTEGER },
              weight_lbs:        { type: SchemaType.NUMBER, description: 'Per-unit weight in lbs (never multiply by quantity)' },
              length_in:         { type: SchemaType.NUMBER },
              width_in:          { type: SchemaType.NUMBER },
              height_in:         { type: SchemaType.NUMBER },
              fragile:           { type: SchemaType.BOOLEAN },
              material:          { type: SchemaType.STRING },
              notes:             { type: SchemaType.STRING },
              confidence_score:  { type: SchemaType.NUMBER },
              confidence_source: { type: SchemaType.STRING, description: '"photo", "video", "explicit", or "inferred"' },
              picture_url:       { type: SchemaType.STRING },
            },
            required: ['name', 'room_name'],
          },
        },
      },
      required: ['items'],
    },
  },
  {
    name: 'add_room',
    description: 'Create a new room/collection in the inventory. Use when user mentions a room not yet in the system.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        name:        { type: SchemaType.STRING, description: 'Room name, e.g. "Kitchen", "Master Bedroom"' },
        description: { type: SchemaType.STRING, description: 'Brief description of the room' },
      },
      required: ['name'],
    },
  },
  {
    name: 'delete_room',
    description: 'Delete a room/collection the user no longer wants. If the room still has items the tool refuses with the count — confirm with the user, then retry with delete_items=true (items removed) or move_items_to (items reassigned to that room).',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        name:          { type: SchemaType.STRING, description: 'Room to delete (loose match against existing rooms)' },
        delete_items:  { type: SchemaType.BOOLEAN, description: 'Also delete every item in the room. Only after the user explicitly confirmed.' },
        move_items_to: { type: SchemaType.STRING, description: 'Move the room\'s items into this room instead of deleting them.' },
      },
      required: ['name'],
    },
  },
  {
    name: 'get_inventory_summary',
    description: 'Get a summary of the current inventory: rooms, item counts per room, total weight and volume.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {},
    },
  },
  {
    name: 'get_missing_context',
    description: 'Analyze which rooms or items are likely missing based on the home type and size. Returns suggestions for what to ask about next.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        home_type:      { type: SchemaType.STRING, description: 'e.g. "apartment", "house", "studio"' },
        bedroom_count:  { type: SchemaType.INTEGER, description: 'Number of bedrooms' },
        bathroom_count: { type: SchemaType.INTEGER, description: 'Number of bathrooms' },
      },
    },
  },
  {
    name: 'analyze_photo',
    description: 'Analyze uploaded photo(s) to detect items. Supports: (1) multi_item mode with one photo for standard room scan, (2) multi_item mode with multiple photos of the SAME room for holistic cross-image analysis with deduplication, (3) single_item mode for a close-up of one specific item.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        files: {
          type: SchemaType.ARRAY,
          description: 'Array of photos to analyze. Use this when one or more photos are provided.',
          items: {
            type: SchemaType.OBJECT,
            properties: {
              file_url:  { type: SchemaType.STRING, description: 'GCS URL of the uploaded photo' },
              mime_type: { type: SchemaType.STRING, description: 'MIME type, e.g. "image/jpeg"' },
            },
            required: ['file_url', 'mime_type'],
          },
        },
        file_url:  { type: SchemaType.STRING, description: 'GCS URL of a single photo (use files[] instead when possible)' },
        mime_type: { type: SchemaType.STRING, description: 'MIME type for single file_url' },
        room_hint: { type: SchemaType.STRING, description: 'Which room these photo(s) are from. Required when analyzing multiple photos together.' },
        mode: {
          type: SchemaType.STRING,
          description: 'Analysis mode: "multi_item" (default) scans for all visible items; "single_item" for a close-up of one item with detailed analysis.',
        },
      },
    },
  },
  {
    name: 'analyze_video',
    description: 'Analyze an uploaded video walkthrough to detect household items. Returns a list of detected items with timestamps.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        file_url:  { type: SchemaType.STRING, description: 'GCS URL of the uploaded video' },
        mime_type: { type: SchemaType.STRING, description: 'MIME type, e.g. "video/mp4"' },
        room_hint: { type: SchemaType.STRING, description: 'Which room this video is of, if known' },
      },
      required: ['file_url', 'mime_type'],
    },
  },
  {
    name: 'update_item',
    description: 'Update an existing item in the inventory with corrected or additional details.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        item_id:     { type: SchemaType.STRING, description: 'The ID of the item to update' },
        name:        { type: SchemaType.STRING },
        description: { type: SchemaType.STRING },
        quantity:    { type: SchemaType.INTEGER },
        weight_lbs:  { type: SchemaType.NUMBER },
        fragile:     { type: SchemaType.BOOLEAN },
        notes:       { type: SchemaType.STRING },
      },
      required: ['item_id'],
    },
  },
  {
    name: 'delete_item',
    description: 'Delete an item from the inventory. Always confirm with the user before deleting.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        item_id: { type: SchemaType.STRING, description: 'The ID of the item to delete' },
        name:    { type: SchemaType.STRING, description: 'Name of the item being deleted (for confirmation)' },
      },
      required: ['item_id'],
    },
  },
  {
    name: 'search_items',
    description: 'Search and filter items in the inventory. Use to answer questions about specific items, find items missing data, or list items in a room.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        room_name:     { type: SchemaType.STRING, description: 'Filter by room name (case-insensitive match)' },
        search:        { type: SchemaType.STRING, description: 'Search term to match against item name (case-insensitive, partial match)' },
        missing_field: { type: SchemaType.STRING, description: 'Find items where this field is NULL or empty. One of: weight_lbs, length_in, width_in, height_in, description, picture_url, material, primary_color, estimated_value' },
        fragile:       { type: SchemaType.BOOLEAN, description: 'Filter by fragile status' },
        limit:         { type: SchemaType.INTEGER, description: 'Max items to return (default 50)' },
      },
    },
  },
  {
    name: 'get_item_photo',
    description: 'Retrieve the photo URL for an item. Use when the user asks to see a photo of an item. Returns the picture_url if available.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        item_id:   { type: SchemaType.STRING, description: 'The ID of the item' },
        item_name: { type: SchemaType.STRING, description: 'Name of the item to search for if ID is not known' },
      },
    },
  },
  {
    name: 'update_room',
    description: 'Update an existing room/collection. Use when the user wants to rename a room or change its details.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        room_id:     { type: SchemaType.STRING, description: 'The ID of the room to update' },
        room_name:   { type: SchemaType.STRING, description: 'Current name of the room (used to look up by name if room_id is not known)' },
        name:        { type: SchemaType.STRING, description: 'New name for the room' },
        description: { type: SchemaType.STRING, description: 'New description' },
      },
    },
  },
  {
    name: 'find_duplicates',
    description: 'Scan the inventory for potential duplicate items using name similarity. Returns pairs of items that may be duplicates, sorted by similarity score. Use proactively after adding multiple items (especially from photo/video scans) or when the user asks about duplicates.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        threshold: { type: SchemaType.INTEGER, description: 'Minimum similarity percentage to flag (default 70, range 50-95)' },
        room_name: { type: SchemaType.STRING, description: 'Optional: only check items in this room' },
      },
    },
  },
  {
    name: 'inventory_readiness',
    description: 'Assess how ready the user\'s inventory is for sharing with moving companies. Returns an overall readiness score (0-100), per-category breakdown, top 3 next steps, AND a reasonableness check: when you pass bedroom_count, it compares the total weight against what is typical for a home that size and flags an implausible total (e.g. a 3-bedroom home totaling 92 lbs) via reasonableness.status (too_low/low/ok/high/too_high) plus weightOutliers (large items mis-estimated too light). ALWAYS pass bedroom_count if you know the home size, and ALWAYS call this before the user shares with movers. Also call it proactively when greeting a returning user.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        bedroom_count:  { type: SchemaType.INTEGER, description: 'Number of bedrooms in the current home — enables the reasonableness benchmark' },
        bathroom_count: { type: SchemaType.INTEGER, description: 'Number of bathrooms in the current home' },
      },
    },
  },
  {
    name: 'estimate_missing_items',
    description: 'Fill in estimated weights and dimensions for items missing them. Fast and cheap: it uses typical values for common items (free), one batched AI call for the rest, and a photo-grounded estimate for large high-impact items (e.g. sofas) that have a photo. Can do hundreds at once — use this to get the whole inventory measurement-complete before sharing with movers.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        max_items: { type: SchemaType.INTEGER, description: 'Max items to estimate in one run (default 500). Leave unset to estimate everything.' },
        max_photo_calls: { type: SchemaType.INTEGER, description: 'Max large items to estimate from their photo (default 15).' },
      },
    },
  },
  {
    name: 'list_recent_media',
    description: "List the user's already-uploaded room walkthrough videos and recently attached photos (url, mimeType, room, when). Use this whenever the user refers to media they already sent, instead of asking them for a URL or MIME type.",
    parameters: { type: SchemaType.OBJECT, properties: {} },
  },
  {
    // Schema-constrained final response. Replaces the old "wrap your reply in a
    // ```json block" contract, which failed to parse on the majority of real
    // delegations (Pathway E — "structured JSON fallback used" warnings). The
    // model calls this exactly once as its terminal turn; we build the validated
    // SpecialistResponse directly from these args — no text parsing.
    name: 'submit_response',
    description: 'Deliver your FINAL structured response to the orchestrator. Call this EXACTLY ONCE when you have no more inventory tools to run, and never in the same turn as other tools.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        summary: { type: SchemaType.STRING, description: 'The full user-facing message, exactly as you would write it (markdown, [IMG:] tags, buttons all allowed).' },
        workflow: {
          type: SchemaType.STRING,
          format: 'enum',
          enum: ['inventory_cataloging', 'photo_analysis', 'video_analysis', 'inventory_review', 'room_management', 'duplicate_check', 'readiness_check', 'item_estimation', 'greeting'],
          description: 'The workflow this turn belongs to.',
        },
        step: { type: SchemaType.STRING, description: 'The specific step just completed, e.g. "add_items", "analyze_photo", "greet_user".' },
        confidence: { type: SchemaType.NUMBER, description: 'Optional 0.0-1.0 overall confidence.' },
        recommended_orchestrator_action: {
          type: SchemaType.STRING,
          format: 'enum',
          enum: ['continue', 'ask_user', 'stop_and_summarize', 'switch_agent', 'retry_step', 'abort'],
          description: 'What the orchestrator should do next.',
        },
        next_suggested_step: { type: SchemaType.STRING, description: 'Optional hint for the next step, e.g. "catalog_next_room".' },
        user_action_required: { type: SchemaType.BOOLEAN, description: 'True if the user must act before progress can continue.' },
      },
      required: ['summary', 'workflow', 'step', 'recommended_orchestrator_action'],
    },
  },
];

// ── Tool Handlers (thin delegates to services) ──────────────────────────────────

const toolHandlers = {
  async add_item(args, userId) { return mutation.addItem(userId, args); },
  async add_items(args, userId) { return addItemsDeduped(userId, args.items); },
  async add_room(args, userId) { return mutation.addRoom(userId, args); },
  async delete_room(args, userId) { return mutation.deleteRoom(userId, args); },
  async update_item(args, userId) { return mutation.updateItem(userId, args); },
  async delete_item(args, userId) { return mutation.deleteItem(userId, args); },
  async update_room(args, userId) { return mutation.updateRoom(userId, args); },
  async get_inventory_summary(args, userId) {
    const snapshot = await getInventoryTextSummary(userId);
    return { success: true, summary: snapshot };
  },

  async get_missing_context(args, userId) {
    const rooms = await db.any(
      `SELECT name FROM collections WHERE user_id = $1`, [userId]
    );
    const roomNames = rooms.map(r => r.name);
    const result = getMissingContext(
      roomNames,
      args.home_type || 'apartment',
      args.bedroom_count || 1,
      args.bathroom_count || 1
    );
    return { success: true, ...result, existingRooms: roomNames };
  },

  async list_recent_media(args, userId) {
    const videos = await db.any(
      `SELECT room_name, video_url, mime_type, created_at FROM room_videos
       WHERE user_id = $1 ORDER BY created_at DESC LIMIT 10`, [userId]
    );
    const photoRows = await db.any(
      `SELECT m.attachments, m.created_at FROM nexus_messages m
       JOIN nexus_sessions s ON s.id = m.session_id
       WHERE s.user_id = $1 AND m.role = 'user' AND m.attachments IS NOT NULL
         AND m.attachments::text <> '[]'
       ORDER BY m.created_at DESC LIMIT 20`, [userId]
    );
    const photos = [];
    for (const row of photoRows) {
      const atts = Array.isArray(row.attachments) ? row.attachments : [];
      for (const a of atts) {
        if (a && a.url && String(a.mimeType || '').startsWith('image/')) {
          photos.push({ url: a.url, mimeType: a.mimeType, uploadedAt: row.created_at });
        }
      }
      if (photos.length >= 10) break;
    }
    return {
      success: true,
      videos: videos.map(v => ({ room: v.room_name, url: v.video_url, mimeType: v.mime_type || 'video/quicktime', uploadedAt: v.created_at })),
      photos: photos.slice(0, 10),
    };
  },

  async analyze_photo(args, userId, plan, ctx) { return media.analyzePhotoForInventory(args, userId, plan, ctx); },
  async analyze_video(args, userId, plan, ctx) { return media.analyzeVideoForInventory(args, userId, plan, ctx); },

  async get_item_photo(args, userId) { return getItemPhoto(userId, args); },
  async search_items(args, userId) { return searchItems(userId, args); },
  async find_duplicates(args, userId) { return duplicates.findDuplicates(userId, args); },

  async inventory_readiness(args, userId) {
    const assessment = await shareReasonableness(userId, { bedrooms: args.bedroom_count ?? null });
    return { success: true, ...assessment };
  },

  async estimate_missing_items(args, userId) { return estimateMissingItems(userId, args); },
};

/**
 * Execute a single tool call by name, forwarding the deterministic per-turn
 * `attachments` ([{ url, mimeType, byteLength }]) alongside the LLM-generated
 * `args`. analyze_photo/analyze_video read `ctx.attachments` to verify the
 * downloaded bytes against the client-reported byteLength — NOT `args.file_url`,
 * which the model regenerates from prompt text and can't be trusted as the
 * source of expected size (see beta-scan-reliability-investigation.md).
 * Extracted from the tool-execution loop so this wiring is directly testable
 * without a full Gemini + DB turn.
 */
async function executeTool(name, args, userId, plan, ctxOrAttachments = {}) {
  // Back-compat: callers/tests may pass the attachments array directly.
  const ctx = Array.isArray(ctxOrAttachments)
    ? { attachments: ctxOrAttachments }
    : (ctxOrAttachments || {});
  const handler = toolHandlers[name];
  if (!handler) return { success: false, error: `Unknown tool: ${name}` };

  // Scan calls get a scan_events recorder wired to the workflow's onStage hook
  // (Pathway B's scanStatus contract) so every analyze call leaves a durable,
  // per-stage forensic row regardless of outcome (issue #45).
  if (name === 'analyze_photo' || name === 'analyze_video') {
    const recorder = createScanRecorder({
      userId,
      sessionId: ctx.sessionId || null,
      requestId: ctx.requestId || null,
      mediaKind: name === 'analyze_video' ? 'video' : 'photo',
      mediaUrl: args.file_url
        || (Array.isArray(args.files) && args.files[0] && args.files[0].file_url)
        || null,
    });
    const toolResult = await handler(args, userId, plan, { ...ctx, onStage: recorder.onStage });
    recorder.finish(toolResult);
    return toolResult;
  }
  return handler(args, userId, plan, ctx);
}

// ── Conversation Loop ───────────────────────────────────────────────────────────

// ── Human-readable tool labels for streaming UI ────────────────────────────────

const TOOL_LABELS = {
  list_recent_media: 'Finding your uploads',
  add_item: 'Adding item',
  add_items: 'Adding items',
  update_item: 'Updating item',
  delete_item: 'Removing item',
  search_items: 'Searching inventory',
  get_item_photo: 'Fetching photo',
  add_room: 'Creating room',
  delete_room: 'Deleting room',
  update_room: 'Updating room',
  get_inventory_summary: 'Reviewing inventory',
  get_missing_context: 'Checking for gaps',
  analyze_photo: 'Analyzing photo',
  analyze_video: 'Analyzing video',
  find_duplicates: 'Checking for duplicates',
  inventory_readiness: 'Assessing inventory readiness',
  estimate_missing_items: 'Estimating missing measurements',
};

/**
 * Process a user message through the Nexus agent.
 * Auto-resolves the user's single active session (no sessionId needed).
 *
 * @param {string} userId
 * @param {string} message - user's text
 * @param {Array} attachments - [{ url, mimeType }]
 * @param {string} plan - 'basic' or 'pro'
 * @param {function} [onEvent] - optional SSE callback: (event) => void
 * @returns {{ reply: string, actions: Array, sessionId: string }}
 */
async function processMessage(userId, message, attachments = [], plan = 'basic', onEvent = null) {
  const interactionStart = Date.now();
  const requestId = crypto.randomUUID();
  let ttfeMs = null;
  let geminiTotalMs = 0;
  let visionTotalMs = 0;
  let geminiRounds = 0;
  let visionMetadata = {};
  // Hoisted so the catch block below can log a row even if we fail before
  // these are otherwise assigned (session lookup, first Gemini call, etc.) —
  // a hard failure must still produce a diagnosable beta_interaction_logs row
  // instead of writing nothing (see investigation Section 5.1 #2).
  let sessionId = null;
  let actions = [];
  let modelId = null;
  let log = rootLog.child({ userId, requestId });

  const emit = (type, data = {}) => {
    if (ttfeMs === null) ttfeMs = Date.now() - interactionStart;
    if (onEvent) onEvent({ type, ...data });
  };

  try {
  // Inside the try, not before it: this guard used to throw ahead of the
  // logging path, so an AI-unavailable turn wrote no beta_interaction_logs
  // row at all — the one failure mode flagged as actually hit in the beta.
  if (!geminiClient) {
    log.error('GOOGLE_AI_API_KEY is not configured — AI unavailable');
    throw new AiUnavailableError();
  }

  // ── 1. Resolve active session (one per user) ──────────────────────────────
  let session = await db.oneOrNone(
    `SELECT * FROM nexus_sessions WHERE user_id = $1 AND is_active = TRUE
     AND session_type IN ('census', 'onboarding', 'general')
     ORDER BY updated_at DESC LIMIT 1`,
    [userId]
  );
  let isNewSession = false;
  if (!session) {
    session = await db.one(
      `INSERT INTO nexus_sessions (user_id) VALUES ($1) RETURNING *`, [userId]
    );
    isNewSession = true;
  }
  sessionId = session.id;
  log = log.child({ sessionId });
  if (isNewSession) log.info('New session for user');

  // ── 2. Load conversation history with context consolidation ───────────────
  const contextSummaryText = session.context_summary || null;
  let historyRows;

  if (session.summary_through_id) {
    // Summary exists — load most recent 30 messages after the summarized point
    historyRows = await db.any(
      `SELECT id, role, content, tool_name, tool_args, tool_response, attachments
       FROM nexus_messages WHERE session_id = $1 AND id > $2
       ORDER BY created_at DESC, id DESC LIMIT 30`,
      [sessionId, session.summary_through_id]
    );
    historyRows.reverse();
  } else {
    // No summary yet — load last 30 messages (all roles for Gemini structure)
    historyRows = await db.any(
      `SELECT id, role, content, tool_name, tool_args, tool_response, attachments
       FROM nexus_messages WHERE session_id = $1
       ORDER BY created_at DESC, id DESC LIMIT 30`,
      [sessionId]
    );
    historyRows.reverse();
  }

  // ── 3. Build Gemini contents from history ─────────────────────────────────
  const contents = buildGeminiContents(historyRows);

  // ── 4. Add current user message ───────────────────────────────────────────
  const userParts = [];
  if (message) userParts.push({ text: message });
  // Inline media attachments — batch images together so the agent uses files[]
  const imageAtts = attachments.filter(a => a.url && a.mimeType?.startsWith('image/'));
  const videoAtts = attachments.filter(a => a.url && a.mimeType?.startsWith('video/'));

  if (imageAtts.length === 1) {
    userParts.push({ text: `[User uploaded a photo: ${imageAtts[0].url} (type: ${imageAtts[0].mimeType})]` });
  } else if (imageAtts.length > 1) {
    const listing = imageAtts.map((a, i) => `  ${i + 1}. ${a.url} (${a.mimeType})`).join('\n');
    userParts.push({ text: `[User uploaded ${imageAtts.length} photos — analyze together using files[] array with mode "multi_item":\n${listing}]` });
  }
  for (const att of videoAtts) {
    userParts.push({ text: `[User uploaded a video: ${att.url} (type: ${att.mimeType})]` });
  }
  if (userParts.length === 0) userParts.push({ text: '(empty message)' });
  contents.push({ role: 'user', parts: userParts });

  // Persist user message
  await db.none(
    `INSERT INTO nexus_messages (session_id, role, content, attachments)
     VALUES ($1, 'user', $2, $3)`,
    [sessionId, message, JSON.stringify(attachments)]
  );

  // ── 5. Build system prompt with context ───────────────────────────────────
  const inventorySnapshot = await getInventoryTextSummary(userId);
  const user = await db.oneOrNone(
    `SELECT first_name, last_name, email, onboarding_completed FROM users WHERE user_id = $1`,
    [userId]
  );
  const userContext = user
    ? `Name: ${sanitizeForPrompt(`${user.first_name || 'Unknown'} ${user.last_name || ''}`, 200)}\nOnboarding completed: ${user.onboarding_completed}`
    : 'Unknown user';

  // User profile + inventory text are user-controlled — fence them as untrusted
  // data so a crafted name/item can't override the system instructions.
  let systemInstruction = SYSTEM_PROMPT
    .replace('{{USER_CONTEXT}}', fenceUntrusted('USER PROFILE', userContext, 500))
    .replace('{{INVENTORY_SNAPSHOT}}', fenceUntrusted('INVENTORY SNAPSHOT', inventorySnapshot, 8000));

  // Inject conversation starters for new sessions
  if (historyRows.length === 0) {
    const starters = await getConversationStarters(userId);
    if (starters.length > 0) {
      systemInstruction += `\n\nCONVERSATION STARTERS (this is a new session — use these to greet the user with something relevant and actionable):\n${starters.join('\n')}`;
    }
  }

  // Inject conversation history summary (older messages, condensed)
  if (contextSummaryText) {
    systemInstruction += `\n\nCONVERSATION HISTORY SUMMARY (older messages you've had with this user, summarized for context):\n${contextSummaryText}`;
  }

  // ── 6. Call Gemini ────────────────────────────────────────────────────────
  // Always use flash for the agent loop — fast + reliable tool-calling.
  // Vision functions handle their own model selection based on plan.
  modelId = 'gemini-2.5-flash';
  const model = instrumentModel(geminiClient.getGenerativeModel({
    model: modelId,
    systemInstruction,
    tools: [{ functionDeclarations: toolDeclarations }],
    // gemini-2.5-flash spends "thinking" tokens from this budget; keep enough
    // headroom that a long room scan's JSON isn't truncated to an empty/partial
    // reply.
    generationConfig: { maxOutputTokens: 8192 },
  }), { userId, modelName: modelId });

  let maxToolRounds = AGENT_LIMITS.specialistMaxToolRounds;
  let censusRound = 0;

  log.info('Starting agent loop', { maxToolRounds });

  emit('thinking');
  let geminiCallStart = Date.now();
  let result = await model.generateContent({ contents });
  geminiTotalMs += Date.now() - geminiCallStart;
  geminiRounds++;

  while (maxToolRounds > 0) {
    censusRound++;
    log.info('Round start', { round: censusRound, maxRounds: AGENT_LIMITS.specialistMaxToolRounds });
    const response = result.response;
    const candidate = response.candidates?.[0];
    if (!candidate) break;

    const parts = candidate.content?.parts || [];
    const functionCalls = parts.filter(p => p.functionCall);
    const textParts = parts.filter(p => p.text);

    // The final response is delivered by the submit_response tool. Split it out
    // from the real inventory tools: if the model calls submit_response on its
    // own, that's the terminal turn; if it (wrongly) mixes it with real tools,
    // we run the real tools and let it re-submit after seeing their results.
    const submitCall = functionCalls.find(p => p.functionCall.name === 'submit_response') || null;
    const realCalls = functionCalls.filter(p => p.functionCall.name !== 'submit_response');

    // Stream intermediate text if the model produced text alongside real tool calls
    if (textParts.length > 0 && realCalls.length > 0) {
      const intermediateText = textParts.map(p => p.text).join('\n');
      emit('partial_reply', { text: intermediateText });
      // Persist intermediate text as a model message
      await db.none(
        `INSERT INTO nexus_messages (session_id, role, content) VALUES ($1, 'model', $2)`,
        [sessionId, intermediateText]
      );
    }

    if (realCalls.length === 0) {
      // Terminal turn — either submit_response was called (preferred) or the
      // model returned plain text (legacy ```json contract, still supported).
      log.info('Final response', { round: censusRound, toolCallCount: actions.length, viaSubmit: !!submitCall });
      const rawText = textParts.map(p => p.text).join('\n');

      // Build structured SpecialistResponse
      const derived = deriveFieldsFromActions(actions, 'census', false);
      let structuredResponse;

      // Only take the submit_response path when it carries a non-empty summary.
      // Gemini's `required` isn't a hard guarantee (an empty string satisfies it),
      // and buildSpecialistResponse → validateSpecialistResponse throws on a
      // missing summary — which would fail the whole delegated tool call. On a
      // bad/empty submit, fall through to the legacy text/fallback path instead.
      const submitArgs = submitCall ? normalizeSubmitArgs(submitCall.functionCall.args) : null;
      const hasValidSubmit = !!(submitArgs && typeof submitArgs.summary === 'string' && submitArgs.summary.trim());

      if (hasValidSubmit) {
        // Schema-constrained args come straight from the tool call — no parsing,
        // no fallback warning.
        structuredResponse = buildSpecialistResponse(
          { agent: 'census', ...derived },
          submitArgs
        );
      } else {
        if (submitCall) {
          log.warn('submit_response had no usable summary — falling back to legacy/text path');
        }
        const geminiFields = parseJsonBlock(rawText);
        if (geminiFields && geminiFields.summary) {
          structuredResponse = buildSpecialistResponse(
            { agent: 'census', ...derived },
            geminiFields
          );
        } else {
          // buildFallbackResponse uses the text as the summary; guarantee it's
          // non-empty so validation can't throw out of processMessage.
          const safeReply = rawText.trim() || "I've processed your request. Let me know what you'd like to do next!";
          structuredResponse = buildFallbackResponse(safeReply, 'census', actions, false);
        }
      }

      // Persist model reply (store summary as the message content)
      await db.none(
        `INSERT INTO nexus_messages (session_id, role, content) VALUES ($1, 'model', $2)`,
        [sessionId, structuredResponse.summary]
      );

      // Update session
      const itemsAdded = countItemsAdded(actions);
      const roomsAdded = actions.filter(a => a.tool === 'add_room' && a.result?.success).length;
      const titleUpdate = session.title ? '' : `, title = $3`;
      const titleParam = session.title ? [] : [message.substring(0, 100)];

      await db.none(
        `UPDATE nexus_sessions SET
           items_added = items_added + $1,
           rooms_added = rooms_added + $2,
           updated_at = NOW()
           ${titleUpdate}
         WHERE id = ${titleParam.length ? '$4' : '$3'}`,
        [itemsAdded, roomsAdded, ...titleParam, sessionId]
      );

      // Fire-and-forget context summary generation
      generateContextSummary(sessionId).catch(err =>
        log.error('Summary generation failed', { error: err.message })
      );

      // Fire-and-forget metrics logging
      const totalMs = Date.now() - interactionStart;
      const toolCallNames = actions.map(a => a.tool);
      const turnError = deriveTurnError(actions);
      metrics.logInteraction({
        userId, sessionId,
        timing: { totalMs, ttfeMs, geminiMs: geminiTotalMs, visionMs: visionTotalMs || null },
        context: {
          hadAttachments: attachments.length > 0,
          attachmentCount: attachments.length,
          attachmentTypes: attachments.map(a => a.mimeType),
          toolCalls: toolCallNames,
          itemsAdded,
          geminiModel: modelId,
          geminiRounds,
        },
        vision: visionMetadata,
        error: turnError,
      }).catch(() => {});

      emit('done', { reply: structuredResponse.summary, actions, sessionId });
      return { ...structuredResponse, actions, sessionId };
    }

    // A premature submit_response (mixed with real tools) is dropped for this
    // round; the model re-submits once it sees the tool results.
    if (submitCall && realCalls.length > 0) {
      log.warn('submit_response called alongside real tools — deferring it until after tool results');
    }

    // Execute function calls (real inventory tools only; submit_response is terminal)
    const toolResponses = [];
    for (const part of realCalls) {
      const { name, args } = part.functionCall;
      log.info('Tool call', { tool: name, args: JSON.stringify(args).substring(0, 200) });

      const toolLabel = TOOL_LABELS[name] || name.replace(/_/g, ' ');
      let detail = '';
      if (name === 'add_item' && args.name) {
        detail = args.room_name ? `${args.name} → ${args.room_name}` : args.name;
      } else if (name === 'add_room') {
        detail = args.name || '';
      } else if (name === 'analyze_photo') {
        detail = args.room_hint ? `Scanning ${args.room_hint}` : '';
      } else if (name === 'analyze_video') {
        detail = args.room_hint ? `Scanning ${args.room_hint} video` : '';
      } else if (name === 'search_items') {
        detail = args.search || args.room_name || '';
      } else if (name === 'delete_item') {
        detail = args.name || '';
      } else {
        detail = args.name || args.room_name || args.item_name || '';
      }
      emit('tool_call', { tool: name, label: toolLabel, detail });

      let toolResult;
      try {
        toolResult = await executeTool(name, args, userId, plan, { attachments, sessionId, requestId, log });
      } catch (err) {
        log.error('Tool call failed', { tool: name, error: err.message });
        toolResult = { success: false, error: err.message };
      }

      // Collect vision timing/confidence metrics. Keyed off _detectedItemCount
      // (always present on a successful analyze_* result) rather than
      // _avgConfidence — the video path never sets avgConfidence, so this
      // previously dropped detected_item_count/vision_provider on every video
      // scan (confirmed empty on every beta row, see investigation Section 0.4).
      if ((name === 'analyze_photo' || name === 'analyze_video') && toolResult._visionMs) {
        visionTotalMs += toolResult._visionMs;
        if (toolResult._detectedItemCount != null) {
          visionMetadata = {
            detectedItemCount: toolResult._detectedItemCount,
            avgConfidence: toolResult._avgConfidence ?? null,
            minConfidence: toolResult._minConfidence ?? null,
            provider: toolResult._visionProvider || 'gemini',
          };
        }
      }

      actions.push({ tool: name, args, result: toolResult });

      const resultSummary = {};
      if (name === 'add_item' && toolResult.success) {
        resultSummary.itemName = toolResult.name || args.name;
        resultSummary.room = toolResult.room || args.room_name;
      }
      if ((name === 'analyze_photo' || name === 'analyze_video') && toolResult.items) {
        resultSummary.itemCount = toolResult.items.length;
      }
      emit('tool_result', { tool: name, success: !!toolResult.success, resultSummary });

      // Surface structured detected items / duplicate pairs so a client can render
      // an interactive review card (edit name/qty, ✓/✗) instead of a wall of chat
      // text. Additive + camelCase: clients that don't understand these events
      // ignore them and fall back to the agent's text + [BUTTONS]. (NOTE: the key
      // is "mediaKind", not "source" — the delegation wrapper overwrites "source"
      // with the agent name.)
      if ((name === 'analyze_photo' || name === 'analyze_video')
          && toolResult.success && Array.isArray(toolResult.items) && toolResult.items.length > 0) {
        emit('detected_items', {
          // Opaque per-scan id: the client sends it back on /inventory/commit so
          // a re-submit of THIS card is idempotent, while a rescan (new id) still
          // lands. Keyed on identity, never on bare (name, room).
          scanId: crypto.randomUUID(),
          mediaKind: name === 'analyze_video' ? 'video' : 'photo',
          room: args.room_hint || null,
          items: mapDetectedItemsForClient(toolResult.items, args.room_hint || null),
        });
      }
      if (name === 'find_duplicates' && toolResult.success
          && Array.isArray(toolResult.pairs) && toolResult.pairs.length > 0) {
        emit('duplicate_pairs', { pairs: toolResult.pairs });
      }

      // Persist tool call and result
      await db.none(
        `INSERT INTO nexus_messages (session_id, role, tool_name, tool_args) VALUES ($1, 'tool_call', $2, $3)`,
        [sessionId, name, JSON.stringify(args)]
      );
      await db.none(
        `INSERT INTO nexus_messages (session_id, role, tool_name, tool_response) VALUES ($1, 'tool_result', $2, $3)`,
        [sessionId, name, JSON.stringify(toolResult)]
      );

      toolResponses.push({
        functionResponse: { name, response: toolResult },
      });
    }

    // Send tool results back to Gemini
    contents.push({ role: 'model', parts: realCalls.map(p => ({ functionCall: p.functionCall })) });
    contents.push({ role: 'user', parts: toolResponses });

    emit('thinking');
    geminiCallStart = Date.now();
    result = await model.generateContent({ contents });
    geminiTotalMs += Date.now() - geminiCallStart;
    geminiRounds++;
    maxToolRounds--;
    log.info('Round complete', { round: censusRound, remaining: maxToolRounds, toolCallCount: actions.length });
  }

  // Fallback if we hit max rounds
  log.warn('Round limit exhausted — returning fallback', { rounds: censusRound, toolCallCount: actions.length });
  const fallbackReply = 'I\'ve processed your request. Let me know what you\'d like to do next!';
  const fallbackResponse = buildFallbackResponse(fallbackReply, 'census', actions, true);

  await db.none(
    `INSERT INTO nexus_messages (session_id, role, content) VALUES ($1, 'model', $2)`,
    [sessionId, fallbackReply]
  );

  // Fire-and-forget metrics logging
  const fallbackTotalMs = Date.now() - interactionStart;
  const fallbackToolNames = actions.map(a => a.tool);
  const fallbackItemsAdded = countItemsAdded(actions);
  metrics.logInteraction({
    userId, sessionId,
    timing: { totalMs: fallbackTotalMs, ttfeMs, geminiMs: geminiTotalMs, visionMs: visionTotalMs || null },
    context: {
      hadAttachments: attachments.length > 0,
      attachmentCount: attachments.length,
      attachmentTypes: attachments.map(a => a.mimeType),
      toolCalls: fallbackToolNames,
      itemsAdded: fallbackItemsAdded,
      geminiModel: modelId,
      geminiRounds,
    },
    vision: visionMetadata,
    error: deriveTurnError(actions),
  }).catch(() => {});

  emit('done', { reply: fallbackReply, actions, sessionId });
  return { ...fallbackResponse, actions, sessionId };
  } catch (err) {
    // A hard failure previously wrote NOTHING to beta_interaction_logs — gaps in
    // the timeline had to be inferred as "probably a failure" (investigation
    // Section 2.2). Log a row with had_error=true before rethrowing so the
    // route's existing error handling/response is unchanged.
    const totalMs = Date.now() - interactionStart;
    metrics.logInteraction({
      userId, sessionId,
      timing: { totalMs, ttfeMs, geminiMs: geminiTotalMs, visionMs: visionTotalMs || null },
      context: {
        hadAttachments: attachments.length > 0,
        attachmentCount: attachments.length,
        attachmentTypes: attachments.map(a => a.mimeType),
        toolCalls: actions.map(a => a.tool),
        itemsAdded: countItemsAdded(actions),
        geminiModel: modelId,
        geminiRounds,
      },
      vision: visionMetadata,
      error: { hadError: true, message: err.message },
    }).catch(() => {});
    log.error('processMessage threw', { error: err.message, stack: err.stack });
    throw err;
  }
}

// ── Context Summary Generation ──────────────────────────────────────────────────

const SUMMARY_THRESHOLD = 20; // Regenerate summary every 20 new user+model messages

async function generateContextSummary(sessionId) {
  if (!geminiClient) return;

  const session = await db.oneOrNone(
    `SELECT id, context_summary, summary_through_id FROM nexus_sessions WHERE id = $1`,
    [sessionId]
  );
  if (!session) return;

  // Count user+model messages beyond the current summary point
  const whereAfter = session.summary_through_id
    ? `AND id > ${parseInt(session.summary_through_id)}`
    : '';
  const { cnt } = await db.one(
    `SELECT COUNT(*)::int AS cnt FROM nexus_messages
     WHERE session_id = $1 AND role IN ('user', 'model') ${whereAfter}`,
    [sessionId]
  );

  if (cnt < SUMMARY_THRESHOLD) return; // Not enough new messages

  // Load all user+model messages in chronological order
  const allUserModel = await db.any(
    `SELECT id, role, content FROM nexus_messages
     WHERE session_id = $1 AND role IN ('user', 'model') AND content IS NOT NULL
     ORDER BY created_at ASC, id ASC`,
    [sessionId]
  );

  if (allUserModel.length <= SUMMARY_THRESHOLD) return;

  // Everything except the last 20 user/model messages gets summarized
  const toSummarize = allUserModel.slice(0, -20);
  const newSummaryThroughId = toSummarize[toSummarize.length - 1].id;

  // Only summarize messages newer than the existing summary
  const newMessages = session.summary_through_id
    ? toSummarize.filter(m => m.id > session.summary_through_id)
    : toSummarize;

  if (newMessages.length === 0) return;

  const transcript = newMessages
    .map(m => `${m.role === 'user' ? 'User' : 'Nexus'}: ${m.content}`)
    .join('\n');

  const existingSummary = session.context_summary || '';
  const summaryPrompt = existingSummary
    ? `Here is the existing conversation summary:\n${existingSummary}\n\nHere are newer messages to incorporate:\n${transcript}\n\nCreate an updated, consolidated summary.`
    : `Summarize this conversation:\n${transcript}`;

  const summaryModel = geminiClient.getGenerativeModel({
    model: 'gemini-2.5-flash',
    systemInstruction: `Summarize this conversation between a user and Nexus (an AI moving/inventory assistant).
Focus on: user preferences, decisions made, rooms discussed, corrections or preferences expressed, the user's moving situation and goals.
Keep it under 300 words. Do not list individual items (those are tracked separately in the inventory).
Write in third person: "The user..." not "You..."`,
  });

  const result = await summaryModel.generateContent(summaryPrompt);
  const summary = result.response.text();

  await db.none(
    `UPDATE nexus_sessions SET context_summary = $1, summary_through_id = $2, updated_at = NOW()
     WHERE id = $3`,
    [summary, newSummaryThroughId, sessionId]
  );

  rootLog.info('Summary updated', { sessionId, throughMessageId: newSummaryThroughId, newMessageCount: newMessages.length });
}

module.exports = {
  processMessage,
  generateContextSummary,
  SYSTEM_PROMPT,
  executeTool,
  countItemsAdded,
  deriveTurnError,
  // Control-plane helpers shared with the REST routes (rescan / commit).
  dedupKey,
  recentReviewCommits,
  scanAlreadyCommitted,
  addItemsDeduped,
  mapDetectedItemsForClient,
  recordCensusToolCall,
};
