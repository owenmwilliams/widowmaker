'use strict';

/**
 * The per-vendor MCP agent server (W1a, #111): routes/api/vendorAgentMcp.js
 * + the shared service layer it rides on. Everything goes through the REAL
 * @modelcontextprotocol/sdk transport over supertest — actual JSON-RPC on
 * the wire, exactly what the widget (#112) and any AI client will send.
 * Proves:
 *
 *   • The MCP handshake: initialize returns serverInfo; tools/list exposes
 *     exactly the four tools with their input schemas; a bare tools/call
 *     works without initialize (stateless mode — the widget's fetch bridge
 *     relies on this).
 *   • LEAK-PROOFING: unknown and inactive tokens get an identical JSON-RPC
 *     error carrying no company data; tool results never contain the
 *     contact email, company id, raw rate card, or hourly table beyond the
 *     computed quote.
 *   • get_company_info / get_intake_questions shapes (knownAnswers
 *     filtering included).
 *   • price_quote: the trust-block INVARIANT holds through MCP — an
 *     incomplete block is a tool error with NO price, NO persisted quote,
 *     NO email; the happy path prices from the vendor card (same
 *     hand-computed #108 fixture), persists with capture_session_id NULL
 *     and the customer email inside inputs, and emails the priced lead.
 *   • Deposit precedence: a card carrying BOTH depositPct and
 *     depositAmount quotes the pct (10% of rangeLow, rounded), not the
 *     flat fee.
 *   • reserve_booking: pending_confirmation + 24h window + SIMULATED
 *     deposit truth-in-copy, both emails; a quote belonging to another
 *     company is indistinguishable from a missing one.
 *   • Rate limiting is wired on the endpoint (and the real limiter exists).
 */

jest.mock('../../services/infra/db', () => ({
  db: { any: jest.fn(), one: jest.fn(), oneOrNone: jest.fn(), none: jest.fn() },
}));

const mockAgentLimiter = jest.fn((req, res, next) => next());
jest.mock('../../config/rateLimits', () => ({
  agentMcpLimiter: (req, res, next) => mockAgentLimiter(req, res, next),
}));

const mockSendMail = jest.fn();
jest.mock('nodemailer', () => ({
  createTransport: jest.fn(() => ({ sendMail: mockSendMail })),
}));

const mockDistance = jest.fn();
jest.mock('../../services/move/distanceService', () => ({
  calculateDrivingDistance: (...args) => mockDistance(...args),
}));

const request = require('supertest');
const express = require('express');
const { db } = require('../../services/infra/db');
const engine = require('../../services/quote/intakeQuoteEngine');
const router = require('../../routes/api/vendorAgentMcp');

const BASE = '/api/agent';
const TOKEN = 'demo';
const COMPANY_ID = 'c0c0c0c0-1111-2222-3333-444444444444';
const QUOTE_ID = 'f0f0f0f0-1111-2222-3333-444444444444';
const RESERVATION_ID = 'e1e1e1e1-2222-3333-4444-555555555555';

// The seed card, verbatim (#108 fixture) — flat $200 deposit, no pct.
const CARD = {
  hourlyByCrew: { 2: 169, 3: 229, 4: 289 },
  minHours: 4,
  billingIncrementMin: 30,
  travelRule: { type: 'double_drive_time', flatFee: 0 },
  truckFee: 45,
  surcharges: { stairsPerFlight: 75, longCarry: 100, heavyItem: 150 },
  packingAddon: 350,
  depositAmount: 200,
  refundWindowDays: 3,
  nteMarginPct: 15,
  maxQuoteWithoutReview: 4000,
  reviewFlagItems: ['piano', 'safe', 'pool table', 'gun safe'],
};

const TRUST_BLOCK = {
  legalName: 'Acme Van Lines, Inc.',
  dba: 'Acme Van Lines',
  stateLicense: 'CAL-T-0123456',
  usDot: 'US DOT 1234567',
  liabilityPerLb: 0.6,
  workedExample: 'a 50 lb TV = $30 statutory coverage',
  fullValueOption: 'Full-value protection available.',
  depositRule: '$200 deposit, refundable to 72h.',
  clockRules: 'Clock starts on arrival.',
  regulatorUrl: 'https://www.cpuc.ca.gov/',
};

