'use strict';

const { GoogleGenerativeAI, SchemaType } = require('@google/generative-ai');
const conn = require('./db');
const db = conn.db;
const census = require('./censusService');
const { analyzeMultiItemPhoto, analyzeMultiImagePhoto, analyzeItemPhoto } = require('../services/vision/visionService');
const { analyzeVideo } = require('../services/vision/geminiVideoScanService');
const { buildGeminiContents } = require('./geminiHistoryBuilder');
const metrics = require('./metricsService');

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

// ── Knex (for transactional inserts) ────────────────────────────────────────────

const knex = require('knex')({
  client: 'pg',
  connection: {
    host: process.env.MT_DATALAYER_HOSTNAME,
    user: process.env.MT_DATALAYER_USERNAME,
    password: process.env.MT_DATALAYER_PASSWORD,
    database: process.env.MT_DATALAYER_DATABASE,
  },
  pool: { min: 0, max: 5 },
});

// ── Helpers ──────────────────────────────────────────────────────────────────────

const https = require('https');
const http = require('http');

function downloadBuffer(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    client.get(url, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    }).on('error', reject);
  });
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

ONBOARDING FLOW (if user is new / has no inventory):
1. Greet warmly and ask what brings them here (moving, organizing, insurance, etc.)
2. Ask where they're moving from — get the address naturally
3. Ask about the home: apartment or house? How many bedrooms/bathrooms?
4. Create the location and rooms using set_location and add_room
5. Transition naturally into inventory: "Great! Let's start cataloging. What's in your living room?"

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
11. If the user corrects you, call update_item immediately. If they want to rename a room, use update_room — do NOT create a new room. Similarly, use update_location to change location details.
12. If the user asks to remove or delete an item, ALWAYS confirm before calling delete_item. Say which item you're about to delete and wait for their "yes".
13. After adding 3+ items at once (e.g. from a photo or video scan), call find_duplicates to check for accidental duplicates. If duplicates are found, list them and ask the user which to keep or remove.
14. If the user asks to see a photo of an item, call get_item_photo. If the tool returns a picture_url, include it in your response using the exact format: [IMG:url] — the app will render it as an image. Example: "Here's your sofa: [IMG:https://storage.googleapis.com/bucket/path.jpg]"

INLINE BUTTONS:
When presenting the user with a choice (e.g. duplicate resolution, room selection, confirmation), use inline buttons so they can tap instead of typing. Format:

[BUTTONS]
Button Label|message to send when tapped
Another Option|different message to send
[/BUTTONS]

Examples:
- Duplicate found: offer "Keep Queen Bed|Keep item 142, delete item 158" / "Keep Queen Bed Frame|Keep item 158, delete item 142" / "Keep both|They're not duplicates, keep both"
- Next room: offer "Kitchen|Let's catalog the Kitchen" / "Bathroom|Let's catalog the Bathroom" / "I'm done|I'm done adding items for now"
- Confirmation: offer "Add all 5|Yes, add all 5 items" / "Let me review|Hold on, let me review the list first"
Keep button labels short (2-5 words). Always include 2-4 options. Use buttons whenever the user needs to make a quick decision.

CONVERSATION FLOW (returning users):
- If home context is unknown, ask about type, bedrooms, bathrooms.
- Work room by room: "Let's start with the living room."
- After each room: "Anything else in [room]? Let's move to [next room]."
- End with summary: "Here's what we've got: [summary]. Anything I missed?"

