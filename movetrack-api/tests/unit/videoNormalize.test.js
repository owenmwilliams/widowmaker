/**
 * Unit tests for normalizeVideoItem (services/infra/vision/videoService.js).
 * DB-free; runs in CI. Covers the Phase C mapping of model output onto the flat
 * inventory fields (weight/dimensions/material/fragile) movers quote from.
 */

const { normalizeVideoItem } = require('../../services/infra/vision/videoService');

describe('normalizeVideoItem', () => {
  test('maps estimated_* fields onto flat inventory fields', () => {
    const out = normalizeVideoItem({
      name: '3-seat sofa', quantity: 1, room: 'living room',
      estimated_weight_lbs: 150,
      estimated_dimensions: { length_in: 84, width_in: 36, height_in: 34 },
      material: 'fabric', fragile: false, notes: 'heavy',
    });
    expect(out.weight_lbs).toBe(150);
    expect(out.length_in).toBe(84);
    expect(out.width_in).toBe(36);
    expect(out.height_in).toBe(34);
    expect(out.material).toBe('fabric');
    expect(out.fragile).toBe(false);
    expect(out.name).toBe('3-seat sofa'); // original fields preserved
  });

  test('infers fragile from notes when no boolean is given', () => {
    const out = normalizeVideoItem({ name: 'Mirror', notes: 'fragile' });
    expect(out.fragile).toBe(true);
  });

  test('coerces zero/invalid/negative numbers to null (never ship a fake 0)', () => {
    const out = normalizeVideoItem({
      name: 'Mystery', estimated_weight_lbs: 0,
      estimated_dimensions: { length_in: -5, width_in: 'x', height_in: null },
    });
    expect(out.weight_lbs).toBeNull();
    expect(out.length_in).toBeNull();
    expect(out.width_in).toBeNull();
    expect(out.height_in).toBeNull();
  });

  test('accepts already-flat fields and camelCase dimensions', () => {
    const flat = normalizeVideoItem({ name: 'Desk', weight_lbs: 60, length_in: 48, width_in: 24, height_in: 30 });
    expect(flat.weight_lbs).toBe(60);
    expect(flat.length_in).toBe(48);

    const camel = normalizeVideoItem({ name: 'TV', estimatedWeight: 40, estimatedDimensions: { length: 49, width: 3, height: 29 } });
    expect(camel.weight_lbs).toBe(40);
    expect(camel.length_in).toBe(49);
    expect(camel.height_in).toBe(29);
  });

  test('handles non-object input gracefully', () => {
    expect(normalizeVideoItem(null)).toBeNull();
    expect(normalizeVideoItem('nope')).toBe('nope');
  });
});