const COMPANY_ROW = {
  id: COMPANY_ID,
  name: 'Acme Van Lines',
  contact_email: 'ops@acme.test',
  trust_block: TRUST_BLOCK,
  payments_mode: 'simulated',
};

// Q&A-only 2BR (#108 hand-computed): range 1151–1494, NTE 1718.
const ANSWERS_2BR = {
  bedrooms: '2',
  stairsOrigin: '1',
  stairsDestination: 'none',
  parking: 'right_outside',
  packing: 'no',
  specialItems: 'none',
};

function makeApp() {
  const app = express();
  app.use(BASE, router);
  return app;
}

/** One JSON-RPC POST, exactly as the widget contract documents it. */
async function rpc(body, { token = TOKEN } = {}) {
  return request(makeApp())
    .post(`${BASE}/${token}/mcp`)
    .set('Content-Type', 'application/json')
    .set('Accept', 'application/json, text/event-stream')
    .send(body);
}

const call = (name, args = {}, id = 9) =>
  rpc({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } });

/** Parse a tool result's JSON text payload. */
function toolPayload(res) {
  expect(res.body.result).toBeDefined();
  return JSON.parse(res.body.result.content[0].text);
}

/**
 * Wire the db for the MCP surface.
 * @param {object} opts { company, trustBlock, rateCard, quoteRow, reservationRow }
 */
function wireDb({
  company = COMPANY_ROW,
  trustBlock = TRUST_BLOCK,
  rateCard = { version: 3, data: CARD },
  quoteRow = null,
  reservationRow = null,
} = {}) {
  db.oneOrNone.mockImplementation(async (sql, params) => {
    if (/FROM companies WHERE token = \$1 AND is_active = TRUE/.test(sql)) {
      return company && params[0] === TOKEN ? company : null;
    }
    if (/FROM rate_cards/.test(sql)) return rateCard;
    if (/FROM intake_quotes q/.test(sql)) return quoteRow;
    throw new Error(`unexpected oneOrNone: ${sql}`);
  });
  db.one.mockImplementation(async (sql) => {
    if (/SELECT trust_block FROM companies/.test(sql)) return { trust_block: trustBlock };
    if (/INSERT INTO intake_quotes/.test(sql)) return { id: QUOTE_ID, created_at: '2026-09-26T00:00:00Z' };
    if (/INSERT INTO booking_reservations/.test(sql)) return reservationRow;
    throw new Error(`unexpected one: ${sql}`);
  });
  db.any.mockResolvedValue([]);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSendMail.mockResolvedValue({ accepted: ['x'] });
  mockDistance.mockResolvedValue(null);
  process.env.SMTP_USER = 'apikey';
  process.env.SMTP_PASS = 'test-smtp-pass';
});

afterAll(() => {
  delete process.env.SMTP_USER;
  delete process.env.SMTP_PASS;
});

// ── Handshake ────────────────────────────────────────────────────────────────

describe('MCP handshake', () => {
  test('initialize returns the vendor-named server over plain JSON', async () => {
    wireDb();
    const res = await rpc({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'nexus-widget', version: '1.0.0' } },
    });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body.jsonrpc).toBe('2.0');
    expect(res.body.result.serverInfo.name).toMatch(/Acme Van Lines/);
    expect(res.body.result.capabilities.tools).toBeDefined();
    // Stateless: no session id header ever.
    expect(res.headers['mcp-session-id']).toBeUndefined();
  });

  test('tools/list exposes exactly the four tools with schemas', async () => {
    wireDb();
    const res = await rpc({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
    expect(res.status).toBe(200);
    const tools = res.body.result.tools;
    expect(tools.map((t) => t.name).sort()).toEqual([
      'get_company_info',
      'get_intake_questions',
      'price_quote',
      'reserve_booking',
    ]);
    const priceQuote = tools.find((t) => t.name === 'price_quote');
    expect(priceQuote.inputSchema.properties).toHaveProperty('answers');
    expect(priceQuote.inputSchema.properties).toHaveProperty('customerEmail');
    const reserve = tools.find((t) => t.name === 'reserve_booking');
    expect(Object.keys(reserve.inputSchema.properties).sort()).toEqual(['customerEmail', 'quoteId', 'requestedDate']);
    // Honest descriptions: the simulated-deposit truth is IN the schema.
    expect(reserve.description).toMatch(/SIMULATED/);
  });

  test('a bare tools/call works without initialize (the widget fetch bridge)', async () => {
    wireDb();
    const res = await call('get_company_info');
    expect(res.status).toBe(200);
    expect(toolPayload(res).name).toBe('Acme Van Lines');
  });
});

