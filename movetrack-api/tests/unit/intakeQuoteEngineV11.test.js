'use strict';

/**
 * intake engine 1.1.0 + the owner-feedback battery changes (Nov 2026):
 *
 *   • parking per END (parkingOrigin / parkingDestination): access hours
 *     and the long-carry fee apply at each end that has them;
 *   • BACK-COMPAT PROOF: every legacy single-`parking` input in the fixture
 *     (outputs captured from intake-a-1.0.0 before the change) reproduces
 *     the same numbers AND line items — engineVersion aside — and still
 *     prices to the same totals after going through sanitizeAnswers
 *     (MCP callers that still send `parking`);
 *   • specialItems allows custom + skip; company specs are optional;
 *   • quoteProgress: battery + intake_specs + email; a quote completes it.
 */

jest.mock('../../services/infra/db', () => ({
  db: { any: jest.fn(), one: jest.fn(), oneOrNone: jest.fn(), none: jest.fn() },
}));

jest.mock('../../services/move/distanceService', () => ({ calculateDrivingDistance: jest.fn() }));

const engine = require('../../services/quote/intakeQuoteEngine');
const intakeAgent = require('../../services/quote/intakeAgentService');
const legacy = require('./fixtures/intakeEngine-1.0.0-legacy-parking.json');

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

// Same 2BR baseline as intakeQuote.test.js: raw 5.0667h, range 1151–1494.
const BASE = { bedrooms: '2', stairsOrigin: '1', stairsDestination: 'none', packing: 'no', specialItems: 'none' };
const inputs = (answers) => ({ answers, items: [], distance: null, rateCard: { version: 3, data: CARD } });
const withoutVersion = ({ engineVersion, ...rest }) => rest;

describe('engine version', () => {
  test('bumped for the per-end parking change', () => {
    expect(engine.ENGINE_VERSION).toBe('intake-a-1.1.0');
    expect(legacy.generatedBy).toBe('intake-a-1.0.0');
  });
});

describe('back-compat: legacy single `parking` answers', () => {
  test(`all ${legacy.cases.length} 1.0.0 fixture cases replay identically (numbers + line items)`, () => {
    expect(legacy.cases.length).toBeGreaterThanOrEqual(72);
    for (const c of legacy.cases) {
      const out = engine.computeQuote(c.inputs);
      expect(withoutVersion(out)).toEqual(withoutVersion(c.outputs));
    }
  });

  test('the fixture actually exercises long carry and short walk', () => {
    const parkings = new Set(legacy.cases.map((c) => c.inputs.answers.parking));
    expect([...parkings]).toEqual(expect.arrayContaining([undefined, 'right_outside', 'short_walk', 'long_carry']));
    expect(legacy.cases.some((c) => c.outputs.lineItems.some((li) => li.key === 'long_carry'))).toBe(true);
  });

  test('a legacy answer routed through sanitizeAnswers (MCP callers) prices to the same totals', () => {
    for (const c of legacy.cases) {
      const sanitized = engine.sanitizeAnswers(c.inputs.answers);
      expect(sanitized.parking).toBeUndefined();
      if (c.inputs.answers.parking) expect(sanitized.parkingOrigin).toBe(c.inputs.answers.parking);
      const out = engine.computeQuote({ ...c.inputs, answers: sanitized });
      expect({ low: out.rangeLow, high: out.rangeHigh, nte: out.nte, hours: out.hours, deposit: out.deposit, status: out.status })
        .toEqual({ low: c.outputs.rangeLow, high: c.outputs.rangeHigh, nte: c.outputs.nte, hours: c.outputs.hours, deposit: c.outputs.deposit, status: c.outputs.status });
    }
  });

  test('parkingOrigin wins over a legacy parking answer when both arrive', () => {
    expect(engine.sanitizeAnswers({ parking: 'long_carry', parkingOrigin: 'right_outside' }))
      .toEqual({ parkingOrigin: 'right_outside' });
    const out = engine.computeQuote(inputs({ ...BASE, parking: 'long_carry', parkingOrigin: 'right_outside' }));
    expect(out.rangeLow).toBe(1151);
    expect(out.lineItems.map((li) => li.key)).not.toContain('long_carry');
  });
});

