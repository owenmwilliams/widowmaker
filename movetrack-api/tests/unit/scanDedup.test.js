'use strict';

/**
 * Unit tests for the redesigned add/dedup control plane (issue #43, arbiter round 2).
 *
 * The guard must kill the §0.3 double-add WITHOUT ever silently dropping
 * legitimate items. It is keyed on scan identity + the just-committed review
 * card (read from the transcript) — never a bare (name, room) window. These
 * tests lock in that behavior; rescanRecommit.test.js proves the end-to-end
 * rescan→recommit flow lands corrected data.
 *
 * DB-free: `db` and the inventory mutation service are mocked.
 */

const mockDb = {
  any: jest.fn(),
  one: jest.fn(),
  oneOrNone: jest.fn(),
  none: jest.fn().mockResolvedValue(undefined),
  tx: jest.fn(),
};
jest.mock('../../services/infra/db', () => ({ db: mockDb }));

const mockAddItem = jest.fn();
jest.mock('../../services/inventory/inventoryMutationService', () => ({
  addItem: (...args) => mockAddItem(...args),
}));

const census = require('../../agents/censusAgent');

/** Build a transcript row as recentReviewCommits' query returns it. */
function commitRow(items, scanId) {
  return { tool_args: { _via: 'review_card', _scanId: scanId, items } };
}

beforeEach(() => {
  mockDb.any.mockReset();
  mockDb.one.mockReset();
  mockDb.oneOrNone.mockReset();
  mockDb.none.mockReset().mockResolvedValue(undefined);
  mockDb.tx.mockReset();
  mockAddItem.mockReset().mockResolvedValue({ success: true, itemId: 1 });
});

describe('recentReviewCommits', () => {
  test('parses committed keys, names, and scanIds from the transcript', async () => {
    mockDb.any.mockResolvedValue([
      commitRow([{ name: 'Dining Table', room_name: 'Dining Room' }, { name: 'Wine Rack', room_name: 'Dining Room' }], 'scan-A'),
    ]);
    const { keys, names, scanIds } = await census.recentReviewCommits('u1');
    expect(keys.has('dining table|dining room')).toBe(true);
    expect(names.has('wine rack')).toBe(true);
    expect(scanIds.has('scan-A')).toBe(true);
  });
});

describe('scanAlreadyCommitted — scan identity, not names', () => {
  test('true for a committed scanId, false for a fresh (rescan) scanId', async () => {
    mockDb.any.mockResolvedValue([commitRow([{ name: 'Sofa', room_name: 'Living Room' }], 'scan-A')]);
    expect(await census.scanAlreadyCommitted('u1', 'scan-A')).toBe(true);
    // A rescan produces a NEW scanId — must NOT be treated as already committed,
    // so its corrected items can land.
    expect(await census.scanAlreadyCommitted('u1', 'scan-B')).toBe(false);
  });

  test('null/empty scanId is never "already committed"', async () => {
    expect(await census.scanAlreadyCommitted('u1', null)).toBe(false);
    expect(mockDb.any).not.toHaveBeenCalled();
  });
});

