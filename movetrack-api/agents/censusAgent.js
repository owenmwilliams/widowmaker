'use strict';

const { GoogleGenerativeAI, SchemaType } = require('@google/generative-ai');
const conn = require('../services/infra/db');
const db = conn.db;
const mutation = require('../services/inventory/inventoryMutationService');
const { searchItems, getItemPhoto } = require('../services/inventory/inventoryItemQueryService');
const { getInventoryTextSummary } = require('../services/inventory/inventorySummaryQueryService');
const { getMissingContext, inventoryReadinessAssessment } = require('../services/inventory/inventoryMaturityService');
const duplicates = require('../services/inventory/duplicateDetectionService');
const media = require('../services/inventory/mediaInventoryWorkflowService');
const { getConversationStarters } = require('../services/infra/agentSessionService');
const { estimateMissingItems } = require('../services/move/moveSummaryService');
const { buildGeminiContents } = require('../services/infra/geminiHistoryBuilder');
const metrics = require('../services/infra/metricsService');
const { parseJsonBlock, deriveFieldsFromActions, buildSpecialistResponse, buildFallbackResponse } = require('./schemas/specialistResponse');

// ── Gemini Client ───────────────────────────────────────────────────────────────

let geminiClient = null;
if (process.env.GOOGLE_AI_API_KEY) {
  geminiClient = new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY);
  console.log('[censusAgentService] Gemini configured');
}

const GEMINI_MODELS = {
  basic: 'gemini-2.5-flash',
  pro: 'gemini-2.5-pro',
};

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
2. After adding items to a room, call get_missing_context to check for gaps and ask about likely missing items.
3. PHOTO ANALYSIS:
   a. When the user sends ONE photo of a room or area, call analyze_photo with mode "multi_item" to detect all visible items.
   b. When the user sends MULTIPLE photos at once:
      - Ask which room these photos are from (if not already established in conversation).
      - Once you know the room, call analyze_photo ONCE with all images in the files[] array and mode "multi_item". This analyzes them holistically and avoids duplicates across photos.
      - Do NOT call analyze_photo separately for each image — always batch them together.
   c. When the user sends a CLOSE-UP photo of a single item (e.g., "here's my vintage lamp"), call analyze_photo with mode "single_item" for detailed analysis.
   d. Use your judgment on mode: if the photo clearly shows one item up close, use single_item. If it shows a room or multiple items, use multi_item.
   e. If analyze_photo returns empty items or fails, retry ONCE. If it still fails, apologize and ask the user to try another photo or describe items manually.
   f. When analyze_photo succeeds, list the detected items and ASK FOR CONFIRMATION before calling add_item. For example: "I can see: 1) Queen Bed, 2) Nightstand, 3) Dresser. Want me to add all of these, or would you like to make changes?"
   g. Only call add_item after the user confirms. Include the picture_url from analyze_photo results if available.
   h. The same confirmation rules apply to analyze_video — list detected items and wait for user approval before adding.
4. If the user sends a video, call analyze_video to detect items. The same retry and confirmation rules from rule 3 apply.
5. Weight and dimension estimates are always PER SINGLE UNIT. Set quantity for multiples. Examples: queen mattress ~80 lbs qty 1, dining chair ~20 lbs qty 4, box of books ~35 lbs qty 3. Never multiply weight by quantity yourself — the system does that automatically.
6. If a room doesn't exist yet, call add_room first, then add items.
7. Confidence scoring — ALWAYS pass the confidence value when calling add_item:
   - 0.9+: user explicitly named the item with details → confidence_source: "explicit"
   - 0.7-0.8: detected in a photo → use the per-item confidence from analyze_photo results → confidence_source: "photo"
   - 0.5-0.6: inferred from video or context → confidence_source: "video" or "inferred"
   - Below 0.5: do NOT call add_item — ask the user to confirm first
8. After covering a room, summarize and suggest the next room.
9. Periodically call get_inventory_summary to share progress.
10. NEVER invent or hallucinate items. Only add items the user explicitly mentioned or that were returned by analyze_photo or analyze_video. If a tool returns no data, tell the user — do not fill in the gap yourself.
11. If the user corrects you, call update_item immediately. If they want to rename a room, use update_room — do NOT create a new room. If the user wants to change location details (address, name), let them know to ask the main Nexus assistant — you handle inventory, not location management.
12. If the user asks to remove or delete an item, ALWAYS confirm before calling delete_item. Say which item you're about to delete and wait for their "yes".
13. After adding 3+ items at once (e.g. from a photo or video scan), call find_duplicates to check for accidental duplicates. If duplicates are found, list them and ask the user which to keep or remove.
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
- Example of RIGHT behavior: call add_item for kitchen items → call add_item for living room items → call add_item for bedroom items → "All done! I've added 15 items across 3 rooms. Anything I missed?"