// ── Leak-proofing ────────────────────────────────────────────────────────────

describe('unknown/inactive token', () => {
  test('JSON-RPC error, no company data, no tool execution', async () => {
    wireDb({ company: null });
    const res = await call('get_company_info', {}, 7);
    // The lookup filters on is_active = TRUE, so unknown and inactive are
    // THE SAME null — one code path, indistinguishable by construction.
    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      jsonrpc: '2.0',
      error: { code: -32001, message: 'This agent link is not active. Check with the moving company for a fresh one.' },
      id: 7,
    });
    expect(JSON.stringify(res.body)).not.toMatch(/Acme|ops@acme|c0c0c0c0/);
    // Nothing beyond the company lookup ever ran.
    expect(db.one).not.toHaveBeenCalled();
    expect(mockSendMail).not.toHaveBeenCalled();
  });

  test('rate limiter is wired in front of the endpoint (and really exists)', async () => {
    wireDb();
    await call('get_company_info');
    expect(mockAgentLimiter).toHaveBeenCalled();
    const real = jest.requireActual('../../config/rateLimits');
    expect(typeof real.agentMcpLimiter).toBe('function');
  });
});

// ── get_company_info / get_intake_questions ─────────────────────────────────

describe('get_company_info', () => {
  test('name + trustBlock + paymentsMode — and nothing private', async () => {
    wireDb();
    const res = await call('get_company_info');
    const payload = toolPayload(res);
    expect(payload).toEqual({ name: 'Acme Van Lines', trustBlock: TRUST_BLOCK, paymentsMode: 'simulated' });
    const text = res.body.result.content[0].text;
    expect(text).not.toMatch(/ops@acme|contact_email|c0c0c0c0/);
  });
});

describe('get_intake_questions', () => {
  test('full battery with no knownAnswers', async () => {
    wireDb();
    const res = await call('get_intake_questions');
    const { questions } = toolPayload(res);
    const ids = questions.map((q) => q.id);
    expect(ids).toEqual(expect.arrayContaining(['bedrooms', 'originAddress', 'destinationAddress', 'moveDate']));
  });

  test('knownAnswers filter: answered questions drop out, junk keys are ignored', async () => {
    wireDb();
    const res = await call('get_intake_questions', {
      knownAnswers: { bedrooms: '2', originAddress: 'Oakland, CA', hacker: 'ignored' },
    });
    const { questions, known } = toolPayload(res);
    const ids = questions.map((q) => q.id);
    expect(ids).not.toContain('bedrooms');
    expect(ids).not.toContain('originAddress');
    expect(ids).toContain('destinationAddress');
    expect(known).toEqual({ bedrooms: '2', originAddress: 'Oakland, CA' });
  });
});

// ── price_quote ──────────────────────────────────────────────────────────────

