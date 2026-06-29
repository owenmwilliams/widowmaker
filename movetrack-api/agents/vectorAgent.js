'use strict';

const { GoogleGenerativeAI, SchemaType } = require('@google/generative-ai');
const conn = require('../services/infra/db');
const db = conn.db;
const { getInventoryTotals, getInventoryTextSummary } = require('../services/inventory/inventorySummaryQueryService');
const { buildGeminiContents } = require('../services/infra/geminiHistoryBuilder');
const { AGENT_LIMITS } = require('./schemas/orchestratorPolicy');

// Vector services
const { recommendTruckSize } = require('../services/move/trucksService');
const { estimateMoveCost } = require('../services/move/moveCostService');
const { estimateLabor } = require('../services/move/laborEstimationService');
const { flagSpecialItems } = require('../services/move/specialHandlingService');
const { calculateRoute } = require('../services/move/routeService');
const { getMoveSummary, getRoomBreakdown } = require('../services/move/moveSummaryService');
const { parseJsonBlock, deriveFieldsFromActions, buildSpecialistResponse, buildFallbackResponse } = require('./schemas/specialistResponse');

// ── Gemini Client ───────────────────────────────────────────────────────────────

let geminiClient = null;
if (process.env.GOOGLE_AI_API_KEY) {
  geminiClient = new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY);
  console.log('[vector] Gemini configured');
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
10. If the user asks about things outside your scope (adding items, scanning rooms, onboarding), let them know to use the main Nexus assistant instead. You own logistics — not inventory cataloging or onboarding.

INLINE BUTTONS:
When presenting the user with a choice, use inline buttons so they can tap instead of typing. Format:

[BUTTONS]
Button Label|message to send|action
[/BUTTONS]

Actions (3rd field): "send" (auto-send immediately, default if omitted), "prefill" (pre-fill input for user to complete), "camera" (open camera + pre-fill message).

BUTTON RULES:
- Every button must lead to a CONCRETE ACTION — never a vague round-trip.
- NEVER offer "I'm done", "I'm finished", or any exit/stop button.
- Include 2-3 options max. Only use buttons when they lead to immediate, meaningful action.

Examples:
- After move summary: "Get cost estimate|Estimate the cost of my move|send" / "Recommend a truck|What truck size do I need?|send"
- After truck recommendation: "Get cost estimate|Now estimate the total cost|send" / "Room breakdown|Show me the breakdown by room|send"
- Need user details: "Set destination|I'm moving to:|prefill"

STRUCTURED RESPONSE FORMAT:
When you give your FINAL response (no more tool calls), you MUST wrap it in a JSON code block. This is how the orchestrator understands your output. The format is:

\`\`\`json
{
  "summary": "Your user-facing message goes here. This is what the user sees. Use all normal formatting (buttons, bullet points, markdown, etc.) inside this string.",
  "workflow": "move_planning",
  "step": "recommend_truck",
  "confidence": 0.85,
  "recommended_orchestrator_action": "continue",
  "next_suggested_step": "estimate_costs",
  "state_delta": { "truck_recommended": "20ft" }
}
\`\`\`

Field guide:
- summary: REQUIRED. The full user-facing message, exactly as you'd normally write it.
- workflow: REQUIRED. One of: "move_planning", "cost_estimation", "route_planning", "labor_estimation", "special_handling", "room_analysis", "greeting".
- step: REQUIRED. The specific step just completed, e.g. "get_summary", "recommend_truck", "calculate_route", "estimate_labor", "estimate_cost", "flag_special", "room_breakdown", "greet_user".
- confidence: Optional 0.0-1.0. How confident you are in the overall result.
- recommended_orchestrator_action: REQUIRED. One of: "continue" (normal flow), "ask_user" (you need user input to proceed), "stop_and_summarize" (task is done), "switch_agent" (user needs Census), "retry_step" (something failed, worth retrying), "abort" (unrecoverable error).
- next_suggested_step: Optional. What should happen next, e.g. "estimate_costs", "flag_special_items", null if done.
- state_delta: Optional. Key changes made, e.g. { "truck_recommended": "20ft", "estimated_cost_range": "$800-$1200" }.

IMPORTANT: Always use this format for your final response. Never return plain text without the JSON block.

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
  const inventorySnapshot = await getInventoryTextSummary(userId);
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
  let maxToolRounds = AGENT_LIMITS.specialistMaxToolRounds;
  let vectorRound = 0;

  console.log(`[vector] Starting loop — ${maxToolRounds} rounds max`);

  emit('thinking');
  let result = await model.generateContent({ contents });

  while (maxToolRounds > 0) {
    vectorRound++;
    console.log(`[vector] ── Round ${vectorRound}/${AGENT_LIMITS.specialistMaxToolRounds} ──`);
    const response = result.response;
    const candidate = response.candidates?.[0];
    if (!candidate) break;

    const parts = candidate.content?.parts || [];
    const functionCalls = parts.filter(p => p.functionCall);
    const textParts = parts.filter(p => p.text);

    if (functionCalls.length === 0) {
      console.log(`[vector] Final response after ${vectorRound} round(s), ${actions.length} tool call(s)`);
      const rawText = textParts.map(p => p.text).join('\n');

      // Build structured SpecialistResponse
      const derived = deriveFieldsFromActions(actions, 'vector', false);
      const geminiFields = parseJsonBlock(rawText);
      let structuredResponse;

      if (geminiFields && geminiFields.summary) {
        structuredResponse = buildSpecialistResponse(
          { agent: 'vector', ...derived },
          geminiFields
        );
      } else {
        structuredResponse = buildFallbackResponse(rawText, 'vector', actions, false);
      }

      // Persist model reply (store summary as the message content)
      await db.none(
        `INSERT INTO nexus_messages (session_id, role, content) VALUES ($1, 'model', $2)`,
        [sessionId, structuredResponse.summary]
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

      emit('done', { reply: structuredResponse.summary, actions, sessionId });
      return { ...structuredResponse, actions, sessionId };
    }

    // Execute function calls
    const toolResponses = [];
    for (const part of functionCalls) {
      const { name, args } = part.functionCall;
      console.log(`[vector] Tool call: ${name}(${JSON.stringify(args).substring(0, 200)})`);

      const toolLabel = TOOL_LABELS[name] || name.replace(/_/g, ' ');
      let detail = '';
      if (name === 'calculate_route') {
        detail = args.origin_text && args.destination_text
          ? `${args.origin_text} → ${args.destination_text}` : '';
      } else if (name === 'estimate_labor' && args.num_movers) {
        detail = `${args.num_movers} movers`;
      }
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
    console.log(`[vector] Round ${vectorRound} complete — ${maxToolRounds} round(s) remaining, ${actions.length} tool call(s) so far`);
  }

  // Fallback if we hit max rounds
  console.warn(`[vector] Round limit exhausted after ${vectorRound} rounds, ${actions.length} tool call(s) — returning fallback`);
  const fallbackReply = 'I\'ve finished analyzing your move. Let me know what else you\'d like to know!';
  const fallbackResponse = buildFallbackResponse(fallbackReply, 'vector', actions, true);

  await db.none(
    `INSERT INTO nexus_messages (session_id, role, content) VALUES ($1, 'model', $2)`,
    [sessionId, fallbackReply]
  );

  emit('done', { reply: fallbackReply, actions, sessionId });
  return { ...fallbackResponse, actions, sessionId };
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