CONVERSATION FLOW (returning users):
- If home context is unknown, ask about type, bedrooms, bathrooms.
- Work room by room: "Let's start with the living room."
- After each room: "Anything else in [room]? Let's move to [next room]."
- End with summary: "Here's what we've got: [summary]. Anything I missed?"

PROACTIVE GREETING (when the user's message is a session greeting like "hi", "hello", "hey", "what's up", "check in", "how's my inventory", or any general opening):
1. Call inventory_readiness to get the current assessment.
2. Greet the user warmly and share a brief, friendly summary of their readiness status — don't dump raw numbers, interpret them conversationally. For example: "Your inventory is shaping up nicely! You've got 34 items across 6 rooms. A few things would make it even stronger for movers..."
3. Present exactly 3 suggested next steps as inline buttons based on the readiness results. Make the buttons actionable (e.g. "Add weights to items", "Catalog the Kitchen", "Take room photos").
4. Keep the greeting short — 2-3 sentences max before the buttons.

STRUCTURED RESPONSE FORMAT:
When you give your FINAL response (no more tool calls), you MUST wrap it in a JSON code block. This is how the orchestrator understands your output. The format is:

\`\`\`json
{
  "summary": "Your user-facing message goes here. This is what the user sees. Use all normal formatting (buttons, [IMG:] tags, markdown, etc.) inside this string.",
  "workflow": "inventory_cataloging",
  "step": "add_items",
  "confidence": 0.9,
  "recommended_orchestrator_action": "continue",
  "next_suggested_step": "check_missing_context",
  "state_delta": { "items_added": 3 }
}
\`\`\`

Field guide:
- summary: REQUIRED. The full user-facing message, exactly as you'd normally write it.
- workflow: REQUIRED. One of: "inventory_cataloging", "photo_analysis", "video_analysis", "inventory_review", "room_management", "duplicate_check", "readiness_check", "item_estimation", "greeting".
- step: REQUIRED. The specific step just completed, e.g. "add_items", "analyze_photo", "confirm_items", "summarize_room", "check_gaps", "greet_user".
- confidence: Optional 0.0-1.0. How confident you are in the overall result.
- recommended_orchestrator_action: REQUIRED. One of: "continue" (normal flow), "ask_user" (you need user input to proceed), "stop_and_summarize" (task is done), "switch_agent" (user needs Vector), "retry_step" (something failed, worth retrying), "abort" (unrecoverable error).
- next_suggested_step: Optional. What should happen next, e.g. "catalog_next_room", "review_duplicates", null if done.
- state_delta: Optional. Key changes made, e.g. { "items_added": 3, "room_created": "Kitchen" }.

IMPORTANT: Always use this format for your final response. Never return plain text without the JSON block.`;

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
    description: 'Assess how ready the user\'s inventory is for sharing with moving companies. Returns an overall readiness score (0-100), per-category breakdown, and the top 3 next steps to improve readiness. Call this proactively when greeting a returning user or when they ask about their progress.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {},
    },
  },
  {
    name: 'estimate_missing_items',
    description: 'Fill in estimated weights and dimensions for items that are missing them, using typical values for common household items. Use when many items lack measurements and the user wants a more complete inventory before sharing with movers.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        max_items: { type: SchemaType.INTEGER, description: 'Maximum number of items to estimate at once (default 20, max 50)' },
      },
    },
  },
];

// ── Tool Handlers (thin delegates to services) ──────────────────────────────────

const toolHandlers = {
  async add_item(args, userId) { return mutation.addItem(userId, args); },
  async add_room(args, userId) { return mutation.addRoom(userId, args); },
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

  async analyze_photo(args, userId, plan) { return media.analyzePhotoForInventory(args, userId, plan); },
  async analyze_video(args, userId, plan) { return media.analyzeVideoForInventory(args, userId, plan); },

  async get_item_photo(args, userId) { return getItemPhoto(userId, args); },
  async search_items(args, userId) { return searchItems(userId, args); },
  async find_duplicates(args, userId) { return duplicates.findDuplicates(userId, args); },

  async inventory_readiness(args, userId) {
    const assessment = await inventoryReadinessAssessment(userId);
    return { success: true, ...assessment };
  },

  async estimate_missing_items(args, userId) { return estimateMissingItems(userId, args); },
};

