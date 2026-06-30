'use strict';

const { parseItemsArray } = require('../../services/infra/vision/videoService');
const { gcsPathFromUrl } = require('../../services/inventory/roomVideoService');

describe('parseItemsArray', () => {
  test('parses a plain JSON array', () => {
    const { items, parseError } = parseItemsArray('[{"name":"Sofa","quantity":1}]');
    expect(parseError).toBeNull();
    expect(items).toHaveLength(1);
    expect(items[0].name).toBe('Sofa');
  });

  test('strips ```json code fences', () => {
    const { items } = parseItemsArray('```json\n[{"name":"TV"}]\n```');
    expect(items[0].name).toBe('TV');
  });

  test('recovers loose JSON (trailing comma) via jsonrepair', () => {
    const { items } = parseItemsArray('[{"name":"Lamp","quantity":1,}]');
    expect(items.length).toBeGreaterThanOrEqual(1);
    expect(items[0].name).toBe('Lamp');
  });

  test('returns empty items on non-JSON (never throws)', () => {
    const { items } = parseItemsArray('not json at all');
    expect(items).toEqual([]);
  });

  test('non-array JSON yields empty items', () => {
    const { items } = parseItemsArray('{"name":"oops"}');
    expect(items).toEqual([]);
  });
});

describe('gcsPathFromUrl', () => {
  test('extracts bucket and path from a public GCS url', () => {
    expect(gcsPathFromUrl('https://storage.googleapis.com/my-bucket/users/u/nexus/v.mp4'))
      .toEqual({ bucket: 'my-bucket', path: 'users/u/nexus/v.mp4' });
  });

  test('returns null for a non-GCS url or empty input', () => {
    expect(gcsPathFromUrl('https://example.com/x.mp4')).toBeNull();
    expect(gcsPathFromUrl(null)).toBeNull();
    expect(gcsPathFromUrl(undefined)).toBeNull();
  });
});
