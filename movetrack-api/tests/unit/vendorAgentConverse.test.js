'use strict';

/**
 * POST /api/agent/:companyToken/converse (W1c, #117) — the widget chat's
 * conversation endpoint, brain mocked (Gemini never called). Pins the
 * public-endpoint contract:
 *
 *   • no GOOGLE_AI_API_KEY / unconfigured brain ⇒ 503 {fallback:true} so
 *     the widget drops to the deterministic battery;
 *   • unknown ≡ inactive token ⇒ one leak-proof 404;
 *   • another company's conversationId is indistinguishable from a missing
 *     one;
 *   • the greeting turn is deterministic (no brain call), persisted, and
 *     carries {name, paymentsMode};
 *   • a normal turn persists transcript + state (answers, quoteId) and
 *     returns {conversationId, reply, chips, event, turns, known};
 *   • the 40-turn cap answers with the polite handoff (company email) and
 *     stops calling the brain;
 *   • messages over 2000 chars are 413;
 *   • the converse limiter is wired (and really exists);
 *   • a brain crash mid-turn degrades to 503 {fallback:true, known} — the
 *     widget carries the answers into deterministic mode.
 */

jest.mock('../../services/infra/db', () => ({
  db: { any: jest.fn(), one: jest.fn(), oneOrNone: jest.fn(), none: jest.fn() },
}));

const mockConverseLimiter = jest.fn((req, res, next) => next());
jest.mock('../../config/rateLimits', () => ({
  agentConverseLimiter: (req, res, next) => mockConverseLimiter(req, res, next),
}));

const mockIsConfigured = jest.fn(() => true);
const mockRunTurn = jest.fn();
jest.mock('../../services/quote/vendorIntakeAgent', () => {
  const actual = jest.requireActual('../../services/quote/vendorIntakeAgent');
  return {
    ...actual,
    isConfigured: () => mockIsConfigured(),
    runTurn: (...a) => mockRunTurn(...a),
  };
});

const request = require('supertest');
const express = require('express');
const { db } = require('../../services/infra/db');
const vendorAgent = require('../../services/quote/vendorIntakeAgent');
const router = require('../../routes/api/vendorAgentConverse');

const TOKEN = 'demo';
const COMPANY_ID = 'c0c0c0c0-1111-2222-3333-444444444444';
const CONVO_ID = 'a1a1a1a1-2222-3333-4444-555555555555';

const COMPANY_ROW = {
  id: COMPANY_ID,
  name: 'Acme Van Lines',
  contact_email: 'ops@acme.test',
  trust_block: { legalName: 'Acme Van Lines, Inc.' },
  payments_mode: 'simulated',
  capacity_per_day: 2,
  blackout_days: [],
  intake_specs: [{ key: 'coi', question: 'COI or HOA rules?' }],
};

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/agent', router);
  return app;
}

const post = (body, token = TOKEN) =>
  request(makeApp()).post(`/api/agent/${token}/converse`).send(body);

function wireDb({ company = COMPANY_ROW, conversation = null } = {}) {
  db.oneOrNone.mockImplementation(async (sql, params) => {
    if (/FROM companies WHERE token = \$1 AND is_active = TRUE/.test(sql)) {
      return company && params[0] === TOKEN ? company : null;
    }
    if (/FROM agent_conversations WHERE id = \$1/.test(sql)) return conversation;
    throw new Error(`unexpected oneOrNone: ${sql}`);
  });
  db.one.mockImplementation(async (sql) => {
    if (/INSERT INTO agent_conversations/.test(sql)) {
      return { id: CONVO_ID, company_id: COMPANY_ID, customer_email: null, state: {}, transcript: [], turns: 0, status: 'active' };
    }
    throw new Error(`unexpected one: ${sql}`);
  });
  db.none.mockResolvedValue(undefined);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockIsConfigured.mockReturnValue(true);
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => jest.restoreAllMocks());

// ── Degradation + leak-proofing ─────────────────────────────────────────────

