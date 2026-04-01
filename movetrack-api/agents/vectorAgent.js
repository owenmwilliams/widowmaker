'use strict';

const { GoogleGenerativeAI, SchemaType } = require('@google/generative-ai');
const conn = require('../services/infra/db');
const db = conn.db;
const census = require('../services/census/censusService');
const { getInventoryTotals } = require('../services/census/inventoryQueryService');
const { buildGeminiContents } = require('../services/shared/geminiHistoryBuilder');

// Vector services
const { recommendTruckSize } = require('../services/vector/truckSizingService');
const { estimateMoveCost } = require('../services/vector/moveCostService');
const { estimateLabor } = require('../services/vector/laborEstimationService');
const { flagSpecialItems } = require('../services/vector/specialHandlingService');
const { calculateRoute } = require('../services/vector/routeService');
const { getMoveSummary, estimateMissingItems, getRoomBreakdown } = require('../services/vector/moveSummaryService');

// ── Gemini Client ───────────────────────────────────────────────────────────────

let geminiClient = null;
if (process.env.GOOGLE_AI_API_KEY) {
  geminiClient = new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY);
  console.log('[vectorService] Gemini configured');
}

const GEMINI_MODELS = {
  basic: 'gemini-2.5-flash',
  pro: 'gemini-2.5-pro',
};

// ── Knex (shared singleton, used only by processMessage for sessions) ────────────

const knex = require('../services/infra/knex');

// ── System Prompt ───────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are Vector, the Nexus Moves move planning AI. You help people understand the size and logistics of their move.

PERSONALITY:
- Analytical, precise, reassuring. Like a seasoned logistics coordinator who makes complex moves feel manageable.
- Present numbers clearly with context ("That's about a 20-ft truck worth of stuff").
- Flag potential issues early and suggest solutions.
- Keep messages concise — use bullet points for data-heavy responses.

MISSION:
Help the user understand the size, logistics, and cost of their move based on their inventory.

USER CONTEXT:
{{USER_CONTEXT}}

CURRENT INVENTORY SNAPSHOT:
{{INVENTORY_SNAPSHOT}}

CAPABILITIES:
1. **Move Size Analysis**: Calculate total weight, volume, and recommend truck size from inventory.
2. **Weight/Dimension Estimation**: Estimate missing weights and dimensions for items that don't have them.
3. **Distance & Route**: Calculate driving distance, time, and fuel costs between locations.
4. **Labor Estimation**: Estimate loading/unloading time and crew size needed.
5. **Cost Estimation**: Provide rough DIY and professional moving cost estimates.
6. **Anomaly Detection**: Flag oversized items, fragile items needing special handling, items that may not fit through standard doors.

RULES:
1. When the user first asks about their move, call get_move_summary to understand the full picture.
2. If many items are missing weights/dimensions, call estimate_missing_items to fill gaps before calculating totals.
3. When estimating costs, always present a RANGE (low-high), never a single number.
4. Always caveat cost estimates: "These are rough estimates. Actual costs vary by season, location, and provider."
5. For distance calculations, use the user's origin and destination if set. If not, ask for them.
6. If the user has fewer than 5 items, tell them the estimates will be very rough and suggest adding more items first.
7. Flag items over 300 lbs or over 84 inches in any dimension as needing special handling.
8. When recommending truck size, add 15-20% buffer to the raw volume for packing inefficiency.
9. NEVER invent data. If you don't have enough information, say so and suggest what's needed.
10. If the user asks about things outside your scope (adding items, scanning rooms), suggest they use the Inventory assistant instead.

INLINE BUTTONS:
When presenting the user with a choice, use inline buttons so they can tap instead of typing. Format:

[BUTTONS]
Button Label|message to send when tapped
Another Option|different message to send
[/BUTTONS]

Examples:
- After move summary: "Get cost estimate|Estimate the cost of my move" / "Recommend a truck|What truck size do I need?" / "Check special items|Flag any items needing special handling"
- After truck recommendation: "Get cost estimate|Now estimate the total cost" / "See room breakdown|Show me the breakdown by room"
Keep labels short (2-5 words). Include 2-4 options. Use buttons whenever the user can take a natural next step.

