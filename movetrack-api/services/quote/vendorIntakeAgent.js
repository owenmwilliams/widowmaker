'use strict';

/**
 * services/quote/vendorIntakeAgent.js
 *
 * THE REAL VENDOR AGENT (W1c, #117) — the Gemini tool-loop brain behind the
 * chat widget's converse endpoint. Where #114's widget chat was the
 * deterministic battery in chat clothing, this runs the conversation with a
 * model — free text from the first message — while every NUMBER the
 * customer sees still comes from the deterministic service layer:
 *
 *   tools = the same functions every other surface calls
 *     get_intake_questions → intakeAgentService.questionBattery
 *                            (estimator battery + the company's intake_specs)
 *     check_availability   → vendorAvailabilityService (capacity/blackouts)
 *     price_quote          → intakeAgentService.priceQuote (rate card,
 *                            trust-block invariant — a bare price is
 *                            impossible by construction)
 *     reserve_booking      → intakeAgentService.reserveBooking (24h pending
 *                            window, SIMULATED deposit)
 *
 * R34 BY ARCHITECTURE: the turn result is { reply, chips?, event? } and the
 * event carries the RAW tool payload — the widget renders quote /
 * availability / reservation cards from that data, never from model prose.
 * Belt and braces, a reply that mentions a dollar amount before any quote
 * has been priced in this conversation is discarded and replaced with the
 * deterministic next-question fallback (see below) — the model cannot
 * invent a price even in text.
 *
 * FALLBACK DISCIPLINE (the #95 / FIRST_TURN_FALLBACK lesson): an empty
 * candidate, a blocked response, or tool-round exhaustion NEVER surfaces as
 * a context-blind "didn't catch that". The recovery is deterministic and
 * FORWARD-MOVING: ask the next unanswered intake question (from the same
 * questionBattery state the tools use), or the email, or offer the
 * reservation — whatever the conversation actually needs next.
 *
 * House reliability pattern (nexusOrchestratorAgent): resilientModel's
 * instrumentModel wraps every generateContent (timeout + transient retry),
 * ≤ MAX_TOOL_ROUNDS rounds per turn, gemini-2.5-flash with real output
 * headroom (thinking tokens count against maxOutputTokens).
 */

const { GoogleGenerativeAI, SchemaType } = require('@google/generative-ai');
const { instrumentModel } = require('../infra/ai/resilientModel');
const { sanitizeForPrompt } = require('../infra/promptSafety');
const intakeAgent = require('./intakeAgentService');
const availabilityService = require('./vendorAvailabilityService');

// Overridable so a retired Gemini model can be swapped from the Cloud Build
// trigger's _VENDOR_AGENT_MODEL substitution without a code change.
const MODEL_ID = process.env.VENDOR_AGENT_MODEL || 'gemini-2.5-flash';
const MAX_TOOL_ROUNDS = 4;
/** Per-conversation turn cap — past it the route hands off politely. */
const TURN_CAP = 40;
/** Transcript turns replayed to the model (the rest lives in state). */
const HISTORY_WINDOW = 30;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

let geminiClient = null;
if (process.env.GOOGLE_AI_API_KEY) {
  geminiClient = new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY);
  console.log('[vendorAgent] Gemini configured');
}

/** Whether the LLM brain can run at all (no key ⇒ converse returns 503 {fallback:true}). */
function isConfigured() {
  return !!geminiClient;
}

// ── System prompt (assembled per vendor) ────────────────────────────────────