describe('price_quote', () => {
  test('TRUST-BLOCK INVARIANT through MCP: incomplete block ⇒ tool error, no price, no persist, no email', async () => {
    wireDb({ trustBlock: { legalName: 'Acme', dba: 'Acme' } });
    const res = await call('price_quote', { answers: ANSWERS_2BR, customerEmail: 'customer@example.com' });
    expect(res.status).toBe(200); // tool-level error, not protocol-level
    expect(res.body.result.isError).toBe(true);
    const detail = toolPayload(res);
    expect(detail.code).toBe('trust_block_incomplete');
    expect(detail.error).toMatch(/trust block/i);
    expect(detail.missing).toEqual(expect.arrayContaining(['stateLicense', 'usDot', 'liabilityPerLb']));
    // NEVER a bare price, in any corner of the result:
    expect(res.body.result.content[0].text).not.toMatch(/rangeLow|1151|1494/);
    const inserts = db.one.mock.calls.filter(([sql]) => /INSERT INTO intake_quotes/.test(sql));
    expect(inserts).toHaveLength(0);
    expect(mockSendMail).not.toHaveBeenCalled();
  });

  test('happy path: vendor-card price + trust block; session-less persist carries the customer email', async () => {
    wireDb();
    const res = await call('price_quote', { answers: ANSWERS_2BR, customerEmail: 'Customer@Example.com' });
    const payload = toolPayload(res);
    expect(res.body.result.isError).toBeUndefined();
    expect(payload.quoteId).toBe(QUOTE_ID);
    expect(payload.company).toEqual({ name: 'Acme Van Lines' });
    expect(payload.rangeLow).toBe(1151);
    expect(payload.rangeHigh).toBe(1494);
    expect(payload.nte).toBe(1718);
    expect(payload.deposit).toEqual({ amount: 200, refundWindowDays: 3 });
    expect(payload.trustBlock).toEqual(TRUST_BLOCK); // rides on EVERY quote

    // Persisted session-less: capture_session_id NULL, email inside inputs,
    // and the stored inputs still replay to the stored outputs (PRD R8).
    const [sql, params] = db.one.mock.calls.find(([q]) => /INSERT INTO intake_quotes/.test(q));
    expect(sql).toMatch(/capture_session_id/);
    expect(params[1]).toBeNull();
    expect(params[2]).toBe(3);
    expect(params[3]).toBe(engine.ENGINE_VERSION);
    const storedInputs = JSON.parse(params[4]);
    expect(storedInputs.customerEmail).toBe('customer@example.com'); // lowercased
    expect(engine.computeQuote(storedInputs)).toEqual(JSON.parse(params[5]));

    // The vendor gets the priced-lead email; raw card never leaves the server.
    expect(mockSendMail).toHaveBeenCalledTimes(1);
    expect(mockSendMail.mock.calls[0][0].to).toBe('ops@acme.test');
    expect(mockSendMail.mock.calls[0][0].subject).toBe('Priced lead: $1,151–$1,494 — customer@example.com');
    expect(res.body.result.content[0].text).not.toMatch(/hourlyByCrew|maxQuoteWithoutReview|reviewFlagItems/);
  });

  test('depositPct wins over flat depositAmount: 10% of the $1,151 low = $115', async () => {
    wireDb({ rateCard: { version: 4, data: { ...CARD, depositPct: 10 } } });
    const res = await call('price_quote', { answers: ANSWERS_2BR, customerEmail: 'customer@example.com' });
    const payload = toolPayload(res);
    expect(payload.rangeLow).toBe(1151);
    expect(payload.deposit.amount).toBe(115); // round(1151 × 0.10), NOT the flat 200
  });

  test('missing/invalid customerEmail is a tool error before any pricing', async () => {
    wireDb();
    const res = await call('price_quote', { answers: ANSWERS_2BR, customerEmail: 'not-an-email' });
    expect(res.body.result.isError).toBe(true);
    expect(toolPayload(res).error).toMatch(/customerEmail/);
    expect(db.one).not.toHaveBeenCalled();
  });

  test('no active rate card ⇒ honest tool error', async () => {
    wireDb({ rateCard: null });
    const res = await call('price_quote', { answers: ANSWERS_2BR, customerEmail: 'customer@example.com' });
    expect(res.body.result.isError).toBe(true);
    expect(toolPayload(res).code).toBe('no_rate_card');
  });
});

// ── reserve_booking ──────────────────────────────────────────────────────────

const QUOTE_ROW = {
  id: QUOTE_ID,
  company_id: COMPANY_ID,
  capture_session_id: null,
  outputs: { rangeLow: 1151, rangeHigh: 1494, nte: 1718, deposit: { amount: 115, refundWindowDays: 3 } },
  company_name: 'Acme Van Lines',
  company_contact_email: 'ops@acme.test',
  company_is_active: true,
  payments_mode: 'simulated',
};

const RESERVATION_ROW = {
  id: RESERVATION_ID,
  status: 'pending_confirmation',
  customer_email: 'customer@example.com',
  requested_date: '2026-10-15',
  deposit_amount: 115,
  deposit_simulated: true,
  expires_at: '2026-09-27T00:00:00Z',
  confirmed_at: null,
  declined_at: null,
  created_at: '2026-09-26T00:00:00Z',
};

