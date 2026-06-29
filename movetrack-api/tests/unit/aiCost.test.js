/**
 * Unit tests for the pure AI cost logic (services/infra/cost/aiCostService.js).
 * DB-free (estimateCostUsd / evaluateBudget don't touch the database).
 */

const { estimateCostUsd, evaluateBudget } = require('../../services/infra/cost/aiCostService');

describe('estimateCostUsd', () => {
  test('prices a gemini-2.5-flash call from token counts', () => {
    // 1M input @ $0.30 + 1M output @ $2.50 = $2.80
    expect(estimateCostUsd('gemini-2.5-flash', 1_000_000, 1_000_000)).toBeCloseTo(2.8, 5);
  });

  test('zero tokens cost nothing', () => {
    expect(estimateCostUsd('gemini-2.5-flash', 0, 0)).toBe(0);
  });

  test('matches the longest model-id prefix', () => {
    // claude-sonnet (3/15) for a versioned id
    expect(estimateCostUsd('claude-sonnet-4-6-latest', 1_000_000, 0)).toBeCloseTo(3.0, 5);
  });

  test('falls back to DEFAULT pricing for unknown models', () => {
    // DEFAULT is 3/15
    expect(estimateCostUsd('some-unknown-model', 0, 1_000_000)).toBeCloseTo(15.0, 5);
  });
});

describe('evaluateBudget', () => {
  const caps = { dailyCap: 2, monthlyCap: 20 };

  test('allows when under both caps', () => {
    expect(evaluateBudget({ todayUsd: 0.5, monthUsd: 5, ...caps }).allowed).toBe(true);
  });

  test('blocks when daily cap is reached', () => {
    const v = evaluateBudget({ todayUsd: 2, monthUsd: 5, ...caps });
    expect(v.allowed).toBe(false);
    expect(v.reason).toMatch(/daily/i);
  });

  test('blocks when monthly cap is reached', () => {
    const v = evaluateBudget({ todayUsd: 0.1, monthUsd: 20, ...caps });
    expect(v.allowed).toBe(false);
    expect(v.reason).toMatch(/monthly/i);
  });

  test('admins always bypass caps', () => {
    expect(evaluateBudget({ todayUsd: 999, monthUsd: 999, isAdmin: true, ...caps }).allowed).toBe(true);
  });
});