PROACTIVE GREETING (when the user's message is a session greeting like "hi", "hello", "hey", "what's up", "check in", "how's my inventory", or any general opening):
1. Call inventory_readiness to get the current assessment.
2. Greet the user warmly and share a brief, friendly summary of their readiness status — don't dump raw numbers, interpret them conversationally. For example: "Your inventory is shaping up nicely! You've got 34 items across 6 rooms. A few things would make it even stronger for movers..."
3. Present exactly 3 suggested next steps as inline buttons based on the readiness results. Make the buttons actionable (e.g. "Add weights to items", "Catalog the Kitchen", "Take room photos").
4. Keep the greeting short — 2-3 sentences max before the buttons.`;

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
    name: 'update_location',
    description: 'Update an existing location. Use when the user wants to rename or change address details of a location.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        location_id: { type: SchemaType.STRING, description: 'The ID of the location to update' },
        name:        { type: SchemaType.STRING, description: 'New name for the location' },
        address:     { type: SchemaType.STRING, description: 'New street address' },
        city:        { type: SchemaType.STRING, description: 'New city' },
        state:       { type: SchemaType.STRING, description: 'New state abbreviation' },
        zip:         { type: SchemaType.STRING, description: 'New ZIP code' },
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
    description: 'Create a new location (home address). Use during onboarding to set where the user is moving from.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        name:    { type: SchemaType.STRING, description: 'Location name, e.g. "My Apartment", "Home"' },
        address: { type: SchemaType.STRING, description: 'Street address' },
        city:    { type: SchemaType.STRING, description: 'City' },
        state:   { type: SchemaType.STRING, description: 'State abbreviation' },
        zip:     { type: SchemaType.STRING, description: 'ZIP code' },
      },
      required: ['name'],
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
];

// ── Tool Handlers ───────────────────────────────────────────────────────────────

/**
 * Get the user's primary location_id. If none exists, returns null.
 */
async function getPrimaryLocationId(userId) {
  const loc = await db.oneOrNone(
    `SELECT id FROM locations WHERE user_id = $1
     ORDER BY location_type = 'primary_residence' DESC, created_at ASC LIMIT 1`,
    [userId]
  );
  return loc ? loc.id : null;
}

/**
 * Find a collection by name for a user, or create one.
 */
async function findOrCreateRoom(userId, roomName, locationId) {
  // Try exact match first
  let room = await db.oneOrNone(
    `SELECT id, name FROM collections WHERE user_id = $1 AND LOWER(name) = LOWER($2)`,
    [userId, roomName]
  );
  if (room) return room;

  // Create it
  if (!locationId) {
    locationId = await getPrimaryLocationId(userId);
  }
  if (!locationId) {
    throw new Error('No location found. Please create a location first using set_location.');
  }

  const [created] = await knex('collections')
    .insert({
      user_id: userId,
      name: roomName,
      location_id: locationId,
    })
    .returning(['id', 'name']);

  // Add permission
  await knex('permissions').insert({
    user_id: userId,
    resource_id: created.id,
    resource_type: 'collection',
    permission_level: 'owner',
    granted_by: userId,
  });

  console.log(`[nexus] Created room: "${roomName}" (id: ${created.id})`);
  return created;
}

const toolHandlers = {
  async add_item(args, userId) {
    const locationId = await getPrimaryLocationId(userId);
    const room = await findOrCreateRoom(userId, args.room_name, locationId);

    const params = {
      user_id: userId,
      name: args.name,
      collection_id: room.id,
      quantity: args.quantity || 1,
    };

    if (args.description) params.description = args.description;
    if (args.weight_lbs) params.weight_lbs = args.weight_lbs;
    if (args.length_in) params.length_in = args.length_in;
    if (args.width_in) params.width_in = args.width_in;
    if (args.height_in) params.height_in = args.height_in;
    if (args.fragile !== undefined) params.fragile = args.fragile;
    if (args.material) params.material = args.material;
    if (args.primary_color) params.primary_color = args.primary_color;
    if (args.tags) params.tags = args.tags;
    if (args.estimated_value) params.estimated_value = args.estimated_value;
    if (args.notes) params.notes = args.notes;
    if (args.picture_url) params.picture_url = args.picture_url;
    if (args.confidence_score != null) params.confidence_score = Math.max(0, Math.min(1, args.confidence_score));
    if (args.confidence_source) params.confidence_source = args.confidence_source;

    const [item] = await knex.transaction(async (trx) => {
      const [inserted] = await knex('items').transacting(trx).insert(params).returning(['id', 'name']);
      await knex('permissions').transacting(trx).insert({
        user_id: userId,
        resource_id: inserted.id,
        resource_type: 'item',
        permission_level: 'owner',
        granted_by: userId,
      });
      return [inserted];
    });

    console.log(`[nexus] Added item: "${args.name}" to "${args.room_name}" (id: ${item.id})`);
    return { success: true, itemId: item.id, name: args.name, room: args.room_name };
  },

  async add_room(args, userId) {
    const locationId = await getPrimaryLocationId(userId);
    if (!locationId) {
      return { success: false, error: 'No location found. Create a location first.' };
    }
    const room = await findOrCreateRoom(userId, args.name, locationId);
    return { success: true, roomId: room.id, name: room.name };
  },

  async get_inventory_summary(args, userId) {
    const snapshot = await census.getInventorySnapshot(userId);
    return { success: true, summary: snapshot };
  },

  async get_missing_context(args, userId) {
    const rooms = await db.any(
      `SELECT name FROM collections WHERE user_id = $1`, [userId]
    );
    const roomNames = rooms.map(r => r.name);
    const result = census.getMissingContext(
      roomNames,
      args.home_type || 'apartment',
      args.bedroom_count || 1,
      args.bathroom_count || 1
    );
    return { success: true, ...result, existingRooms: roomNames };
  },

  async analyze_photo(args, userId) {
    try {
      const gcs = require('./gcsService');
      const { cropByBoundingBox } = require('../services/images/crop');

      // ── Normalize inputs ──
      let files = args.files || [];
      if (files.length === 0 && args.file_url) {
        files = [{ file_url: args.file_url, mime_type: args.mime_type }];
      }
      if (files.length === 0) {
        return { success: false, error: 'No photos provided' };
      }
      if (files.length > 5) {
        return { success: false, error: 'Maximum 5 photos per call. Send additional photos in a separate call.' };
      }

      const mode = args.mode || 'multi_item';

      // ── Download all images ──
      const imageBuffers = [];
      for (const file of files) {
        try {
          const buffer = await downloadBuffer(file.file_url);
          imageBuffers.push({ buffer, mimeType: file.mime_type, url: file.file_url });
        } catch (dlErr) {
          console.warn(`[nexus] Failed to download ${file.file_url}:`, dlErr.message);
        }
      }
      if (imageBuffers.length === 0) {
        return { success: false, error: 'Failed to download any of the provided photos' };
      }

      const visionStart = Date.now();

      // ── Single-item mode (close-up of one item) ──
      if (mode === 'single_item') {
        const base64 = imageBuffers[0].buffer.toString('base64');
        const result = await analyzeItemPhoto(base64, imageBuffers[0].mimeType, 'gemini');
        // Upload original as item photo — no cropping needed for close-ups
        const photoPath = `users/${userId}/nexus/photos/${Date.now()}.jpg`;
        await gcs.uploadBuffer(imageBuffers[0].buffer, photoPath, imageBuffers[0].mimeType);
        const pictureUrl = `https://storage.googleapis.com/${gcs.BUCKET}/${photoPath}`;
        const itemData = result.data || result;
        const conf = itemData.confidence || 0;
        return {
          success: true,
          mode: 'single_item',
          item: { ...itemData, picture_url: pictureUrl },
          _visionMs: Date.now() - visionStart,
          _detectedItemCount: 1,
          _avgConfidence: conf || null,
          _minConfidence: conf || null,
          _visionProvider: 'gemini',
        };
      }

      // ── Multi-item mode ──
      let items, itemCount;

      if (imageBuffers.length === 1) {
        // Single image: existing multi-item path
        const base64 = imageBuffers[0].buffer.toString('base64');
        const result = await analyzeMultiItemPhoto(base64, imageBuffers[0].mimeType, 'gemini');
        items = result.data?.items || result.items || [];
        itemCount = result.data?.itemCount || result.itemCount || items.length;
        items.forEach(item => { item.sourceImage = 1; });
      } else {
        // Multiple images: holistic cross-image analysis
        console.log(`[nexus] Analyzing ${imageBuffers.length} photos holistically`);
        const imageSources = imageBuffers.map(ib => ({
          base64: ib.buffer.toString('base64'),
          mimeType: ib.mimeType,
        }));
        const result = await analyzeMultiImagePhoto(imageSources, 'gemini');
        items = result.data?.items || result.items || [];
        itemCount = result.data?.itemCount || result.itemCount || items.length;
      }

      // ── Crop each item from its source image ──
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const bbox = item.boundingBox || item.bbox;
        if (!bbox) continue;

        // sourceImage is 1-based; default to 1
        const srcIdx = (item.sourceImage || 1) - 1;
        const sourceBuffer = imageBuffers[Math.min(srcIdx, imageBuffers.length - 1)].buffer;

        try {
          const cropped = await cropByBoundingBox(sourceBuffer, bbox, { minSize: 10, quality: 85 });
          if (!cropped) continue;
          const cropPath = `users/${userId}/nexus/crops/${Date.now()}-${i}.jpg`;
          await gcs.uploadBuffer(cropped, cropPath, 'image/jpeg');
          item.picture_url = `https://storage.googleapis.com/${gcs.BUCKET}/${cropPath}`;
          console.log(`[nexus] Cropped item[${i}] "${item.name}" from image ${srcIdx + 1}`);
        } catch (cropErr) {
          console.warn(`[nexus] Crop failed for item[${i}]:`, cropErr.message);
        }
      }

      const visionElapsed = Date.now() - visionStart;
      const confidences = items.map(i => i.confidence || 0).filter(c => c > 0);
      return {
        success: true, mode: 'multi_item', imageCount: imageBuffers.length, items, itemCount,
        _visionMs: visionElapsed,
        _detectedItemCount: items.length,
        _avgConfidence: confidences.length > 0 ? confidences.reduce((a, b) => a + b, 0) / confidences.length : null,
        _minConfidence: confidences.length > 0 ? Math.min(...confidences) : null,
        _visionProvider: 'gemini',
      };
    } catch (err) {
      console.error('[nexus] analyze_photo failed:', err.message);
      return { success: false, error: err.message };
    }
  },

  async analyze_video(args, userId) {
    try {
      const fs = require('fs');
      const os = require('os');
      const path = require('path');
      const gcs = require('./gcsService');
      const { extractSharpestFrame } = require('../services/vision/frameExtractor');

      const url = args.file_url;
      console.log(`[nexus] Downloading video for analysis: ${url}`);
      const videoBuffer = await downloadBuffer(url);

      console.log(`[nexus] Video downloaded: ${(videoBuffer.length / 1024 / 1024).toFixed(1)}MB`);
      const videoVisionStart = Date.now();
      const result = await analyzeVideo(videoBuffer, args.mime_type);
      const items = result.items || [];

      // Extract frames for each item with a timestamp and upload to GCS
      const ext = (args.mime_type || 'video/mp4').split('/')[1] || 'mp4';
      const tmpPath = path.join(os.tmpdir(), `nexus-video-${Date.now()}.${ext}`);
      fs.writeFileSync(tmpPath, videoBuffer);

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const ts = item.timestamp_seconds || item.timestamp;
        if (ts == null) continue;
        try {
          const frameBuffer = await extractSharpestFrame(tmpPath, ts);
          if (frameBuffer && frameBuffer.length > 0) {
            const framePath = `users/${userId}/nexus/video-frames/${Date.now()}-${i}.jpg`;
            await gcs.uploadBuffer(frameBuffer, framePath, 'image/jpeg');
            item.picture_url = `https://storage.googleapis.com/${gcs.BUCKET}/${framePath}`;
            console.log(`[nexus] Extracted frame for item[${i}] "${item.name}" at ${ts}s`);
          }
        } catch (frameErr) {
          console.warn(`[nexus] Frame extraction failed for item[${i}]:`, frameErr.message);
        }
      }

      // Clean up temp file
      try { fs.unlinkSync(tmpPath); } catch (_) {}

      const videoVisionElapsed = Date.now() - videoVisionStart;
      const videoConfidences = items.map(i => i.confidence || 0).filter(c => c > 0);
      return {
        success: true, items, itemCount: items.length, parseError: result.parseError,
        _visionMs: videoVisionElapsed,
        _detectedItemCount: items.length,
        _avgConfidence: videoConfidences.length > 0 ? videoConfidences.reduce((a, b) => a + b, 0) / videoConfidences.length : null,
        _minConfidence: videoConfidences.length > 0 ? Math.min(...videoConfidences) : null,
        _visionProvider: 'gemini',
      };
    } catch (err) {
      console.error('[nexus] analyze_video failed:', err.message);
      return { success: false, error: err.message };
    }
  },

  async update_item(args, userId) {
    const updates = {};
    if (args.name) updates.name = args.name;
    if (args.description) updates.description = args.description;
    if (args.quantity) updates.quantity = args.quantity;
    if (args.weight_lbs) updates.weight_lbs = args.weight_lbs;
    if (args.fragile !== undefined) updates.fragile = args.fragile;
    if (args.notes) updates.notes = args.notes;
    updates.updated_at = new Date();

    const count = await knex('items')
      .where({ id: args.item_id, user_id: userId })
      .update(updates);

    if (count === 0) {
      return { success: false, error: 'Item not found or not authorized' };
    }
    return { success: true, itemId: args.item_id };
  },

  async delete_item(args, userId) {
    // Verify ownership
    const item = await knex('items')
      .select('id', 'name')
      .where({ id: args.item_id, user_id: userId })
      .first();

    if (!item) {
      return { success: false, error: 'Item not found or not authorized' };
    }

    await knex.transaction(async (trx) => {
      await knex('permissions').transacting(trx)
        .where({ resource_id: args.item_id, resource_type: 'item' })
        .del();
      await knex('items').transacting(trx)
        .where({ id: args.item_id, user_id: userId })
        .del();
    });

    console.log(`[nexus] Deleted item: "${item.name}" (id: ${args.item_id})`);
    return { success: true, deletedId: args.item_id, name: item.name };
  },

  async get_item_photo(args, userId) {
    let item;
    if (args.item_id) {
      item = await knex('items')
        .select('id', 'name', 'picture_url')
        .where({ id: args.item_id, user_id: userId })
        .first();
    } else if (args.item_name) {
      item = await knex('items')
        .select('id', 'name', 'picture_url')
        .where({ user_id: userId })
        .whereRaw('LOWER(name) LIKE ?', [`%${args.item_name.toLowerCase()}%`])
        .first();
    }

    if (!item) {
      return { success: false, error: 'Item not found' };
    }
    if (!item.picture_url) {
      return { success: true, hasPhoto: false, name: item.name, message: 'No photo available for this item.' };
    }
    return { success: true, hasPhoto: true, name: item.name, picture_url: item.picture_url };
  },

  async search_items(args, userId) {
    const allowedMissing = [
      'weight_lbs', 'length_in', 'width_in', 'height_in',
      'description', 'picture_url', 'material', 'primary_color', 'estimated_value',
    ];

    let query = knex('items')
      .select(
        'items.id', 'items.name', 'items.description', 'items.quantity',
        'items.weight_lbs', 'items.length_in', 'items.width_in', 'items.height_in',
        'items.fragile', 'items.material', 'items.primary_color',
        'items.estimated_value', 'items.picture_url',
        'collections.name as room_name'
      )
      .leftJoin('collections', 'items.collection_id', 'collections.id')
      .where('items.user_id', userId);

    if (args.room_name) {
      query = query.whereRaw('LOWER(collections.name) = ?', [args.room_name.toLowerCase()]);
    }
    if (args.search) {
      query = query.whereRaw('LOWER(items.name) LIKE ?', [`%${args.search.toLowerCase()}%`]);
    }
    if (args.missing_field && allowedMissing.includes(args.missing_field)) {
      query = query.whereNull(`items.${args.missing_field}`);
    }
    if (args.fragile !== undefined) {
      query = query.where('items.fragile', args.fragile);
    }

    const limit = Math.min(args.limit || 50, 100);
    const items = await query.orderBy('items.name').limit(limit);

    return { success: true, items, count: items.length };
  },

  async find_duplicates(args, userId) {
    const threshold = Math.max(50, Math.min(95, args.threshold || 70));

    let query = knex('items')
      .select('items.id', 'items.name', 'items.quantity', 'items.description',
              'items.picture_url', 'collections.name as room_name')
      .leftJoin('collections', 'items.collection_id', 'collections.id')
      .where('items.user_id', userId);

    if (args.room_name) {
      query = query.whereRaw('LOWER(collections.name) = ?', [args.room_name.toLowerCase()]);
    }

    const items = await query.orderBy('items.name');

    // Levenshtein distance (mirroring frontend logic)
    function levenshtein(a, b) {
      const m = a.length, n = b.length;
      const dp = Array.from({ length: n + 1 }, () => Array(m + 1).fill(0));
      for (let i = 0; i <= m; i++) dp[0][i] = i;
      for (let j = 0; j <= n; j++) dp[j][0] = j;
      for (let j = 1; j <= n; j++) {
        for (let i = 1; i <= m; i++) {
          dp[j][i] = Math.min(
            dp[j][i - 1] + 1,
            dp[j - 1][i] + 1,
            dp[j - 1][i - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
          );
        }
      }
      return dp[n][m];
    }

    const pairs = [];
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        const a = (items[i].name || '').toLowerCase().trim();
        const b = (items[j].name || '').toLowerCase().trim();
        if (!a || !b) continue;

        const dist = levenshtein(a, b);
        const maxLen = Math.max(a.length, b.length);
        let similarity = Math.round(((maxLen - dist) / maxLen) * 1000) / 10;

        // Boost if same room
        if (items[i].room_name && items[j].room_name &&
            items[i].room_name.toLowerCase() === items[j].room_name.toLowerCase()) {
          similarity = Math.min(100, similarity + 10);
        }

        if (similarity >= threshold) {
          pairs.push({
            itemA: { id: items[i].id, name: items[i].name, room: items[i].room_name, quantity: items[i].quantity },
            itemB: { id: items[j].id, name: items[j].name, room: items[j].room_name, quantity: items[j].quantity },
            similarity,
          });
        }
      }
    }

    pairs.sort((a, b) => b.similarity - a.similarity);

    return {
      success: true,
      duplicateCount: pairs.length,
      pairs: pairs.slice(0, 20), // Cap at 20 pairs
      message: pairs.length === 0
        ? 'No potential duplicates found.'
        : `Found ${pairs.length} potential duplicate pair(s).`,
    };
  },

  async set_user_profile(args, userId) {
    const updates = {};
    if (args.first_name) updates.first_name = args.first_name;
    if (args.last_name) updates.last_name = args.last_name;
    updates.updated_at = new Date();

    await knex('users').where({ user_id: userId }).update(updates);

    // Goal is stored on the onboarding flow — for now, log it
    if (args.goal) {
      console.log(`[nexus] User goal set: ${args.goal}`);
    }
    return { success: true, name: `${args.first_name || ''} ${args.last_name || ''}`.trim() };
  },

  async set_location(args, userId) {
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

    console.log(`[nexus] Created location: "${args.name}" (id: ${location.id})`);
    return { success: true, locationId: location.id, name: args.name };
  },

  async update_room(args, userId) {
    let room;
    if (args.room_id) {
      room = await knex('collections')
        .select('id', 'name')
        .where({ id: args.room_id, user_id: userId })
        .first();
    } else if (args.room_name) {
      room = await knex('collections')
        .select('id', 'name')
        .where({ user_id: userId })
        .whereRaw('LOWER(name) = ?', [args.room_name.toLowerCase()])
        .first();
    }

    if (!room) {
      return { success: false, error: 'Room not found or not authorized' };
    }

    const updates = {};
    if (args.name) updates.name = args.name;
    if (args.description) updates.description = args.description;
    updates.updated_at = new Date();

    await knex('collections').where({ id: room.id, user_id: userId }).update(updates);

    console.log(`[nexus] Updated room: "${room.name}" → "${args.name || room.name}" (id: ${room.id})`);
    return { success: true, roomId: room.id, oldName: room.name, newName: args.name || room.name };
  },

  async update_location(args, userId) {
    let locationId = args.location_id;
    if (!locationId) {
      locationId = await getPrimaryLocationId(userId);
    }
    if (!locationId) {
      return { success: false, error: 'No location found' };
    }

    const loc = await knex('locations')
      .select('id', 'name')
      .where({ id: locationId, user_id: userId })
      .first();

    if (!loc) {
      return { success: false, error: 'Location not found or not authorized' };
    }

    const updates = {};
    if (args.name) updates.name = args.name;
    if (args.address) updates.address = args.address;
    if (args.city) updates.city = args.city;
    if (args.state) updates.state = args.state;
    if (args.zip) updates.zip = args.zip;
    updates.updated_at = new Date();

    await knex('locations').where({ id: loc.id, user_id: userId }).update(updates);

    console.log(`[nexus] Updated location: "${loc.name}" → "${args.name || loc.name}" (id: ${loc.id})`);
    return { success: true, locationId: loc.id, oldName: loc.name, newName: args.name || loc.name };
  },

  async inventory_readiness(args, userId) {
    const assessment = await census.getReadinessAssessment(userId);
    return { success: true, ...assessment };
  },
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
  set_user_profile: 'Setting up profile',
  set_location: 'Setting location',
  update_location: 'Updating location',
  find_duplicates: 'Checking for duplicates',
  inventory_readiness: 'Assessing inventory readiness',
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
    console.log(`[nexus] New session for user: ${session.id}`);
  }
  const sessionId = session.id;

  // ── 2. Load conversation history with context consolidation ───────────────
  const contextSummaryText = session.context_summary || null;
  let historyRows;

  if (session.summary_through_id) {
    // Summary exists — load only messages after the summarized point
    historyRows = await db.any(
      `SELECT id, role, content, tool_name, tool_args, tool_response, attachments
       FROM nexus_messages WHERE session_id = $1 AND id > $2
       ORDER BY created_at ASC`,
      [sessionId, session.summary_through_id]
    );
  } else {
    // No summary yet — load last 60 messages (all roles for Gemini structure)
    historyRows = await db.any(
      `SELECT id, role, content, tool_name, tool_args, tool_response, attachments
       FROM nexus_messages WHERE session_id = $1
       ORDER BY created_at DESC LIMIT 60`,
      [sessionId]
    );
    historyRows.reverse(); // Back to chronological order
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
  const inventorySnapshot = await census.getInventorySnapshot(userId);
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
    const starters = await census.getConversationStarters(userId);
    if (starters.length > 0) {
      systemInstruction += `\n\nCONVERSATION STARTERS (this is a new session — use these to greet the user with something relevant and actionable):\n${starters.join('\n')}`;
    }
  }

  // Inject conversation history summary (older messages, condensed)
  if (contextSummaryText) {
    systemInstruction += `\n\nCONVERSATION HISTORY SUMMARY (older messages you've had with this user, summarized for context):\n${contextSummaryText}`;
  }

  // ── 6. Call Gemini ────────────────────────────────────────────────────────
  const modelId = GEMINI_MODELS[plan] || GEMINI_MODELS.basic;
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

    if (functionCalls.length === 0) {
      // No more tool calls — this is the final text response
      const reply = textParts.map(p => p.text).join('\n');

      // Persist model reply
      await db.none(
        `INSERT INTO nexus_messages (session_id, role, content) VALUES ($1, 'model', $2)`,
        [sessionId, reply]
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
        console.error('[nexus] Summary generation failed:', err.message)
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

      emit('done', { reply, actions, sessionId });
      return { reply, actions, sessionId };
    }

    // Execute function calls
    const toolResponses = [];
    for (const part of functionCalls) {
      const { name, args } = part.functionCall;
      console.log(`[nexus] Tool call: ${name}(${JSON.stringify(args).substring(0, 200)})`);

      const toolLabel = TOOL_LABELS[name] || name.replace(/_/g, ' ');
      const detail = args.name || args.room_name || args.item_name || '';
      emit('tool_call', { tool: name, label: toolLabel, detail });

      let toolResult;
      try {
        const handler = toolHandlers[name];
        if (!handler) {
          toolResult = { success: false, error: `Unknown tool: ${name}` };
        } else {
          toolResult = await handler(args, userId);
        }
      } catch (err) {
        console.error(`[nexus] Tool ${name} failed:`, err.message);
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
  return { reply: fallbackReply, actions, sessionId };
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

  console.log(`[nexus] Summary updated for session ${sessionId} (through msg ${newSummaryThroughId}, ${newMessages.length} new messages summarized)`);
}

module.exports = { processMessage, generateContextSummary, SYSTEM_PROMPT };