function buildSystemPrompt(company, state, todayIso) {
  const name = sanitizeForPrompt(company.name, 120);
  const paymentsLine = company.payments_mode === 'simulated'
    ? `Deposits in this demo are SIMULATED — no real charge is ever made, and reservation copy must say so plainly. The deposit screen is handled by the page, NOT by you.`
    : `This company takes no deposit through this chat — the date is reserved and ${name} confirms it first.`;

  return `You are ${name}'s moving assistant, powered by Nexus Moves. You help one customer price and book their move with ${name}, in chat, on ${name}'s own website.

WHAT YOU CAN DO (only through your tools):
- get_intake_questions: the questions a quote needs (including ${name}'s own extra questions). Pass everything the conversation has already established as knownAnswers so nothing is asked twice.
- check_availability: whether a move date is open on ${name}'s Nexus booking calendar, with up to 3 alternative open days — or, given a date RANGE (requestedDate + latestDate), up to 5 open days inside it. External calendars are not synced — say "the booking calendar", never promise beyond the tool result.
- price_quote: ${name}'s instant quote, computed deterministically from their own rate card. Requires the customer's email (it's where the quote copy goes) — ask for it before pricing, once, plainly.
- reserve_booking: reserve a date against a priced quote. It is reserve-PENDING-confirmation: ${name} has 24 hours to confirm, and the customer is emailed either way.

HARD RULES (never break these):
1. NEVER state a price, deposit amount, date availability, or coverage number except verbatim from a tool result in THIS conversation. No estimates from memory, no "typically around", no negotiating. The page renders the quote and availability as cards from the tool data — after a tool succeeds, your text should be one short plain sentence, not a recitation of numbers.
2. Ask ONE question at a time. Never re-ask something already answered — pass it in knownAnswers instead.
3. ${paymentsLine} NEVER ask for card numbers, payment details, or any credentials in chat.
4. If the quote comes back status "review_required", present the estimate honestly and say an estimator will confirm the final price — do not soften or hide it, and do not stall: the estimate plus "an estimator will confirm" IS the answer.
5. If the customer asks something outside what your tools can do (claims, insurance paperwork, complaints, a human), answer briefly and honestly if you can, and otherwise offer to have ${name} follow up by email — never invent policy, never promise on ${name}'s behalf.
6. Tone: plain, factual, warm but unhurried. No pressure, no countdown urgency, no exclamation-mark selling. Short messages — this is a chat bubble, not a letter.

QUICK REPLIES: when your question has a small set of natural answers, end your reply with a chips block, at most 4 short labels:
[CHIPS]1 bed|2 bed|3 bed|4+ bed[/CHIPS]
The block is stripped from the text and rendered as tappable chips. Only include it when tapping genuinely answers the question. Never put prices in chips.
For a question marked allowCustom in get_intake_questions (e.g. specialItems), the chips are only the common cases: add "Other…" as a FIFTH, final chip — the page turns it into a free-text prompt.

CUSTOM AND SKIPPED ANSWERS:
- If the customer types an answer that isn't one of the chips for an allowCustom question, accept it: record their own words as the answer (e.g. specialItems: "Peloton and a large aquarium") — never force them back onto the chips.
- For optional questions (optional:true — specialItems and ${name}'s own extra questions), "skip", "not sure", "no idea" or similar is a fine answer: record the question's skipValue and move on without pushing.

DATES AND RANGES — TODAY'S DATE: ${todayIso}. Resolve relative dates ("next Friday") to YYYY-MM-DD before calling tools.
When the customer gives a range or a vague window ("next January, sometime 20th to the end of the month", "early March", "the week of the 10th"), do NOT ask them to pick one exact date first. Resolve the window to concrete dates (requestedDate = start, latestDate = end, the next future occurrence), call check_availability with both, and offer the open dates it returns as choices — one short sentence; the page renders them as tappable date chips. Record moveDate only once they pick one. If the range has no open dates, say so plainly and offer the tool's nearest alternatives.

CONVERSATION STATE (already established — never re-ask):
${JSON.stringify({
    answers: state.known || {},
    customerEmail: state.customerEmail || null,
    quotedAlready: !!state.quote,
    reservedAlready: !!state.reservation,
  }, null, 2)}`;
}

// ── Tool declarations ────────────────────────────────────────────────────────

/**
 * Gemini rejects an OBJECT schema with no properties — a 400 on EVERY
 * request, which silently pushed every turn onto the deterministic
 * fallback. So the answer maps list each question id explicitly, built per
 * company from the same battery the conversation uses (standard questions
 * plus the mover's own intake_specs).
 */
function answersSchema(company, description) {
  const { questions } = intakeAgent.questionBattery({ knownAnswers: {}, intakeSpecs: company?.intake_specs });
  const properties = {};
  for (const q of questions) {
    let allowed = Array.isArray(q.options) && q.options.length
      ? ` One of: ${q.options.map((o) => o.value).join(', ')}.`
      : '';
    if (allowed && q.allowCustom) allowed = ` Usually one of: ${q.options.map((o) => o.value).join(', ')} — or the customer's own words.`;
    const skip = q.optional && q.skipValue ? ` Optional: "${q.skipValue}" if they skip or aren't sure.` : '';
    properties[q.id] = { type: SchemaType.STRING, description: `${q.label}${allowed}${skip}` };
  }
  return { type: SchemaType.OBJECT, description, properties };
}