describe('degradation contract', () => {
  test('unconfigured brain ⇒ 503 {fallback:true} — the widget switches to deterministic', async () => {
    wireDb();
    mockIsConfigured.mockReturnValue(false);
    const res = await post({ message: 'hi' });
    expect(res.status).toBe(503);
    expect(res.body.fallback).toBe(true);
    expect(mockRunTurn).not.toHaveBeenCalled();
    expect(db.one).not.toHaveBeenCalled(); // no conversation row for a dead brain
  });

  test('brain crash mid-turn ⇒ 503 {fallback:true, known} carrying gathered answers', async () => {
    wireDb({
      conversation: {
        id: CONVO_ID, company_id: COMPANY_ID, customer_email: null,
        state: { known: { bedrooms: '2' } }, transcript: [{ role: 'assistant', text: 'hi' }], turns: 3, status: 'active',
      },
    });
    mockRunTurn.mockRejectedValue(new Error('gemini exploded'));
    const res = await post({ conversationId: CONVO_ID, message: 'ok' });
    expect(res.status).toBe(503);
    expect(res.body.fallback).toBe(true);
    expect(res.body.known).toEqual({ bedrooms: '2' });
  });
});

describe('leak-proofing', () => {
  test('unknown/inactive token ⇒ one 404, no company data, no brain call', async () => {
    wireDb({ company: null });
    const res = await post({ message: 'hi' }, 'nope');
    expect(res.status).toBe(404);
    expect(JSON.stringify(res.body)).not.toMatch(/Acme|ops@acme|c0c0c0c0/);
    expect(mockRunTurn).not.toHaveBeenCalled();
  });

  test("another company's conversationId is indistinguishable from a missing one", async () => {
    wireDb({
      conversation: {
        id: CONVO_ID, company_id: 'someone-else', customer_email: null,
        state: {}, transcript: [], turns: 0, status: 'active',
      },
    });
    const res = await post({ conversationId: CONVO_ID, message: 'hi' });
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/No conversation with that id/);
    expect(mockRunTurn).not.toHaveBeenCalled();
  });

  test('garbage conversationId is the same 404 (no query at all)', async () => {
    wireDb();
    const res = await post({ conversationId: 'DROP TABLE', message: 'hi' });
    expect(res.status).toBe(404);
    expect(db.oneOrNone).not.toHaveBeenCalledWith(expect.stringMatching(/agent_conversations/), expect.anything());
  });
});

// ── The greeting turn ────────────────────────────────────────────────────────

