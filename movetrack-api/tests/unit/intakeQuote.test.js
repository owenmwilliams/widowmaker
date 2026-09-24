'use strict';

/**
 * Agentic intake Mode A (#107): the vendor-priced quote engine + the
 * /api/capture intake endpoints. Proves:
 *
 *   • ENGINE determinism + reproducibility (PRD R8): the same inputs object
 *     (answers + inventory + distance + rate-card snapshot) produces
 *     byte-identical outputs, including engine/card versions — and re-running
 *     the engine on a JSON round-trip of stored inputs reproduces the stored
 *     outputs exactly.
 *   • Crew/hours/fees/NTE math against hand-computed fixtures (Q&A-only 2BR
 *     path and the scanned-inventory path).
 *   • Review-flag routing: a piano answer or a flagged scanned item (gun
 *     safe) ⇒ status 'review_required' with honest estimator copy; totals
 *     over maxQuoteWithoutReview and long-distance moves flag too.
 *   • R2 question filtering: rooms scanned ⇒ no home-size question; origin
 *     on file ⇒ no origin question.
 *   • TRUST-BLOCK INVARIANT: an incomplete block is a 409 with admin-facing
 *     copy and NOTHING is priced or persisted — the API never returns a bare
 *     price. A complete block rides on every quote payload.
 *   • The quote persists with rate_card_version + engine_version and the
 *     company is emailed the "Priced lead: $X–$Y — {email}" notification.
 *
 * Router mounted in isolation with db/auth/services mocked and the REAL
 * engine (companyCapture.test.js pattern).
 */

jest.mock('../../services/infra/db', () => ({
  db: { any: jest.fn(), one: jest.fn(), oneOrNone: jest.fn(), none: jest.fn(), result: jest.fn() },
}));

let mockUser;
jest.mock('../../services/infra/authService', () => {
  const jwt = require('jsonwebtoken');
  const SECRET = 'test-intake-secret';
  return {
    authenticate: (req, res, next) => {
      if (!mockUser) return res.status(401).json({ error: 'Unauthorized' });
      req.user = mockUser;
      next();
    },
    signGuestCaptureToken: ({ captureSessionId, userId }) =>
      jwt.sign({ captureSessionId, userId, guest: true }, SECRET, { expiresIn: '30d' }),
    verifyGuestCaptureToken: (token) => {
      try {
        const d = jwt.verify(token, SECRET);
        return d && d.guest === true && d.captureSessionId && d.userId ? d : null;
      } catch {
        return null;
      }
    },
  };
});

jest.mock('../../config/rateLimits', () => ({
  captureLimiter: (req, res, next) => next(),
  captureStartLimiter: (req, res, next) => next(),
}));

jest.mock('../../services/infra/mediaAssetService', () => ({ reserveUpload: jest.fn() }));
jest.mock('../../services/inventory/scanJobService', () => ({
  UUID_RE: /^[0-9a-f-]{36}$/i,
  isAllowedMediaUrl: jest.fn(),
  createJob: jest.fn(),
  getJob: jest.fn(),
  markConsumed: jest.fn(),
  toDTO: jest.fn((row) => row),
}));
jest.mock('../../services/inventory/inventoryMutationService', () => ({ addItem: jest.fn() }));
jest.mock('../../services/inventory/shareService', () => ({
  createShare: jest.fn(),
  shareUrl: jest.fn((t) => `https://app.example/share/${t}`),
}));

const mockDistance = jest.fn();
jest.mock('../../services/move/distanceService', () => ({
  calculateDrivingDistance: (...args) => mockDistance(...args),
}));

const mockSendMail = jest.fn();
jest.mock('nodemailer', () => ({
  createTransport: jest.fn(() => ({ sendMail: mockSendMail })),
}));

const request = require('supertest');
const express = require('express');
const { db } = require('../../services/infra/db');
const authService = require('../../services/infra/authService');
const engine = require('../../services/quote/intakeQuoteEngine');
const router = require('../../routes/api/companyCapture');

const BASE = '/api/capture';
const TOKEN = 'acmecompanycapturetoken';
const SESSION_ID = '11111111-2222-3333-4444-555555555555';
const GUEST_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const QUOTE_ID = 'f0f0f0f0-1111-2222-3333-444444444444';

// The seed card, verbatim — the fixtures below are hand-computed from it.
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

