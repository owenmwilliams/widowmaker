'use strict';

/**
 * Arbiter review on #52: (1) a parse-failed 0-item scan is recorded
 * status='success' (with parse_error set) — getRecentScanFailures must not
 * miss it; (2) ?hours=abc -> NaN -> 500, must clamp instead; and LIMIT both
 * lists rather than returning everything in the window unbounded.
 */

function createQueryBuilder(resolveValue) {
  const calls = { where: [], orWhereNotNull: [], leftJoin: [], select: [], orderBy: [], limit: [] };
  const qb = {
    where: jest.fn((...args) => {
      if (typeof args[0] === 'function') {
        args[0](qb); // simulate `.where(qb => { qb.where(...).orWhereNotNull(...) })`
      } else {
        calls.where.push(args);
      }
      return qb;
    }),
    orWhereNotNull: jest.fn((...args) => { calls.orWhereNotNull.push(args); return qb; }),
    leftJoin: jest.fn((...args) => { calls.leftJoin.push(args); return qb; }),
    select: jest.fn((...args) => { calls.select.push(args); return qb; }),
    orderBy: jest.fn((...args) => { calls.orderBy.push(args); return qb; }),
    limit: jest.fn((...args) => { calls.limit.push(args); return qb; }),
    then: (resolve) => resolve(resolveValue),
    _calls: calls,
  };
  return qb;
}

describe('getRecentScanFailures', () => {
  let getRecentScanFailures;
  let scanEventsQb, betaLogsQb;

  beforeEach(() => {
    jest.resetModules();
    scanEventsQb = createQueryBuilder([{ id: 1, status: 'success', parse_error: 'bad json' }]);
    betaLogsQb = createQueryBuilder([{ id: 2 }]);

    const knexFn = jest.fn((table) => {
      if (table === 'scan_events') return scanEventsQb;
      if (table === 'beta_interaction_logs') return betaLogsQb;
      throw new Error(`unexpected table: ${table}`);
    });
    knexFn.raw = jest.fn((sql) => sql);
    jest.doMock('../../services/infra/knex', () => knexFn);

    ({ getRecentScanFailures } = require('../../services/analytics/reportingService'));
  });

  afterEach(() => {
    jest.dontMock('../../services/infra/knex');
  });

  test('queries scan_events for status=error OR a non-null parse_error (not status=error alone)', async () => {
    await getRecentScanFailures(24);
    expect(scanEventsQb._calls.where).toContainEqual(['scan_events.status', 'error']);
    expect(scanEventsQb._calls.orWhereNotNull).toContainEqual(['scan_events.parse_error']);
  });

  test('returns the parse-error row even though its status column is success', async () => {
    const result = await getRecentScanFailures(24);
    expect(result.scanFailures).toEqual([{ id: 1, status: 'success', parse_error: 'bad json' }]);
  });

  test('defaults to 24h when hours is NaN (e.g. ?hours=abc) instead of producing an Invalid Date', async () => {
    const result = await getRecentScanFailures(Number('abc'));
    expect(result.hours).toBe(24);
    expect(new Date(result.since).toString()).not.toBe('Invalid Date');
  });

  test('clamps an out-of-range hours value to the [1, 720] window', async () => {
    expect((await getRecentScanFailures(99999)).hours).toBe(720);
    expect((await getRecentScanFailures(-5)).hours).toBe(1);
    expect((await getRecentScanFailures(0)).hours).toBe(1);
  });

  test('defaults and clamps limit, and applies it to both queries', async () => {
    const result = await getRecentScanFailures(24, Number('abc'));
    expect(result.limit).toBe(200);
    expect(scanEventsQb._calls.limit).toEqual([[200]]);
    expect(betaLogsQb._calls.limit).toEqual([[200]]);

    jest.resetModules();
    scanEventsQb = createQueryBuilder([]);
    betaLogsQb = createQueryBuilder([]);
    const knexFn2 = jest.fn((table) => (table === 'scan_events' ? scanEventsQb : betaLogsQb));
    jest.doMock('../../services/infra/knex', () => knexFn2);
    ({ getRecentScanFailures } = require('../../services/analytics/reportingService'));

    const clamped = await getRecentScanFailures(24, 10000);
    expect(clamped.limit).toBe(500);
  });
});