describe('addItemsDeduped — chat "add them all" path', () => {
  const SCAN = [
    { name: 'Dining Table', room_name: 'Dining Room' },
    { name: 'Dining Chair', room_name: 'Dining Room' },
    { name: 'China Cabinet', room_name: 'Dining Room' },
  ];

  test('skips exactly the items the user just committed via the card (§0.3 double-add)', async () => {
    mockDb.any.mockResolvedValue([commitRow(SCAN, 'scan-A')]);
    const result = await census.addItemsDeduped('u1', SCAN);
    expect(result.added).toBe(0);
    expect(result.skipped).toBe(3);
    expect(mockAddItem).not.toHaveBeenCalled();
  });

  test('does NOT drop a distinct same-named item in a different room', async () => {
    mockDb.any.mockResolvedValue([commitRow([{ name: 'Dining Chair', room_name: 'Dining Room' }], 'scan-A')]);
    const result = await census.addItemsDeduped('u1', [{ name: 'Dining Chair', room_name: 'Kitchen' }]);
    expect(result.added).toBe(1);
    expect(result.skipped).toBe(0);
    expect(mockAddItem).toHaveBeenCalledTimes(1);
  });

  test('closes the room-less false-negative: a bare chat name matches the card\'s Unsorted default', async () => {
    // Card committed with an explicit room; chat re-adds the same name with NO room.
    mockDb.any.mockResolvedValue([commitRow([{ name: 'Floor Lamp', room_name: 'Unsorted' }], 'scan-A')]);
    const result = await census.addItemsDeduped('u1', [{ name: 'Floor Lamp' }]);
    expect(result.added).toBe(0);
    expect(result.skipped).toBe(1);
  });

  test('adds genuinely new items even when a card was recently committed', async () => {
    mockDb.any.mockResolvedValue([commitRow([{ name: 'Sofa', room_name: 'Living Room' }], 'scan-A')]);
    const result = await census.addItemsDeduped('u1', [{ name: 'Coffee Table', room_name: 'Living Room' }]);
    expect(result.added).toBe(1);
    expect(result.skipped).toBe(0);
  });

  test('reports per-item failures honestly instead of dropping them', async () => {
    mockDb.any.mockResolvedValue([]);
    mockAddItem
      .mockResolvedValueOnce({ success: true })
      .mockResolvedValueOnce({ success: false, error: 'No location found' });
    const result = await census.addItemsDeduped('u1', [
      { name: 'Sofa', room_name: 'Living Room' },
      { name: 'Rug', room_name: 'Living Room' },
    ]);
    expect(result.added).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.failures).toEqual([{ name: 'Rug', error: 'No location found' }]);
  });

  test('a commit-index lookup failure never blocks the add (fails open)', async () => {
    mockDb.any.mockRejectedValue(new Error('db down'));
    const result = await census.addItemsDeduped('u1', SCAN);
    expect(result.added).toBe(3);
    expect(mockAddItem).toHaveBeenCalledTimes(3);
  });
});

describe('recordCensusToolCall — transactional + fresh-session seed', () => {
  function wireTx() {
    const txNone = jest.fn().mockResolvedValue(undefined);
    mockDb.tx.mockImplementation(async (cb) => cb({ none: txNone }));
    return txNone;
  }

  test('writes tool_call + tool_result inside a single transaction', async () => {
    mockDb.oneOrNone.mockResolvedValue({ id: 'sess-1' });
    mockDb.one.mockResolvedValue({ cnt: 5 }); // session already has turns
    const txNone = wireTx();

    const sessionId = await census.recordCensusToolCall('u1', 'add_items', { items: [] }, { success: true });

    expect(sessionId).toBe('sess-1');
    expect(mockDb.tx).toHaveBeenCalledTimes(1);
    const sqls = txNone.mock.calls.map(c => c[0]);
    expect(sqls.some(s => s.includes("'tool_call'"))).toBe(true);
    expect(sqls.some(s => s.includes("'tool_result'"))).toBe(true);
    // No seed user turn when the session already has turns.
    expect(sqls.some(s => s.includes("'user'"))).toBe(false);
  });

  test('seeds a leading user turn for a brand-new session so the record survives history trimming', async () => {
    mockDb.oneOrNone.mockResolvedValue(null);
    mockDb.one
      .mockResolvedValueOnce({ id: 'new-sess' }) // INSERT ... RETURNING id
      .mockResolvedValueOnce({ cnt: 0 });         // count of user/model turns
    const txNone = wireTx();

    await census.recordCensusToolCall('u1', 'add_items', { items: [] }, { success: true });

    const sqls = txNone.mock.calls.map(c => c[0]);
    expect(sqls.some(s => s.includes("'user'"))).toBe(true); // seed turn present
  });
});
