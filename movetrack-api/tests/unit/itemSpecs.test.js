'use strict';

const { specForName, isLargeImpactItem } = require('../../services/inventory/itemSpecsReference');

describe('specForName', () => {
  test('returns weight + dimensions for a known item', () => {
    const s = specForName('Leather Sofa');
    expect(s).toMatchObject({ w: expect.any(Number), l: expect.any(Number), wd: expect.any(Number), h: expect.any(Number) });
    expect(s.w).toBeGreaterThan(0);
  });

  test('prefers the more specific key (sectional before sofa)', () => {
    expect(specForName('Large sectional').w).toBe(specForName('sectional').w);
    expect(specForName('Large sectional').w).not.toBe(specForName('sofa').w);
  });

  test('matches by substring, case-insensitive', () => {
    expect(specForName('Stainless REFRIGERATOR')).not.toBeNull();
  });

  test('returns null for unknown items', () => {
    expect(specForName('antique snow globe')).toBeNull();
  });

  test('returned spec is a copy (not the shared table object)', () => {
    const a = specForName('sofa');
    a.w = -1;
    expect(specForName('sofa').w).toBeGreaterThan(0);
  });
});

describe('isLargeImpactItem', () => {
  test('flags large furniture/appliances', () => {
    expect(isLargeImpactItem('Sofa')).toBe(true);
    expect(isLargeImpactItem('French door refrigerator')).toBe(true);
    expect(isLargeImpactItem('Queen mattress')).toBe(true);
  });

  test('does not flag small items', () => {
    expect(isLargeImpactItem('Table lamp')).toBe(false);
    expect(isLargeImpactItem('Throw pillow')).toBe(false);
  });

  test('flags unknown-but-heavy via keyword', () => {
    expect(isLargeImpactItem('Antique piano')).toBe(true);
  });
});
