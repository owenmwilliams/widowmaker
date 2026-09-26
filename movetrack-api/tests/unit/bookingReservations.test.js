'use strict';

/**
 * Reserve-pending-confirmation bookings, vendor side (W1a, #111):
 * routes/api/companyPortal.js reservation endpoints + the intakeAgentService
 * reservation lifecycle + the engine's deposit precedence. Proves:
 *
 *   • ENGINE deposit precedence: depositPct (percent of rangeLow, rounded
 *     to whole dollars) WINS over flat depositAmount when both are present;
 *     flat still works alone; neither ⇒ 0. Determinism holds with pct cards.
 *   • GET /api/company/reservations: pending-first ordering with countdown
 *     fields, company-scoped SQL.
 *   • LAZY EXPIRY: a read that meets past-due pending rows flips them to
 *     'expired' via the conditional UPDATE and emails each customer EXACTLY
 *     once — the flip is the atomic latch, so a second read (whose UPDATE
 *     returns nothing) sends nothing.
 *   • reserve→confirm and reserve→decline: pending+unexpired-only updates,
 *     honest customer emails ("no charge has been made" / "nothing to
 *     refund"), 409s for already-settled rows, 404 for unknown/foreign ids.
 *   • Confirming a stale pending row does NOT zombie-confirm: it lazily
 *     expires (single email) and answers 409 reservation_expired.
 *
 * Portal router mounted in isolation with db/auth/nodemailer mocked and the
 * REAL intakeAgentService + engine (house pattern).
 */

jest.mock('../../services/infra/db', () => ({
  db: { any: jest.fn(), one: jest.fn(), oneOrNone: jest.fn(), none: jest.fn() },
}));

let mockCompany;
jest.mock('../../services/infra/companyAuthService', () => ({
  authenticateCompany: (req, res, next) => {
    if (!mockCompany) return res.status(401).json({ error: 'Unauthorized - Invalid token' });
    req.company = mockCompany;
    next();
  },
}));

jest.mock('../../services/inventory/shareService', () => ({
  createShare: jest.fn(),
  shareUrl: jest.fn((t) => `https://app.example/share/${t}`),
}));

const mockSendMail = jest.fn();
jest.mock('nodemailer', () => ({
  createTransport: jest.fn(() => ({ sendMail: mockSendMail })),
}));

const request = require('supertest');
const express = require('express');
const { db } = require('../../services/infra/db');
const engine = require('../../services/quote/intakeQuoteEngine');
const portalRouter = require('../../routes/api/companyPortal');

const COMPANY_ID = 'c0c0c0c0-1111-2222-3333-444444444444';
const RES_ID = 'e1e1e1e1-2222-3333-4444-555555555555';
const QUOTE_ID = 'f0f0f0f0-1111-2222-3333-444444444444';

const COMPANY = { id: COMPANY_ID, name: 'Acme Van Lines', contact_email: 'ops@acme.test', token: 'demo', is_active: true };

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/company', portalRouter);
  return app;
}

const EXPIRE_RE = /UPDATE booking_reservations\s+SET status = 'expired'/;
const LIST_RE = /FROM booking_reservations br/;
const SETTLE_RE = /SET status = '(confirmed|declined)'/;
const EXISTS_RE = /SELECT id, status, expires_at FROM booking_reservations/;

function pendingRow(overrides = {}) {
  return {
    id: RES_ID,
    intake_quote_id: QUOTE_ID,
    customer_email: 'customer@example.com',
    requested_date: '2026-10-15',
    deposit_amount: '115.00', // numeric comes back as a string from pg
    deposit_simulated: true,
    status: 'pending_confirmation',
    expires_at: new Date(Date.now() + 20 * 3600 * 1000).toISOString(),
    confirmed_at: null,
    declined_at: null,
    created_at: '2026-09-26T00:00:00Z',
    quote_outputs: { rangeLow: 1151, rangeHigh: 1494, nte: 1718 },
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockCompany = COMPANY;
  mockSendMail.mockResolvedValue({ accepted: ['x'] });
  process.env.SMTP_USER = 'apikey';
  process.env.SMTP_PASS = 'test-smtp-pass';
});

