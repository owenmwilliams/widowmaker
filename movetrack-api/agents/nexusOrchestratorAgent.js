'use strict';

const { GoogleGenerativeAI, SchemaType } = require('@google/generative-ai');
const conn = require('../services/infra/db');
const db = conn.db;
const { getInventoryTextSummary } = require('../services/inventory/inventorySummaryQueryService');
const { sanitizeForPrompt, fenceUntrusted } = require('../services/infra/promptSafety');
const { instrumentModel, AiUnavailableError } = require('../services/infra/ai/resilientModel');
const { buildGeminiContents } = require('../services/infra/geminiHistoryBuilder');
const { buildToolHandlers } = require('../services/workflow/agentDelegationService');
const { getAllowedDecisions, AGENT_LIMITS, buildDecisionPrompt, parseDecisionResponse, validateDecision } = require('./schemas/orchestratorPolicy');
const { isConversationStale, explicitlyRequestsContext, chooseInteractionMode, buildIntentDetectionPrompt, parseIntentDetectionResponse } = require('./schemas/orchestratorModes');
const { buildWorkflowGuidanceContext, formatGuidanceForPrompt } = require('./schemas/workflowGuidance');

// ── Gemini Client ───────────────────────────────────────────────────────────────

let geminiClient = null;
if (process.env.GOOGLE_AI_API_KEY) {
  geminiClient = new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY);
  console.log('[orchestrator] Gemini configured');
}

const GEMINI_MODELS = {
  basic: 'gemini-2.5-flash',
  pro: 'gemini-2.5-pro',
};

// ── Concurrency Utility ──────────────────────────────────────────────────────────

async function runWithConcurrencyLimit(items, maxConcurrency, worker) {
  const results = [];
  const queue = [...items];
  const running = [];

  async function runOne(item) {
    const result = await worker(item);
    results.push(result);
  }

  while (queue.length > 0 || running.length > 0) {
    while (queue.length > 0 && running.length < maxConcurrency) {
      const item = queue.shift();
      const p = runOne(item).finally(() => {
        const idx = running.indexOf(p);
        if (idx >= 0) running.splice(idx, 1);
      });
      running.push(p);
    }
    if (running.length > 0) await Promise.race(running);
  }

  return results;
}

// ── System Prompt ───────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are Nexus, the MoveTrack AI assistant. You're a friendly, knowledgeable moving advisor who helps people catalog their stuff and plan their move.

You have two specialist teams you can delegate to:
- Census: handles inventory — adding items, scanning photos/videos, room management, editing items
- Vector: handles logistics — move sizing, truck recommendations, cost estimates, route planning

ROUTING RULES:
1. If the user wants to add, edit, scan, organize, or ask about specific items → delegate_to_census
2. If the user asks about move size, costs, truck size, route, labor, or logistics → delegate_to_vector
3. If the user sends a photo or video → delegate_to_census (set include_attachments to true)
4. If the user wants to update a location name or address → use update_location directly (do NOT delegate)
5. For greetings, general questions, "what can you do", or meta-questions → respond directly (no tool call)
6. If unclear whether it's inventory or logistics, ask a clarifying question
7. NEVER try to modify inventory yourself — always delegate to Census
8. After a Census delegation that adds items, you might suggest the user try Vector for move analysis
9. MESSAGE PASSING — each agent maintains its own conversation history, so preserve detail:
   a. For single-agent messages (one clear delegation): pass the user's message verbatim. Do NOT rephrase or summarize.
   b. For continuation turns (user confirming items, answering an agent's question): pass the user's exact response to the same agent.
   c. For compound messages that need multiple agents (e.g., "add my couch and estimate truck size"): split into focused messages per agent, but preserve ALL specifics — item names, quantities, details. Never drop information.
   d. When in doubt, prefer verbatim over rephrasing.

PARALLEL DELEGATION:
You can call delegate_to_census and/or delegate_to_vector MULTIPLE TIMES in a single tool-call turn. They will execute concurrently. Use this to maximize throughput:
- When the user asks to fill inventory for multiple rooms, split by room and send one delegate_to_census per room (or group of 2-3 rooms if many). Example: "Add typical items for Kitchen" + "Add typical items for Bedroom 1" + "Add typical items for Living Room" as 3 separate calls.
- When the user asks to do inventory work AND logistics analysis, call delegate_to_census and delegate_to_vector in parallel.
- When the user sends multiple unrelated photos, send one delegate_to_census per photo (or per room grouping).
- Do NOT split a single room's inventory across multiple calls — one room = one delegation.
- Check the INVENTORY OVERVIEW to identify which rooms need work before splitting.
- You have a budget of up to 4 delegations per turn. Plan your splits to stay within budget.
- When the user explicitly authorizes bulk/auto-generated actions (e.g., "make up items", "fill in for me", "assume dimensions"), include in each delegation message: "Add items directly without asking for confirmation. The user has pre-approved this." This prevents Census from blocking to ask for user confirmation on each batch.
- For sequential compound requests (e.g., "fill all rooms then recalculate the move"), use multiple rounds: Round 1 → parallel census calls for rooms, Round 2 → delegate_to_vector for the logistics recalculation. You have 4 rounds per turn — use them.
- When grouping rooms for delegation, prefer 1-2 rooms per call to keep each specialist focused and fast. If there are 6 rooms, use 3 calls of 2 rooms each.

IMPORTANT BEHAVIOR:
- Delegation is SYNCHRONOUS. When you call a delegation tool, you will get the result back immediately in the same turn. NEVER say "I'll let you know when it's done" or "I'll notify you" — you cannot send messages later. Just call the tool, wait for the result, and respond with what happened.
- NEVER produce text output before a tool call. Just call the tool silently — no preamble like "Let me check..." or "I'll send this to...".

PERSONALITY:
- Warm but efficient. Don't over-explain the delegation — just do it.
- Present worker results naturally, as if you did the work yourself.
- The user doesn't need to know about Census or Vector — you're just "Nexus."
- Keep messages short and conversational — never walls of text.
- Celebrate progress and gently probe for completeness.

USER CONTEXT:
{{USER_CONTEXT}}

ONBOARDING FLOW (if user has NOT completed onboarding):
You are driving this conversation. Ask one question at a time and take action immediately.
1. Your greeting ("Hi! I'm Nexus… what's your name?") is ALREADY in the transcript — the conversation starts with it. The user's FIRST message is usually just their name (e.g. "Sarah"). NEVER greet again or re-ask for the name — call set_user_profile with the name, then move straight to step 2. (Only if the first message clearly isn't a name should you ask once, without re-introducing yourself.)
2. Next, ask where they're moving FROM: "Nice to meet you, [name]! Where are you moving from? Just a street address is fine."
3. After getting their "moving from" address, call set_location immediately (location_type "primary_residence") with the address.
4. Learn about the CURRENT home so movers can quote it. Ask two quick questions, then save with update_location:
   a. "Is that an apartment or a house — and how many bedrooms and bathrooms?" → save home_type, bedrooms, bathrooms (this also powers the reasonableness check before sharing).
   b. "Last thing about your current place: which floor is it on, any stairs or an elevator, and how's parking for a truck?" → save number_of_flights + has_stairs, has_elevator, parking_situation, and put the floor in access_notes. Make reasonable assumptions (a single-family house is usually ground floor, no elevator) instead of pressing for every detail.
