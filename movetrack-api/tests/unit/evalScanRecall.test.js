/**
 * Pathway E (#44) — recall/precision matching used by scripts/eval-scan-recall.js.
 * DB-free, no API calls; covers the fuzzy name matcher and stats.
 */

const { tokenize, nameSimilarity, matchItems, stats } = require('../../scripts/eval-scan-recall');

describe('tokenize', () => {
  test('normalizes case, punctuation, plurals, and stopwords', () => {
    expect(tokenize('55" TVs')).toEqual(['55', 'tv']);
    expect(tokenize('Box of Dishes')).toEqual(['box', 'dishe']); // crude singularization is fine for matching
    expect(tokenize('3-seat sofa')).toEqual(['3', 'seat', 'sofa']);
  });
});

describe('nameSimilarity', () => {
  test('rewards containment (short name fully inside long name)', () => {
    expect(nameSimilarity('55" TV', 'TV')).toBeGreaterThanOrEqual(0.8);
    expect(nameSimilarity('3-seat sofa', 'sofa')).toBeGreaterThanOrEqual(0.8);
  });
  test('is zero for unrelated items', () => {
    expect(nameSimilarity('dining table', 'floor lamp')).toBe(0);
  });
});

describe('matchItems', () => {
  test('greedy one-to-one match, no double counting', () => {
    const gt = ['dining table', 'dining chair', 'wine rack'];
    const detected = ['Dining table', '4x dining chairs', 'TV'];
    const { matchedGt, matchedDet, pairs } = matchItems(gt, detected, 0.5);
    expect(matchedGt.size).toBe(2);
    expect(matchedDet.size).toBe(2);
    // wine rack was in ground truth but never detected
    expect(pairs.some((p) => p.groundTruth === 'wine rack')).toBe(false);
  });

  test('a single detected item cannot satisfy two ground-truth items', () => {
    const gt = ['dining chair', 'office chair'];
    const detected = ['chair'];
    const { matchedGt } = matchItems(gt, detected, 0.5);
    expect(matchedGt.size).toBe(1);
  });
});

describe('stats', () => {
  test('mean/stdev/min/max', () => {
    expect(stats([9, 12, 3, 6])).toEqual({ mean: 7.5, stdev: 3.35, min: 3, max: 12 });
  });
  test('empty input is safe', () => {
    expect(stats([])).toEqual({ mean: 0, stdev: 0, min: 0, max: 0 });
  });
});
