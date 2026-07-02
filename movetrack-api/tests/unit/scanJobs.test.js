/**
 * Unit tests for the pure parts of scanJobService (services/inventory/scanJobService.js).
 * DB-free: covers the result mapping the client decodes into the review card,
 * and the row→DTO projection. Worker/DB behavior is exercised in integration.
 */

const { toReviewResult, toDTO, isAllowedMediaUrl, roomFromCaption, UUID_RE } = require('../../services/inventory/scanJobService');
const gcs = require('../../services/infra/gcsService');

describe('toReviewResult', () => {
  test('maps raw workflow items into the detected_items camelCase shape', () => {
    const result = toReviewResult(
      [{
        name: 'Dining table',
        quantity: 1,
        picture_url: 'https://storage.googleapis.com/b/t.jpg',
        weight_lbs: 150,
        length_in: 84, width_in: 36, height_in: 30,
        material: 'wood',
        fragile: false,
        confidence: 0.9,
      }],
      'video',
      'Dining Room'
    );
    expect(result.mediaKind).toBe('video');
    expect(result.room).toBe('Dining Room');
    expect(result.items).toEqual([{
      name: 'Dining table',
      quantity: 1,
      room: 'Dining Room',
      pictureUrl: 'https://storage.googleapis.com/b/t.jpg',
      weightLbs: 150,
      lengthIn: 84, widthIn: 36, heightIn: 30,
      material: 'wood',
      fragile: false,
      confidence: 0.9,
    }]);
  });

  test('defaults sparse items instead of dropping them', () => {
    const { items } = toReviewResult([{}, { name: 'Lamp', quantity: -3, fragile: 1 }], 'photo', null);
    expect(items[0]).toMatchObject({ name: 'Item', quantity: 1, room: null, pictureUrl: null, fragile: false });
    expect(items[1]).toMatchObject({ name: 'Lamp', quantity: 1, fragile: true });
  });

  test('item room wins over the hint; hint fills gaps', () => {
    const { items } = toReviewResult(
      [{ name: 'A', room: 'Kitchen' }, { name: 'B' }],
      'photo',
      'Garage'
    );
    expect(items[0].room).toBe('Kitchen');
    expect(items[1].room).toBe('Garage');
  });

  test('tolerates a non-array items payload', () => {
    expect(toReviewResult(null, 'photo', null).items).toEqual([]);
    expect(toReviewResult(undefined, 'video', null).items).toEqual([]);
  });

  test('coerces non-numeric measurements to null', () => {
    const { items } = toReviewResult([{ name: 'Box', weight_lbs: 'heavy', confidence: '0.7' }], 'photo', null);
    expect(items[0].weightLbs).toBeNull();
    expect(items[0].confidence).toBe(0.7);
  });
});

describe('toDTO', () => {
  test('projects a row to the client shape', () => {
    const dto = toDTO({
      id: 'abc',
      user_id: 'u1',            // must NOT leak
      idempotency_key: 'k',     // must NOT leak
      status: 'completed',
      stage: 'done',
      media_kind: 'video',
      media_url: 'https://x/y.mov',
      room_hint: 'Den',
      caption: 'my den',
      plan: 'pro',
      result: { mediaKind: 'video', room: 'Den', items: [] },
      error: null,
      created_at: 't0',
      finished_at: 't1',
      consumed_at: null,
    });
    expect(dto).toEqual({
      id: 'abc',
      status: 'completed',
      stage: 'done',
      mediaKind: 'video',
      mediaUrl: 'https://x/y.mov',
      roomHint: 'Den',
      caption: 'my den',
      result: { mediaKind: 'video', room: 'Den', items: [] },
      error: null,
      createdAt: 't0',
      finishedAt: 't1',
      consumedAt: null,
    });
    expect(dto).not.toHaveProperty('user_id');
  });

  test('returns null for a missing row', () => {
    expect(toDTO(null)).toBeNull();
  });
});

describe('isAllowedMediaUrl', () => {
  const userId = '9f1b2c3d-0000-4000-8000-000000000001';

  test('accepts media under the requesting user prefix in the app bucket', () => {
    expect(isAllowedMediaUrl(`https://storage.googleapis.com/${gcs.BUCKET}/users/${userId}/chat/nexus/x.mov`, userId)).toBe(true);
  });

  test("rejects another user's media, other buckets, and arbitrary URLs", () => {
    expect(isAllowedMediaUrl(`https://storage.googleapis.com/${gcs.BUCKET}/users/other-user/x.mov`, userId)).toBe(false);
    expect(isAllowedMediaUrl(`https://storage.googleapis.com/some-other-bucket/users/${userId}/x.mov`, userId)).toBe(false);
    expect(isAllowedMediaUrl('https://evil.example.com/x.mov', userId)).toBe(false);
    expect(isAllowedMediaUrl('http://169.254.169.254/latest/meta-data', userId)).toBe(false);
    expect(isAllowedMediaUrl('', userId)).toBe(false);
    expect(isAllowedMediaUrl(null, userId)).toBe(false);
  });
});

describe('roomFromCaption', () => {
  test('accepts short room-name-shaped captions', () => {
    expect(roomFromCaption('dining room')).toBe('dining room');
    expect(roomFromCaption('  Garage ')).toBe('Garage');
    expect(roomFromCaption('Kids bedroom 2')).toBe('Kids bedroom 2');
  });

  test('rejects sentences, long captions, and empties', () => {
    expect(roomFromCaption('this is my dining room, mind the wine!')).toBeNull();
    expect(roomFromCaption('please scan everything in here carefully')).toBeNull();
    expect(roomFromCaption('a'.repeat(41))).toBeNull();
    expect(roomFromCaption('')).toBeNull();
    expect(roomFromCaption(null)).toBeNull();
  });
});

describe('UUID_RE', () => {
  test('matches UUIDs and rejects junk ids', () => {
    expect(UUID_RE.test('9f1b2c3d-0000-4000-8000-000000000001')).toBe(true);
    expect(UUID_RE.test('not-a-uuid')).toBe(false);
    expect(UUID_RE.test('9f1b2c3d-0000-4000-8000-00000000000')).toBe(false);
  });
});