CONVERSATION STARTERS (for new sessions):
{{CONVERSATION_STARTERS}}`;

// ── Tool Declarations ───────────────────────────────────────────────────────────

const toolDeclarations = [
  {
    name: 'get_move_summary',
    description: 'Get a comprehensive summary of the move: total items, weight, volume, items missing data, rooms, and locations. This is the starting point for move planning.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {},
    },
  },
  {
    name: 'estimate_missing_items',
    description: 'Estimate weights and dimensions for items that are missing them. Returns the updated totals after estimation.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        max_items: { type: SchemaType.INTEGER, description: 'Maximum number of items to estimate at once (default 20, max 50)' },
      },
    },
  },
  {
    name: 'recommend_truck_size',
    description: 'Based on total volume and weight, recommend the right truck size with a packing buffer.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        buffer_pct: { type: SchemaType.NUMBER, description: 'Packing inefficiency buffer as decimal (default 0.20 = 20%)' },
      },
    },
  },
  {
    name: 'calculate_route',
    description: 'Calculate driving distance, time, and fuel cost between two locations. Uses the user\'s saved locations if origin_text and destination_text are not provided.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        origin_text:      { type: SchemaType.STRING, description: 'Origin city/address, e.g. "Austin, TX". If omitted, uses primary location.' },
        destination_text: { type: SchemaType.STRING, description: 'Destination city/address, e.g. "Denver, CO"' },
      },
    },
  },
  {
    name: 'estimate_labor',
    description: 'Estimate loading and unloading time based on inventory volume, plus recommended crew size.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        num_movers:   { type: SchemaType.INTEGER, description: 'Number of movers (default 2)' },
        has_stairs:   { type: SchemaType.BOOLEAN, description: 'Whether origin or destination has stairs (adds 30% time)' },
        has_elevator: { type: SchemaType.BOOLEAN, description: 'Whether building has an elevator (adds 20% time for wait/load cycles)' },
      },
    },
  },
  {
    name: 'estimate_move_cost',
    description: 'Generate a rough cost estimate for the move, including DIY and professional options.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        distance_miles:  { type: SchemaType.NUMBER, description: 'Distance in miles (if already calculated)' },
        num_movers:      { type: SchemaType.INTEGER, description: 'Number of movers for professional estimate (default 2)' },
        include_packing: { type: SchemaType.BOOLEAN, description: 'Include packing services in professional estimate' },
      },
    },
  },
  {
    name: 'flag_special_items',
    description: 'Identify items that need special handling: oversized, very heavy, fragile, or items that may not fit through standard doors (36" wide, 80" tall).',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {},
    },
  },
  {
    name: 'get_room_breakdown',
    description: 'Get a detailed breakdown of items, weight, and volume by room.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {},
    },
  },
];

// ── Tool Handlers (thin delegates to services) ──────────────────────────────────

const toolHandlers = {
  async get_move_summary(args, userId) { return getMoveSummary(userId); },
  async estimate_missing_items(args, userId) { return estimateMissingItems(userId, args); },

  async recommend_truck_size(args, userId) {
    const totals = await getInventoryTotals(userId);
    return recommendTruckSize(totals, args.buffer_pct);
  },

  async calculate_route(args, userId) { return calculateRoute(userId, args); },

  async estimate_labor(args, userId) {
    const totals = await getInventoryTotals(userId);
    return estimateLabor(totals, args);
  },

  async estimate_move_cost(args, userId) {
    const totals = await getInventoryTotals(userId);
    return estimateMoveCost(totals, args);
  },

  async flag_special_items(args, userId) { return flagSpecialItems(userId); },
  async get_room_breakdown(args, userId) { return getRoomBreakdown(userId); },
};

// ── Tool Labels (for SSE streaming) ──────────────────────────────────────────────

const TOOL_LABELS = {
  get_move_summary: 'Summarizing move',
  estimate_missing_items: 'Estimating missing items',
  recommend_truck_size: 'Sizing truck',
  calculate_route: 'Calculating route',
  estimate_labor: 'Estimating labor',
  estimate_move_cost: 'Estimating costs',
  flag_special_items: 'Checking special items',
  get_room_breakdown: 'Breaking down rooms',
};

// ── Conversation Loop ───────────────────────────────────────────────────────────

async function processMessage(userId, message, attachments = [], plan = 'basic', onEvent = null) {
  const emit = (type, data = {}) => {
    if (onEvent) onEvent({ type, ...data });
  };
  if (!geminiClient) {
    throw new Error('GOOGLE_AI_API_KEY is not configured');
  }

  // ── 1. Resolve active session (one per user, session_type = 'vector') ────
  let session = await db.oneOrNone(
    `SELECT * FROM nexus_sessions WHERE user_id = $1 AND is_active = TRUE AND session_type = 'vector'
     ORDER BY updated_at DESC LIMIT 1`,
    [userId]
  );
  if (!session) {
    session = await db.one(
      `INSERT INTO nexus_sessions (user_id, session_type) VALUES ($1, 'vector') RETURNING *`, [userId]
    );
    console.log(`[vector] New session for user: ${session.id}`);
  }
  const sessionId = session.id;

  // ── 2. Load conversation history with context consolidation ───────────────
  const contextSummaryText = session.context_summary || null;
  let historyRows;

  if (session.summary_through_id) {
    historyRows = await db.any(
      `SELECT id, role, content, tool_name, tool_args, tool_response, attachments
       FROM nexus_messages WHERE session_id = $1 AND id > $2
       ORDER BY created_at ASC`,
      [sessionId, session.summary_through_id]
    );
  } else {
    historyRows = await db.any(
      `SELECT id, role, content, tool_name, tool_args, tool_response, attachments
       FROM nexus_messages WHERE session_id = $1
       ORDER BY created_at DESC LIMIT 60`,
      [sessionId]
    );
    historyRows.reverse();
  }

  // ── 3. Build Gemini contents from history ─────────────────────────────────
  const contents = buildGeminiContents(historyRows);

  // ── 4. Add current user message ───────────────────────────────────────────
  const userParts = [];
  if (message) userParts.push({ text: message });
  if (userParts.length === 0) userParts.push({ text: '(empty message)' });
  contents.push({ role: 'user', parts: userParts });

  // Persist user message
  await db.none(
    `INSERT INTO nexus_messages (session_id, role, content)
     VALUES ($1, 'user', $2)`,
    [sessionId, message]
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

  let conversationStarters = '';
  if (historyRows.length === 0) {
    conversationStarters = [
      '- Ask about move size and truck recommendation',
      '- Ask for a cost estimate',
      '- Ask about items needing special handling',
    ].join('\n');
  }

  let systemInstruction = SYSTEM_PROMPT
    .replace('{{USER_CONTEXT}}', userContext)
    .replace('{{INVENTORY_SNAPSHOT}}', inventorySnapshot)
    .replace('{{CONVERSATION_STARTERS}}', conversationStarters || 'N/A (returning user)');

  if (contextSummaryText) {
    systemInstruction += `\n\nCONVERSATION HISTORY SUMMARY (older messages, summarized):\n${contextSummaryText}`;
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
  let maxToolRounds = 8;

  emit('thinking');
  let result = await model.generateContent({ contents });

  while (maxToolRounds > 0) {
    const response = result.response;
    const candidate = response.candidates?.[0];
    if (!candidate) break;

    const parts = candidate.content?.parts || [];
    const functionCalls = parts.filter(p => p.functionCall);
    const textParts = parts.filter(p => p.text);

    if (functionCalls.length === 0) {
      const reply = textParts.map(p => p.text).join('\n');

      // Persist model reply
      await db.none(
        `INSERT INTO nexus_messages (session_id, role, content) VALUES ($1, 'model', $2)`,
        [sessionId, reply]
      );

      // Update session title for new sessions
      if (!session.title) {
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

      // Fire-and-forget context summary generation
      generateContextSummary(sessionId).catch(err =>
        console.error('[vector] Summary generation failed:', err.message)
      );

      emit('done', { reply, actions, sessionId });
      return { reply, actions, sessionId };
    }

    // Execute function calls
    const toolResponses = [];
    for (const part of functionCalls) {
      const { name, args } = part.functionCall;
      console.log(`[vector] Tool call: ${name}(${JSON.stringify(args).substring(0, 200)})`);

      const toolLabel = TOOL_LABELS[name] || name.replace(/_/g, ' ');
      emit('tool_call', { tool: name, label: toolLabel });

      let toolResult;
      try {
        const handler = toolHandlers[name];
        if (!handler) {
          toolResult = { success: false, error: `Unknown tool: ${name}` };
        } else {
          toolResult = await handler(args, userId);
        }
      } catch (err) {
        console.error(`[vector] Tool ${name} failed:`, err.message);
        toolResult = { success: false, error: err.message };
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
    result = await model.generateContent({ contents });
    maxToolRounds--;
  }

  // Fallback if we hit max rounds
  const fallbackReply = 'I\'ve finished analyzing your move. Let me know what else you\'d like to know!';
  await db.none(
    `INSERT INTO nexus_messages (session_id, role, content) VALUES ($1, 'model', $2)`,
    [sessionId, fallbackReply]
  );
  return { reply: fallbackReply, actions, sessionId };
}

// ── Context Summary Generation ──────────────────────────────────────────────────

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
    .map(m => `${m.role === 'user' ? 'User' : 'Vector'}: ${m.content}`)
    .join('\n');

  const existingSummary = session.context_summary || '';
  const summaryPrompt = existingSummary
    ? `Here is the existing conversation summary:\n${existingSummary}\n\nHere are newer messages to incorporate:\n${transcript}\n\nCreate an updated, consolidated summary.`
    : `Summarize this conversation:\n${transcript}`;

  const summaryModel = geminiClient.getGenerativeModel({
    model: 'gemini-2.5-flash',
    systemInstruction: `Summarize this conversation between a user and Vector (an AI move planning assistant).
Focus on: move details discussed, cost estimates given, truck recommendations, distances calculated, any concerns flagged.
Keep it under 300 words. Write in third person: "The user..." not "You..."`,
  });

  const result = await summaryModel.generateContent(summaryPrompt);
  const summary = result.response.text();

  await db.none(
    `UPDATE nexus_sessions SET context_summary = $1, summary_through_id = $2, updated_at = NOW()
     WHERE id = $3`,
    [summary, newSummaryThroughId, sessionId]
  );

  console.log(`[vector] Summary updated for session ${sessionId} (through msg ${newSummaryThroughId})`);
}

module.exports = { processMessage, generateContextSummary };