function buildToolDeclarations(company) {
    return [
    {
      name: 'get_intake_questions',
      description: 'The intake questions a quote still needs, given everything already known. Call this to find out what to ask next. Pass ALL answers the conversation has established (from state and this turn) as knownAnswers.',
      parameters: {
        type: SchemaType.OBJECT,
        properties: {
          knownAnswers: answersSchema(company, 'Answers already established, keyed by question id. Omit anything not yet known.'),
        },
      },
    },
    {
      name: 'check_availability',
      description: "Whether the company can take a move on a date (its Nexus booking calendar: capacity per day, existing reservations, blackout days). Returns requestedDateOpen plus up to 3 nearest alternative open dates. When the customer gives a date RANGE or window, pass its start as requestedDate and its end as latestDate: the result adds openDates (up to 5 open days in the range, earliest first) to offer as choices. Use it before reserving, and whenever the customer asks about a date.",
      parameters: {
        type: SchemaType.OBJECT,
        properties: {
          requestedDate: { type: SchemaType.STRING, description: 'The move date to check — or the START of a date range — YYYY-MM-DD.' },
          latestDate: { type: SchemaType.STRING, description: 'Optional END of a date range, YYYY-MM-DD, on or after requestedDate (ranges over 31 days are clamped). Omit for a single date.' },
        },
        required: ['requestedDate'],
      },
    },
    {
      name: 'price_quote',
      description: "Compute the company's instant quote from its own rate card. Requires the estimator answers gathered so far and the customer's email address. The result (price range, line items, not-to-exceed, deposit, trust block) is rendered as a card by the page.",
      parameters: {
        type: SchemaType.OBJECT,
        properties: {
          answers: answersSchema(company, 'All estimator answers gathered so far, keyed by question id.'),
          customerEmail: { type: SchemaType.STRING, description: "The customer's email address, exactly as they gave it." },
        },
        required: ['answers', 'customerEmail'],
      },
    },
    {
      name: 'reserve_booking',
      description: 'Reserve a move date against the quote already priced in this conversation. Only call it after the customer clearly asks to book/reserve, and only for a date check_availability said is open.',
      parameters: {
        type: SchemaType.OBJECT,
        properties: {
          quoteId: { type: SchemaType.STRING, description: 'The quoteId from price_quote.' },
          requestedDate: { type: SchemaType.STRING, description: 'The move date, YYYY-MM-DD.' },
          customerEmail: { type: SchemaType.STRING, description: "The customer's email address." },
        },
        required: ['quoteId', 'requestedDate', 'customerEmail'],
      },
    },
  ];
}

// ── Tool handlers (state-carrying closures over one turn) ───────────────────

/** Merge a model-supplied answers object into state.known via the sanitizer. */
function mergeKnown(state, company, extra) {
  const merged = { ...(state.known || {}) };
  if (extra && typeof extra === 'object') {
    for (const [k, v] of Object.entries(extra)) {
      if (typeof v === 'string' && v.trim()) merged[k] = v.trim().slice(0, 255);
      else if (typeof v === 'number' || typeof v === 'boolean') merged[k] = String(v);
    }
  }
  // questionBattery re-sanitizes: battery keys through sanitizeAnswers,
  // spec keys through the spec whitelist — junk keys drop out here.
  const { known } = intakeAgent.questionBattery({ knownAnswers: merged, intakeSpecs: company.intake_specs });
  state.known = known;
  return known;
}