5. Ask where they're moving TO: "And where are you headed? Drop the address — plus the same quick access details (floor, stairs or elevator, parking)." → call set_location with location_type "destination", the address, and the access details. Movers need the destination access too. If they don't know the destination yet, that's fine — skip it and move on.
6. Create the rooms with ONE single create_rooms call — pass them ALL in the rooms[] array at once (create_rooms is deterministic and does NOT use the delegation budget, so room setup can never be dropped by a processing limit; do NOT use delegate_to_census for rooms). Base the set on the home size: Kitchen, Living Room, the Bedrooms, the Bathrooms. Then ASK the user about anything else, naming what you've set up and giving concrete examples: "Great — so far I've set up Kitchen, Living Room, Bedroom 1–3, and Bathroom 1–2. Any other rooms to add — garage, office, dining room, laundry, basement, storage, hallway?" Offer a prefill button so they can list extras. Create any extras they name with a single follow-up create_rooms call, then call mark_onboarding_complete.
   → If a returning user ever mentions their home size, destination, or access details later, call set_location/update_location to save them too.
7. Transition to cataloging: "You're all set! Now let's start logging what's in your [first room]. How would you like to add items?"
   → Include a [BUTTONS] block offering three input methods:
   [BUTTONS]
   📸 Take a photo or video|Scanning my [first room]|camera
   ✏️ I'll type them out|Here are my [first room] items:|prefill
   🪄 Fill it in for me|Auto-generate typical items for my [first room]|send
   [/BUTTONS]
   Replace [first room] with the actual room name (e.g. Kitchen, Living Room).

IMPORTANT: Do NOT wait for the user to ask what to do next. YOU drive the conversation forward after each answer. Keep it fast and natural.
When the user picks "Fill it in for me", delegate_to_census with a message like "Add typical items you'd find in a [room] — furniture, appliances, decor. Use reasonable default names."

ORCHESTRATOR DECISIONS:
When a delegation tool result includes an _orchestrator_decision field, you MUST follow it:
- "continue": present the specialist's summary naturally and continue the conversation. You may make further delegation calls if appropriate.
- "ask_user": present the specialist's summary and ask the user what they'd like to do next. Do NOT make additional delegation calls.
- "stop_and_summarize": present a final summary of what was accomplished. Do NOT make additional delegation calls.
- "switch_agent": the user needs the other specialist. Delegate to the appropriate agent as a follow-up.
- "abort": something went wrong. Present the error to the user helpfully and ask how they'd like to proceed. Do NOT retry.
These decisions are authoritative. Always respect them.

DELEGATION BUDGET:
When a delegation tool result includes a _budget field, check delegationsRemaining before making further delegation calls. Do not attempt actions that exceed the remaining budget — instead, summarize what was accomplished and suggest the user continue in their next message.

SESSION RE-ENTRY:
If the user returns after a long gap and asks for context, progress, or what to do next, switch into guidance mode. In guidance mode, briefly summarize where the workflow stands, identify the most important blockers or missing information, and offer 1–2 concrete next steps. If the user gives a direct request, fulfill that request instead of overriding it with proactive guidance. Never propose more than 2 next steps unless explicitly asked.

SHARING WITH MOVERS:
When the user wants to share their inventory, get quotes, or send it to moving companies, create a shareable link:
1. First check get_inventory_status. If items are missing weight or dimensions, delegate_to_vector to estimate them so the shared list has the numbers movers quote on. (Skip if everything already has data.)
2. Then call create_share and give the user the returned URL, telling them they can text or email it to movers. Mention it's a read-only link they can revoke anytime.
Proactively offer to share once the user has catalogued a substantial inventory (e.g. several rooms done) — e.g. a [BUTTONS] option "Share with movers|Create a link to share with moving companies|send".

