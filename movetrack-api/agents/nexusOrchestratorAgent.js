'use strict';

const { GoogleGenerativeAI, SchemaType } = require('@google/generative-ai');
const conn = require('../services/infra/db');
const db = conn.db;
const census = require('../services/census/censusService');
const censusAgent = require('./censusAgent');
const vectorService = require('./vectorAgent');
const { buildGeminiContents } = require('../services/shared/geminiHistoryBuilder');

// ── Gemini Client ───────────────────────────────────────────────────────────────

let geminiClient = null;
if (process.env.GOOGLE_AI_API_KEY) {
  geminiClient = new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY);
  console.log('[nexusOrchestrator] Gemini configured');
}

const GEMINI_MODELS = {
  basic: 'gemini-2.5-flash',
  pro: 'gemini-2.5-pro',
};

// ── System Prompt ───────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are Nexus, the MoveTrack AI assistant. You're a friendly, knowledgeable moving advisor who helps people catalog their stuff and plan their move.

You have two specialist teams you can delegate to:
- Census: handles inventory — adding items, scanning photos/videos, room management, editing items
- Vector: handles logistics — move sizing, truck recommendations, cost estimates, route planning

ROUTING RULES:
1. If the user wants to add, edit, scan, organize, or ask about specific items → delegate_to_census
2. If the user asks about move size, costs, truck size, route, labor, or logistics → delegate_to_vector
3. If the user sends a photo or video → delegate_to_census (set include_attachments to true)
4. For greetings, general questions, "what can you do", or meta-questions → respond directly (no tool call)
5. If unclear whether it's inventory or logistics, ask a clarifying question
6. NEVER try to modify inventory yourself — always delegate to Census
7. After a Census delegation that adds items, you might suggest the user try Vector for move analysis
8. MESSAGE PASSING — each agent maintains its own conversation history, so preserve detail:
   a. For single-agent messages (one clear delegation): pass the user's message verbatim. Do NOT rephrase or summarize.
   b. For continuation turns (user confirming items, answering an agent's question): pass the user's exact response to the same agent.
   c. For compound messages that need multiple agents (e.g., "add my couch and estimate truck size"): split into focused messages per agent, but preserve ALL specifics — item names, quantities, details. Never drop information.
   d. When in doubt, prefer verbatim over rephrasing.

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
];

// ── Tool Labels for SSE ─────────────────────────────────────────────────────────

const TOOL_LABELS = {
  delegate_to_census: 'Working on inventory…',
  delegate_to_vector: 'Analyzing your move…',
  get_inventory_status: 'Checking inventory…',
  get_user_profile: 'Loading profile…',
};

// ── Tool Handlers ───────────────────────────────────────────────────────────────

function buildToolHandlers(userId, attachments, plan, onEvent) {
  // Wrap onEvent so worker agents' 'done' and 'error' events don't leak
  // into the orchestrator's SSE stream (orchestrator emits its own 'done')
  const workerEvent = onEvent
    ? (event) => { if (event.type !== 'done' && event.type !== 'error') onEvent(event); }
    : null;

  return {
    async delegate_to_census(args) {
      const workerAttachments = args.include_attachments ? attachments : [];
      const result = await censusAgent.processMessage(
        userId, args.message, workerAttachments, plan, workerEvent
      );
      return {
        success: true,
        reply: result.reply,
        actions: result.actions || [],
        sessionId: result.sessionId,
      };
    },

    async delegate_to_vector(args) {
      const result = await vectorService.processMessage(
        userId, args.message, [], plan, workerEvent
      );
      return {
        success: true,
        reply: result.reply,
        actions: result.actions || [],
        sessionId: result.sessionId,
      };
    },

    async get_inventory_status() {
      const snapshot = await census.getInventorySnapshot(userId);
      return { success: true, snapshot };
    },

    async get_user_profile() {
      const user = await db.oneOrNone(
        `SELECT first_name, last_name, email, onboarding_completed FROM users WHERE user_id = $1`,
        [userId]
      );
      const locations = await db.any(
        `SELECT id, name, type, is_primary FROM locations WHERE user_id = $1 ORDER BY is_primary DESC, name ASC`,
        [userId]
      );
      return {
        success: true,
        user: user ? {
          name: `${user.first_name || ''} ${user.last_name || ''}`.trim(),
          email: user.email,
          onboarding_completed: user.onboarding_completed,
        } : null,
        locations: locations.map(l => ({ id: l.id, name: l.name, type: l.type, isPrimary: l.is_primary })),
      };
    },
  };
}

