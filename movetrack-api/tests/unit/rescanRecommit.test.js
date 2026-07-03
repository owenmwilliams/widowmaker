'use strict';

/**
 * Route-level regression for the rescan → recommit flow and the /rescan security
 * guard (issue #43, arbiter round 2). Proves:
 *   • A rescan re-runs analysis and returns corrected items with a fresh scanId.
 *   • Committing those corrected items (new scanId) lands ALL of them — the
 *     redesigned guard never name-drops the user's curated list.
 *   • Re-submitting the SAME card (same scanId) is idempotent — no duplicates.
 *   • /rescan rejects URLs outside the caller's own GCS prefix (SSRF / cross-user).
 *
 * The nexus router is mounted in isolation with the I/O collaborators mocked, so
 * this runs DB-free in CI.
 */

jest.mock('../../services/infra/db', () => ({
  db: { any: jest.fn(), one: jest.fn(), oneOrNone: jest.fn(), none: jest.fn(), tx: jest.fn() },
}));
jest.mock('../../services/infra/authService', () => ({
  authenticate: (req, _res, next) => { req.user = { user_id: 'user-1' }; next(); },
  resolveEffectivePlan: () => 'basic',
}));
jest.mock('../../agents/nexusOrchestratorAgent', () => ({ processMessage: jest.fn() }));
jest.mock('../../services/infra/mediaAssetService', () => ({ reserveUpload: jest.fn(), ingestUpload: jest.fn() }));
jest.mock('../../services/infra/gcsService', () => ({ BUCKET: 'test-bucket', getSignedUploadUrl: jest.fn() }));
jest.mock('../../services/inventory/inventoryMutationService', () => ({
  addItem: jest.fn(),
  attachItemPhoto: jest.fn(),
  // pure matcher — use the real one so the commit route's photo-update branch
  // behaves exactly as in production (no targets here: db.any returns [])
  pickPhotoUpdateTarget: jest.requireActual('../../services/inventory/inventoryMutationService').pickPhotoUpdateTarget,
}));
jest.mock('../../services/inventory/mediaInventoryWorkflowService', () => ({
  analyzeVideoForInventory: jest.fn(),
  analyzePhotoForInventory: jest.fn(),
}));
jest.mock('../../agents/censusAgent', () => ({
  mapDetectedItemsForClient: (items) => (items || []).map(i => ({
    name: i.name || 'Item', quantity: 1, room: i.room || null, pictureUrl: null,
    weightLbs: i.weight_lbs || null, lengthIn: null, widthIn: null, heightIn: null,
    material: null, fragile: false, confidence: null,
  })),
  scanAlreadyCommitted: jest.fn(),
  recordCensusToolCall: jest.fn().mockResolvedValue('sess-1'),
  recentReviewCommits: jest.fn(),
  dedupKey: (n, r) => `${String(n || '').toLowerCase().trim()}|${String(r || '').toLowerCase().trim()}`,
}));

const request = require('supertest');
const express = require('express');
const media = require('../../services/inventory/mediaInventoryWorkflowService');
const mutation = require('../../services/inventory/inventoryMutationService');
const census = require('../../agents/censusAgent');
const router = require('../../routes/api/agents/nexus');

const BASE = '/api/agents/nexus';
const OWN_VIDEO = 'https://storage.googleapis.com/test-bucket/users/user-1/chat/nexus/abc.mp4';

function makeApp() {
  const app = express();
  app.use(BASE, router);
  return app;
}

beforeEach(() => {
  media.analyzeVideoForInventory.mockReset();
  media.analyzePhotoForInventory.mockReset();
  mutation.addItem.mockReset().mockResolvedValue({ success: true, itemId: 1 });
  census.scanAlreadyCommitted.mockReset().mockResolvedValue(false);
  census.recordCensusToolCall.mockReset().mockResolvedValue('sess-1');
});