afterAll(() => {
  delete process.env.SMTP_USER;
  delete process.env.SMTP_PASS;
});

// ── Engine: deposit precedence (depositPct vs depositAmount) ────────────────

describe('intakeQuoteEngine deposit precedence (#111)', () => {
  test('depositFromCard: pct wins, flat is the fallback, neither ⇒ 0, dollars are whole', () => {
    expect(engine.depositFromCard({ depositPct: 10, depositAmount: 200 }, 1151)).toBe(115);
    expect(engine.depositFromCard({ depositPct: 10 }, 1151)).toBe(115);
    expect(engine.depositFromCard({ depositAmount: 200 }, 1151)).toBe(200);
    expect(engine.depositFromCard({}, 1151)).toBe(0);
    expect(engine.depositFromCard(null, 1151)).toBe(0);
    // Rounding to whole dollars: 12.5% of $999 = $124.875 → $125.
    expect(engine.depositFromCard({ depositPct: 12.5 }, 999)).toBe(125);
    // Junk pct falls back to flat.
    expect(engine.depositFromCard({ depositPct: 'lots', depositAmount: 50 }, 1000)).toBe(50);
  });

  test('computeQuote carries the pct deposit and stays deterministic', () => {
    const card = {
      hourlyByCrew: { 2: 169, 3: 229, 4: 289 },
      minHours: 4,
      billingIncrementMin: 30,
      travelRule: { type: 'double_drive_time', flatFee: 0 },
      truckFee: 45,
      surcharges: { stairsPerFlight: 75, longCarry: 100, heavyItem: 150 },
      packingAddon: 350,
      depositPct: 10,
      depositAmount: 200,
      refundWindowDays: 3,
      nteMarginPct: 15,
      maxQuoteWithoutReview: 4000,
      reviewFlagItems: ['piano'],
    };
    const inputs = {
      answers: { bedrooms: '2', stairsOrigin: '1', stairsDestination: 'none', parking: 'right_outside', packing: 'no' },
      items: [],
      distance: null,
      rateCard: { version: 4, data: card },
    };
    const out = engine.computeQuote(inputs);
    expect(out.rangeLow).toBe(1151); // the #108 fixture is unchanged by deposit shape
    expect(out.deposit).toEqual({ amount: 115, refundWindowDays: 3 });
    // Reproducible from a JSON round-trip, pct card included (PRD R8).
    expect(engine.computeQuote(JSON.parse(JSON.stringify(inputs)))).toEqual(out);
  });
});

// ── GET /api/company/reservations ────────────────────────────────────────────