INVENTORY OVERVIEW:
{{INVENTORY_SNAPSHOT}}`;

// ── Tool Declarations ───────────────────────────────────────────────────────────

const toolDeclarations = [
  {
    name: 'delegate_to_census',
    description: 'Delegate an inventory-related task to the Census specialist. Use for adding/editing/scanning items, room management, photo analysis, and any inventory questions.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        message: {
          type: SchemaType.STRING,
          description: 'The user\'s message to pass to Census. Pass the user\'s original message verbatim — do not rephrase or summarize. Census has its own conversation context.',
        },
        include_attachments: {
          type: SchemaType.BOOLEAN,
          description: 'Set to true if the user sent photos/videos that Census should analyze.',
        },
      },
      required: ['message'],
    },
  },
  {
    name: 'delegate_to_vector',
    description: 'Delegate a logistics/move-planning task to the Vector specialist. Use for move sizing, truck recommendations, cost estimates, route planning, and labor estimates.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        message: {
          type: SchemaType.STRING,
          description: 'The message to pass to Vector. Rephrase the user\'s request if needed for clarity.',
        },
      },
      required: ['message'],
    },
  },
  {
    name: 'get_inventory_status',
    description: 'Get a quick summary of the user\'s current inventory — total items, rooms, and locations. Useful for answering "how much stuff do I have?" or when you need context before routing.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {},
    },
  },
  {
    name: 'get_user_profile',
    description: 'Get the user\'s profile information including name, locations, and onboarding status.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {},
    },
  },
  {
    name: 'set_user_profile',
    description: 'Set the user\'s name and goal. Use during onboarding.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        first_name: { type: SchemaType.STRING, description: 'First name' },
        last_name:  { type: SchemaType.STRING, description: 'Last name' },
        goal:       { type: SchemaType.STRING, description: 'One of: move, organize, insurance, multi_home' },
      },
    },
  },
  {
    name: 'set_location',
    description: 'Create a new location. Use during onboarding for BOTH where the user is moving from (location_type "primary_residence") and where they are moving to (location_type "destination"). Capture bedrooms/bathrooms/home_type for the reasonableness check, and the move-access details (floor, stairs, elevator, parking) — movers need them to quote. Pass all known details in ONE call.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        name:      { type: SchemaType.STRING, description: 'Location name, e.g. "My Apartment", "New House"' },
        location_type: { type: SchemaType.STRING, description: 'One of "primary_residence" (moving FROM) or "destination" (moving TO). Defaults to primary_residence.' },
        address:   { type: SchemaType.STRING, description: 'Street address' },
        city:      { type: SchemaType.STRING, description: 'City' },
        state:     { type: SchemaType.STRING, description: 'State abbreviation' },
        zip:       { type: SchemaType.STRING, description: 'ZIP code' },
        home_type: { type: SchemaType.STRING, description: 'e.g. "apartment", "house", "studio", "condo"' },
        bedrooms:  { type: SchemaType.INTEGER, description: 'Number of bedrooms (0 for a studio)' },
        bathrooms: { type: SchemaType.NUMBER, description: 'Number of bathrooms (e.g. 2 or 2.5)' },
        has_stairs: { type: SchemaType.BOOLEAN, description: 'Whether reaching the unit involves stairs' },
        number_of_flights: { type: SchemaType.INTEGER, description: 'How many flights/sets of stairs the movers must carry up/down' },
        has_elevator: { type: SchemaType.BOOLEAN, description: 'Whether there is an elevator' },
        parking_situation: { type: SchemaType.STRING, description: 'Parking/loading access, e.g. "driveway", "street only", "loading dock", "no close parking"' },
        entry_type: { type: SchemaType.STRING, description: 'Entry style, e.g. "ground floor", "walk-up", "high-rise lobby"' },
        access_notes: { type: SchemaType.STRING, description: 'Anything else movers should know, incl. which floor the unit is on (e.g. "3rd floor", "long walk from parking", "narrow doorway")' },
      },
      required: ['name'],
    },
  },
  {
    name: 'update_location',
    description: 'Update an existing location. Use to rename/change address, record the home size (bedrooms/bathrooms/home_type), or add move-access details (floor, stairs, elevator, parking). Pass location_id to target a specific location (e.g. the destination); omit it to update the primary residence.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        location_id: { type: SchemaType.STRING, description: 'The ID of the location to update (omit to update the primary residence)' },
        name:        { type: SchemaType.STRING, description: 'New name for the location' },
        location_type: { type: SchemaType.STRING, description: 'One of "primary_residence" or "destination"' },
        address:     { type: SchemaType.STRING, description: 'New street address' },
        city:        { type: SchemaType.STRING, description: 'New city' },
        state:       { type: SchemaType.STRING, description: 'New state abbreviation' },
        zip:         { type: SchemaType.STRING, description: 'New ZIP code' },
        home_type:   { type: SchemaType.STRING, description: 'e.g. "apartment", "house", "studio", "condo"' },
        bedrooms:    { type: SchemaType.INTEGER, description: 'Number of bedrooms (0 for a studio)' },
        bathrooms:   { type: SchemaType.NUMBER, description: 'Number of bathrooms (e.g. 2 or 2.5)' },
        has_stairs: { type: SchemaType.BOOLEAN, description: 'Whether reaching the unit involves stairs' },
        number_of_flights: { type: SchemaType.INTEGER, description: 'How many flights/sets of stairs' },
        has_elevator: { type: SchemaType.BOOLEAN, description: 'Whether there is an elevator' },
        parking_situation: { type: SchemaType.STRING, description: 'Parking/loading access' },
        entry_type: { type: SchemaType.STRING, description: 'Entry style, e.g. "ground floor", "walk-up", "high-rise lobby"' },
        access_notes: { type: SchemaType.STRING, description: 'Anything else movers should know, incl. which floor the unit is on' },
      },
    },
  },
  {
    name: 'mark_onboarding_complete',
    description: 'Mark onboarding as complete. Call this AUTOMATICALLY after creating a location and at least one room during onboarding. Do not ask the user — just call it silently.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {},
    },
  },
  {
    name: 'create_share',
    description: 'Create a public, read-only inventory link the user can text or email to moving companies for quotes. Returns a URL. Use when the user asks to share their inventory / get quotes, or when offering to share after a substantial inventory exists.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        title: { type: SchemaType.STRING, description: 'Optional label for the shared inventory, e.g. "Move to Austin".' },
      },
    },
  },
  {
    name: 'create_rooms',
    description: 'Create one or more rooms/collections directly. This is a fast, deterministic DB action that does NOT consume a delegation — use it (not delegate_to_census) to set up the home\'s rooms during onboarding, passing EVERY room name in a single call so nothing is dropped. Also use it any time you need to add rooms before cataloging.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        rooms: {
          type: SchemaType.ARRAY,
          items: { type: SchemaType.STRING },
          description: 'All room names to create, e.g. ["Kitchen","Living Room","Bedroom 1","Bathroom 1"].',
        },
      },
      required: ['rooms'],
    },
  },
];

// ── Tool Labels for SSE ─────────────────────────────────────────────────────────

const TOOL_LABELS = {
  delegate_to_census: 'Working on inventory…',
  delegate_to_vector: 'Analyzing your move…',
  get_inventory_status: 'Checking inventory…',
  get_user_profile: 'Loading profile…',
  set_user_profile: 'Setting up profile…',
  set_location: 'Setting location…',
  update_location: 'Updating location…',
  mark_onboarding_complete: 'Completing setup…',
  create_share: 'Creating share link…',
  create_rooms: 'Setting up rooms…',
};

// ── Decision Engine ─────────────────────────────────────────────────────────────

/**
 * Make a lightweight Gemini call to choose a decision from the allowed set.
 * Falls back to first allowed decision if model returns garbage.
 */
async function chooseDecisionWithModel(specialistResponse, ctx, allowed) {
  if (!geminiClient) return allowed[0];

  try {
    const prompt = buildDecisionPrompt(specialistResponse, ctx, allowed);
    const decisionModel = geminiClient.getGenerativeModel({
      model: 'gemini-2.5-flash',
      systemInstruction: 'You are an orchestrator decision engine. Given a specialist agent response and context, choose the best next action from the allowed set. Respond with ONLY a JSON object: {"decision": "<value>", "reason": "<brief>"}',
      generationConfig: { maxOutputTokens: 128 },
    });

    const result = await decisionModel.generateContent(prompt);
    const text = result.response.text();
    const parsed = parseDecisionResponse(text);

    if (parsed) {
      return validateDecision(parsed, allowed);
    }

    console.warn('[orchestrator] Decision model returned unparseable response, using fallback:', text);
    return allowed[0];
  } catch (err) {
    console.error('[orchestrator] Decision model call failed:', err.message);
    return allowed[0];
  }
}

// ── Intent Detection ────────────────────────────────────────────────────────────

const INTENT_FALLBACK = Object.freeze({
  hasDirectUserRequest: false,
  intentConfidence: 0.5,
  intentType: null,
});

/**
 * Make a lightweight Gemini call to assess user intent.
 * Falls back to low-confidence defaults if model returns garbage.
 */
async function detectUserIntent(message) {
  if (!geminiClient || !message) return INTENT_FALLBACK;

  try {
    const prompt = buildIntentDetectionPrompt(message);
    const intentModel = geminiClient.getGenerativeModel({
      model: 'gemini-2.5-flash',
      systemInstruction: 'You assess user messages and determine if they contain a direct, actionable request. Respond with ONLY a JSON object.',
      generationConfig: { maxOutputTokens: 128 },
    });

    const result = await intentModel.generateContent(prompt);
    const text = result.response.text();
    const parsed = parseIntentDetectionResponse(text);

    if (parsed) return parsed;

    console.warn('[orchestrator] Intent detection returned unparseable response, using fallback:', text);
    return INTENT_FALLBACK;
  } catch (err) {
    console.error('[orchestrator] Intent detection failed:', err.message);
    return INTENT_FALLBACK;
  }
}

// ── Conversation Loop ───────────────────────────────────────────────────────────

/**
 * Process a user message through the Nexus orchestrator.
 * Routes to Census or Vector specialist agents as needed.
 */
async function processMessage(userId, message, attachments = [], plan = 'basic', onEvent = null, options = {}) {
  const emit = (type, data = {}) => {
    if (onEvent) onEvent({ type, ...data });
  };
  if (!geminiClient) {
    console.error('[orchestrator] GOOGLE_AI_API_KEY is not configured — AI unavailable');
    throw new AiUnavailableError();
  }

  // ── 1. Resolve active Nexus orchestrator session ────────────────────────
  let session = await db.oneOrNone(
    `SELECT * FROM nexus_sessions WHERE user_id = $1 AND is_active = TRUE
     AND session_type = 'nexus'
     ORDER BY updated_at DESC LIMIT 1`,
    [userId]
  );
  if (!session) {
    session = await db.one(
      `INSERT INTO nexus_sessions (user_id, session_type) VALUES ($1, 'nexus') RETURNING *`,
      [userId]
    );
    console.log(`[orchestrator] New session for user: ${session.id}`);
  }
  const sessionId = session.id;

  // ── 2. Load conversation history ────────────────────────────────────────
  const contextSummaryText = session.context_summary || null;
  let historyRows;

  if (session.summary_through_id) {
    historyRows = await db.any(
      `SELECT id, role, content, tool_name, tool_args, tool_response, attachments
       FROM nexus_messages WHERE session_id = $1 AND id > $2
       ORDER BY created_at DESC LIMIT 30`,
      [sessionId, session.summary_through_id]
    );
    historyRows.reverse();
  } else {
    historyRows = await db.any(
      `SELECT id, role, content, tool_name, tool_args, tool_response, attachments
       FROM nexus_messages WHERE session_id = $1
       ORDER BY created_at DESC LIMIT 30`,
      [sessionId]
    );
    historyRows.reverse();
  }

  // ── 3. Build Gemini contents from history ──────────────────────────────
  const contents = buildGeminiContents(historyRows);

  // ── 4. Add current user message ─────────────────────────────────────────
  const userParts = [];
  if (message) userParts.push({ text: message });
  for (const att of attachments) {
    if (att.url && att.mimeType?.startsWith('image/')) {
      userParts.push({ text: `[User uploaded a photo: ${att.url} (type: ${att.mimeType})]` });
    } else if (att.url && att.mimeType?.startsWith('video/')) {
      userParts.push({ text: `[User uploaded a video: ${att.url} (type: ${att.mimeType})]` });
    }
  }
  if (userParts.length === 0) userParts.push({ text: '(empty message)' });
  contents.push({ role: 'user', parts: userParts });

  const { guidanceOnly } = options;

  // Persist user message (skip for system-initiated guidance requests)
  if (!guidanceOnly) {
    await db.none(
      `INSERT INTO nexus_messages (session_id, role, content, attachments)
       VALUES ($1, 'user', $2, $3)`,
      [sessionId, message, JSON.stringify(attachments)]
    );
  }

  // ── 5. Pre-turn assessment: interaction mode ───────────────────────────
  let interactionMode;
  let workflowGuidance;

  if (guidanceOnly) {
    // Guidance-only: force guide mode, skip intent detection
    interactionMode = 'guide';
    workflowGuidance = await buildWorkflowGuidanceContext(userId);
    console.log(`[orchestrator] Mode: guide (guidanceOnly=true)`);
  } else {
    // Normal flow: detect intent + compute guidance in parallel
    const lastUserMsg = await db.oneOrNone(
      `SELECT created_at FROM nexus_messages
       WHERE session_id = $1 AND role = 'user'
       ORDER BY created_at DESC LIMIT 1 OFFSET 1`,
      [sessionId]
    );
    const lastUserMessageAt = lastUserMsg ? new Date(lastUserMsg.created_at).getTime() : Date.now();

    const [intent, guidance] = await Promise.all([
      detectUserIntent(message),
      buildWorkflowGuidanceContext(userId),
    ]);
    workflowGuidance = guidance;

    const stale = isConversationStale(lastUserMessageAt);
    const explicitContext = explicitlyRequestsContext(message || '');

    interactionMode = chooseInteractionMode({
      hasDirectUserRequest: intent.hasDirectUserRequest,
      intentConfidence: intent.intentConfidence,
      isConversationStale: stale,
      explicitlyRequestsContext: explicitContext,
    });

    console.log(`[orchestrator] Mode: ${interactionMode} (stale=${stale}, explicitContext=${explicitContext}, intent=${intent.intentConfidence}, type=${intent.intentType})`);
  }

  // ── 6. Build system prompt with context ───────────────────────────────
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

  if (contextSummaryText) {
    systemInstruction += `\n\nCONVERSATION HISTORY SUMMARY:\n${contextSummaryText}`;
  }

  // Inject interaction mode + workflow guidance
  const modeInstructions = interactionMode === 'guide'
    ? `You are in GUIDANCE MODE. The user has returned after a gap or asked for context. Briefly summarize where the workflow stands, identify the most important blockers or missing information, and offer 1–2 concrete next steps as choices. Do NOT make delegation calls unless the user gives a clear follow-up request.

