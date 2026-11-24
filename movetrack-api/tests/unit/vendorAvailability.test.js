'use strict';

/**
 * vendorAvailabilityService (W1c, #117) — the deterministic Mode B-lite
 * calendar behind check_availability on BOTH agent surfaces (MCP tool +
 * converse brain). Proves the math the copy relies on:
 *
 *   • capacity: pending_confirmation AND confirmed reservations both hold a
 *     slot; a date at capacity is closed (declined/expired never counted —
 *     the SQL filter is asserted);
 *   • blackout days and past dates are never open — and never proposed;
 *   • alternatives: ≤3, nearest-first, FORWARD-WEIGHTED (+1 before -1),
 *     preferring the ±7 window and walking forward when it's dry;
 *   • malformed dates are an IntakeAgentError('invalid_input'), never a
 *     stack trace to the public internet.
 */

jest.mock('../../services/infra/db', () => ({
  db: { any: jest.fn(), one: jest.fn(), oneOrNone: jest.fn(), none: jest.fn() },
}));

const { db } = require('../../services/infra/db');
const { checkAvailability, MAX_ALTERNATIVES } = require('../../services/quote/vendorAvailabilityService');
const { IntakeAgentError } = require('../../services/quote/intakeAgentService');

const COMPANY_ID = 'c0c0c0c0-1111-2222-3333-444444444444';
const TODAY = '2026-09-26';

/** Wire the two reads: the company knobs + the booked-per-day counts. */
function wire({ capacity = 2, blackouts = [], booked = {} } = {}) {
  db.oneOrNone.mockImplementation(async (sql, params) => {
    if (/SELECT capacity_per_day, blackout_days FROM companies/.test(sql)) {
      return params[0] === COMPANY_ID
        ? { capacity_per_day: capacity, blackout_days: blackouts }
        : null;
    }
    throw new Error(`unexpected oneOrNone: ${sql}`);
  });
  db.any.mockImplementation(async (sql, params) => {
    expect(sql).toMatch(/status = 'confirmed'\s+OR \(status = 'pending_confirmation' AND expires_at > NOW\(\)\)/);
    const [, start, end] = params;
    return Object.entries(booked)
      .filter(([day]) => day >= start && day <= end)
      .map(([day, n]) => ({ day, booked: n }));
  });
}

beforeEach(() => jest.clearAllMocks());

describe('checkAvailability — the requested date', () => {
  test('open when under capacity, with alternatives rounded out anyway', async () => {
    wire({ capacity: 2, booked: { '2026-10-15': 1 } });
    const r = await checkAvailability(COMPANY_ID, '2026-10-15', { today: TODAY });
    expect(r.requestedDateOpen).toBe(true);
    expect(r.reason).toBeNull();
    expect(r.capacityPerDay).toBe(2);
    expect(r.alternatives).toHaveLength(MAX_ALTERNATIVES);
    expect(r.alternatives).not.toContain('2026-10-15'); // alternatives ≠ the day itself
  });

  test('pending + confirmed together fill the day: 1+1 against capacity 2 ⇒ fully_booked', async () => {
    // The GROUP BY count arrives summed — 2 holds on the day.
    wire({ capacity: 2, booked: { '2026-10-15': 2 } });
    const r = await checkAvailability(COMPANY_ID, '2026-10-15', { today: TODAY });
    expect(r.requestedDateOpen).toBe(false);
    expect(r.reason).toBe('fully_booked');
  });

  test('blackout day is closed even with zero bookings', async () => {
    wire({ blackouts: ['2026-10-15'] });
    const r = await checkAvailability(COMPANY_ID, '2026-10-15', { today: TODAY });
    expect(r.requestedDateOpen).toBe(false);
    expect(r.reason).toBe('blackout');
  });

  test('past dates (and today itself) are closed', async () => {
    wire({});
    const past = await checkAvailability(COMPANY_ID, '2026-09-20', { today: TODAY });
    expect(past.requestedDateOpen).toBe(false);
    expect(past.reason).toBe('past_date');

    const sameDay = await checkAvailability(COMPANY_ID, TODAY, { today: TODAY });
    expect(sameDay.requestedDateOpen).toBe(false);
    expect(sameDay.reason).toBe('past_date');
  });

  test('malformed date is an honest invalid_input error', async () => {
    wire({});
    await expect(checkAvailability(COMPANY_ID, 'next tuesday', { today: TODAY }))
      .rejects.toThrow(IntakeAgentError);
    await expect(checkAvailability(COMPANY_ID, '2026-02-30', { today: TODAY }))
      .rejects.toMatchObject({ code: 'invalid_input' });
    expect(db.any).not.toHaveBeenCalled();
  });
});

