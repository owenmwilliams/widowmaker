'use strict';

const { GoogleGenerativeAI, SchemaType } = require('@google/generative-ai');
const conn = require('./db');
const db = conn.db;
const census = require('./censusService');
const { analyzeMultiItemPhoto } = require('./visionService');
const { analyzeVideo } = require('./videoScanService');

// ── Gemini Client ───────────────────────────────────────────────────────────────

let geminiClient = null;
if (process.env.GOOGLE_AI_API_KEY) {
  geminiClient = new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY);
  console.log('[nexusService] Gemini configured');
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

// ── System Prompt ───────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are Nexus, the MoveTrack AI assistant. You help people manage their moves and catalog their belongings through natural conversation.

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
3. If the user sends a photo, call analyze_photo to detect items.
   - If analyze_photo returns empty items or fails, retry the call ONE more time.
   - If it still fails or returns no usable data, do NOT guess or invent items. Instead, apologize and ask the user if they'd like to try another photo or describe the items manually.
   - When analyze_photo succeeds, list the detected items for the user and ASK FOR CONFIRMATION before calling add_item. For example: "I can see: 1) Queen Bed, 2) Nightstand, 3) Dresser. Want me to add all of these, or would you like to make changes?"
   - Only call add_item after the user confirms. If they want to remove or change items, adjust accordingly.
   - When calling add_item for photo-detected items, include the picture_url from the analyze_photo results if available.
   - The same confirmation rules apply to analyze_video — list detected items and wait for user approval before adding.
4. If the user sends a video, call analyze_video to detect items. The same retry and confirmation rules from rule 3 apply.
5. Use realistic weight/dimension estimates: queen mattress ~80 lbs, sofa ~100 lbs, dining chair ~20 lbs, bookshelf ~70 lbs, TV ~30 lbs, dresser ~120 lbs, desk ~60 lbs.
6. If a room doesn't exist yet, call add_room first, then add items.
7. Confidence scoring:
   - 0.9+: user explicitly named the item with details
   - 0.7-0.8: detected in a photo or inferred from context
   - 0.5: suggested — ask before adding, do NOT call add_item
8. After covering a room, summarize and suggest the next room.
9. Periodically call get_inventory_summary to share progress.
10. NEVER invent or hallucinate items. Only add items the user explicitly mentioned or that were returned by analyze_photo or analyze_video. If a tool returns no data, tell the user — do not fill in the gap yourself.
11. If the user corrects you, call update_item immediately.