describe('reserve_booking', () => {
  test('happy path: pending_confirmation + 24h window + simulated-deposit truth-in-copy + both emails', async () => {
    wireDb({ quoteRow: QUOTE_ROW, reservationRow: RESERVATION_ROW });
    const res = await call('reserve_booking', {
      quoteId: QUOTE_ID,
      requestedDate: '2026-10-15',
      customerEmail: 'customer@example.com',
    });
    const payload = toolPayload(res);
    expect(res.body.result.isError).toBeUndefined();
    expect(payload.reservationId).toBe(RESERVATION_ID);
    expect(payload.status).toBe('pending_confirmation');
    expect(payload.requestedDate).toBe('2026-10-15');
    expect(payload.expiresAt).toBe('2026-09-27T00:00:00Z');
    expect(payload.company).toEqual({ name: 'Acme Van Lines' });
    expect(payload.quote).toEqual({ id: QUOTE_ID, rangeLow: 1151, rangeHigh: 1494, nte: 1718 });
    // Truth in copy: the deposit says SIMULATED, out loud.
    expect(payload.deposit.amount).toBe(115);
    expect(payload.deposit.simulated).toBe(true);
    expect(payload.deposit.note).toMatch(/SIMULATED — no real charge/);

    // INSERT carries the quote's own deposit + the 24h window.
    const [sql, params] = db.one.mock.calls.find(([q]) => /INSERT INTO booking_reservations/.test(q));
    expect(sql).toMatch(/INTERVAL '24 hours'/);
    expect(sql).toMatch(/'pending_confirmation'/);
    expect(params).toEqual([COMPANY_ID, QUOTE_ID, null, 'customer@example.com', '2026-10-15', 115]);

    // Vendor email: the spec'd subject line. Customer email: honest reserve copy.
    expect(mockSendMail).toHaveBeenCalledTimes(2);
    const [vendorMail, customerMail] = mockSendMail.mock.calls.map((c) => c[0]);
    expect(vendorMail.to).toBe('ops@acme.test');
    expect(vendorMail.subject).toBe('Reservation to confirm: $1,151–$1,494, 2026-10-15 — respond within 24 hours');
    expect(vendorMail.text).toMatch(/SIMULATED/);
    expect(customerMail.to).toBe('customer@example.com');
    expect(customerMail.subject).toBe('Reserved pending confirmation — Acme Van Lines has 24 hours to confirm');
    expect(customerMail.text).toMatch(/NO charge has been made/);
  });

  test("another company's quoteId is indistinguishable from a missing one", async () => {
    wireDb({ quoteRow: { ...QUOTE_ROW, company_id: 'someone-else' } });
    const res = await call('reserve_booking', {
      quoteId: QUOTE_ID,
      requestedDate: '2026-10-15',
      customerEmail: 'customer@example.com',
    });
    expect(res.body.result.isError).toBe(true);
    const detail = toolPayload(res);
    expect(detail.code).toBe('quote_not_found');
    expect(res.body.result.content[0].text).not.toMatch(/someone-else|1151/);
    expect(db.one).not.toHaveBeenCalled(); // nothing inserted
    expect(mockSendMail).not.toHaveBeenCalled();
  });

  test('garbage date / email fail loudly before touching the quote', async () => {
    wireDb({ quoteRow: QUOTE_ROW });
    const badDate = await call('reserve_booking', {
      quoteId: QUOTE_ID, requestedDate: 'next tuesday', customerEmail: 'customer@example.com',
    });
    expect(badDate.body.result.isError).toBe(true);
    expect(toolPayload(badDate).error).toMatch(/YYYY-MM-DD/);

    const badEmail = await call('reserve_booking', {
      quoteId: QUOTE_ID, requestedDate: '2026-10-15', customerEmail: 'nope',
    });
    expect(badEmail.body.result.isError).toBe(true);
    expect(db.oneOrNone).not.toHaveBeenCalledWith(expect.stringMatching(/FROM intake_quotes/), expect.anything());
  });

  test('mail failure never fails the reservation', async () => {
    wireDb({ quoteRow: QUOTE_ROW, reservationRow: RESERVATION_ROW });
    mockSendMail.mockRejectedValue(new Error('smtp down'));
    const res = await call('reserve_booking', {
      quoteId: QUOTE_ID, requestedDate: '2026-10-15', customerEmail: 'customer@example.com',
    });
    expect(res.body.result.isError).toBeUndefined();
    expect(toolPayload(res).reservationId).toBe(RESERVATION_ID);
  });
});
