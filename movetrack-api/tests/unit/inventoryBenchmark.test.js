'use strict';

const {
  weightBandForBedrooms,
  assessWeightPlausibility,
  typicalUnitWeight,
  flagWeightOutliers,
} = require('../../services/inventory/inventoryBenchmarkService');

describe('weightBandForBedrooms', () => {
  test('returns a band for known bedroom counts', () => {
    const b = weightBandForBedrooms(3);
    expect(b.low).toBeLessThan(b.typical);
    expect(b.typical).toBeLessThan(b.high);
  });

  test('returns null when bedrooms is unknown', () => {
    expect(weightBandForBedrooms(null)).toBeNull();
    expect(weightBandForBedrooms(undefined)).toBeNull();
    expect(weightBandForBedrooms('abc')).toBeNull();
  });

  test('extrapolates beyond the table', () => {
    const b6 = weightBandForBedrooms(6);
    const b5 = weightBandForBedrooms(5);
    expect(b6.typical).toBeGreaterThan(b5.typical);
  });

  test('treats 0 bedrooms as a studio', () => {
    expect(weightBandForBedrooms(0).typical).toBe(1800);
  });
});

describe('assessWeightPlausibility', () => {
  test('flags the canonical broken case: 92 lbs for a 3-bed', () => {
    const v = assessWeightPlausibility({ bedrooms: 3, actualWeightLbs: 92 });
    expect(v.hasBenchmark).toBe(true);
    expect(v.status).toBe('too_low');
    expect(v.severity).toBe('high');
    expect(v.message).toMatch(/missed rooms|second pass/i);
  });

  test('accepts a plausible 3-bed total', () => {
    const v = assessWeightPlausibility({ bedrooms: 3, actualWeightLbs: 8000 });
    expect(v.status).toBe('ok');
    expect(v.severity).toBe('none');
  });

  test('marks a slightly-light inventory as low (medium), not broken', () => {
    // 3-bed low edge is 5500; 0.4*5500=2200. 4000 is between → "low".
    const v = assessWeightPlausibility({ bedrooms: 3, actualWeightLbs: 4000 });
    expect(v.status).toBe('low');
    expect(v.severity).toBe('medium');
  });

  test('flags absurdly heavy inventories', () => {
    const v = assessWeightPlausibility({ bedrooms: 2, actualWeightLbs: 40000 });
    expect(v.status).toBe('too_high');
    expect(v.severity).toBe('high');
  });

  test('returns no benchmark when home size is unknown', () => {
    const v = assessWeightPlausibility({ bedrooms: null, actualWeightLbs: 92 });
    expect(v.hasBenchmark).toBe(false);
    expect(v.status).toBe('unknown');
  });

  test('derives a volume band from the weight band (~7 lbs/cu ft)', () => {
    const v = assessWeightPlausibility({ bedrooms: 3, actualWeightLbs: 8000 });
    expect(v.expectedVolumeCuFt.typical).toBe(Math.round(v.expectedWeightLbs.typical / 7));
  });

  test('reports the ratio of actual to typical', () => {
    const v = assessWeightPlausibility({ bedrooms: 3, actualWeightLbs: 8000 });
    expect(v.ratio).toBeCloseTo(1, 1);
  });
});

describe('flagWeightOutliers', () => {
  test('flags a 2-lb sofa as too light', () => {
    const flags = flagWeightOutliers([{ name: 'Living room sofa', weight_lbs: 2 }]);
    expect(flags).toHaveLength(1);
    expect(flags[0].reason).toBe('too_light');
  });

  test('flags a recognized heavy item with no weight', () => {
    const flags = flagWeightOutliers([{ name: 'Refrigerator', weight_lbs: null }]);
    expect(flags[0].reason).toBe('missing_weight');
  });

  test('does not flag a plausible weight', () => {
    expect(flagWeightOutliers([{ name: 'Sofa', weight_lbs: 110 }])).toHaveLength(0);
  });

  test('ignores small/unknown items it has no benchmark for', () => {
    expect(flagWeightOutliers([{ name: 'Decorative candle', weight_lbs: 1 }])).toHaveLength(0);
  });

  test('accepts camelCase weightLbs too', () => {
    expect(flagWeightOutliers([{ name: 'Dresser', weightLbs: 5 }])[0].reason).toBe('too_light');
  });
});

describe('typicalUnitWeight', () => {
  test('matches by substring', () => {
    expect(typicalUnitWeight('Stainless refrigerator')).toBe(250);
  });
  test('returns null for unknown items', () => {
    expect(typicalUnitWeight('throw pillow')).toBeNull();
  });
});