CONVERSATION FLOW (returning users):
- If home context is unknown, ask about type, bedrooms, bathrooms.
- Work room by room: "Let's start with the living room."
- After each room: "Anything else in [room]? Let's move to [next room]."
- End with summary: "Here's what we've got: [summary]. Anything I missed?"`;

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
        quantity:       { type: SchemaType.INTEGER, description: 'How many. Default 1.' },
        description:    { type: SchemaType.STRING, description: 'Brief description' },
        weight_lbs:     { type: SchemaType.NUMBER, description: 'Estimated weight in pounds' },
        length_in:      { type: SchemaType.NUMBER, description: 'Length in inches' },
        width_in:       { type: SchemaType.NUMBER, description: 'Width in inches' },
        height_in:      { type: SchemaType.NUMBER, description: 'Height in inches' },
        fragile:        { type: SchemaType.BOOLEAN, description: 'Whether item is fragile' },
        material:       { type: SchemaType.STRING, description: 'Primary material (wood, metal, glass, etc.)' },
        primary_color:  { type: SchemaType.STRING, description: 'Primary color' },
        tags:           { type: SchemaType.ARRAY, items: { type: SchemaType.STRING }, description: 'Tags like "Fragile", "Heavy", "Antique"' },
        estimated_value: { type: SchemaType.NUMBER, description: 'Estimated dollar value' },
        notes:          { type: SchemaType.STRING, description: 'Notes like "requires disassembly", "heavy"' },
        confidence:     { type: SchemaType.NUMBER, description: 'Confidence 0.0-1.0 that this item exists and details are accurate' },
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
    description: 'Analyze an uploaded photo to detect and identify items in it. Returns a list of detected items.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        file_url:  { type: SchemaType.STRING, description: 'GCS URL of the uploaded photo' },
        mime_type: { type: SchemaType.STRING, description: 'MIME type, e.g. "image/jpeg"' },
        room_hint: { type: SchemaType.STRING, description: 'Which room this photo is from, if known' },
      },
      required: ['file_url', 'mime_type'],
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
      const sharp = require('sharp');
      const https = require('https');
      const http = require('http');

      // Download image from GCS URL to get buffer
      const url = args.file_url;
      const imageBuffer = await new Promise((resolve, reject) => {
        const client = url.startsWith('https') ? https : http;
        client.get(url, (res) => {
          const chunks = [];
          res.on('data', c => chunks.push(c));
          res.on('end', () => resolve(Buffer.concat(chunks)));
          res.on('error', reject);
        }).on('error', reject);
      });

      const base64 = imageBuffer.toString('base64');
      const result = await analyzeMultiItemPhoto(base64, args.mime_type, 'gemini');
      const items = result.data?.items || result.items || [];
      const itemCount = result.data?.itemCount || result.itemCount || items.length;

      // Crop each item by bounding box and upload to GCS
      const meta = await sharp(imageBuffer).metadata();
      const fw = meta.width;
      const fh = meta.height;

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const bbox = item.boundingBox || item.bbox;
        if (!bbox || !fw || !fh) continue;
        try {
          const left = Math.max(0, Math.round(bbox.x * fw));
          const top = Math.max(0, Math.round(bbox.y * fh));
          const width = Math.min(fw - left, Math.round((bbox.width || bbox.w) * fw));
          const height = Math.min(fh - top, Math.round((bbox.height || bbox.h) * fh));
          if (width < 10 || height < 10) continue;

          const cropped = await sharp(imageBuffer)
            .extract({ left, top, width, height })
            .jpeg({ quality: 85 })
            .toBuffer();

          const cropPath = `users/${userId}/nexus/crops/${Date.now()}-${i}.jpg`;
          await gcs.uploadBuffer(cropped, cropPath, 'image/jpeg');
          item.picture_url = `https://storage.googleapis.com/${gcs.BUCKET}/${cropPath}`;
          console.log(`[nexus] Cropped photo item[${i}] "${item.name}" to ${width}x${height}`);
        } catch (cropErr) {
          console.warn(`[nexus] Crop failed for item[${i}]:`, cropErr.message);
        }
      }

      return { success: true, items, itemCount };
    } catch (err) {
      console.error('[nexus] analyze_photo failed:', err.message);
      return { success: false, error: err.message };
    }
  },

  async analyze_video(args, _userId) {
    try {
      const https = require('https');
      const http = require('http');

      const url = args.file_url;
      console.log(`[nexus] Downloading video for analysis: ${url}`);
      const videoBuffer = await new Promise((resolve, reject) => {
        const client = url.startsWith('https') ? https : http;
        client.get(url, (res) => {
          const chunks = [];
          res.on('data', c => chunks.push(c));
          res.on('end', () => resolve(Buffer.concat(chunks)));
          res.on('error', reject);
        }).on('error', reject);
      });

      console.log(`[nexus] Video downloaded: ${(videoBuffer.length / 1024 / 1024).toFixed(1)}MB`);
      const result = await analyzeVideo(videoBuffer, args.mime_type);
      const items = result.items || [];
      return { success: true, items, itemCount: items.length, parseError: result.parseError };
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
};

// ── Conversation Loop ───────────────────────────────────────────────────────────

/**
 * Process a user message through the Nexus agent.
 *
 * @param {string} userId
 * @param {string|null} sessionId - null to start a new session
 * @param {string} message - user's text
 * @param {Array} attachments - [{ url, mimeType }]
 * @param {string} plan - 'basic' or 'pro'
 * @returns {{ reply: string, actions: Array, sessionId: string }}
 */
async function processMessage(userId, sessionId, message, attachments = [], plan = 'basic') {
  if (!geminiClient) {
    throw new Error('GOOGLE_AI_API_KEY is not configured');
  }

  // ── 1. Load or create session ──────────────────────────────────────────────
  let session;
  if (sessionId) {
    session = await db.oneOrNone(
      `SELECT * FROM nexus_sessions WHERE id = $1 AND user_id = $2`, [sessionId, userId]
    );
  }
  if (!session) {
    session = await db.one(
      `INSERT INTO nexus_sessions (user_id) VALUES ($1) RETURNING *`, [userId]
    );
    sessionId = session.id;
    console.log(`[nexus] New session: ${sessionId}`);
  }

  // ── 2. Load conversation history ──────────────────────────────────────────
  const historyRows = await db.any(
    `SELECT role, content, tool_name, tool_args, tool_response, attachments
     FROM nexus_messages WHERE session_id = $1
     ORDER BY created_at ASC LIMIT 60`,
    [sessionId]
  );

  // ── 3. Build Gemini contents from history ─────────────────────────────────
  const contents = [];
  for (const row of historyRows) {
    if (row.role === 'user') {
      const parts = [];
      if (row.content) parts.push({ text: row.content });
      contents.push({ role: 'user', parts });
    } else if (row.role === 'model') {
      const parts = [];
      if (row.content) parts.push({ text: row.content });
      contents.push({ role: 'model', parts });
    } else if (row.role === 'tool_call') {
      contents.push({
        role: 'model',
        parts: [{
          functionCall: { name: row.tool_name, args: row.tool_args || {} }
        }],
      });
    } else if (row.role === 'tool_result') {
      contents.push({
        role: 'user',
        parts: [{
          functionResponse: {
            name: row.tool_name,
            response: row.tool_response || {},
          }
        }],
      });
    }
  }

  // ── 4. Add current user message ───────────────────────────────────────────
  const userParts = [];
  if (message) userParts.push({ text: message });
  // Inline media attachments
  for (const att of attachments) {
    if (att.url && att.mimeType?.startsWith('image/')) {
      userParts.push({ text: `[User uploaded a photo: ${att.url} (type: ${att.mimeType})]` });
    } else if (att.url && att.mimeType?.startsWith('video/')) {
      userParts.push({ text: `[User uploaded a video: ${att.url} (type: ${att.mimeType})]` });
    }
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

  const systemInstruction = SYSTEM_PROMPT
    .replace('{{USER_CONTEXT}}', userContext)
    .replace('{{INVENTORY_SNAPSHOT}}', inventorySnapshot);

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

  let result = await model.generateContent({ contents });

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

      return { reply, actions, sessionId };
    }

    // Execute function calls
    const toolResponses = [];
    for (const part of functionCalls) {
      const { name, args } = part.functionCall;
      console.log(`[nexus] Tool call: ${name}(${JSON.stringify(args).substring(0, 200)})`);

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

      actions.push({ tool: name, args, result: toolResult });

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

    result = await model.generateContent({ contents });
    maxToolRounds--;
  }

  // Fallback if we hit max rounds
  const fallbackReply = 'I\'ve processed your request. Let me know what you\'d like to do next!';
  await db.none(
    `INSERT INTO nexus_messages (session_id, role, content) VALUES ($1, 'model', $2)`,
    [sessionId, fallbackReply]
  );
  return { reply: fallbackReply, actions, sessionId };
}

module.exports = { processMessage, SYSTEM_PROMPT };