describe('checkAvailability — alternative days', () => {
  test('nearest-first and forward-weighted: +1, -1, +2 around a full day', async () => {
    wire({ capacity: 1, booked: { '2026-10-15': 1 } });
    const r = await checkAvailability(COMPANY_ID, '2026-10-15', { today: TODAY });
    expect(r.requestedDateOpen).toBe(false);
    expect(r.alternatives).toEqual(['2026-10-16', '2026-10-14', '2026-10-17']);
  });

  test('closed neighbours are skipped: blackouts and full days never proposed', async () => {
    wire({
      capacity: 1,
      blackouts: ['2026-10-16'],                    // +1 blacked out
      booked: { '2026-10-15': 1, '2026-10-14': 1 }, // requested + -1 full
    });
    const r = await checkAvailability(COMPANY_ID, '2026-10-15', { today: TODAY });
    expect(r.alternatives).toEqual(['2026-10-17', '2026-10-13', '2026-10-18']);
  });

  test('past days are never proposed even inside the ±7 window', async () => {
    // Requested 2 days out and full — the -window days ≤ today must not appear.
    wire({ capacity: 1, booked: { '2026-09-28': 1 } });
    const r = await checkAvailability(COMPANY_ID, '2026-09-28', { today: TODAY });
    expect(r.alternatives).toEqual(['2026-09-29', '2026-09-27', '2026-09-30']);
    for (const d of r.alternatives) expect(d > TODAY).toBe(true);
  });

  test('a dry ±7 window extends FORWARD only (never further back)', async () => {
    // Everything from -7 to +7 is full; the walk continues at +8.
    const booked = {};
    for (let d = 8; d <= 22; d++) booked[`2026-10-${String(d).padStart(2, '0')}`] = 1;
    wire({ capacity: 1, booked });
    const r = await checkAvailability(COMPANY_ID, '2026-10-15', { today: TODAY });
    expect(r.alternatives).toEqual(['2026-10-23', '2026-10-24', '2026-10-25']);
  });

  test('never more than 3 proposals', async () => {
    wire({ capacity: 5 });
    const r = await checkAvailability(COMPANY_ID, '2026-10-15', { today: TODAY });
    expect(r.alternatives.length).toBeLessThanOrEqual(3);
  });
});

// ── Date ranges (owner feedback, Nov 2026: "sometime 20th to the end") ──────

describe('checkAvailability — date range (latestDate)', () => {
  const { MAX_RANGE_OPEN_DATES, MAX_RANGE_DAYS } = require('../../services/quote/vendorAvailabilityService');

  test('no latestDate ⇒ the original single-date shape, no range fields', async () => {
    wire({});
    const r = await checkAvailability(COMPANY_ID, '2026-10-15', { today: TODAY });
    expect(r).not.toHaveProperty('openDates');
    expect(r).not.toHaveProperty('latestDate');
  });

  test('open dates inside [requestedDate, latestDate], earliest first, alongside the old fields', async () => {
    wire({ capacity: 1, booked: { '2027-01-20': 1, '2027-01-22': 1 }, blackouts: ['2027-01-21'] });
    const r = await checkAvailability(COMPANY_ID, '2027-01-20', { today: TODAY, latestDate: '2027-01-31' });
    expect(r.requestedDateOpen).toBe(false);          // existing fields still there
    expect(r.reason).toBe('fully_booked');
    expect(r.alternatives.length).toBeLessThanOrEqual(MAX_ALTERNATIVES);
    expect(r.latestDate).toBe('2027-01-31');
    expect(r.rangeTruncated).toBe(false);
    // 20 full, 21 blackout, 22 full ⇒ 23 onward; capped at 5.
    expect(r.openDates).toEqual(['2027-01-23', '2027-01-24', '2027-01-25', '2027-01-26', '2027-01-27']);
    expect(r.openDates).toHaveLength(MAX_RANGE_OPEN_DATES);
  });

  test('fewer open days than the cap ⇒ just those; a fully closed range ⇒ []', async () => {
    wire({ capacity: 2, booked: { '2027-01-30': 2 } });
    const few = await checkAvailability(COMPANY_ID, '2027-01-29', { today: TODAY, latestDate: '2027-01-31' });
    expect(few.openDates).toEqual(['2027-01-29', '2027-01-31']);

    wire({ capacity: 1, booked: { '2027-01-30': 1, '2027-01-31': 1 } });
    const none = await checkAvailability(COMPANY_ID, '2027-01-30', { today: TODAY, latestDate: '2027-01-31' });
    expect(none.openDates).toEqual([]);
    expect(none.alternatives.length).toBeGreaterThan(0); // still something to offer
  });

  test('a range starting in the past only offers future days', async () => {
    wire({});
    const r = await checkAvailability(COMPANY_ID, '2026-09-24', { today: TODAY, latestDate: '2026-09-29' });
    expect(r.openDates).toEqual(['2026-09-27', '2026-09-28', '2026-09-29']);
  });

  test('the booking read covers the whole range', async () => {
    wire({ capacity: 1, booked: { '2027-01-15': 1 } });
    await checkAvailability(COMPANY_ID, '2027-01-01', { today: TODAY, latestDate: '2027-01-31' });
    const [, start, end] = db.any.mock.calls[0][1];
    expect(start <= '2027-01-01').toBe(true);
    expect(end >= '2027-01-31').toBe(true);
  });

  test(`ranges longer than ${31} days are clamped and say so`, async () => {
    wire({ capacity: 1 });
    const r = await checkAvailability(COMPANY_ID, '2027-03-01', { today: TODAY, latestDate: '2027-06-30' });
    expect(MAX_RANGE_DAYS).toBe(31);
    expect(r.latestDate).toBe('2027-03-31');
    expect(r.rangeTruncated).toBe(true);
  });

  test('a single-day range is fine', async () => {
    wire({});
    const r = await checkAvailability(COMPANY_ID, '2027-01-20', { today: TODAY, latestDate: '2027-01-20' });
    expect(r.openDates).toEqual(['2027-01-20']);
  });

  test('invalid ranges are invalid_input, before any booking read', async () => {
    wire({});
    for (const latestDate of ['end of january', '2027-02-30', '2027-1-31', '2027-01-19']) {
      await expect(checkAvailability(COMPANY_ID, '2027-01-20', { today: TODAY, latestDate }))
        .rejects.toMatchObject({ code: 'invalid_input' });
    }
    expect(db.any).not.toHaveBeenCalled();
  });
});