describe('per-end parking pricing', () => {
  test('right outside at both ends = the old no-parking baseline', () => {
    const out = engine.computeQuote(inputs({ ...BASE, parkingOrigin: 'right_outside', parkingDestination: 'right_outside' }));
    expect([out.rangeLow, out.rangeHigh, out.nte]).toEqual([1151, 1494, 1718]);
  });

  test('long carry at BOTH ends: hours at each end + one fee per end', () => {
    // raw 5.0667 + 0.75 + 0.75 = 6.5667 → low ceil(5.5817)=6, high ceil(7.5517)=8.
    // Labor 6×229=1374 / 8×229=1832; fees truck 45 + stairs 75 + 100 + 100 = 320.
    const out = engine.computeQuote(inputs({ ...BASE, parkingOrigin: 'long_carry', parkingDestination: 'long_carry' }));
    expect(out.hours.access).toBe(1.9); // 0.4 stairs + 0.75 + 0.75
    expect([out.hours.low, out.hours.high]).toEqual([6, 8]);
    expect([out.rangeLow, out.rangeHigh, out.nte]).toEqual([1694, 2152, 2475]);
    const carry = out.lineItems.filter((li) => li.key.startsWith('long_carry'));
    expect(carry).toEqual([
      { key: 'long_carry_origin', label: 'Long carry — current place', amountLow: 100, amountHigh: 100 },
      { key: 'long_carry_destination', label: 'Long carry — new place', amountLow: 100, amountHigh: 100 },
    ]);
  });

  test('short walk at the old place, long carry at the new place', () => {
    // raw 5.0667 + 0.25 + 0.75 = 6.0667 → low 5.5, high 7; labor 1260 / 1603; fees 45+75+100.
    const out = engine.computeQuote(inputs({ ...BASE, parkingOrigin: 'short_walk', parkingDestination: 'long_carry' }));
    expect([out.hours.low, out.hours.high]).toEqual([5.5, 7]);
    expect([out.rangeLow, out.rangeHigh]).toEqual([1480, 1823]);
    expect(out.lineItems.map((li) => li.key)).toEqual(['labor', 'truck', 'stairs', 'long_carry_destination']);
  });

  test('destination-only answer is honoured (origin unanswered = no adder)', () => {
    const dest = engine.computeQuote(inputs({ ...BASE, parkingDestination: 'long_carry' }));
    const orig = engine.computeQuote(inputs({ ...BASE, parkingOrigin: 'long_carry' }));
    expect(dest.rangeLow).toBe(orig.rangeLow);
    expect(dest.lineItems.find((li) => li.key === 'long_carry_destination')).toBeTruthy();
    expect(orig.lineItems.find((li) => li.key === 'long_carry_origin').label).toBe('Long carry — current place');
  });
});

describe('battery: custom + optional answers', () => {
  test('specialItems allows a custom answer and a neutral skip', () => {
    const q = engine.buildQuestions({}).find((x) => x.id === 'specialItems');
    expect(q).toEqual(expect.objectContaining({
      allowCustom: true, optional: true, skipValue: 'none',
      customPlaceholder: expect.stringMatching(/Peloton/),
    }));
    expect(q.options.length).toBeLessThanOrEqual(4); // ≤4 chips + "Other…"
  });

  test('free-text special items survive sanitizing (up to 120 chars) and still trip review flags', () => {
    const typed = 'Peloton bike, a large aquarium and my grandmother\'s baby grand piano';
    const answers = engine.sanitizeAnswers({ ...BASE, specialItems: typed });
    expect(answers.specialItems).toBe(typed);
    expect(engine.sanitizeAnswers({ specialItems: 'x'.repeat(300) }).specialItems).toHaveLength(120);
    const out = engine.computeQuote(inputs(answers));
    expect(out.status).toBe('review_required');
    expect(out.reviewReasons.join(' ')).toMatch(/piano/);
  });

  test('company intake specs are optional with a "Not sure" skip value', () => {
    const { questions } = intakeAgent.questionBattery({ knownAnswers: {}, intakeSpecs: [{ key: 'coi', question: 'COI needed?' }] });
    expect(questions.find((x) => x.id === 'coi')).toEqual(expect.objectContaining({ optional: true, skipValue: 'Not sure' }));
  });

  test('legacy parking answers count as parkingOrigin in the battery; the old key stays reserved for specs', () => {
    const { questions, known } = intakeAgent.questionBattery({ knownAnswers: { parking: 'short_walk' } });
    expect(known.parkingOrigin).toBe('short_walk');
    expect(questions.map((q) => q.id)).not.toContain('parkingOrigin');
    expect(questions.map((q) => q.id)).toContain('parkingDestination');
    expect(intakeAgent.sanitizeIntakeSpecs([
      { key: 'parking', question: 'shadow?' },
      { key: 'parkingDestination', question: 'shadow?' },
      { key: 'hoa', question: 'HOA rules?' },
    ]).map((s) => s.key)).toEqual(['hoa']);
  });
});

describe('quoteProgress', () => {
  const specs = [{ key: 'coi', question: 'COI needed?' }];

  test('total = battery + specs + the email step; counts what is answered', () => {
    expect(intakeAgent.quoteProgress({ knownAnswers: {}, intakeSpecs: specs }))
      .toEqual({ answered: 0, total: 12, quoteReady: false, reserved: false });
    const p = intakeAgent.quoteProgress({
      knownAnswers: { bedrooms: '2', originAddress: 'Oakland, CA', coi: 'Not sure', junk: 'x' },
      intakeSpecs: specs,
    });
    expect(p).toEqual({ answered: 3, total: 12, quoteReady: false, reserved: false });
  });

  test('email counts as a step; a quote completes the bar; a reservation is flagged', () => {
    expect(intakeAgent.quoteProgress({ knownAnswers: {}, customerEmail: 'a@b.co' }).answered).toBe(1);
    expect(intakeAgent.quoteProgress({ knownAnswers: {}, quoteReady: true })).toEqual({ answered: 11, total: 11, quoteReady: true, reserved: false });
    expect(intakeAgent.quoteProgress({ knownAnswers: {}, reserved: true })).toEqual({ answered: 11, total: 11, quoteReady: true, reserved: true });
  });
});
