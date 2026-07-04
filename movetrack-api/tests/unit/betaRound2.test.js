'use strict';

/**
 * 2026-07-03 beta round 2: captions that describe CONTENTS must never become
 * rooms (the room comes from the conversation instead), photo scans of an
 * already-cataloged item update its picture instead of duplicating it, and
 * the "take pictures of large items" nudge trusts an item's own weight/dims,
 * not just the name lexicon.
 */

jest.mock('../../services/infra/scanEventsService', () => ({
  createScanRecorder: jest.fn(() => ({ onStage: jest.fn(), finish: jest.fn() })),
  recordScanEvent: jest.fn(),
}));
jest.mock('../../services/inventory/mediaInventoryWorkflowService', () => ({
  analyzeVideoForInventory: jest.fn(),
  analyzePhotoForInventory: jest.fn(),
}));
jest.mock('../../services/infra/metricsService', () => ({
  logInteraction: jest.fn().mockResolvedValue(undefined),
}));

const mockCtx = { rooms: [], messages: [] };
jest.mock('../../services/infra/db', () => ({
  db: {
    any: jest.fn(async (sql) => {
      if (/FROM collections/.test(sql)) return mockCtx.rooms;
      if (/FROM nexus_messages/.test(sql)) return mockCtx.messages;
      return [];
    }),
    oneOrNone: jest.fn(async () => null),
    one: jest.fn(async () => ({})),
    none: jest.fn(async () => undefined),
    result: jest.fn(async () => ({ rowCount: 0 })),
  },
}));

const { roomFromCaption, roomFromRecentContext } = require('../../services/inventory/scanJobService');
const { pickPhotoUpdateTarget } = require('../../services/inventory/inventoryMutationService');
const { isLargeImpactItem, isLargeItemRecord } = require('../../services/inventory/itemSpecsReference');

beforeEach(() => {
  mockCtx.rooms = [];
  mockCtx.messages = [];
});

describe('roomFromCaption — contents descriptions are not rooms', () => {
  test('the beta bug: "Everything in this closet" is rejected', () => {
    expect(roomFromCaption('Everything in this closet')).toBeNull();
  });

  test.each([
    'All my stuff',
    'these shelves',
    'the items here',
    'boxes inside',
  ])('rejects %p', (caption) => {
    expect(roomFromCaption(caption)).toBeNull();
  });

  test('real room captions still pass', () => {
    expect(roomFromCaption('Hallway')).toBe('Hallway');
    expect(roomFromCaption('Scanning my Bathroom 1')).toBe('Bathroom 1');
    expect(roomFromCaption('I am scanning my living room')).toBe('Living Room');
  });
});

describe('roomFromRecentContext — the room under discussion fills the gap', () => {
  test('uses the room from the agent\'s last message ("What else should we add to the Hallway?")', async () => {
    mockCtx.rooms = [{ name: 'Hallway' }, { name: 'Kitchen' }, { name: 'Bedroom 2' }];
    mockCtx.messages = [
      { content: 'What else should we add to the Hallway, Owen?' },
      { content: 'Great — the Kitchen is done!' },
    ];
    expect(await roomFromRecentContext('u1', 'sess-1')).toBe('Hallway');
  });

  test('an ambiguous message (two rooms) refuses to guess', async () => {
    mockCtx.rooms = [{ name: 'Hallway' }, { name: 'Kitchen' }];
    mockCtx.messages = [{ content: 'Should we do the Hallway or the Kitchen next?' }];
    expect(await roomFromRecentContext('u1', 'sess-1')).toBeNull();
  });

  test('skips roomless messages and finds the most recent mention', async () => {
    mockCtx.rooms = [{ name: 'Garage' }];
    mockCtx.messages = [
      { content: 'Sounds good!' },
      { content: 'Let\'s finish the Garage next.' },
    ];
    expect(await roomFromRecentContext('u1', 'sess-1')).toBe('Garage');
  });

  test('no session or no rooms → null', async () => {
    expect(await roomFromRecentContext('u1', null)).toBeNull();
    mockCtx.rooms = [];
    expect(await roomFromRecentContext('u1', 'sess-1')).toBeNull();
  });
});

describe('pickPhotoUpdateTarget — a large-item photo updates, never duplicates', () => {
  const existing = [
    { id: 7, name: 'Sofa', room_name: 'Living Room', picture_url: null },
    { id: 8, name: 'Dresser', room_name: 'Bedroom 1', picture_url: 'https://x/d.jpg' },
  ];

  test('matches the photo-less sofa by head noun within the same room', () => {
    const target = pickPhotoUpdateTarget(existing, {
      name: '3-seat sofa', room: 'living room', quantity: 1, pictureUrl: 'https://x/s.jpg',
    });
    expect(target?.id).toBe(7);
  });

  test('an item that already has a photo is not a target (could be a second one)', () => {
    expect(pickPhotoUpdateTarget(existing, {
      name: 'Dresser', room: 'Bedroom 1', quantity: 1, pictureUrl: 'https://x/d2.jpg',
    })).toBeNull();
  });

  test('multi-quantity, missing picture, and cross-room items never match', () => {
    expect(pickPhotoUpdateTarget(existing, { name: 'Sofa', room: 'Living Room', quantity: 2, pictureUrl: 'u' })).toBeNull();
    expect(pickPhotoUpdateTarget(existing, { name: 'Sofa', room: 'Living Room', quantity: 1, pictureUrl: null })).toBeNull();
    expect(pickPhotoUpdateTarget(existing, { name: 'Sofa', room: 'Den', quantity: 1, pictureUrl: 'u' })).toBeNull();
  });
});

describe('large-item detection — trust the record, not just the name', () => {
  test('new lexicon entries catch common big things', () => {
    for (const name of ['Gun safe', 'Kayak', 'Storage cabinet', 'Riding mower', 'Ping pong table']) {
      expect(isLargeImpactItem(name)).toBe(true);
    }
  });

  test('an unrecognized name with big recorded weight or volume still counts', () => {
    expect(isLargeItemRecord({ name: 'Mystery crate', weight_lbs: 120 })).toBe(true);
    expect(isLargeItemRecord({ name: 'Mystery crate', length_in: 48, width_in: 30, height_in: 20 })).toBe(true);
  });

  test('small unknown items stay out of the nudge list', () => {
    expect(isLargeItemRecord({ name: 'Ceramic vase', weight_lbs: 4, length_in: 8, width_in: 8, height_in: 14 })).toBe(false);
  });
});