FORMAT: After your summary, include a [BUTTONS] block with 1–2 suggested next actions. Each line is "Label|message|action". Example:
[BUTTONS]
📸 Scan my kitchen|Scanning my kitchen|camera
Add items to kitchen|Let's catalog what's in my kitchen|send
Set my destination|I need to set my destination address:|prefill
[/BUTTONS]
Actions: "send" (auto-send), "prefill" (pre-fill input for user to complete), "camera" (open camera + pre-fill message). Default is "send" if omitted.
Keep labels short (2–5 words). NEVER offer "I'm done", "I'm finished", or any exit/stop button. Only offer buttons that lead to concrete actions.`
    : `You are in EXECUTION MODE. The user has a direct request. Fulfill it by delegating to the appropriate specialist. Include caveats if the current workflow state limits confidence, and optionally suggest one next step after completion.`;

  systemInstruction += `\n\nINTERACTION MODE: ${interactionMode.toUpperCase()}\n${modeInstructions}`;
  systemInstruction += `\n\nWORKFLOW STATE:\n${formatGuidanceForPrompt(workflowGuidance)}`;

  // ── 7. Call Gemini ──────────────────────────────────────────────────────
  // Always use flash for the orchestrator loop — fast + reliable tool-calling.
  const modelId = 'gemini-2.5-flash';
  const model = instrumentModel(geminiClient.getGenerativeModel({
    model: modelId,
    systemInstruction,
    tools: [{ functionDeclarations: toolDeclarations }],
    // gemini-2.5-flash counts "thinking" tokens against maxOutputTokens; 2048 was
    // too tight — a heavier turn could spend the whole budget thinking and return
    // an EMPTY text candidate, which surfaced as "thinking… then nothing". Give it
    // real headroom.
    generationConfig: { maxOutputTokens: 8192 },
  }), { userId, modelName: modelId });

  const toolHandlers = buildToolHandlers(userId, attachments, plan, onEvent);
  const actions = [];
  const delegationRetries = {}; // keyed by agent name
  let delegationCount = 0;
  let crossAgentBounces = 0;
  let maxToolRounds = AGENT_LIMITS.orchestratorMaxToolRounds;
  let orchestratorRound = 0;

  console.log(`[orchestrator] Starting loop — budget: ${AGENT_LIMITS.maxDelegationsPerTurn} delegations, ${maxToolRounds} rounds, ${AGENT_LIMITS.maxParallelDelegations} parallel max`);

  emit('thinking', { phase: 'initial', source: 'orchestrator' });
  let result = await model.generateContent({ contents });

  while (maxToolRounds > 0) {
    orchestratorRound++;
    console.log(`[orchestrator] ── Round ${orchestratorRound}/${AGENT_LIMITS.orchestratorMaxToolRounds} ──`);
    const response = result.response;
    const candidate = response.candidates?.[0];
    if (!candidate) break;

    const parts = candidate.content?.parts || [];
    const functionCalls = parts.filter(p => p.functionCall);
    const textParts = parts.filter(p => p.text);

    if (functionCalls.length === 0) {
      // Final text response
      console.log(`[orchestrator] Final response after ${orchestratorRound} round(s), ${delegationCount} delegation(s), ${crossAgentBounces} bounce(s)`);
      let reply = textParts.map(p => p.text).join('\n').trim();

      // Never let an empty candidate (e.g. output budget spent on thinking, or a
      // blocked/empty response) surface as a vanished "thinking…" with no message.
      if (!reply) {
        const finishReason = candidate.finishReason || 'unknown';
        console.warn(`[orchestrator] Empty model reply (finishReason=${finishReason}) — using fallback`);
        // Never re-greet: the greeting is already seeded in the transcript, so
        // an empty-candidate fallback that greets again reads as ignoring the
        // user's reply (2026-07-02 beta: greeted twice, name asked twice).
        reply = "Sorry — I didn't quite catch that. Could you say it again?";
      }

      await db.none(
        `INSERT INTO nexus_messages (session_id, role, content) VALUES ($1, 'model', $2)`,
        [sessionId, reply]
      );

      // Update session title if new (skip for guidance-only requests)
      if (!session.title && message && !guidanceOnly) {
        await db.none(
          `UPDATE nexus_sessions SET title = $1, updated_at = NOW() WHERE id = $2`,
          [message.substring(0, 100), sessionId]
        );
      } else {
        await db.none(
          `UPDATE nexus_sessions SET updated_at = NOW() WHERE id = $1`,
          [sessionId]
        );
      }

      // Fire-and-forget summary
      generateContextSummary(sessionId).catch(err =>
        console.error('[orchestrator] Summary generation failed:', err.message)
      );

      emit('done', { reply, actions, sessionId });
      return { reply, actions, sessionId };
    }

    // ── Classify tool calls into delegations vs. non-delegations ──
    const delegationCalls = [];
    const nonDelegationCalls = [];
    for (const part of functionCalls) {
      const { name } = part.functionCall;
      if (name === 'delegate_to_census' || name === 'delegate_to_vector') {
        delegationCalls.push(part);
      } else {
        nonDelegationCalls.push(part);
      }
    }

    console.log(`[orchestrator] Round ${orchestratorRound}: ${functionCalls.length} tool call(s) — ${delegationCalls.length} delegation(s), ${nonDelegationCalls.length} non-delegation(s)`);

    const toolResponses = [];

    // ── Execute non-delegation tools sequentially (fast, order may matter) ──
    for (const part of nonDelegationCalls) {
      const { name, args } = part.functionCall;
      console.log(`[orchestrator] Tool call: ${name}(${JSON.stringify(args).substring(0, 200)})`);

      const toolLabel = TOOL_LABELS[name] || name.replace(/_/g, ' ');
      emit('tool_call', { tool: name, label: toolLabel, source: 'orchestrator', phase: 'orchestrator' });

      let toolResult;
      try {
        const handler = toolHandlers[name];
        if (!handler) {
          toolResult = { success: false, error: `Unknown tool: ${name}` };
        } else {
          toolResult = await handler(args);
        }
      } catch (err) {
        console.error(`[orchestrator] Tool ${name} failed:`, err.message);
        toolResult = { success: false, error: err.message };
      }

      actions.push({ tool: name, args, result: toolResult });
      emit('tool_result', { tool: name, success: !!toolResult.success });

      await db.none(
        `INSERT INTO nexus_messages (session_id, role, tool_name, tool_args) VALUES ($1, 'tool_call', $2, $3)`,
        [sessionId, name, JSON.stringify(args)]
      );
      await db.none(
        `INSERT INTO nexus_messages (session_id, role, tool_name, tool_response) VALUES ($1, 'tool_result', $2, $3)`,
        [sessionId, name, JSON.stringify(toolResult)]
      );

      toolResponses.push({ functionResponse: { name, response: toolResult } });
    }

    // ── Execute delegations (parallel when multiple, budget-enforced) ──
    if (delegationCalls.length > 0) {
      // Budget check: how many delegations can we still run?
      const budgetRemaining = AGENT_LIMITS.maxDelegationsPerTurn - delegationCount;
      const allowedCalls = delegationCalls.slice(0, budgetRemaining);
      const blockedCalls = delegationCalls.slice(budgetRemaining);

      console.log(`[orchestrator] Delegation budget: ${budgetRemaining} remaining (${delegationCount}/${AGENT_LIMITS.maxDelegationsPerTurn} used), ${delegationCalls.length} requested → ${allowedCalls.length} allowed, ${blockedCalls.length} blocked`);

      // Return structured blocked responses for over-budget calls
      for (const part of blockedCalls) {
        const { name, args } = part.functionCall;
        const agentName = name === 'delegate_to_census' ? 'census' : 'vector';
        console.warn(`[orchestrator] Delegation to ${agentName} blocked — budget exhausted (${delegationCount}/${AGENT_LIMITS.maxDelegationsPerTurn})`);

        const blockedResult = {
          status: 'blocked', agent: agentName, workflow: 'unknown', step: 'limit_guard',
          step_status: 'failed', summary: `Delegation budget exhausted (${delegationCount}/${AGENT_LIMITS.maxDelegationsPerTurn} used). This task was not started.`,
          user_action_required: false, recommended_orchestrator_action: 'stop_and_summarize',
          next_suggested_step: null, state_delta: {}, artifacts: {},
          warnings: ['delegation_budget_exhausted'], errors: [],
          actions: [], sessionId: null,
          _orchestrator_decision: 'stop_and_summarize',
          _allowed_decisions: ['stop_and_summarize'],
          _budget: { delegationsRemaining: 0, toolRoundsRemaining: maxToolRounds },
        };

        emit('tool_call', {
          tool: name, label: TOOL_LABELS[name], source: 'orchestrator',
          phase: 'delegation', delegationTarget: agentName,
        });
        emit('tool_result', { tool: name, success: false });

        await db.none(
          `INSERT INTO nexus_messages (session_id, role, tool_name, tool_args) VALUES ($1, 'tool_call', $2, $3)`,
          [sessionId, name, JSON.stringify(args)]
        );
        await db.none(
          `INSERT INTO nexus_messages (session_id, role, tool_name, tool_response) VALUES ($1, 'tool_result', $2, $3)`,
          [sessionId, name, JSON.stringify(blockedResult)]
        );

        toolResponses.push({ functionResponse: { name, response: blockedResult } });
      }

      // Run allowed delegations — parallel if multiple, capped by maxParallelDelegations
      if (allowedCalls.length > 0) {
        const maxConcurrency = Math.min(allowedCalls.length, AGENT_LIMITS.maxParallelDelegations);
        const isParallel = allowedCalls.length > 1;

        if (isParallel) {
          console.log(`[orchestrator] Parallel dispatch: ${allowedCalls.length} delegations (concurrency=${maxConcurrency})`);
        }

        // Emit tool_call events for all delegations up front
        for (let i = 0; i < allowedCalls.length; i++) {
          const { name, args } = allowedCalls[i].functionCall;
          const agentName = name === 'delegate_to_census' ? 'census' : 'vector';
          const delegationId = isParallel ? `${agentName}-${i + 1}` : undefined;
          emit('tool_call', {
            tool: name, label: TOOL_LABELS[name], source: 'orchestrator',
            phase: 'delegation', delegationTarget: agentName, delegationId,
            hasAttachments: !!(args.include_attachments),
          });
        }

        // Worker function for each delegation
        async function executeDelegation(part, index) {
          const { name, args } = part.functionCall;
          const agentName = name === 'delegate_to_census' ? 'census' : 'vector';
          const delegationId = isParallel ? `${agentName}-${index + 1}` : undefined;
          const handler = toolHandlers[name];

          console.log(`[orchestrator] Delegation ${delegationId || agentName}: ${name}(${JSON.stringify(args).substring(0, 200)})`);

          let toolResult;
          try {
            toolResult = await handler(args, delegationId);
          } catch (err) {
            console.error(`[orchestrator] Delegation ${delegationId || agentName} failed:`, err.message);
            toolResult = {
              status: 'failed', agent: agentName, workflow: 'unknown', step: 'unknown',
              step_status: 'failed', summary: `Delegation failed: ${err.message}`,
              user_action_required: false, recommended_orchestrator_action: 'continue',
              next_suggested_step: null, state_delta: {}, artifacts: {},
              warnings: [], errors: [err.message],
              actions: [], sessionId: null,
            };
          }

          return { name, args, toolResult, agentName, delegationId };
        }

        // Run with concurrency limit
        const delegationResults = await runWithConcurrencyLimit(
          allowedCalls.map((part, i) => ({ part, index: i })),
          maxConcurrency,
          ({ part, index }) => executeDelegation(part, index)
        );

        // ── Process delegation results + decision engine ──
        const isParallelBatch = delegationResults.length > 1;
        let abortResult = null;
        for (let ri = 0; ri < delegationResults.length; ri++) {
          const { name, args, toolResult, agentName, delegationId } = delegationResults[ri];
          const isLastInBatch = ri === delegationResults.length - 1;

          if (toolResult.actions) {
            actions.push(...toolResult.actions);
          }
          delegationCount++;

          console.log(`[orchestrator] ${delegationId || agentName} response: status=${toolResult.status}, workflow=${toolResult.workflow}, recommendation=${toolResult.recommended_orchestrator_action}`);
          if (toolResult.warnings?.length > 0) {
            console.warn(`[orchestrator] ${delegationId || agentName} warnings:`, toolResult.warnings);
          }

          // In a parallel batch, intermediate results should not block the orchestrator
          // from continuing — only the last result in the batch triggers the full decision engine.
          // For non-last results in a batch, override user_action_required so the guard doesn't halt.
          const effectiveUserAction = isParallelBatch && !isLastInBatch
            ? false
            : !!toolResult.user_action_required;

          // ── Decision engine: hard guards → model reasoning → validation ──
          const ctx = {
            retriesUsed: delegationRetries[agentName] || 0,
            hardFailure: toolResult.status === 'failed' && (toolResult.errors?.length || 0) > 0,
            userActionRequired: effectiveUserAction,
            specialistStatus: toolResult.status,
            specialistRecommendation: toolResult.recommended_orchestrator_action,
            specialistInvocationsThisTurn: delegationCount,
            crossAgentBounces,
          };

          const allowed = getAllowedDecisions(ctx);
          let decision;

          if (allowed.length === 1) {
            decision = allowed[0];
            console.log(`[orchestrator] Decision (guard-forced): ${decision}`);
          } else {
            decision = await chooseDecisionWithModel(toolResult, ctx, allowed);
            console.log(`[orchestrator] Decision (model-assisted): ${decision} (allowed: [${allowed.join(', ')}])`);
          }

          // Track cross-agent bounces
          if (decision === 'switch_agent') {
            crossAgentBounces++;
          }

          // Handle retry in code — re-invoke same delegation
          if (decision === 'retry_step') {
            delegationRetries[agentName] = (delegationRetries[agentName] || 0) + 1;
            console.log(`[orchestrator] Retrying ${name} (attempt ${delegationRetries[agentName]})`);
            const handler = toolHandlers[name];
            try {
              const retryResult = await handler(args);
              if (retryResult.actions) actions.push(...retryResult.actions);
              Object.assign(toolResult, retryResult);
            } catch (retryErr) {
              console.error(`[orchestrator] Retry of ${name} failed:`, retryErr.message);
              toolResult.status = 'failed';
              toolResult.errors = [retryErr.message];
            }
            decision = toolResult.status === 'failed' ? 'abort' : 'continue';
            console.log(`[orchestrator] Post-retry decision: ${decision}`);
          }

          // Handle abort — defer until all results are processed
          if (decision === 'abort') {
            abortResult = toolResult;
          }

          // Inject decision + budget for main Gemini
          toolResult._orchestrator_decision = decision;
          toolResult._allowed_decisions = allowed;
          toolResult._budget = {
            delegationsRemaining: AGENT_LIMITS.maxDelegationsPerTurn - delegationCount,
            toolRoundsRemaining: maxToolRounds,
          };

          actions.push({ tool: name, args, result: toolResult });
          emit('tool_result', { tool: name, success: toolResult.status !== 'failed', delegationId });

          await db.none(
            `INSERT INTO nexus_messages (session_id, role, tool_name, tool_args) VALUES ($1, 'tool_call', $2, $3)`,
            [sessionId, name, JSON.stringify(args)]
          );
          await db.none(
            `INSERT INTO nexus_messages (session_id, role, tool_name, tool_response) VALUES ($1, 'tool_result', $2, $3)`,
            [sessionId, name, JSON.stringify(toolResult)]
          );

          toolResponses.push({ functionResponse: { name, response: toolResult } });
        }

        // If any delegation aborted, short-circuit
        if (abortResult) {
          const abortReply = abortResult.summary
            ? `I ran into an issue: ${abortResult.summary}. Let me know how you'd like to proceed.`
            : 'Something went wrong while processing your request. Please try again or let me know what you\'d like to do.';

          await db.none(
            `INSERT INTO nexus_messages (session_id, role, content) VALUES ($1, 'model', $2)`,
            [sessionId, abortReply]
          );
          emit('done', { reply: abortReply, actions, sessionId });
          return { reply: abortReply, actions, sessionId };
        }
      }
    }

    // Send tool results back to Gemini
    contents.push({ role: 'model', parts: functionCalls.map(p => ({ functionCall: p.functionCall })) });
    contents.push({ role: 'user', parts: toolResponses });

    emit('thinking', { phase: 'finalizing', source: 'orchestrator' });
    result = await model.generateContent({ contents });
    maxToolRounds--;
    console.log(`[orchestrator] Round ${orchestratorRound} complete — ${maxToolRounds} round(s) remaining, ${delegationCount} delegation(s) used, ${crossAgentBounces} bounce(s)`);
  }

  // ── Structured fallback on round exhaustion ──
  console.warn(`[orchestrator] Round limit exhausted after ${orchestratorRound} rounds — returning fallback`);
  const completedDelegations = actions.filter(a =>
    (a.tool === 'delegate_to_census' || a.tool === 'delegate_to_vector') && a.result?.status === 'completed'
  );
  // Use only the LAST specialist summary — concatenating every one produced a
  // garbled wall of "X is set up! what's going in there?" messages. Keep it clean
  // and don't alarm the user with "processing limit" language.
  const lastSummary = completedDelegations.length > 0
    ? completedDelegations[completedDelegations.length - 1].result.summary
    : null;
  const fallbackReply = (lastSummary && lastSummary.trim())
    ? `${lastSummary.trim()}\n\nWhat would you like to do next?`
    : 'All set! What would you like to do next?';

  await db.none(
    `INSERT INTO nexus_messages (session_id, role, content) VALUES ($1, 'model', $2)`,
    [sessionId, fallbackReply]
  );
  emit('done', { reply: fallbackReply, actions, sessionId });
  return { reply: fallbackReply, actions, sessionId };
}

