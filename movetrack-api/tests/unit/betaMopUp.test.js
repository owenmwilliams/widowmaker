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

describe('next steps — one explicit bullet per gap', () => {
  test('every empty room and every unphotographed large item gets its own bullet', () => {
    // Pure formatting contract, exercised via the strings the sheet renders:
    // "Catalog items in {room}" and "Take a picture of {item}" (2026-07-02
    // request: no summaries, bullets lead straight to Share).
    const emptyRooms = [{ name: 'Bedroom 2' }, { name: 'Bedroom 3' }, { name: 'Living Room' }];
    const largeGaps = [
      { room: 'Living Room', items: ['3-seat sofa', '65-inch TV'] },
      { room: 'Dining Room', items: ['Dining table'] },
    ];
    const bullets = [
      ...emptyRooms.map(r => `Catalog items in ${r.name}`),
      ...largeGaps.flatMap(g => g.items.map(i => `Take a picture of ${i}`)),
    ];
    expect(bullets).toEqual([
      'Catalog items in Bedroom 2',
      'Catalog items in Bedroom 3',
      'Catalog items in Living Room',
      'Take a picture of 3-seat sofa',
      'Take a picture of 65-inch TV',
      'Take a picture of Dining table',
    ]);
  });
});

describe('room resolution — phrases never become rooms', () => {
  const ROOMS = [
    { id: 1, name: 'Bathroom 1' },
    { id: 2, name: 'Bathroom 2' },
    { id: 3, name: 'Living Room' },
    { id: 4, name: 'Dining Room' },
  ];

  function freshMutation() {
    jest.resetModules();
    jest.doMock('../../services/infra/db', () => ({
      db: {
        any: jest.fn(async (sql) => (/FROM collections/.test(sql) ? ROOMS : [])),
        oneOrNone: jest.fn().mockResolvedValue(null),
        one: jest.fn(),
        none: jest.fn(),
      },
    }));
    jest.doMock('../../services/infra/knex', () => jest.fn());
    // The route describe above doMocks this module; take the real one here.
    return jest.requireActual('../../services/inventory/inventoryMutationService');
  }

  test('cleanRoomPhrase strips narration filler', () => {
    const { cleanRoomPhrase } = freshMutation();
    expect(cleanRoomPhrase('I am scanning my living room')).toBe('living room');
    expect(cleanRoomPhrase('Scanning my Bathroom 1')).toBe('bathroom 1');
    expect(cleanRoomPhrase('the dining room')).toBe('dining room');
    expect(cleanRoomPhrase('Den')).toBe('den');
  });

  test('chatty phrases resolve to the existing room', async () => {
    const { matchExistingRoom } = freshMutation();
    expect((await matchExistingRoom('u1', 'Scanning my Bathroom 1')).name).toBe('Bathroom 1');
    expect((await matchExistingRoom('u1', 'I am scanning my living room')).name).toBe('Living Room');
    expect((await matchExistingRoom('u1', 'dining room')).name).toBe('Dining Room');
  });

  test('an ambiguous fragment does not guess between rooms', async () => {
    const { matchExistingRoom } = freshMutation();
    expect(await matchExistingRoom('u1', 'bathroom')).toBeNull(); // 1 or 2 — don't guess
    expect(await matchExistingRoom('u1', 'garage')).toBeNull();   // genuinely new
  });

  test('roomFromCaption cleans the hint the review card shows', () => {
    jest.resetModules();
    // scanJobService's inner require must see the REAL cleanRoomPhrase (the
    // route describe above doMocks inventoryMutationService without it).
    jest.doMock('../../services/inventory/inventoryMutationService', () =>
      jest.requireActual('../../services/inventory/inventoryMutationService'));
    const { roomFromCaption } = jest.requireActual('../../services/inventory/scanJobService');
    expect(roomFromCaption('I am scanning my living room')).toBe('Living Room');
    expect(roomFromCaption('Scanning my Bathroom 1')).toBe('Bathroom 1');
    expect(roomFromCaption('Can you believe how much stuff is in here? Anyway, this is the garage!')).toBeNull();
  });
});