// Q&A-only 2BR: 700 cu ft → crew 3 @ $229; handling 700/150 = 4.6667h;
// stairs 1 flight = +0.4h; raw 5.0667h. Billed (30-min increments, 4h min):
// base ceil→5.5h, low ceil(4.3067)→4.5h, high ceil(5.8267)→6.0h.
// Labor low round(4.5×229)=1031, high 6×229=1374. Fees: truck 45 + 1×75
// stairs = 120. Range 1151–1494. NTE round(1494×1.15)=1718.
const ANSWERS_2BR = {
  bedrooms: '2',
  stairsOrigin: '1',
  stairsDestination: 'none',
  parking: 'right_outside',
  packing: 'no',
  specialItems: 'none',
};
const EXPECTED_2BR = { crew: 3, hourlyRate: 229, hoursLow: 4.5, hoursHigh: 6, rangeLow: 1151, rangeHigh: 1494, nte: 1718 };

// Scan path: sofa 84×38×34 = 62.8056 cu ft; gun safe 60×30×26 = 27.0833;
// 10 undimensioned boxes × 3 = 30 → 119.89 cu ft → crew 2 @ $169; handling
// 1.2h → everything clamps to the 4h minimum. Labor 676 flat. Fees: truck
// 45 + heavy item 150 = 195. Range 871–871, NTE round(1001.65)=1002. The
// gun safe name matches reviewFlagItems ⇒ review_required.
const SCAN_ITEMS = [
  { name: 'Sofa', quantity: 1, weightLbs: 120, lengthIn: 84, widthIn: 38, heightIn: 34 },
  { name: 'Moving box', quantity: 10, weightLbs: null, lengthIn: null, widthIn: null, heightIn: null },
  { name: 'Gun Safe', quantity: 1, weightLbs: 600, lengthIn: 60, widthIn: 30, heightIn: 26 },
];

const qaInputs = (answers = ANSWERS_2BR, extra = {}) => ({
  answers,
  items: [],
  distance: null,
  rateCard: { version: 3, data: CARD },
  ...extra,
});

// ── Engine: math fixtures ─────────────────────────────────────────────────────