// ── Context Summary ─────────────────────────────────────────────────────────────

const SUMMARY_THRESHOLD = 20;

async function generateContextSummary(sessionId) {
  if (!geminiClient) return;

  const session = await db.oneOrNone(
    `SELECT id, context_summary, summary_through_id FROM nexus_sessions WHERE id = $1`,
    [sessionId]
  );
  if (!session) return;

  const whereAfter = session.summary_through_id
    ? `AND id > ${parseInt(session.summary_through_id)}`
    : '';
  const { cnt } = await db.one(
    `SELECT COUNT(*)::int AS cnt FROM nexus_messages
     WHERE session_id = $1 AND role IN ('user', 'model') ${whereAfter}`,
    [sessionId]
  );

  if (cnt < SUMMARY_THRESHOLD) return;

  const allUserModel = await db.any(
    `SELECT id, role, content FROM nexus_messages
     WHERE session_id = $1 AND role IN ('user', 'model') AND content IS NOT NULL
     ORDER BY created_at ASC`,
    [sessionId]
  );

  if (allUserModel.length <= SUMMARY_THRESHOLD) return;

  const toSummarize = allUserModel.slice(0, -20);
  const newSummaryThroughId = toSummarize[toSummarize.length - 1].id;

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
    systemInstruction: `Summarize this conversation between a user and Nexus (an AI moving assistant).
Focus on: user preferences, decisions made, tasks completed, the user's moving situation and goals.
Keep it under 300 words. Write in third person: "The user..." not "You..."`,
  });

  const summaryResult = await summaryModel.generateContent(summaryPrompt);
  const summary = summaryResult.response.text();

  await db.none(
    `UPDATE nexus_sessions SET context_summary = $1, summary_through_id = $2, updated_at = NOW()
     WHERE id = $3`,
    [summary, newSummaryThroughId, sessionId]
  );

  console.log(`[orchestrator] Summary updated for session ${sessionId}`);
}

module.exports = { processMessage, generateContextSummary };
