'use strict';

/**
 * vendorIntakeAgent (W1c, #117) — the Gemini tool-loop brain, with Gemini
 * MOCKED per the orchestrator-test pattern (never the real API). Pins the
 * discipline the widget's honesty depends on:
 *
 *   • prices come ONLY from tool payloads: the quote event carries the
 *     mocked priceQuote payload byte-for-byte, and a model reply that
 *     invents a dollar amount with NO quote in the conversation is scrubbed
 *     and replaced by the forward-moving fallback (no event either);
 *   • the company's intake_specs are merged into get_intake_questions on
 *     the converse brain (same service call as MCP);
 *   • availability + reservation tool results ride out as events (raw
 *     payloads), reservation outranking quote outranking availability;
 *   • empty candidates and tool-round exhaustion NEVER produce "didn't
 *     catch that" — the fallback asks the NEXT UNANSWERED intake question
 *     (the #95 FIRST_TURN_FALLBACK lesson);
 *   • ≤ MAX_TOOL_ROUNDS model rounds per turn;
 *   • [CHIPS] blocks parse to ≤4 chips and never carry prices.
 */

jest.mock('../../services/infra/db', () => ({
  db: { any: jest.fn(), one: jest.fn(), oneOrNone: jest.fn(), none: jest.fn() },
}));

const mockPriceQuote = jest.fn();
const mockReserveBooking = jest.fn();
jest.mock('../../services/quote/intakeAgentService', () => {
  const actual = jest.requireActual('../../services/quote/intakeAgentService');
  return {
    ...actual,
    priceQuote: (...a) => mockPriceQuote(...a),
    reserveBooking: (...a) => mockReserveBooking(...a),
  };
});

const mockCheckAvailability = jest.fn();
jest.mock('../../services/quote/vendorAvailabilityService', () => ({
  checkAvailability: (...a) => mockCheckAvailability(...a),
}));

// ── Gemini mock (orchestrator-test pattern) ─────────────────────────────────
let mockMainGenerate;
jest.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: class {
    getGenerativeModel() {
      return { generateContent: (...a) => mockMainGenerate(...a) };
    }
  },
  SchemaType: { OBJECT: 'OBJECT', STRING: 'STRING', ARRAY: 'ARRAY', BOOLEAN: 'BOOLEAN', NUMBER: 'NUMBER', INTEGER: 'INTEGER' },
}));

const textResult = (text) => ({ response: { candidates: [{ content: { parts: [{ text }] } }] } });
const functionCallResult = (name, args = {}) => ({
  response: { candidates: [{ content: { parts: [{ functionCall: { name, args } }] } }] },
});
const emptyCandidateResult = (finishReason = 'MAX_TOKENS') => ({
  response: { candidates: [{ content: { parts: [] }, finishReason }] },
});

const COMPANY = {
  id: 'c0c0c0c0-1111-2222-3333-444444444444',
  name: 'Acme Van Lines',
  contact_email: 'ops@acme.test',
  payments_mode: 'simulated',
  intake_specs: [{ key: 'coi', question: 'Does either building require a certificate of insurance (COI) or have HOA move-in rules?' }],
};

const QUOTE_PAYLOAD = {
  quoteId: 'f0f0f0f0-1111-2222-3333-444444444444',
  company: { name: 'Acme Van Lines' },
  rangeLow: 1151,
  rangeHigh: 1494,
  nte: 1718,
  deposit: { amount: 115, refundWindowDays: 3 },
  status: 'quoted',
  reviewReasons: [],
  trustBlock: { legalName: 'Acme Van Lines, Inc.' },
};

let agent;

beforeEach(() => {
  jest.resetModules();
  jest.clearAllMocks();
  process.env.GOOGLE_AI_API_KEY = 'test-key';
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  mockMainGenerate = jest.fn();
  agent = require('../../services/quote/vendorIntakeAgent');
  mockPriceQuote.mockResolvedValue({ quoteId: QUOTE_PAYLOAD.quoteId, outputs: {}, payload: QUOTE_PAYLOAD });
});

afterEach(() => {
  delete process.env.GOOGLE_AI_API_KEY;
  jest.restoreAllMocks();
});

const run = (over = {}) =>
  agent.runTurn({ company: COMPANY, state: {}, transcript: [], message: 'hi', ...over });

// ── Tool-loop discipline ─────────────────────────────────────────────────────

