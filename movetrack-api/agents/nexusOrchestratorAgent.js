'use strict';

const { GoogleGenerativeAI, SchemaType } = require('@google/generative-ai');
const conn = require('../services/infra/db');
const db = conn.db;
const { getInventoryTextSummary } = require('../services/inventory/inventorySummaryQueryService');
const { sanitizeForPrompt, fenceUntrusted } = require('../services/infra/promptSafety');
const { instrumentModel, AiUnavailableError } = require('../services/infra/ai/resilientModel');
const { buildGeminiContents } = require('../services/infra/geminiHistoryBuilder');
const { buildToolHandlers } = require('../services/workflow/agentDelegationService');
const { getAllowedDecisions, POLICY_DEFAULTS, buildDecisionPrompt, parseDecisionResponse, validateDecision } = require('./schemas/orchestratorPolicy');
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

ONBOARDING FLOW (if user has NOT completed onboarding):
You are driving this conversation. Ask one question at a time and take action immediately.
1. When the user sends their first message (e.g. "I'm planning a move"), acknowledge it warmly and ask for their name: "Great! I'm Nexus, your AI moving assistant. First — what's your name?"
   → Do NOT call any tools yet. Wait for the name.
2. After getting their name, ask for their address: "Nice to meet you, [name]! Where are you moving from? Just a street address is fine."
   → Call set_user_profile with their name and goal (from step 1)
3. After getting their address, call set_location immediately, then ask about the home: "Got it! Is that an apartment or a house? How many bedrooms?"
   → Call set_location with the address
4. Ask about the home: "Is that an apartment or house? How many bedrooms?"
   → Based on their answer, delegate_to_census to create rooms (e.g. Kitchen, Living Room, Bedroom 1, Bedroom 2, Bathroom)
   → Call mark_onboarding_complete immediately after rooms are created
5. Transition to cataloging: "You're all set! Now let's start logging what's in your [first room]. How would you like to add items?"
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

SESSION RE-ENTRY:
If the user returns after a long gap and asks for context, progress, or what to do next, switch into guidance mode. In guidance mode, briefly summarize where the workflow stands, identify the most important blockers or missing information, and offer 1–2 concrete next steps. If the user gives a direct request, fulfill that request instead of overriding it with proactive guidance. Never propose more than 2 next steps unless explicitly asked.

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
    name: 'mark_onboarding_complete',
    description: 'Mark onboarding as complete. Call this AUTOMATICALLY after creating a location and at least one room during onboarding. Do not ask the user — just call it silently.',
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
  set_user_profile: 'Setting up profile…',
  set_location: 'Setting location…',
  update_location: 'Updating location…',
  mark_onboarding_complete: 'Completing setup…',
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
    generationConfig: { maxOutputTokens: 2048 },
  }), { userId, modelName: modelId });

  const toolHandlers = buildToolHandlers(userId, attachments, plan, onEvent);
  const actions = [];
  const delegationRetries = {}; // keyed by agent name
  let delegationCount = 0;
  let maxToolRounds = 4; // Orchestrator usually only needs 1-2 rounds

  emit('thinking', { phase: 'initial', source: 'orchestrator' });
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

    // Execute function calls
    const toolResponses = [];
    for (const part of functionCalls) {
      const { name, args } = part.functionCall;
      console.log(`[orchestrator] Tool call: ${name}(${JSON.stringify(args).substring(0, 200)})`);

      const toolLabel = TOOL_LABELS[name] || name.replace(/_/g, ' ');
      const isDelegation = (name === 'delegate_to_census' || name === 'delegate_to_vector');
      emit('tool_call', {
        tool: name, label: toolLabel, source: 'orchestrator',
        phase: isDelegation ? 'delegation' : 'orchestrator',
        delegationTarget: isDelegation ? (name === 'delegate_to_census' ? 'census' : 'vector') : undefined,
        hasAttachments: isDelegation ? !!(args.include_attachments) : undefined,
      });

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
      if (isDelegation && toolResult.actions) {
        actions.push(...toolResult.actions);
        delegationCount++;

        const agentName = toolResult.agent || 'specialist';
        console.log(`[orchestrator] ${agentName} response: status=${toolResult.status}, workflow=${toolResult.workflow}, recommendation=${toolResult.recommended_orchestrator_action}`);
        if (toolResult.warnings?.length > 0) {
          console.warn(`[orchestrator] ${agentName} warnings:`, toolResult.warnings);
        }

        // ── Decision engine: hard guards → model reasoning → validation ──
        const ctx = {
          retriesUsed: delegationRetries[agentName] || 0,
          maxRetries: POLICY_DEFAULTS.maxRetries,
          hardFailure: toolResult.status === 'failed' && (toolResult.errors?.length || 0) > 0,
          userActionRequired: !!toolResult.user_action_required,
          specialistStatus: toolResult.status,
          specialistRecommendation: toolResult.recommended_orchestrator_action,
          specialistInvocationsThisTurn: delegationCount,
        };

        const allowed = getAllowedDecisions(ctx);
        let decision;

        if (allowed.length === 1) {
          // Hard guards narrowed to single option — skip model call
          decision = allowed[0];
          console.log(`[orchestrator] Decision (guard-forced): ${decision}`);
        } else {
          // Gemini reasons within bounded options
          decision = await chooseDecisionWithModel(toolResult, ctx, allowed);
          console.log(`[orchestrator] Decision (model-assisted): ${decision} (allowed: [${allowed.join(', ')}])`);
        }

        // Handle retry in code — re-invoke same delegation
        if (decision === 'retry_step') {
          delegationRetries[agentName] = (delegationRetries[agentName] || 0) + 1;
          console.log(`[orchestrator] Retrying ${name} (attempt ${delegationRetries[agentName]})`);
          try {
            toolResult = await handler(args);
            if (toolResult.actions) actions.push(...toolResult.actions);
          } catch (retryErr) {
            console.error(`[orchestrator] Retry of ${name} failed:`, retryErr.message);
            toolResult = { ...toolResult, status: 'failed', errors: [retryErr.message] };
          }
          // After retry, force a non-retry decision
          decision = toolResult.status === 'failed' ? 'abort' : 'continue';
          console.log(`[orchestrator] Post-retry decision: ${decision}`);
        }

        // Handle abort — short-circuit with error message
        if (decision === 'abort') {
          const abortReply = toolResult.summary
            ? `I ran into an issue: ${toolResult.summary}. Let me know how you'd like to proceed.`
            : 'Something went wrong while processing your request. Please try again or let me know what you\'d like to do.';

          await db.none(
            `INSERT INTO nexus_messages (session_id, role, content) VALUES ($1, 'model', $2)`,
            [sessionId, abortReply]
          );
          emit('done', { reply: abortReply, actions, sessionId });
          return { reply: abortReply, actions, sessionId };
        }

        // Inject decision for main Gemini to follow
        toolResult._orchestrator_decision = decision;
        toolResult._allowed_decisions = allowed;
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

    emit('thinking', { phase: 'finalizing', source: 'orchestrator' });
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

  console.log(`[orchestrator] Summary updated for session ${sessionId}`);
}

module.exports = { processMessage, generateContextSummary };