describe('GET /api/company/reservations', () => {
  test('requires a company session', async () => {
    mockCompany = null;
    const res = await request(makeApp()).get('/api/company/reservations');
    expect(res.status).toBe(401);
  });

  test('lists pending-first with countdown fields, company-scoped', async () => {
    const rows = [pendingRow(), pendingRow({
      id: 'a2a2a2a2-2222-3333-4444-555555555555',
      status: 'confirmed',
      confirmed_at: '2026-09-25T12:00:00Z',
      deposit_amount: null,
    })];
    db.any.mockImplementation(async (sql, params) => {
      if (EXPIRE_RE.test(sql)) { expect(params).toEqual([COMPANY_ID]); return []; }
      if (LIST_RE.test(sql)) {
        expect(params).toEqual([COMPANY_ID]);
        expect(sql).toMatch(/ORDER BY \(br\.status = 'pending_confirmation'\) DESC/);
        return rows;
      }
      throw new Error(`unexpected any: ${sql}`);
    });

    const res = await request(makeApp()).get('/api/company/reservations');
    expect(res.status).toBe(200);
    const [pending, confirmed] = res.body.reservations;
    expect(pending.id).toBe(RES_ID);
    expect(pending.status).toBe('pending_confirmation');
    expect(pending.requestedDate).toBe('2026-10-15');
    expect(pending.depositAmount).toBe(115);
    expect(pending.depositSimulated).toBe(true);
    expect(pending.quote).toEqual({ rangeLow: 1151, rangeHigh: 1494, nte: 1718 });
    // Countdown: ~20h left, and only for pending rows.
    expect(pending.expiresInSeconds).toBeGreaterThan(19 * 3600);
    expect(pending.expiresInSeconds).toBeLessThanOrEqual(20 * 3600);
    expect(confirmed.status).toBe('confirmed');
    expect(confirmed.expiresInSeconds).toBeNull();
    expect(confirmed.depositAmount).toBeNull();
  });

  test('LAZY EXPIRY: past-due pending rows are flipped on read and each customer is emailed once', async () => {
    let flippedOnce = false;
    db.any.mockImplementation(async (sql) => {
      if (EXPIRE_RE.test(sql)) {
        // The conditional UPDATE only returns rows it flipped; after the
        // first read they are 'expired' and never match again.
        if (flippedOnce) return [];
        flippedOnce = true;
        return [{ id: RES_ID, customer_email: 'customer@example.com', requested_date: '2026-10-15', deposit_amount: '115.00' }];
      }
      if (LIST_RE.test(sql)) return [];
      throw new Error(`unexpected any: ${sql}`);
    });

    const first = await request(makeApp()).get('/api/company/reservations');
    expect(first.status).toBe(200);
    expect(mockSendMail).toHaveBeenCalledTimes(1);
    const mail = mockSendMail.mock.calls[0][0];
    expect(mail.to).toBe('customer@example.com');
    expect(mail.subject).toBe('Your reservation with Acme Van Lines expired');
    expect(mail.text).toMatch(/didn't confirm your reservation within 24 hours/);
    expect(mail.text).toMatch(/no charge has been made/i);

    // Second read: UPDATE matches nothing ⇒ no second email. Single-send
    // comes from the atomic flip, not from bookkeeping.
    const second = await request(makeApp()).get('/api/company/reservations');
    expect(second.status).toBe(200);
    expect(mockSendMail).toHaveBeenCalledTimes(1);
  });

  test('expiry email failure never fails the read (row stays flipped)', async () => {
    mockSendMail.mockRejectedValue(new Error('smtp down'));
    db.any.mockImplementation(async (sql) => {
      if (EXPIRE_RE.test(sql)) return [{ id: RES_ID, customer_email: 'c@example.com', requested_date: '2026-10-15', deposit_amount: null }];
      if (LIST_RE.test(sql)) return [];
      throw new Error(`unexpected any: ${sql}`);
    });
    const res = await request(makeApp()).get('/api/company/reservations');
    expect(res.status).toBe(200);
  });
});

// ── Confirm / decline ────────────────────────────────────────────────────────

function wireSettle({ updated = null, existing = null, flipped = [] } = {}) {
  db.oneOrNone.mockImplementation(async (sql, params) => {
    if (SETTLE_RE.test(sql)) {
      expect(sql).toMatch(/status = 'pending_confirmation' AND expires_at > NOW\(\)/);
      expect(params).toEqual([RES_ID, COMPANY_ID]); // company-scoped, always
      return updated;
    }
    if (EXISTS_RE.test(sql)) { expect(params).toEqual([RES_ID, COMPANY_ID]); return existing; }
    throw new Error(`unexpected oneOrNone: ${sql}`);
  });
  db.any.mockImplementation(async (sql) => {
    if (EXPIRE_RE.test(sql)) return flipped;
    throw new Error(`unexpected any: ${sql}`);
  });
}

describe('POST /api/company/reservations/:id/confirm', () => {
  test('reserve→confirm: pending+unexpired row settles, customer gets the honest confirmation', async () => {
    wireSettle({
      updated: { ...pendingRow(), status: 'confirmed', confirmed_at: '2026-09-26T10:00:00Z' },
    });
    const res = await request(makeApp()).post(`/api/company/reservations/${RES_ID}/confirm`);
    expect(res.status).toBe(200);
    expect(res.body.reservation.status).toBe('confirmed');
    expect(res.body.reservation.confirmedAt).toBe('2026-09-26T10:00:00Z');
    expect(res.body.reservation.deposit.simulated).toBe(true);

    expect(mockSendMail).toHaveBeenCalledTimes(1);
    const mail = mockSendMail.mock.calls[0][0];
    expect(mail.to).toBe('customer@example.com');
    expect(mail.subject).toBe('Acme Van Lines confirmed your move — 2026-10-15');
    expect(mail.text).toMatch(/simulated in demo mode — no charge has been made/);
  });

  test('already declined ⇒ 409 reservation_not_pending, no email', async () => {
    wireSettle({ existing: { id: RES_ID, status: 'declined', expires_at: '2026-09-25T00:00:00Z' } });
    const res = await request(makeApp()).post(`/api/company/reservations/${RES_ID}/confirm`);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('reservation_not_pending');
    expect(res.body.error).toMatch(/already declined/);
    expect(mockSendMail).not.toHaveBeenCalled();
  });

  test('stale pending row: confirm at hour 25 lazily expires it (single expiry email) and answers 409', async () => {
    wireSettle({
      existing: { id: RES_ID, status: 'pending_confirmation', expires_at: '2026-09-25T00:00:00Z' },
      flipped: [{ id: RES_ID, customer_email: 'customer@example.com', requested_date: '2026-10-15', deposit_amount: '115.00' }],
    });
    const res = await request(makeApp()).post(`/api/company/reservations/${RES_ID}/confirm`);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('reservation_expired');
    expect(res.body.error).toMatch(/24-hour window has passed/);
    // Exactly ONE email: the customer's expiry notice — never a confirmation.
    expect(mockSendMail).toHaveBeenCalledTimes(1);
    expect(mockSendMail.mock.calls[0][0].subject).toBe('Your reservation with Acme Van Lines expired');
  });

  test('unknown or foreign id ⇒ 404; garbage id never touches the db', async () => {
    wireSettle({});
    const res = await request(makeApp()).post(`/api/company/reservations/${RES_ID}/confirm`);
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('reservation_not_found');

    jest.clearAllMocks();
    const garbage = await request(makeApp()).post('/api/company/reservations/not-a-uuid/confirm');
    expect(garbage.status).toBe(404);
    expect(db.oneOrNone).not.toHaveBeenCalled();
  });
});

describe('POST /api/company/reservations/:id/decline', () => {
  test('reserve→decline: settles + tells the customer nothing was ever charged', async () => {
    wireSettle({
      updated: { ...pendingRow(), status: 'declined', declined_at: '2026-09-26T10:00:00Z' },
    });
    const res = await request(makeApp()).post(`/api/company/reservations/${RES_ID}/decline`);
    expect(res.status).toBe(200);
    expect(res.body.reservation.status).toBe('declined');
    expect(res.body.reservation.declinedAt).toBe('2026-09-26T10:00:00Z');

    const [sql] = db.oneOrNone.mock.calls.find(([q]) => SETTLE_RE.test(q));
    expect(sql).toMatch(/declined_at = NOW\(\)/);

    expect(mockSendMail).toHaveBeenCalledTimes(1);
    const mail = mockSendMail.mock.calls[0][0];
    expect(mail.subject).toBe("Acme Van Lines can't take your move on 2026-10-15");
    expect(mail.text).toMatch(/No charge was ever made, so there is nothing to refund/);
  });

  test('settle email failure never fails the decline (status is saved)', async () => {
    wireSettle({ updated: { ...pendingRow(), status: 'declined', declined_at: '2026-09-26T10:00:00Z' } });
    mockSendMail.mockRejectedValue(new Error('smtp down'));
    const res = await request(makeApp()).post(`/api/company/reservations/${RES_ID}/decline`);
    expect(res.status).toBe(200);
    expect(res.body.reservation.status).toBe('declined');
  });
});