// ── Conversation Loop ───────────────────────────────────────────────────────────

/**
 * Process a user message through the Nexus orchestrator.
 * Routes to Census or Vector specialist agents as needed.
 */
async function processMessage(userId, message, attachments = [], plan = 'basic', onEvent = null) {
  const emit = (type, data = {}) => {
    if (onEvent) onEvent({ type, ...data });
  };
  if (!geminiClient) {
    throw new Error('GOOGLE_AI_API_KEY is not configured');
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
    console.log(`[nexusOrchestrator] New session for user: ${session.id}`);
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

  // Persist user message
  await db.none(
    `INSERT INTO nexus_messages (session_id, role, content, attachments)
     VALUES ($1, 'user', $2, $3)`,
    [sessionId, message, JSON.stringify(attachments)]
  );

  // ── 5. Build system prompt with context ─────────────────────────────────
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

  if (contextSummaryText) {
    systemInstruction += `\n\nCONVERSATION HISTORY SUMMARY:\n${contextSummaryText}`;
  }

  // ── 6. Call Gemini ──────────────────────────────────────────────────────
  // Always use flash for the orchestrator loop — fast + reliable tool-calling.
  const modelId = 'gemini-2.5-flash';
  const model = geminiClient.getGenerativeModel({
    model: modelId,
    systemInstruction,
    tools: [{ functionDeclarations: toolDeclarations }],
    generationConfig: { maxOutputTokens: 2048 },
  });

  const toolHandlers = buildToolHandlers(userId, attachments, plan, onEvent);
  const actions = [];
  let maxToolRounds = 4; // Orchestrator usually only needs 1-2 rounds

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
      // Final text response
      const reply = textParts.map(p => p.text).join('\n');

      await db.none(
        `INSERT INTO nexus_messages (session_id, role, content) VALUES ($1, 'model', $2)`,
        [sessionId, reply]
      );

      // Update session title if new
      if (!session.title && message) {
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
        console.error('[nexusOrchestrator] Summary generation failed:', err.message)
      );

      emit('done', { reply, actions, sessionId });
      return { reply, actions, sessionId };
    }

    // Execute function calls
    const toolResponses = [];
    for (const part of functionCalls) {
      const { name, args } = part.functionCall;
      console.log(`[nexusOrchestrator] Tool call: ${name}(${JSON.stringify(args).substring(0, 200)})`);

      const toolLabel = TOOL_LABELS[name] || name.replace(/_/g, ' ');
      emit('tool_call', { tool: name, label: toolLabel });

      let toolResult;
      try {
        const handler = toolHandlers[name];
        if (!handler) {
          toolResult = { success: false, error: `Unknown tool: ${name}` };
        } else {
          toolResult = await handler(args);
        }
      } catch (err) {
        console.error(`[nexusOrchestrator] Tool ${name} failed:`, err.message);
        toolResult = { success: false, error: err.message };
      }

      // For delegation tools, collect the worker's actions
      if ((name === 'delegate_to_census' || name === 'delegate_to_vector') && toolResult.actions) {
        actions.push(...toolResult.actions);
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

  // Fallback
  const fallbackReply = 'I\'ve processed your request. Let me know what you\'d like to do next!';
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

  console.log(`[nexusOrchestrator] Summary updated for session ${sessionId}`);
}

module.exports = { processMessage, generateContextSummary };