function buildToolHandlers({ company, state, events }) {
  return {
    async get_intake_questions(args = {}) {
      const known = mergeKnown(state, company, args.knownAnswers);
      return intakeAgent.questionBattery({ knownAnswers: known, intakeSpecs: company.intake_specs });
    },

    async check_availability(args = {}) {
      const latestDate = typeof args.latestDate === 'string' && args.latestDate.trim() ? args.latestDate : undefined;
      const payload = await availabilityService.checkAvailability(company.id, args.requestedDate, { latestDate });
      events.push({ type: 'availability', payload });
      return payload;
    },

    async price_quote(args = {}) {
      const email = typeof args.customerEmail === 'string' ? args.customerEmail.trim().toLowerCase() : '';
      // Server-side shape gate — the model relays whatever the customer
      // typed; a malformed email is a tool error the model must fix by
      // re-asking, never a priced quote against garbage.
      if (!email || email.length > 255 || !EMAIL_RE.test(email)) {
        throw new intakeAgent.IntakeAgentError('invalid_input', 'A valid customer email is required before pricing — ask for it plainly.', { statusCode: 400 });
      }
      const known = mergeKnown(state, company, args.answers);
      const result = await intakeAgent.priceQuote({
        companyId: company.id,
        companyName: company.name,
        companyContactEmail: company.contact_email,
        captureSessionId: null,
        customerEmail: email,
        userId: null,
        answers: known,
      });
      state.customerEmail = email;
      state.quote = { quoteId: result.quoteId, payload: result.payload };
      events.push({ type: 'quote', payload: result.payload });
      return result.payload;
    },

    async reserve_booking(args = {}) {
      const email = typeof args.customerEmail === 'string' ? args.customerEmail.trim().toLowerCase() : (state.customerEmail || '');
      const payload = await intakeAgent.reserveBooking({
        companyId: company.id,
        quoteId: args.quoteId || state.quote?.quoteId,
        requestedDate: args.requestedDate,
        customerEmail: email,
      });
      state.reservation = payload;
      if (DATE_RE.test(String(args.requestedDate || ''))) state.known.moveDate = args.requestedDate;
      events.push({ type: 'reservation', payload });
      return payload;
    },
  };
}

// ── Chips block parsing ([CHIPS]a|b|c[/CHIPS], house [BUTTONS] convention) ──

const CHIPS_RE = /\[CHIPS\]([\s\S]*?)\[\/CHIPS\]/i;

/** The free-text escape hatch chip — the page turns it into a composer prompt. */
const OTHER_CHIP = 'Other…';
const isOtherChip = (label) => /^other\b/i.test(String(label || '').trim());

function extractChips(text) {
  const m = CHIPS_RE.exec(text || '');
  if (!m) return { reply: (text || '').trim(), chips: undefined };
  const all = m[1]
    .split('|')
    .map((s) => s.trim())
    .filter((s) => s && s.length <= 40 && !/\$\s?\d/.test(s)); // no prices in chips, ever
  // ≤4 answer chips, plus "Other…" as an optional fifth (always last).
  const chips = all.filter((c) => !isOtherChip(c)).slice(0, 4);
  if (all.some(isOtherChip)) chips.push(OTHER_CHIP);
  const reply = (text || '').replace(CHIPS_RE, '').trim();
  return { reply, chips: chips.length ? chips : undefined };
}

/**
 * Deterministic chip polish (owner feedback, Nov 2026). When the chips on
 * screen answer a question that allows custom answers (≥2 of its option
 * labels are present) and the model forgot "Other…", append it. Whenever
 * "Other…" is shown, return the composer placeholder the page should use.
 */
function decorateChips(chips, state, company) {
  if (!Array.isArray(chips) || chips.length === 0) return { chips, inputHint: undefined };
  const { questions } = intakeAgent.questionBattery({ knownAnswers: state.known || {}, intakeSpecs: company.intake_specs });
  const custom = questions.filter((q) => q.allowCustom && Array.isArray(q.options));
  const labels = new Set(chips.map(normalize));
  const matched = custom.find((q) => q.options.filter((o) => labels.has(normalize(o.label))).length >= 2);
  let out = chips;
  if (matched && !chips.some(isOtherChip)) out = [...chips.slice(0, 4), OTHER_CHIP];
  if (!out.some(isOtherChip)) return { chips: out, inputHint: undefined };
  const q = matched || custom[0];
  return { chips: out, inputHint: { placeholder: q?.customPlaceholder || 'Type your answer…' } };
}

// ── Price scrubbing (R34 belt-and-braces) ────────────────────────────────────

const DOLLAR_RE = /\$\s?\d[\d,]*(?:\.\d+)?/;