describe('POST /rescan — security guard', () => {
  test('rejects a URL outside our GCS bucket (SSRF)', async () => {
    const res = await request(makeApp()).post(`${BASE}/rescan`)
      .send({ url: 'http://169.254.169.254/latest/meta-data/', mimeType: 'video/mp4' });
    expect(res.status).toBe(403);
    expect(media.analyzeVideoForInventory).not.toHaveBeenCalled();
  });

  test('rejects another user\'s media (cross-user read-back)', async () => {
    const res = await request(makeApp()).post(`${BASE}/rescan`)
      .send({ url: 'https://storage.googleapis.com/test-bucket/users/user-2/chat/nexus/x.mp4', mimeType: 'video/mp4' });
    expect(res.status).toBe(403);
    expect(media.analyzeVideoForInventory).not.toHaveBeenCalled();
  });

  test('rejects a path-traversal attempt', async () => {
    const res = await request(makeApp()).post(`${BASE}/rescan`)
      .send({ url: 'https://storage.googleapis.com/test-bucket/users/user-1/../user-2/x.mp4', mimeType: 'video/mp4' });
    expect(res.status).toBe(403);
  });

  test('accepts the caller\'s own media and returns items + a fresh scanId', async () => {
    media.analyzeVideoForInventory.mockResolvedValue({
      success: true,
      items: [{ name: 'Dining Table' }, { name: 'Dining Chair' }, { name: 'China Cabinet' }],
    });
    const res = await request(makeApp()).post(`${BASE}/rescan`)
      .send({ url: OWN_VIDEO, mimeType: 'video/mp4', room: 'Dining Room' });
    expect(res.status).toBe(200);
    expect(res.body.itemCount).toBe(3);
    expect(typeof res.body.scanId).toBe('string');
    expect(res.body.scanId.length).toBeGreaterThan(0);
  });

  test('a scan failure surfaces honestly (no fake empty success)', async () => {
    media.analyzeVideoForInventory.mockResolvedValue({ success: false, error: 'frame extraction failed' });
    const res = await request(makeApp()).post(`${BASE}/rescan`)
      .send({ url: OWN_VIDEO, mimeType: 'video/mp4' });
    expect(res.status).toBe(502);
  });
});

describe('rescan → recommit lands corrected data (no name-drops, idempotent re-submit)', () => {
  test('committing a rescan\'s corrected items adds ALL of them', async () => {
    // Simulate the corrected scan (was 2 items, now 9). scanAlreadyCommitted=false
    // because this is a NEW card (fresh scanId).
    census.scanAlreadyCommitted.mockResolvedValue(false);
    const corrected = Array.from({ length: 9 }, (_, i) => ({ name: `Item ${i + 1}`, room: 'Dining Room' }));

    const res = await request(makeApp()).post(`${BASE}/inventory/commit`)
      .send({ items: corrected, room: 'Dining Room', scanId: 'scan-rescan-1' });

    expect(res.status).toBe(200);
    expect(res.body.addedCount).toBe(9);   // nothing dropped
    expect(res.body.skippedCount).toBe(0);
    expect(mutation.addItem).toHaveBeenCalledTimes(9);
  });

  test('re-submitting the SAME card (same scanId) is idempotent — no duplicate rows', async () => {
    census.scanAlreadyCommitted.mockResolvedValue(true); // this scanId already committed
    const items = [{ name: 'Sofa', room: 'Living Room' }, { name: 'TV', room: 'Living Room' }];

    const res = await request(makeApp()).post(`${BASE}/inventory/commit`)
      .send({ items, room: 'Living Room', scanId: 'scan-A' });

    expect(res.status).toBe(200);
    expect(res.body.addedCount).toBe(0);
    expect(res.body.alreadyCommitted).toBe(true);
    expect(res.body.skippedCount).toBe(2);
    expect(mutation.addItem).not.toHaveBeenCalled(); // no second insert
  });

  test('two distinct scans of the same room both land (different scanIds)', async () => {
    census.scanAlreadyCommitted.mockResolvedValue(false);
    // First corner
    let res = await request(makeApp()).post(`${BASE}/inventory/commit`)
      .send({ items: [{ name: 'Dining Chair', room: 'Dining Room' }], room: 'Dining Room', scanId: 'scan-corner-1' });
    expect(res.body.addedCount).toBe(1);
    // Second corner — a physically distinct chair, different scanId → not skipped
    res = await request(makeApp()).post(`${BASE}/inventory/commit`)
      .send({ items: [{ name: 'Dining Chair', room: 'Dining Room' }], room: 'Dining Room', scanId: 'scan-corner-2' });
    expect(res.body.addedCount).toBe(1);
    expect(mutation.addItem).toHaveBeenCalledTimes(2);
  });

  test('commit surfaces per-item failures rather than dropping them', async () => {
    census.scanAlreadyCommitted.mockResolvedValue(false);
    mutation.addItem
      .mockResolvedValueOnce({ success: true })
      .mockResolvedValueOnce({ success: false, error: 'No location found' });
    const res = await request(makeApp()).post(`${BASE}/inventory/commit`)
      .send({ items: [{ name: 'Sofa', room: 'Living Room' }, { name: 'Rug', room: 'Living Room' }], scanId: 'scan-x' });
    expect(res.body.addedCount).toBe(1);
    expect(res.body.failedCount).toBe(1);
    expect(res.body.failures[0]).toMatchObject({ name: 'Rug' });
  });
});