describe('gemini history — seeded greeting survives the leading-edge rule', () => {
  const { buildGeminiContents } = jest.requireActual('../../services/infra/geminiHistoryBuilder');

  test('a leading model greeting is kept via a synthetic bootstrap user turn', () => {
    const contents = buildGeminiContents([
      { role: 'model', content: "Hi! I'm Nexus. What's your name?" },
      { role: 'user', content: 'Owen Williams' },
    ]);
    expect(contents[0].role).toBe('user');            // Gemini's hard requirement
    expect(contents[1].role).toBe('model');
    expect(contents[1].parts[0].text).toMatch(/What's your name/);
    expect(contents[2].parts[0].text).toBe('Owen Williams');
  });

  test('a leading orphaned functionCall is still trimmed, not bootstrapped', () => {
    const contents = buildGeminiContents([
      { role: 'tool_call', tool_name: 'add_room', tool_args: { name: 'Den' }, content: '' },
      { role: 'user', content: 'hello' },
    ]);
    expect(contents[0].role).toBe('user');
    expect(contents[0].parts[0].text).toBe('hello');
  });
});

describe('scan-review pill contract', () => {
  const { enrichMessagesWithActions } = jest.requireActual('../../services/infra/agentSessionService');

  test('the scan marker row is tagged kind=scan_review with its count', () => {
    const rows = [
      { role: 'user', content: 'Here is my video' },
      { role: 'model', content: 'Found 18 items in the Bathroom 1 scan — review card shown.' },
      { role: 'model', content: 'A normal reply.' },
    ];
    const enriched = enrichMessagesWithActions(rows);
    expect(enriched[1].kind).toBe('scan_review');
    expect(enriched[1].scanCount).toBe(18);
    expect(enriched[2].kind).toBeUndefined();
  });

  test('singular form tags too', () => {
    const enriched = enrichMessagesWithActions([
      { role: 'user', content: 'photo' },
      { role: 'model', content: 'Found 1 item in your photo scan — review card shown.' },
    ]);
    expect(enriched[1].kind).toBe('scan_review');
    expect(enriched[1].scanCount).toBe(1);
  });
});

describe('chunked video analysis — long walkthroughs keep their tails', () => {
  const { chunkFrames, mergeChunkResults, analyzeFramesChunked } =
    jest.requireActual('../../services/infra/vision/videoService');

  const frame = (i) => ({ buffer: Buffer.from(`f${i}`), tsSeconds: i });

  test('frames split into consecutive 14-frame windows', () => {
    const chunks = chunkFrames(Array.from({ length: 30 }, (_, i) => frame(i)));
    expect(chunks.map(c => c.frames.length)).toEqual([14, 14, 2]);
    expect(chunks.map(c => c.offset)).toEqual([0, 14, 28]);
  });

  test('short clips take the single-call path untouched', async () => {
    const analyze = jest.fn().mockResolvedValue({ items: [{ name: 'Sofa', source_frame: 2 }], parseError: null });
    const res = await analyzeFramesChunked(
      Array.from({ length: 20 }, (_, i) => frame(i)), 'basic', null, null, null, { _analyzeFn: analyze }
    );
    expect(analyze).toHaveBeenCalledTimes(1);
    expect(res.chunkCount).toBe(1);
    expect(res.items[0].source_frame).toBe(2); // untouched — no remap needed
  });

  test('long videos: every window analyzed, source_frame remapped globally, boundary dupes collapsed', async () => {
    const frames = Array.from({ length: 42 }, (_, i) => frame(i)); // 3 windows
    const analyze = jest.fn()
      .mockResolvedValueOnce({ items: [
        { name: '3-seat sofa', room: 'Living Room', quantity: 1, source_frame: 3 },
      ], parseError: null, usageMetadata: { totalTokenCount: 100 } })
      .mockResolvedValueOnce({ items: [
        { name: '3-seat sofa', room: 'Living Room', quantity: 1, source_frame: 1 },   // same sofa across the boundary
        { name: 'Bookshelf', room: 'Living Room', quantity: 2, source_frame: 5 },
      ], parseError: null, usageMetadata: { totalTokenCount: 100 } })
      .mockResolvedValueOnce({ items: [
        { name: 'Bar cart', room: 'Living Room', quantity: 1, source_frame: 14 },     // END-of-video item
      ], parseError: null, truncated: true, usageMetadata: { totalTokenCount: 100 } });

    const res = await analyzeFramesChunked(frames, 'basic', 'Living Room', null, null, { _analyzeFn: analyze });

    expect(analyze).toHaveBeenCalledTimes(3);
    // Narration audio only accompanies the first window.
    expect(analyze.mock.calls.filter(c => c[3] !== null)).toHaveLength(0); // audio was null here anyway
    expect(res.chunkCount).toBe(3);
    const names = res.items.map(i => i.name);
    expect(names).toEqual(['3-seat sofa', 'Bookshelf', 'Bar cart']); // dupe collapsed, tail kept
    // Global thumbnail mapping: chunk 2's frame 5 → 14+5 = 19; chunk 3's 14 → 28+14 = 42.
    expect(res.items.find(i => i.name === 'Bookshelf').source_frame).toBe(19);
    expect(res.items.find(i => i.name === 'Bar cart').source_frame).toBe(42);
    expect(res.truncated).toBe(true);                 // any truncated window flags the scan
    expect(res.usageMetadata.totalTokenCount).toBe(300);
  });

  test('audio goes to the first window only', async () => {
    const frames = Array.from({ length: 30 }, (_, i) => frame(i));
    const analyze = jest.fn().mockResolvedValue({ items: [], parseError: null });
    await analyzeFramesChunked(frames, 'basic', null, Buffer.from('audio'), null, { _analyzeFn: analyze });
    const audioArgs = analyze.mock.calls.map(c => c[3]);
    expect(audioArgs.filter(a => a !== null)).toHaveLength(1);
    expect(analyze.mock.calls[0][3]).not.toBeNull();
  });

  test('a failed window degrades to truncated, never a dead scan', async () => {
    const frames = Array.from({ length: 30 }, (_, i) => frame(i));
    const analyze = jest.fn()
      .mockResolvedValueOnce({ items: [{ name: 'Sofa', room: 'A', quantity: 1, source_frame: 1 }], parseError: null })
      .mockRejectedValueOnce(new Error('503 overloaded'));
    const res = await analyzeFramesChunked(frames, 'basic', null, null, null, { _analyzeFn: analyze });
    expect(res.items).toHaveLength(1);
    expect(res.truncated).toBe(true);
  });
});