/**
 * True when the reply mentions a dollar amount although NO quote has ever
 * been priced in this conversation — the one case where model prose could
 * invent a price. With a real quote in state, amounts in text trace back to
 * tool data (and the card renders from data regardless).
 */
function mentionsUnbackedPrice(reply, state) {
  return DOLLAR_RE.test(reply || '') && !state.quote;
}

// ── Deterministic forward-moving fallback ────────────────────────────────────

/**
 * Never "didn't catch that": recover by asking the next thing the
 * conversation actually needs — the next unanswered intake question, the
 * email, or the reserve offer. Reuses the same questionBattery state the
 * tools maintain, so a fallback turn makes real progress.
 */
function nextStepFallback(state, company) {
  if (state.reservation) {
    return {
      reply: `Your ${state.reservation.requestedDate} reservation is in — ${company.name} has 24 hours to confirm, and you'll get an email either way. Anything else I can help with?`,
      chips: undefined,
    };
  }

  const { questions } = intakeAgent.questionBattery({
    knownAnswers: state.known || {},
    intakeSpecs: company.intake_specs,
  });

  if (questions.length > 0) {
    const q = questions[0];
    let chips = Array.isArray(q.options)
      ? q.options.map((o) => o.label).slice(0, 4)
      : undefined;
    if (chips && q.allowCustom) chips.push(OTHER_CHIP);
    // Optional free-text questions (the company's own) get a skip chip.
    if (!chips && q.optional && q.skipValue) chips = [q.skipValue];
    return { reply: `Let's keep it moving — ${q.label}`, chips };
  }

  if (!state.customerEmail) {
    return {
      reply: `That's everything I need for a price. Where should we send your quote? (Your email — the quote goes there too.)`,
      chips: undefined,
    };
  }

  if (state.quote) {
    return {
      reply: `Your quote from ${company.name} is above. Want to check a move date, or is there anything you'd like to go over?`,
      chips: ['Check my move date', 'I have a question'],
    };
  }

  return {
    reply: `I have everything I need — say the word and I'll price your move on ${company.name}'s rates.`,
    chips: ['Price my move'],
  };
}

/** Chip/greeting phrases that steer the conversation — never an answer. */
const CONTROL_PHRASES = new Set([
  'price my move', 'check a date', 'check my move date', 'how does this work?',
  'i have a question', 'hi', 'hello', 'hey', 'other', 'other…', 'other...',
]);

const normalize = (v) => String(v || '').toLowerCase().replace(/[\u2018\u2019]/g, "'").replace(/\s+/g, ' ').trim();