describe('quote turns — card from DATA', () => {
  test('price_quote payload rides out verbatim as the quote event', async () => {
    mockMainGenerate
      .mockResolvedValueOnce(functionCallResult('price_quote', {
        answers: { bedrooms: '2', stairsOrigin: '1' },
        customerEmail: 'Customer@Example.com',
      }))
      .mockResolvedValueOnce(textResult('Here is your instant quote — an estimator confirms nothing extra here.'));

    const r = await run();
    expect(r.event).toEqual({ type: 'quote', payload: QUOTE_PAYLOAD });
    expect(r.reply).toMatch(/instant quote/);
    // The service was called with the SANITIZED answers and normalized email…
    expect(mockPriceQuote).toHaveBeenCalledWith(expect.objectContaining({
      companyId: COMPANY.id,
      customerEmail: 'customer@example.com',
      answers: expect.objectContaining({ bedrooms: '2', stairsOrigin: '1' }),
      userId: null,
      captureSessionId: null,
    }));
    // …and the state now carries the quote + email for later turns.
    expect(r.state.quote.quoteId).toBe(QUOTE_PAYLOAD.quoteId);
    expect(r.state.customerEmail).toBe('customer@example.com');
  });

  test('a model-invented $ with NO quote in the conversation is scrubbed — fallback asks on, no event', async () => {
    mockMainGenerate.mockResolvedValueOnce(textResult('A 2-bedroom move like yours usually runs about $850–$1,200.'));

    const r = await run({ state: { known: { bedrooms: '2' } } });
    expect(r.event).toBeUndefined();
    expect(r.reply).not.toMatch(/\$\s?\d/);
    // Forward-moving: the next unanswered battery question (origin), never an apology.
    expect(r.reply).toMatch(/moving from/i);
    expect(r.reply).not.toMatch(/didn't catch|didn’t catch/i);
  });

  test('bad customerEmail is a tool error the model must fix — never a priced quote', async () => {
    mockMainGenerate
      .mockResolvedValueOnce(functionCallResult('price_quote', { answers: {}, customerEmail: 'nope' }))
      .mockResolvedValueOnce(textResult('Could you double-check that email for me?'));

    const r = await run();
    expect(mockPriceQuote).not.toHaveBeenCalled();
    expect(r.event).toBeUndefined();
    // The tool response handed back to the model carried the honest error.
    const secondCall = mockMainGenerate.mock.calls[1][0];
    const toolTurn = secondCall.contents[secondCall.contents.length - 1];
    expect(toolTurn.parts[0].functionResponse.response.code).toBe('invalid_input');
  });
});

describe('availability + reservation events', () => {
  test('check_availability payload rides out as the availability event', async () => {
    const availability = {
      requestedDate: '2026-10-15', requestedDateOpen: false, reason: 'fully_booked',
      capacityPerDay: 2, alternatives: ['2026-10-16', '2026-10-14', '2026-10-17'],
    };
    mockCheckAvailability.mockResolvedValue(availability);
    mockMainGenerate
      .mockResolvedValueOnce(functionCallResult('check_availability', { requestedDate: '2026-10-15' }))
      .mockResolvedValueOnce(textResult('That day is full — here are the nearest open days.'));

    const r = await run();
    expect(mockCheckAvailability).toHaveBeenCalledWith(COMPANY.id, '2026-10-15');
    expect(r.event).toEqual({ type: 'availability', payload: availability });
  });

  test('reserve_booking event outranks the availability event in the same turn', async () => {
    mockCheckAvailability.mockResolvedValue({ requestedDate: '2026-10-16', requestedDateOpen: true, alternatives: [] });
    const reservation = { reservationId: 'e1e1e1e1-2222-3333-4444-555555555555', status: 'pending_confirmation', requestedDate: '2026-10-16', deposit: { amount: 115, simulated: true } };
    mockReserveBooking.mockResolvedValue(reservation);
    mockMainGenerate
      .mockResolvedValueOnce(functionCallResult('check_availability', { requestedDate: '2026-10-16' }))
      .mockResolvedValueOnce(functionCallResult('reserve_booking', {
        quoteId: QUOTE_PAYLOAD.quoteId, requestedDate: '2026-10-16', customerEmail: 'customer@example.com',
      }))
      .mockResolvedValueOnce(textResult('Reserved pending confirmation — Acme has 24 hours to confirm.'));

    const r = await run({ state: { known: {}, customerEmail: 'customer@example.com', quote: { quoteId: QUOTE_PAYLOAD.quoteId, payload: QUOTE_PAYLOAD } } });
    expect(r.event.type).toBe('reservation');
    expect(r.event.payload).toEqual(reservation);
    expect(r.state.reservation).toEqual(reservation);
  });
});

describe('intake specs — the mover-defined question reaches the brain', () => {
  test('get_intake_questions merges intake_specs and the spec answer sticks in state', async () => {
    mockMainGenerate
      .mockResolvedValueOnce(functionCallResult('get_intake_questions', { knownAnswers: { bedrooms: '2', coi: 'No COI needed' } }))
      .mockResolvedValueOnce(textResult('Great — where are you moving from?'));

    const r = await run();
    const secondCall = mockMainGenerate.mock.calls[1][0];
    const toolTurn = secondCall.contents[secondCall.contents.length - 1];
    const battery = toolTurn.parts[0].functionResponse.response;
    // Answered spec dropped out of the open questions; unanswered battery remains.
    expect(battery.questions.map((q) => q.id)).not.toContain('coi');
    expect(battery.questions.map((q) => q.id)).toContain('originAddress');
    expect(battery.known.coi).toBe('No COI needed');
    expect(r.state.known.coi).toBe('No COI needed');
  });

  test('unanswered spec question is offered to the model like any battery question', async () => {
    mockMainGenerate
      .mockResolvedValueOnce(functionCallResult('get_intake_questions', { knownAnswers: {} }))
      .mockResolvedValueOnce(textResult('First — how big is your home? [CHIPS]Studio|1 bed|2 bed|3 bed[/CHIPS]'));

    const r = await run();
    const secondCall = mockMainGenerate.mock.calls[1][0];
    const battery = secondCall.contents[secondCall.contents.length - 1].parts[0].functionResponse.response;
    const spec = battery.questions.find((q) => q.id === 'coi');
    expect(spec).toEqual({ id: 'coi', label: COMPANY.intake_specs[0].question, type: 'text', source: 'company' });
    expect(r.chips).toEqual(['Studio', '1 bed', '2 bed', '3 bed']);
    expect(r.reply).toBe('First — how big is your home?');
  });
});

// ── Fallback discipline (the #95 lesson) ─────────────────────────────────────

describe('fallbacks never stall', () => {
  test('empty candidate ⇒ asks the NEXT UNANSWERED question, with its chips', async () => {
    mockMainGenerate.mockResolvedValueOnce(emptyCandidateResult());
    const r = await run({ state: { known: { bedrooms: '2', originAddress: 'Oakland, CA', destinationAddress: 'San Jose, CA' } } });
    // Next open battery question after those three is stairsOrigin.
    expect(r.reply).toMatch(/stairs at your current place/i);
    expect(r.chips).toEqual(['No stairs', '1 flight', '2 flights', '3+ flights']);
    expect(r.reply).not.toMatch(/didn't catch|didn’t catch|sorry/i);
  });

  test('model exception ⇒ same deterministic recovery', async () => {
    mockMainGenerate.mockRejectedValue(new Error('boom'));
    const r = await run();
    expect(r.reply).toMatch(/how big is your home/i);
  });

  test('battery + specs done, no email yet ⇒ the fallback asks for the email', async () => {
    mockMainGenerate.mockResolvedValueOnce(emptyCandidateResult());
    const known = {
      bedrooms: '2', originAddress: 'Oakland, CA', destinationAddress: 'San Jose, CA',
      stairsOrigin: 'none', stairsDestination: 'none', parking: 'right_outside',
      packing: 'no', specialItems: 'none', moveDate: '2026-10-15', coi: 'no',
    };
    const r = await run({ state: { known } });
    expect(r.reply).toMatch(/email/i);
  });

  test('tool-round exhaustion ⇒ deterministic close, but a mid-turn quote still ships as the event', async () => {
    mockMainGenerate.mockResolvedValue(functionCallResult('price_quote', {
      answers: { bedrooms: '2' }, customerEmail: 'customer@example.com',
    }));

    const r = await run();
    // Initial call + one per continued round, never more than MAX_TOOL_ROUNDS.
    expect(mockMainGenerate.mock.calls.length).toBeLessThanOrEqual(agent.MAX_TOOL_ROUNDS);
    expect(r.event.type).toBe('quote');
    expect(r.reply).toBeTruthy();
    expect(r.reply).not.toMatch(/didn't catch|didn’t catch/i);
  });
});

// ── Chips parsing ────────────────────────────────────────────────────────────

describe('extractChips', () => {
  test('parses ≤4 chips and strips the block', () => {
    const { reply, chips } = agent.extractChips('Pick one. [CHIPS]a|b|c|d|e|f[/CHIPS]');
    expect(reply).toBe('Pick one.');
    expect(chips).toEqual(['a', 'b', 'c', 'd']);
  });

  test('chips never carry prices', () => {
    const { chips } = agent.extractChips('Deal? [CHIPS]Book for $500|Not now[/CHIPS]');
    expect(chips).toEqual(['Not now']);
  });

  test('no block ⇒ no chips', () => {
    expect(agent.extractChips('Plain reply.')).toEqual({ reply: 'Plain reply.', chips: undefined });
  });
});

// ── Config flag ──────────────────────────────────────────────────────────────

describe('isConfigured', () => {
  test('false without GOOGLE_AI_API_KEY (the route turns this into 503 {fallback:true})', () => {
    jest.resetModules();
    delete process.env.GOOGLE_AI_API_KEY;
    const bare = require('../../services/quote/vendorIntakeAgent');
    expect(bare.isConfigured()).toBe(false);
  });

  test('true with a key', () => {
    expect(agent.isConfigured()).toBe(true);
  });
});
