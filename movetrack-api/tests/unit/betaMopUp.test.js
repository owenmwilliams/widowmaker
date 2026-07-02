'use strict';

/**
 * TestFlight mop-up round (2026-07-02 feedback):
 *  1. Video item schema REQUIRES size/weight/locator — optional fields were
 *     routinely omitted under structured output (0×0×0 rows, no thumbnails).
 *  2. A fresh user's first open seeds the greeting as a transcript row, so
 *     their first message is a reply the model has context for.
 *  3. Resolving duplicates from the native card is recorded to the transcript,
 *     so the agent never re-offers a review the user already did.
 *  4. Media gaps include EMPTY rooms — an unscanned room must not read as a
 *     green "every room has a walkthrough" check.
 */

describe('video item schema requires review-card fields', () => {
  const { framesResponseSchema, videoItemsArraySchema } = require('../../services/infra/vision/visionSchemas');

  test('frames path requires size, weight, room, and source_frame', () => {
    // hasAudio=false → a bare ARRAY schema; its .items is the per-item schema.
    const itemSchema = framesResponseSchema(false).items;
    for (const f of ['name', 'quantity', 'room', 'estimated_weight_lbs', 'estimated_dimensions', 'source_frame']) {
      expect(itemSchema.required).toContain(f);
    }
    expect(itemSchema.properties.estimated_dimensions.required)
      .toEqual(expect.arrayContaining(['length_in', 'width_in', 'height_in']));
  });

  test('inline path requires the timestamp locator instead', () => {
    const itemSchema = videoItemsArraySchema.items;
    expect(itemSchema.required).toContain('timestamp_seconds');
    expect(itemSchema.required).not.toContain('source_frame');
  });
});

describe('nexus routes — greeting seed and duplicate-resolution visibility', () => {
  const sessionCalls = [];
  const dbNone = jest.fn().mockResolvedValue(undefined);

  jest.doMock('../../services/infra/db', () => ({
    db: {
      any: jest.fn().mockResolvedValue([]),
      one: jest.fn(async (sql) => {
        sessionCalls.push(sql);
        return { id: 'sess-new', user_id: 'user-1', session_type: 'general', title: null };
      }),
      oneOrNone: jest.fn(async (sql) => {
        if (/onboarding_completed/.test(sql)) return { onboarding_completed: false };
        if (/nexus_sessions/.test(sql)) return { id: 'sess-new' };
        return null;
      }),
      none: dbNone,
      tx: jest.fn(),
    },
  }));
  jest.doMock('../../services/infra/authService', () => ({
    authenticate: (req, _res, next) => { req.user = { user_id: 'user-1' }; next(); },
    resolveEffectivePlan: () => 'basic',
  }));
  jest.doMock('../../services/infra/agentSessionService', () => ({
    getActiveSession: jest.fn().mockResolvedValue(null),
    getSessionMessages: jest.fn().mockResolvedValue([]),
    enrichMessagesWithActions: (m) => m,
    getQuickStartChips: jest.fn().mockResolvedValue([]),
  }));
  jest.doMock('../../agents/nexusOrchestratorAgent', () => ({ processMessage: jest.fn() }));
  jest.doMock('../../agents/schemas/workflowGuidance', () => ({
    buildWorkflowGuidanceContext: jest.fn().mockResolvedValue({}),
  }));
  jest.doMock('../../agents/censusAgent', () => ({
    mapDetectedItemsForClient: (items) => items || [],
    scanAlreadyCommitted: jest.fn().mockResolvedValue(false),
    recordCensusToolCall: jest.fn().mockResolvedValue('sess-1'),
    recentReviewCommits: jest.fn().mockResolvedValue({ keys: new Set(), names: new Set(), scanIds: new Set() }),
    dedupKey: (n, r) => `${n}|${r}`,
  }));
  jest.doMock('../../services/infra/mediaAssetService', () => ({ reserveUpload: jest.fn(), ingestUpload: jest.fn() }));
  jest.doMock('../../services/infra/gcsService', () => ({ BUCKET: 'test-bucket', getSignedUploadUrl: jest.fn() }));
  jest.doMock('../../services/inventory/inventoryMutationService', () => ({
    addItem: jest.fn().mockResolvedValue({ success: true }),
    deleteItem: jest.fn().mockResolvedValue({ success: true }),
  }));
  jest.doMock('../../services/inventory/mediaInventoryWorkflowService', () => ({
    analyzeVideoForInventory: jest.fn(),
    analyzePhotoForInventory: jest.fn(),
  }));
  jest.doMock('../../services/inventory/scanJobService', () => ({
    createJob: jest.fn(), getJob: jest.fn(), listUnconsumed: jest.fn().mockResolvedValue([]),
    markConsumed: jest.fn(), toDTO: (r) => r, recoverStaleJobs: jest.fn().mockResolvedValue(0),
    isAllowedMediaUrl: () => true, UUID_RE: /^[0-9a-f-]{36}$/i,
  }));

  const request = require('supertest');
  const express = require('express');

  function makeApp() {
    const router = require('../../routes/api/agents/nexus');
    const app = express();
    app.use('/api/agents/nexus', router);
    return app;
  }

  test('first /active-session seeds a session + greeting model row', async () => {
    const res = await request(makeApp()).get('/api/agents/nexus/active-session');
    expect(res.status).toBe(200);
    expect(res.body.session).toBeTruthy();
    // The greeting was inserted as a model transcript row.
    const greetingInsert = dbNone.mock.calls.find(
      ([sql, params]) => /INSERT INTO nexus_messages/.test(sql) && /What's your name\?/.test(String(params?.[1]))
    );
    expect(greetingInsert).toBeTruthy();
  });

  test('resolve-duplicates records the outcome to the transcript', async () => {
    const census = require('../../agents/censusAgent');
    const res = await request(makeApp())
      .post('/api/agents/nexus/inventory/resolve-duplicates')
      .send({ removeItemIds: ['1', '2'] });
    expect(res.status).toBe(200);
    expect(res.body.removedCount).toBe(2);
    const call = census.recordCensusToolCall.mock.calls.find(([, tool]) => tool === 'find_duplicates');
    expect(call).toBeTruthy();
    expect(call[3]).toMatchObject({ resolved: true, removedCount: 2 });
  });
});

describe('media gaps include empty rooms', () => {
  test('a room with zero items and no video is a walkthrough gap', async () => {
    jest.resetModules();
    jest.doMock('../../services/infra/db', () => ({
      db: {
        any: jest.fn(async (sql) => {
          if (/FROM collections/.test(sql)) {
            return [
              { name: 'Living Room', item_count: 0 },
              { name: 'Bathroom 1', item_count: 13 },
            ];
          }
          return [];
        }),
        oneOrNone: jest.fn().mockResolvedValue(null),
        one: jest.fn(),
        none: jest.fn(),
      },
    }));
    jest.doMock('../../services/inventory/roomVideoService', () => ({
      listRoomVideos: jest.fn().mockResolvedValue([{ room_name: 'Bathroom 1' }]),
    }));
    const { getMediaGaps } = require('../../services/inventory/inventoryMaturityService');
    const gaps = await getMediaGaps('user-1');
    expect(gaps.roomsMissingVideo.map(r => r.room)).toContain('Living Room');
    expect(gaps.roomsMissingVideo.map(r => r.room)).not.toContain('Bathroom 1');
  });
});