/** "Skip"-style replies to an OPTIONAL question ⇒ its neutral skipValue. */
const SKIP_RE = /^(skip(\s+(it|this|that))?|not sure|unsure|no idea|i don'?t know|dunno|n\/?a|pass)[.!]?$/;
/** "Nothing"-style replies — only mean the skipValue when that value IS "none". */
const NONE_RE = /^(none|nothing|no|nope|nah|nothing special|nothing really)[.!]?$/;

/**
 * When the model didn't act this turn, the fallback must still make
 * progress: record the customer's reply as the answer to the question it
 * last asked (chip labels like "2 bed" map to their stored value "2"),
 * then capture the email. Without this the fallback re-asked the same
 * question forever.
 */
function captureFallbackAnswer(state, company, message) {
  const text = typeof message === 'string' ? message.trim() : '';
  if (!text || CONTROL_PHRASES.has(normalize(text))) return;

  const { questions } = intakeAgent.questionBattery({
    knownAnswers: state.known || {},
    intakeSpecs: company.intake_specs,
  });
  if (questions.length > 0) {
    const q = questions[0];
    const m = normalize(text);
    let value = null;
    if (Array.isArray(q.options) && q.options.length) {
      const hit = q.options.find((o) => normalize(o.label) === m || normalize(o.value) === m);
      if (hit) value = hit.value;
    }
    if (!value && q.optional && q.skipValue
      && (SKIP_RE.test(m) || m === normalize(q.skipValue) || (q.skipValue === 'none' && NONE_RE.test(m)))) {
      value = q.skipValue;
    }
    if (!value && (q.allowCustom || !(Array.isArray(q.options) && q.options.length))) {
      // Free text: questions without options, and chip questions that allow
      // the customer's own words (specialItems: "a Peloton") — never discarded.
      value = text.slice(0, q.allowCustom ? 120 : 255);
    }
    if (value) mergeKnown(state, company, { [q.id]: value });
    return;
  }

  const email = text.toLowerCase();
  if (!state.customerEmail && email.length <= 255 && EMAIL_RE.test(email)) {
    state.customerEmail = email;
  }
}

/**
 * The fallback turn: capture what the customer said (only when no tool ran
 * this turn — otherwise the model already recorded it and the reply would
 * land on the wrong question), price deterministically once everything is
 * in, then ask the next thing.
 */
async function fallbackTurn({ state, company, message, handlers, toolCalls }) {
  if (toolCalls.length === 0) captureFallbackAnswer(state, company, message);
  const { questions } = intakeAgent.questionBattery({
    knownAnswers: state.known || {},
    intakeSpecs: company.intake_specs,
  });
  if (questions.length === 0 && state.customerEmail && !state.quote) {
    try {
      await handlers.price_quote({ customerEmail: state.customerEmail, answers: state.known });
      toolCalls.push({ name: 'price_quote', ok: true });
    } catch (err) {
      console.error('[vendorAgent] fallback price_quote failed:', err.message);
      toolCalls.push({ name: 'price_quote', ok: false });
    }
  }
  return nextStepFallback(state, company);
}

// ── Gemini history from the persisted transcript ─────────────────────────────

function buildContents(transcript, message) {
  const contents = [];
  const rows = Array.isArray(transcript) ? transcript.slice(-HISTORY_WINDOW) : [];
  // Gemini wants the history to open with a user turn and to alternate, but
  // the persisted transcript opens with the scripted greeting (the system
  // prompt already carries that identity) — so skip leading model turns and
  // fold any same-role runs together.
  const push = (role, text) => {
    if (contents.length === 0 && role === 'model') return;
    const last = contents[contents.length - 1];
    if (last && last.role === role) last.parts[0].text += `\n\n${text}`;
    else contents.push({ role, parts: [{ text }] });
  };
  for (const t of rows) {
    const text = typeof t?.text === 'string' ? t.text : '';
    if (!text) continue;
    push(t.role === 'user' ? 'user' : 'model', text);
  }
  push('user', message);
  return contents;
}

// ── The turn loop ─────────────────────────────────────────────────────────────

/**
 * Run ONE conversation turn through the vendor agent.
 *
 * @param {object} p
 * @param {object} p.company     companies row: id, name, contact_email,
 *                               payments_mode, intake_specs
 * @param {object} p.state       conversation state (mutated + returned):
 *                               { known, customerEmail, quote, reservation }
 * @param {Array}  p.transcript  persisted transcript rows [{role, text}]
 * @param {string} p.message     the customer's new message (bounded by route)
 * @returns {{ reply, chips, event, state, toolCalls }} — `event` is the raw
 *          payload of the most significant tool that succeeded this turn
 *          (reservation > quote > availability), for the UI's data cards.
 */
async function runTurn({ company, state, transcript, message }) {
  if (!geminiClient) {
    // The route should have 503'd before calling us; double-guard anyway.
    const err = new Error('vendor agent is not configured');
    err.code = 'agent_unconfigured';
    throw err;
  }

  state.known = state.known || {};
  const events = [];
  const toolCalls = [];
  const handlers = buildToolHandlers({ company, state, events });

  const todayIso = new Date().toISOString().slice(0, 10);
  const model = instrumentModel(geminiClient.getGenerativeModel({
    model: MODEL_ID,
    systemInstruction: buildSystemPrompt(company, state, todayIso),
    tools: [{ functionDeclarations: buildToolDeclarations(company) }],
    // flash counts thinking tokens against maxOutputTokens — give it headroom
    // (the orchestrator's 2048 was too tight and produced empty candidates).
    generationConfig: { maxOutputTokens: 4096 },
  }), { userId: null, modelName: MODEL_ID });

  const contents = buildContents(transcript, message);

  const finish = async (rawText) => {
    let { reply, chips } = extractChips(rawText);
    if (!reply || mentionsUnbackedPrice(reply, state)) {
      if (reply) {
        console.warn(`[vendorAgent] scrubbed unbacked price in reply for company ${company.id}: ${JSON.stringify(reply.slice(0, 160))}`);
      }
      const fb = await fallbackTurn({ state, company, message, handlers, toolCalls });
      reply = fb.reply;
      chips = fb.chips;
    }
    const decorated = decorateChips(chips, state, company);
    chips = decorated.chips;
    // Most significant event of the turn — the UI renders THIS as a card.
    const priority = { reservation: 3, quote: 2, availability: 1 };
    let event;
    for (const e of events) {
      if (!event || priority[e.type] >= priority[event.type]) event = e;
    }
    return { reply, chips, event, state, toolCalls, inputHint: decorated.inputHint };
  };

  let result;
  try {
    result = await model.generateContent({ contents });
  } catch (err) {
    console.error('[vendorAgent] generateContent failed:', err.message);
    return finish('');
  }

  let rounds = 0;
  while (rounds < MAX_TOOL_ROUNDS) {
    rounds++;
    const candidate = result?.response?.candidates?.[0];
    if (!candidate) break; // → deterministic fallback below, never silence

    const parts = candidate.content?.parts || [];
    const functionCalls = parts.filter((p) => p.functionCall);
    const textParts = parts.filter((p) => p.text);

    if (functionCalls.length === 0) {
      return finish(textParts.map((p) => p.text).join('\n').trim());
    }

    const toolResponses = [];
    for (const part of functionCalls) {
      const { name, args } = part.functionCall;
      let response;
      try {
        const handler = handlers[name];
        if (!handler) {
          response = { error: `Unknown tool: ${name}` };
        } else {
          response = await handler(args || {});
        }
      } catch (err) {
        if (err instanceof intakeAgent.IntakeAgentError) {
          // Honest, user-relayable copy with a stable code.
          response = { error: err.message, code: err.code };
          if (err.missing) response.missing = err.missing;
        } else {
          console.error(`[vendorAgent] tool ${name} failed:`, err.message);
          response = { error: 'Something went wrong on our side. Please try again.' };
        }
      }
      toolCalls.push({ name, ok: !response?.error });
      toolResponses.push({ functionResponse: { name, response } });
    }

    contents.push({ role: 'model', parts: functionCalls.map((p) => ({ functionCall: p.functionCall })) });
    contents.push({ role: 'user', parts: toolResponses });

    if (rounds >= MAX_TOOL_ROUNDS) break; // budget spent — deterministic close below

    try {
      result = await model.generateContent({ contents });
    } catch (err) {
      console.error(`[vendorAgent] generateContent failed in round ${rounds}:`, err.message);
      result = null;
      break;
    }
  }

  // Empty candidate / exhaustion: forward-moving deterministic close. If the
  // turn DID accomplish something (a quote, a reservation), the event still
  // rides out and the card renders — only the prose is scripted.
  console.warn(`[vendorAgent] turn ended without model text (rounds=${rounds}) — deterministic close`);
  return finish('');
}

// ── Quote progress (header tracker) ──────────────────────────────────────────

/** { answered, total, quoteReady, reserved } for this conversation's state. */
function progressFor(state, company) {
  const st = state || {};
  return intakeAgent.quoteProgress({
    knownAnswers: st.known || {},
    intakeSpecs: company?.intake_specs,
    customerEmail: st.customerEmail || null,
    quoteReady: !!st.quote,
    reserved: !!st.reservation,
  });
}

// ── Deterministic greeting (turn zero — no model call, instant) ─────────────

function buildGreeting(company) {
  return {
    reply: `Hi — I'm ${company.name}'s moving assistant. I can price your move on ${company.name}'s own rates, check move dates, and hold one for you. Tell me about your move, or just say hi — typing works from the first message.`,
    chips: ['Price my move', 'Check a date', 'How does this work?'],
  };
}

module.exports = {
  isConfigured,
  runTurn,
  buildGreeting,
  buildSystemPrompt,
  nextStepFallback,
  extractChips,
  decorateChips,
  progressFor,
  OTHER_CHIP,
  mentionsUnbackedPrice,
  buildToolDeclarations,
  captureFallbackAnswer,
  MODEL_ID,
  MAX_TOOL_ROUNDS,
  TURN_CAP,
};