describe('greeting (turn zero)', () => {
  test('no message ⇒ deterministic greeting + chips + company info, persisted, brain untouched', async () => {
    wireDb();
    const res = await post({});
    expect(res.status).toBe(200);
    expect(res.body.conversationId).toBe(CONVO_ID);
    expect(res.body.reply).toMatch(/Acme Van Lines's moving assistant/);
    expect(res.body.chips).toEqual(vendorAgent.buildGreeting(COMPANY_ROW).chips);
    expect(res.body.company).toEqual({ name: 'Acme Van Lines', paymentsMode: 'simulated' });
    expect(mockRunTurn).not.toHaveBeenCalled();

    const [sql, params] = db.none.mock.calls.find(([q]) => /UPDATE agent_conversations/.test(q));
    expect(sql).toMatch(/SET state = \$2, transcript = \$3/);
    const transcript = JSON.parse(params[2]);
    expect(transcript).toHaveLength(1);
    expect(transcript[0].role).toBe('assistant');
  });
});

// ── A normal turn ────────────────────────────────────────────────────────────

describe('a conversation turn', () => {
  test('runs the brain, persists transcript + state, returns the full contract', async () => {
    const convo = {
      id: CONVO_ID, company_id: COMPANY_ID, customer_email: null,
      state: { known: { bedrooms: '2' } },
      transcript: [{ role: 'assistant', text: 'Hi!', at: 't0' }],
      turns: 1, status: 'active',
    };
    wireDb({ conversation: convo });
    const event = { type: 'quote', payload: { quoteId: 'q-1', rangeLow: 1151, rangeHigh: 1494 } };
    mockRunTurn.mockImplementation(async ({ state }) => {
      state.known.originAddress = 'Oakland, CA';
      state.customerEmail = 'c@x.com';
      state.quote = { quoteId: 'q-1', payload: event.payload };
      return { reply: 'Here is your quote.', chips: ['Reserve a date'], event, state, toolCalls: [] };
    });

    const res = await post({ conversationId: CONVO_ID, message: 'I am moving from Oakland' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      conversationId: CONVO_ID,
      reply: 'Here is your quote.',
      chips: ['Reserve a date'],
      event,
      turns: 2,
      known: { bedrooms: '2', originAddress: 'Oakland, CA' },
    });

    // The brain got the company + prior state + the message.
    expect(mockRunTurn).toHaveBeenCalledWith(expect.objectContaining({
      company: COMPANY_ROW,
      message: 'I am moving from Oakland',
      transcript: convo.transcript,
    }));

    // Persistence: state (incl. quoteId + email), transcript grown by 2, turns bumped.
    const [, params] = db.none.mock.calls.find(([q]) => /UPDATE agent_conversations/.test(q));
    const state = JSON.parse(params[1]);
    expect(state.quote.quoteId).toBe('q-1');
    expect(state.customerEmail).toBe('c@x.com');
    const transcript = JSON.parse(params[2]);
    expect(transcript).toHaveLength(3);
    expect(transcript[1]).toMatchObject({ role: 'user', text: 'I am moving from Oakland' });
    expect(transcript[2]).toMatchObject({ role: 'assistant', text: 'Here is your quote.', event });
    expect(params[3]).toBe(2);        // turns
    expect(params[5]).toBe('c@x.com'); // customer_email column
  });

  test('resume: an existing conversation is loaded, not recreated', async () => {
    wireDb({
      conversation: {
        id: CONVO_ID, company_id: COMPANY_ID, customer_email: null,
        state: {}, transcript: [], turns: 0, status: 'active',
      },
    });
    mockRunTurn.mockResolvedValue({ reply: 'ok', state: { known: {} }, toolCalls: [] });
    const res = await post({ conversationId: CONVO_ID, message: 'hi' });
    expect(res.status).toBe(200);
    const inserts = db.one.mock.calls.filter(([q]) => /INSERT INTO agent_conversations/.test(q));
    expect(inserts).toHaveLength(0);
  });
});

// ── Bounds ───────────────────────────────────────────────────────────────────

describe('bounds', () => {
  test('40-turn cap ⇒ polite handoff with the company email, brain not called, status capped', async () => {
    wireDb({
      conversation: {
        id: CONVO_ID, company_id: COMPANY_ID, customer_email: 'c@x.com',
        state: { known: {}, customerEmail: 'c@x.com', quote: { quoteId: 'q-1' } },
        transcript: [], turns: vendorAgent.TURN_CAP, status: 'active',
      },
    });
    const res = await post({ conversationId: CONVO_ID, message: 'and another thing' });
    expect(res.status).toBe(200);
    expect(res.body.reply).toMatch(/ops@acme\.test/);
    expect(res.body.reply).toMatch(/quote is saved/);
    expect(mockRunTurn).not.toHaveBeenCalled();
    const [, params] = db.none.mock.calls.find(([q]) => /UPDATE agent_conversations/.test(q));
    expect(params[4]).toBe('capped');
  });

  test('message over 2000 chars ⇒ 413, nothing persisted', async () => {
    wireDb();
    const res = await post({ message: 'x'.repeat(2001) });
    expect(res.status).toBe(413);
    expect(mockRunTurn).not.toHaveBeenCalled();
    expect(db.none).not.toHaveBeenCalled();
  });

  test('the converse limiter is wired in front of the endpoint (and really exists)', async () => {
    wireDb();
    mockRunTurn.mockResolvedValue({ reply: 'ok', state: { known: {} }, toolCalls: [] });
    await post({ message: 'hi' });
    expect(mockConverseLimiter).toHaveBeenCalled();
    const real = jest.requireActual('../../config/rateLimits');
    expect(typeof real.agentConverseLimiter).toBe('function');
  });
});