describe('intakeQuoteEngine.computeQuote', () => {
  test('Q&A-only 2BR quote matches the hand-computed fixture', () => {
    const out = engine.computeQuote(qaInputs());
    expect(out.engineVersion).toBe(engine.ENGINE_VERSION);
    expect(out.rateCardVersion).toBe(3);
    expect(out.cuFt).toBe(700);
    expect(out.cuFtSource).toBe('bedrooms');
    expect(out.crew).toBe(EXPECTED_2BR.crew);
    expect(out.hourlyRate).toBe(EXPECTED_2BR.hourlyRate);
    expect(out.hours.low).toBe(EXPECTED_2BR.hoursLow);
    expect(out.hours.high).toBe(EXPECTED_2BR.hoursHigh);
    expect(out.rangeLow).toBe(EXPECTED_2BR.rangeLow);
    expect(out.rangeHigh).toBe(EXPECTED_2BR.rangeHigh);
    expect(out.nte).toBe(EXPECTED_2BR.nte);
    expect(out.deposit).toEqual({ amount: 200, refundWindowDays: 3 });
    expect(out.status).toBe('quoted');
    expect(out.reviewReasons).toEqual([]);
    // Itemized: labor + truck + stairs, nothing invented.
    expect(out.lineItems.map((li) => li.key).sort()).toEqual(['labor', 'stairs', 'truck']);
    const stairs = out.lineItems.find((li) => li.key === 'stairs');
    expect(stairs.amountLow).toBe(75);
  });

  test('scan path: inventory volume wins, heavy-item fee applies, minimum hours clamp', () => {
    const out = engine.computeQuote(qaInputs({ parking: 'right_outside' }, { items: SCAN_ITEMS }));
    expect(out.cuFtSource).toBe('inventory');
    expect(out.cuFt).toBe(119.89);
    expect(out.crew).toBe(2);
    expect(out.hours.low).toBe(4);   // 4h minimum
    expect(out.hours.high).toBe(4);
    expect(out.rangeLow).toBe(871);
    expect(out.rangeHigh).toBe(871);
    expect(out.nte).toBe(1002);
    const heavy = out.lineItems.find((li) => li.key === 'heavy_items');
    expect(heavy.amountLow).toBe(150);
    // 'Gun Safe' matches the card's flag list ⇒ estimator review.
    expect(out.status).toBe('review_required');
    expect(out.reviewReasons.join(' ')).toMatch(/estimator/i);
  });

  test('double drive time bills travel hours at the crew rate', () => {
    const out = engine.computeQuote(qaInputs(ANSWERS_2BR, { distance: { miles: 20, driveHours: 0.5 } }));
    expect(out.hours.travel).toBe(1); // 0.5h × 2 (CA double drive time)
    // raw 5.0667+1 = 6.0667 → base 6.5, low ceil(5.1567)→5.5, high ceil(6.9767)→7
    expect(out.hours.low).toBe(5.5);
    expect(out.hours.high).toBe(7);
    expect(out.status).toBe('quoted'); // 20 miles is local
  });

  test('review routing: piano answer, over-cap totals, long distance', () => {
    const piano = engine.computeQuote(qaInputs({ ...ANSWERS_2BR, specialItems: 'piano' }));
    expect(piano.status).toBe('review_required');
    expect(piano.rangeLow).toBe(EXPECTED_2BR.rangeLow); // the price still shows, honestly framed

    const big = engine.computeQuote(qaInputs({ ...ANSWERS_2BR, bedrooms: '4', packing: 'yes' }));
    // 1500 cu ft → crew 4 @ 289: high hours 10 → labor 2890 + fees (45+75+350) = 3360… under 4000
    // add long stairs to push over: 3 flights each end
    const bigger = engine.computeQuote(qaInputs({ ...ANSWERS_2BR, bedrooms: '4', packing: 'yes', stairsOrigin: '3', stairsDestination: '3' }));
    expect(bigger.rangeHigh).toBeGreaterThan(CARD.maxQuoteWithoutReview);
    expect(bigger.status).toBe('review_required');
    expect(big.status).toBe('quoted');

    const far = engine.computeQuote(qaInputs(ANSWERS_2BR, { distance: { miles: 380, driveHours: 6 } }));
    expect(far.status).toBe('review_required');
    expect(far.reviewReasons.join(' ')).toMatch(/long-distance/i);
  });

  test('deterministic: identical inputs ⇒ byte-identical outputs', () => {
    const a = engine.computeQuote(qaInputs(ANSWERS_2BR, { items: SCAN_ITEMS, distance: { miles: 12, driveHours: 0.4 } }));
    const b = engine.computeQuote(qaInputs(ANSWERS_2BR, { items: SCAN_ITEMS, distance: { miles: 12, driveHours: 0.4 } }));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  test('reproducible from stored inputs (PRD R8): JSON round-trip replays exactly', () => {
    const inputs = qaInputs(ANSWERS_2BR, { items: SCAN_ITEMS });
    const stored = JSON.parse(JSON.stringify({ inputs, outputs: engine.computeQuote(inputs) }));
    const replayed = engine.computeQuote(stored.inputs);
    expect(replayed).toEqual(stored.outputs);
    expect(replayed.engineVersion).toBe(stored.outputs.engineVersion);
    expect(replayed.rateCardVersion).toBe(stored.outputs.rateCardVersion);
  });
});

// ── Engine: R2 question filtering ────────────────────────────────────────────

describe('intakeQuoteEngine.buildQuestions (PRD R2)', () => {
  const ids = (qs) => qs.map((q) => q.id);

  test('nothing known → full battery, bedrooms first', () => {
    const qs = engine.buildQuestions({ hasInventory: false, hasOrigin: false });
    expect(ids(qs)).toEqual(expect.arrayContaining(['bedrooms', 'originAddress', 'destinationAddress', 'stairsOrigin', 'stairsDestination', 'parking', 'packing', 'specialItems', 'moveDate']));
  });

  test('rooms scanned → home-size question skipped', () => {
    const qs = engine.buildQuestions({ hasInventory: true, hasOrigin: false });
    expect(ids(qs)).not.toContain('bedrooms');
    expect(ids(qs)).toContain('originAddress');
  });

  test('origin on file → origin question skipped', () => {
    const qs = engine.buildQuestions({ hasInventory: false, hasOrigin: true });
    expect(ids(qs)).toContain('bedrooms');
    expect(ids(qs)).not.toContain('originAddress');
  });
});

// ── Routes ───────────────────────────────────────────────────────────────────

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(BASE, router);
  return app;
}

function sessionRow(overrides = {}) {
  return {
    id: SESSION_ID,
    company_id: 'co-1',
    customer_email: 'customer@example.com',
    user_id: GUEST_ID,
    status: 'active',
    consent: true,
    videos_count: 0,
    bytes_total: 0,
    expires_at: new Date(Date.now() + 86400000).toISOString(),
    company_name: 'Acme Van Lines',
    company_contact_email: 'ops@acme.test',
    company_token: TOKEN,
    company_is_active: true,
    ...overrides,
  };
}

const guestToken = () =>
  authService.signGuestCaptureToken({ captureSessionId: SESSION_ID, userId: GUEST_ID });

/**
 * Wire the db mocks for the intake endpoints.
 * @param {object} opts { trustBlock, rateCard, items, itemsCount, location }
 */
function wireDb({
  trustBlock = TRUST_BLOCK,
  rateCard = { version: 3, data: CARD },
  items = [],
  itemsCount = 0,
  location = null,
} = {}) {
  db.oneOrNone.mockImplementation(async (sql) => {
    if (/FROM company_capture_sessions s/.test(sql)) return sessionRow();
    if (/FROM rate_cards/.test(sql)) return rateCard;
    if (/FROM locations/.test(sql)) return location;
    throw new Error(`unexpected oneOrNone: ${sql}`);
  });
  db.one.mockImplementation(async (sql) => {
    if (/SELECT trust_block FROM companies/.test(sql)) return { trust_block: trustBlock };
    if (/COUNT\(\*\)::int AS n FROM items/.test(sql)) return { n: itemsCount };
    if (/INSERT INTO intake_quotes/.test(sql)) return { id: QUOTE_ID, created_at: '2026-09-24T00:00:00Z' };
    throw new Error(`unexpected one: ${sql}`);
  });
  db.any.mockImplementation(async (sql) => {
    if (/FROM items/.test(sql)) return items;
    return [];
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUser = null;
  db.none.mockResolvedValue(undefined);
  mockSendMail.mockResolvedValue({ accepted: ['x'] });
  mockDistance.mockResolvedValue(null);
  process.env.SMTP_USER = 'apikey';
  process.env.SMTP_PASS = 'test-smtp-pass';
});

afterAll(() => {
  delete process.env.SMTP_USER;
  delete process.env.SMTP_PASS;
});

describe('GET /api/capture/:companyToken/intake-questions', () => {
  test('requires a guest token', async () => {
    const res = await request(makeApp()).get(`${BASE}/${TOKEN}/intake-questions`);
    expect(res.status).toBe(401);
  });

  test('fresh session → full battery with known counts', async () => {
    wireDb();
    const res = await request(makeApp())
      .get(`${BASE}/${TOKEN}/intake-questions`)
      .set('Authorization', `Bearer ${guestToken()}`);
    expect(res.status).toBe(200);
    const ids = res.body.questions.map((q) => q.id);
    expect(ids).toContain('bedrooms');
    expect(ids).toContain('originAddress');
    expect(res.body.known).toEqual({ itemsCount: 0, origin: null });
  });

  test('R2 over the wire: scanned rooms + origin on file drop those questions', async () => {
    wireDb({ itemsCount: 14, location: { address: '1 Main St', city: 'Oakland', state: 'CA' } });
    const res = await request(makeApp())
      .get(`${BASE}/${TOKEN}/intake-questions`)
      .set('Authorization', `Bearer ${guestToken()}`);
    expect(res.status).toBe(200);
    const ids = res.body.questions.map((q) => q.id);
    expect(ids).not.toContain('bedrooms');
    expect(ids).not.toContain('originAddress');
    expect(res.body.known).toEqual({ itemsCount: 14, origin: '1 Main St, Oakland, CA' });
  });
});

describe('POST /api/capture/:companyToken/quote', () => {
  test('TRUST-BLOCK INVARIANT: incomplete block → 409, nothing priced or persisted', async () => {
    wireDb({ trustBlock: { legalName: 'Acme', dba: 'Acme' } }); // missing licenses etc.
    const res = await request(makeApp())
      .post(`${BASE}/${TOKEN}/quote`)
      .set('Authorization', `Bearer ${guestToken()}`)
      .send({ answers: ANSWERS_2BR });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/trust block/i);
    expect(res.body.missing).toEqual(expect.arrayContaining(['stateLicense', 'usDot', 'liabilityPerLb']));
    // NEVER a bare price:
    expect(res.body.rangeLow).toBeUndefined();
    expect(res.body.rangeHigh).toBeUndefined();
    const insertCalls = db.one.mock.calls.filter(([sql]) => /INSERT INTO intake_quotes/.test(sql));
    expect(insertCalls).toHaveLength(0);
    expect(mockSendMail).not.toHaveBeenCalled();
  });

  test('null trust block (never configured) → same 409 gate', async () => {
    wireDb({ trustBlock: null });
    const res = await request(makeApp())
      .post(`${BASE}/${TOKEN}/quote`)
      .set('Authorization', `Bearer ${guestToken()}`)
      .send({ answers: ANSWERS_2BR });
    expect(res.status).toBe(409);
  });

  test('no active rate card → 409 with admin-facing copy', async () => {
    wireDb({ rateCard: null });
    const res = await request(makeApp())
      .post(`${BASE}/${TOKEN}/quote`)
      .set('Authorization', `Bearer ${guestToken()}`)
      .send({ answers: ANSWERS_2BR });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/rate card/i);
  });

  test('happy path: prices from the vendor card, persists with versions, emails the priced lead', async () => {
    wireDb();
    const res = await request(makeApp())
      .post(`${BASE}/${TOKEN}/quote`)
      .set('Authorization', `Bearer ${guestToken()}`)
      .send({ answers: ANSWERS_2BR });

    expect(res.status).toBe(201);
    expect(res.body.quoteId).toBe(QUOTE_ID);
    expect(res.body.company).toEqual({ name: 'Acme Van Lines' });
    expect(res.body.rangeLow).toBe(EXPECTED_2BR.rangeLow);
    expect(res.body.rangeHigh).toBe(EXPECTED_2BR.rangeHigh);
    expect(res.body.nte).toBe(EXPECTED_2BR.nte);
    expect(res.body.status).toBe('quoted');
    expect(res.body.trustBlock).toEqual(TRUST_BLOCK); // the block rides on EVERY quote

    // Persisted with the exact versions used (PRD R8).
    const [sql, params] = db.one.mock.calls.find(([q]) => /INSERT INTO intake_quotes/.test(q));
    expect(sql).toMatch(/rate_card_version/);
    expect(params[2]).toBe(3);                       // rate_card_version
    expect(params[3]).toBe(engine.ENGINE_VERSION);   // engine_version
    const storedInputs = JSON.parse(params[4]);
    const storedOutputs = JSON.parse(params[5]);
    expect(engine.computeQuote(storedInputs)).toEqual(storedOutputs); // reproducible as stored
    expect(params[6]).toBe('quoted');

    // Company notification: "Priced lead: $X–$Y — {email}".
    expect(mockSendMail).toHaveBeenCalledTimes(1);
    expect(mockSendMail.mock.calls[0][0].to).toBe('ops@acme.test');
    expect(mockSendMail.mock.calls[0][0].subject).toBe('Priced lead: $1,151–$1,494 — customer@example.com');
  });

  test('piano ⇒ review_required over the wire, honest copy, trust block still attached', async () => {
    wireDb();
    const res = await request(makeApp())
      .post(`${BASE}/${TOKEN}/quote`)
      .set('Authorization', `Bearer ${guestToken()}`)
      .send({ answers: { ...ANSWERS_2BR, specialItems: 'piano' } });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('review_required');
    expect(res.body.reviewReasons.join(' ')).toMatch(/estimator/i);
    expect(res.body.trustBlock).toEqual(TRUST_BLOCK);
    const [, params] = db.one.mock.calls.find(([q]) => /INSERT INTO intake_quotes/.test(q));
    expect(params[6]).toBe('review_required');
  });

  test('scanned inventory prices the scan path and a flagged item routes to review', async () => {
    wireDb({
      items: [
        { name: 'Sofa', quantity: 1, weight_lbs: 120, length_in: 84, width_in: 38, height_in: 34 },
        { name: 'Moving box', quantity: 10, weight_lbs: null, length_in: null, width_in: null, height_in: null },
        { name: 'Gun Safe', quantity: 1, weight_lbs: 600, length_in: 60, width_in: 30, height_in: 26 },
      ],
      itemsCount: 12,
    });
    const res = await request(makeApp())
      .post(`${BASE}/${TOKEN}/quote`)
      .set('Authorization', `Bearer ${guestToken()}`)
      .send({ answers: { stairsOrigin: 'none', stairsDestination: 'none', parking: 'right_outside', packing: 'no' } });
    expect(res.status).toBe(201);
    expect(res.body.cuFtSource).toBe('inventory');
    expect(res.body.rangeLow).toBe(871);
    expect(res.body.rangeHigh).toBe(871);
    expect(res.body.status).toBe('review_required'); // gun safe
  });

  test('mail failure never fails the quote', async () => {
    wireDb();
    mockSendMail.mockRejectedValue(new Error('smtp down'));
    const res = await request(makeApp())
      .post(`${BASE}/${TOKEN}/quote`)
      .set('Authorization', `Bearer ${guestToken()}`)
      .send({ answers: ANSWERS_2BR });
    expect(res.status).toBe(201);
    expect(res.body.rangeLow).toBe(EXPECTED_2BR.rangeLow);
  });
});