// ── Conversation Loop ───────────────────────────────────────────────────────────

// ── Human-readable tool labels for streaming UI ────────────────────────────────

const TOOL_LABELS = {
  add_item: 'Adding item',
  update_item: 'Updating item',
  delete_item: 'Removing item',
  search_items: 'Searching inventory',
  get_item_photo: 'Fetching photo',
  add_room: 'Creating room',
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
  let ttfeMs = null;
  let geminiTotalMs = 0;
  let visionTotalMs = 0;
  let geminiRounds = 0;
  let visionMetadata = {};

  const emit = (type, data = {}) => {
    if (ttfeMs === null) ttfeMs = Date.now() - interactionStart;
    if (onEvent) onEvent({ type, ...data });
  };
  if (!geminiClient) {
    throw new Error('GOOGLE_AI_API_KEY is not configured');
  }

  // ── 1. Resolve active session (one per user) ──────────────────────────────
  let session = await db.oneOrNone(
    `SELECT * FROM nexus_sessions WHERE user_id = $1 AND is_active = TRUE
     AND session_type IN ('census', 'onboarding', 'general')
     ORDER BY updated_at DESC LIMIT 1`,
    [userId]
  );
  if (!session) {
    session = await db.one(
      `INSERT INTO nexus_sessions (user_id) VALUES ($1) RETURNING *`, [userId]
    );
    console.log(`[census] New session for user: ${session.id}`);
  }
  const sessionId = session.id;

  // ── 2. Load conversation history with context consolidation ───────────────
  const contextSummaryText = session.context_summary || null;
  let historyRows;

  if (session.summary_through_id) {
    // Summary exists — load most recent 30 messages after the summarized point
    historyRows = await db.any(
      `SELECT id, role, content, tool_name, tool_args, tool_response, attachments
       FROM nexus_messages WHERE session_id = $1 AND id > $2
       ORDER BY created_at DESC LIMIT 30`,
      [sessionId, session.summary_through_id]
    );
    historyRows.reverse();
  } else {
    // No summary yet — load last 30 messages (all roles for Gemini structure)
    historyRows = await db.any(
      `SELECT id, role, content, tool_name, tool_args, tool_response, attachments
       FROM nexus_messages WHERE session_id = $1
       ORDER BY created_at DESC LIMIT 30`,
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
    ? `Name: ${user.first_name || 'Unknown'} ${user.last_name || ''}\nOnboarding completed: ${user.onboarding_completed}`
    : 'Unknown user';

  let systemInstruction = SYSTEM_PROMPT
    .replace('{{USER_CONTEXT}}', userContext)
    .replace('{{INVENTORY_SNAPSHOT}}', inventorySnapshot);

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
  const modelId = 'gemini-2.5-flash';
  const model = geminiClient.getGenerativeModel({
    model: modelId,
    systemInstruction,
    tools: [{ functionDeclarations: toolDeclarations }],
    generationConfig: { maxOutputTokens: 4096 },
  });

  const actions = [];
  let maxToolRounds = 8; // Safety limit to prevent infinite loops

  emit('thinking');
  let geminiCallStart = Date.now();
  let result = await model.generateContent({ contents });
  geminiTotalMs += Date.now() - geminiCallStart;
  geminiRounds++;

  while (maxToolRounds > 0) {
    const response = result.response;
    const candidate = response.candidates?.[0];
    if (!candidate) break;

    const parts = candidate.content?.parts || [];
    const functionCalls = parts.filter(p => p.functionCall);
    const textParts = parts.filter(p => p.text);

    // Stream intermediate text if model produced text alongside tool calls
    if (textParts.length > 0 && functionCalls.length > 0) {
      const intermediateText = textParts.map(p => p.text).join('\n');
      emit('partial_reply', { text: intermediateText });
      // Persist intermediate text as a model message
      await db.none(
        `INSERT INTO nexus_messages (session_id, role, content) VALUES ($1, 'model', $2)`,
        [sessionId, intermediateText]
      );
    }

    if (functionCalls.length === 0) {
      // No more tool calls — this is the final text response
      const rawText = textParts.map(p => p.text).join('\n');

      // Build structured SpecialistResponse
      const derived = deriveFieldsFromActions(actions, 'census', false);
      const geminiFields = parseJsonBlock(rawText);
      let structuredResponse;

      if (geminiFields && geminiFields.summary) {
        structuredResponse = buildSpecialistResponse(
          { agent: 'census', ...derived },
          geminiFields
        );
      } else {
        structuredResponse = buildFallbackResponse(rawText, 'census', actions, false);
      }

      // Persist model reply (store summary as the message content)
      await db.none(
        `INSERT INTO nexus_messages (session_id, role, content) VALUES ($1, 'model', $2)`,
        [sessionId, structuredResponse.summary]
      );

      // Update session
      const itemsAdded = actions.filter(a => a.tool === 'add_item' && a.result?.success).length;
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
        console.error('[census] Summary generation failed:', err.message)
      );

      // Fire-and-forget metrics logging
      const totalMs = Date.now() - interactionStart;
      const toolCallNames = actions.map(a => a.tool);
      const itemsAddedCount = actions.filter(a => a.tool === 'add_item' && a.result?.success).length;
      metrics.logInteraction({
        userId, sessionId,
        timing: { totalMs, ttfeMs, geminiMs: geminiTotalMs, visionMs: visionTotalMs || null },
        context: {
          hadAttachments: attachments.length > 0,
          attachmentCount: attachments.length,
          attachmentTypes: attachments.map(a => a.mimeType),
          toolCalls: toolCallNames,
          itemsAdded: itemsAddedCount,
          geminiModel: modelId,
          geminiRounds,
        },
        vision: visionMetadata,
        error: { hadError: false },
      }).catch(() => {});

      emit('done', { reply: structuredResponse.summary, actions, sessionId });
      return { ...structuredResponse, actions, sessionId };
    }

    // Execute function calls
    const toolResponses = [];
    for (const part of functionCalls) {
      const { name, args } = part.functionCall;
      console.log(`[census] Tool call: ${name}(${JSON.stringify(args).substring(0, 200)})`);

      const toolLabel = TOOL_LABELS[name] || name.replace(/_/g, ' ');
      const detail = args.name || args.room_name || args.item_name || '';
      emit('tool_call', { tool: name, label: toolLabel, detail });

      let toolResult;
      try {
        const handler = toolHandlers[name];
        if (!handler) {
          toolResult = { success: false, error: `Unknown tool: ${name}` };
        } else {
          toolResult = await handler(args, userId, plan);
        }
      } catch (err) {
        console.error(`[census] Tool ${name} failed:`, err.message);
        toolResult = { success: false, error: err.message };
      }

      // Collect vision timing/confidence metrics
      if ((name === 'analyze_photo' || name === 'analyze_video') && toolResult._visionMs) {
        visionTotalMs += toolResult._visionMs;
        if (toolResult._avgConfidence != null) {
          visionMetadata = {
            detectedItemCount: toolResult._detectedItemCount,
            avgConfidence: toolResult._avgConfidence,
            minConfidence: toolResult._minConfidence,
            provider: toolResult._visionProvider || 'gemini',
          };
        }
      }

      actions.push({ tool: name, args, result: toolResult });

      emit('tool_result', { tool: name, success: !!toolResult.success });

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
    contents.push({ role: 'model', parts: functionCalls.map(p => ({ functionCall: p.functionCall })) });
    contents.push({ role: 'user', parts: toolResponses });

    emit('thinking');
    geminiCallStart = Date.now();
    result = await model.generateContent({ contents });
    geminiTotalMs += Date.now() - geminiCallStart;
    geminiRounds++;
    maxToolRounds--;
  }

  // Fallback if we hit max rounds
  const fallbackReply = 'I\'ve processed your request. Let me know what you\'d like to do next!';
  const fallbackResponse = buildFallbackResponse(fallbackReply, 'census', actions, true);

  await db.none(
    `INSERT INTO nexus_messages (session_id, role, content) VALUES ($1, 'model', $2)`,
    [sessionId, fallbackReply]
  );

  // Fire-and-forget metrics logging
  const fallbackTotalMs = Date.now() - interactionStart;
  const fallbackToolNames = actions.map(a => a.tool);
  const fallbackItemsAdded = actions.filter(a => a.tool === 'add_item' && a.result?.success).length;
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
    error: { hadError: false },
  }).catch(() => {});

  emit('done', { reply: fallbackReply, actions, sessionId });
  return { ...fallbackResponse, actions, sessionId };
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
     ORDER BY created_at ASC`,
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

  console.log(`[census] Summary updated for session ${sessionId} (through msg ${newSummaryThroughId}, ${newMessages.length} new messages summarized)`);
}

module.exports = { processMessage, generateContextSummary, SYSTEM_PROMPT };
