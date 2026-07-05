'use strict';

/**
 * Targeted scan asks — captions become instructions (murphy-bed bug).
 *
 * A user who said "Please add this queen sized murphy bed to bedroom 2..."
 * got a generic 17-item room scan: the caption only ever fed room inference
 * and the vision model never saw it. These tests prove:
 *   • captionIntent classifies specific-item asks vs room labels/narration.
 *   • runJob threads user_note + scan_mode into the analyze args (photo,
 *     photo batch, video) and surfaces scanMode/userNote in the job result.
 *   • GOLDEN-SET INVARIANT: with no caption, analyze args carry NO new keys
 *     and every vision prompt is byte-identical to today's constants.
 *   • The note is a fixture keep-list: a note-named "murphy bed" survives
 *     partitionFixtures while an un-named toilet is still dropped.
 *   • Chunked video analysis passes the note to EVERY chunk.
 *   • /rescan accepts an optional note and threads it the same way.
 */

const mockAnalyzeVideo = jest.fn();
const mockAnalyzePhoto = jest.fn();

jest.mock('../../services/infra/scanEventsService', () => ({
  createScanRecorder: jest.fn(() => ({ onStage: jest.fn(), finish: jest.fn() })),
  recordScanEvent: jest.fn(),
}));
jest.mock('../../services/inventory/mediaInventoryWorkflowService', () => ({
  analyzeVideoForInventory: (...a) => mockAnalyzeVideo(...a),
  analyzePhotoForInventory: (...a) => mockAnalyzePhoto(...a),
}));
jest.mock('../../services/infra/metricsService', () => ({
  logInteraction: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../services/infra/authService', () => ({
  authenticate: (req, _res, next) => { req.user = { user_id: 'user-1' }; next(); },
  resolveEffectivePlan: () => 'basic',
}));
jest.mock('../../agents/nexusOrchestratorAgent', () => ({ processMessage: jest.fn() }));
jest.mock('../../services/infra/mediaAssetService', () => ({ reserveUpload: jest.fn(), ingestUpload: jest.fn() }));
jest.mock('../../services/infra/gcsService', () => ({ BUCKET: 'test-bucket', getSignedUploadUrl: jest.fn() }));
jest.mock('../../agents/censusAgent', () => ({
  mapDetectedItemsForClient: (items) => (items || []).map(i => ({ name: i.name || 'Item' })),
  scanAlreadyCommitted: jest.fn().mockResolvedValue(false),
  recordCensusToolCall: jest.fn().mockResolvedValue('sess-1'),
  recentReviewCommits: jest.fn(),
  dedupKey: (n, r) => `${String(n || '').toLowerCase()}|${String(r || '').toLowerCase()}`,
}));

const mockState = { inserted: [], results: [], claimable: null };
jest.mock('../../services/infra/db', () => ({
  db: {
    one: jest.fn(async (sql, params) => {
      mockState.inserted.push({ sql, params });
      return { id: 'job-1', session_id: 'sess-1', _inserted: true };
    }),
    oneOrNone: jest.fn(async (sql) => {
      if (/UPDATE scan_jobs[\s\S]*RETURNING/.test(sql) && /processing/.test(sql)) {
        const job = mockState.claimable;
        mockState.claimable = null;
        return job;
      }
      return { id: 'sess-1' };
    }),
    none: jest.fn(async (sql, params) => { mockState.inserted.push({ sql, params }); }),
    result: jest.fn(async (sql, params) => {
      mockState.results.push({ sql, params });
      return { rowCount: 1 };
    }),
    any: jest.fn(async () => []),
    manyOrNone: jest.fn(async () => []),
    tx: jest.fn(),
  },
}));

const request = require('supertest');
const express = require('express');
const scanJobs = require('../../services/inventory/scanJobService');
const {
  captionIntent,
  partitionFixtures,
  buildScanNoteSection,
  noteNamesItem,
} = require('../../services/infra/vision/scanItemFilters');
const videoService = require('../../services/infra/vision/videoService');
const imageService = require('../../services/infra/vision/imageService');
const nexusRouter = require('../../routes/api/agents/nexus');

const MURPHY = 'Please add this queen sized murphy bed to bedroom 2. Please also add a queen sized mattress which is inside';

beforeEach(() => {
  mockState.inserted.length = 0;
  mockState.results.length = 0;
  mockState.claimable = null;
  mockAnalyzePhoto.mockReset();
  mockAnalyzeVideo.mockReset();
});

// ── Intent classifier ────────────────────────────────────────────────────────

describe('captionIntent', () => {
  test('the murphy-bed sentence is a targeted ask', () => {
    expect(captionIntent(MURPHY)).toBe('targeted');
  });

  test.each([
    ['Add this piano', 'targeted'],
    ['please include the treadmill', 'targeted'],
    ['Just the murphy bed', 'targeted'],
    ['only the sofa please', 'targeted'],
    ['Add murphy bed', 'targeted'],
  ])('%p → %p', (caption, expected) => {
    expect(captionIntent(caption)).toBe(expected);
  });

  test.each([
    ['Hallway'],
    ['scanning my living room'],
    [''],
    [null],
    [undefined],
    ['Everything in this closet'],
    ['add everything you can see'],
    ['please add all the items in this room'],
    ['Bedroom 2'],
    ['add to bedroom 2'],   // no named object — ambiguous stays full
  ])('%p → full', (caption) => {
    expect(captionIntent(caption)).toBe('full');
  });
});

// ── runJob threading (photo + video) ────────────────────────────────────────

function baseJob(overrides = {}) {
  return {
    id: '22222222-2222-4222-8222-222222222222',
    user_id: 'u1',
    session_id: 'sess-1',
    media_url: 'https://storage.googleapis.com/test-bucket/users/u1/chat/nexus/a.jpg',
    media_urls: null,
    mime_type: 'image/jpeg',
    media_kind: 'photo',
    room_hint: 'Bedroom 2',
    caption: null,
    plan: 'basic',
    attempts: 1,
    created_at: new Date().toISOString(),
    started_at: new Date().toISOString(),
    ...overrides,
  };
}

function completedResult() {
  const upd = mockState.results.find(c => /status = 'completed'/.test(c.sql));
  return upd ? JSON.parse(upd.params[1]) : null;
}

describe('runJob passes user_note + scan_mode for targeted captions', () => {
  test('photo job: caption rides as user_note with scan_mode targeted', async () => {
    mockState.claimable = baseJob({ caption: MURPHY });
    mockAnalyzePhoto.mockResolvedValue({ success: true, items: [{ name: 'Murphy Bed' }], itemCount: 1 });

    await scanJobs.processJob();

    const args = mockAnalyzePhoto.mock.calls[0][0];
    expect(args.user_note).toBe(MURPHY);
    expect(args.scan_mode).toBe('targeted');
    expect(args.mode).toBe('multi_item');
    expect(args.room_hint).toBe('Bedroom 2');

    const result = completedResult();
    expect(result.scanMode).toBe('targeted');
    expect(result.userNote).toBe(MURPHY);
  });

  test('photo BATCH job: files[] args carry the note too', async () => {
    const urls = [
      'https://storage.googleapis.com/test-bucket/users/u1/chat/nexus/a.jpg',
      'https://storage.googleapis.com/test-bucket/users/u1/chat/nexus/b.jpg',
    ];
    mockState.claimable = baseJob({ media_urls: urls, caption: 'Just the murphy bed' });
    mockAnalyzePhoto.mockResolvedValue({ success: true, items: [{ name: 'Murphy Bed' }], itemCount: 1 });

    await scanJobs.processJob();

    const args = mockAnalyzePhoto.mock.calls[0][0];
    expect(args.files).toHaveLength(2);
    expect(args.user_note).toBe('Just the murphy bed');
    expect(args.scan_mode).toBe('targeted');
  });

  test('video job: caption rides as user_note with scan_mode targeted', async () => {
    mockState.claimable = baseJob({
      media_kind: 'video',
      mime_type: 'video/quicktime',
      media_url: 'https://storage.googleapis.com/test-bucket/users/u1/chat/nexus/a.mov',
      caption: MURPHY,
    });
    mockAnalyzeVideo.mockResolvedValue({ success: true, items: [{ name: 'Murphy Bed' }], itemCount: 1 });

    await scanJobs.processJob();

    const args = mockAnalyzeVideo.mock.calls[0][0];
    expect(args.user_note).toBe(MURPHY);
    expect(args.scan_mode).toBe('targeted');
  });

  test('a room-label caption is passed as a note but classified full', async () => {
    mockState.claimable = baseJob({ caption: 'Hallway', room_hint: 'Hallway' });
    mockAnalyzePhoto.mockResolvedValue({ success: true, items: [{ name: 'Rug' }], itemCount: 1 });

    await scanJobs.processJob();

    const args = mockAnalyzePhoto.mock.calls[0][0];
    expect(args.user_note).toBe('Hallway');
    expect(args.scan_mode).toBe('full');

    const result = completedResult();
    expect(result.scanMode).toBe('full');
    expect(result).not.toHaveProperty('userNote'); // only surfaced when targeted
  });

  test('the transcript marker text format is EXACTLY unchanged', async () => {
    mockState.claimable = baseJob({ caption: MURPHY });
    mockAnalyzePhoto.mockResolvedValue({ success: true, items: [{ name: 'Murphy Bed' }, { name: 'Mattress' }], itemCount: 2 });

    await scanJobs.processJob();

    const marker = mockState.inserted.find(c =>
      /INSERT INTO nexus_messages/.test(c.sql) && /'model'/.test(c.sql));
    expect(marker.params[1]).toBe('Found 2 items in the Bedroom 2 scan — review card shown.');
    expect(marker.params[1]).toMatch(/^Found \d+ items? in .+ scan — review card shown\.$/);
  });
});

// ── Golden-set invariant: no caption → byte-identical args and prompts ──────

describe('golden-set invariant (no caption/note)', () => {
  test('photo args carry NO user_note/scan_mode keys', async () => {
    mockState.claimable = baseJob({ caption: null });
    mockAnalyzePhoto.mockResolvedValue({ success: true, items: [{ name: 'Sofa' }], itemCount: 1 });

    await scanJobs.processJob();

    const args = mockAnalyzePhoto.mock.calls[0][0];
    expect(Object.keys(args).sort()).toEqual(['file_url', 'mime_type', 'mode', 'room_hint']);
    expect(args).not.toHaveProperty('user_note');
    expect(args).not.toHaveProperty('scan_mode');
  });

  test('video args carry NO user_note/scan_mode keys', async () => {
    mockState.claimable = baseJob({
      media_kind: 'video',
      mime_type: 'video/quicktime',
      caption: null,
    });
    mockAnalyzeVideo.mockResolvedValue({ success: true, items: [{ name: 'Sofa' }], itemCount: 1 });

    await scanJobs.processJob();

    const args = mockAnalyzeVideo.mock.calls[0][0];
    expect(Object.keys(args).sort()).toEqual(['file_url', 'mime_type', 'room_hint']);
  });

  test('buildScanNoteSection is empty for no note — PROMPT + "" is byte-identical', () => {
    expect(buildScanNoteSection(null)).toBe('');
    expect(buildScanNoteSection(undefined)).toBe('');
    expect(buildScanNoteSection('')).toBe('');
    expect(buildScanNoteSection('   ')).toBe('');
    expect(imageService.MULTI_ITEM_VISION_PROMPT + buildScanNoteSection(null))
      .toBe(imageService.MULTI_ITEM_VISION_PROMPT);
  });

  test('the four vision prompt constants contain no note text', () => {
    const NOTE_MARK = 'The customer sent this media with a note';
    expect(imageService.MULTI_ITEM_VISION_PROMPT).not.toContain(NOTE_MARK);
    expect(videoService.INVENTORY_PROMPT).not.toContain(NOTE_MARK);
    expect(videoService.INVENTORY_PROMPT_FRAMES).not.toContain(NOTE_MARK);
    // Prompts still end on today's closing rules (unchanged text).
    expect(imageService.MULTI_ITEM_VISION_PROMPT).toMatch(/window AC unit\)\.$/);
    expect(videoService.INVENTORY_PROMPT_FRAMES).toMatch(/"source_frame":2\}\]$/);
  });

  test('chunked analysis without a note passes no note opts to the analyzer', async () => {
    const frames = Array.from({ length: 30 }, () => ({ buffer: Buffer.from('f') }));
    const analyze = jest.fn().mockResolvedValue({ items: [], parseError: null, truncated: false, narrationNotes: null });
    await videoService.analyzeFramesChunked(frames, 'basic', null, null, null, { _analyzeFn: analyze });
    expect(analyze).toHaveBeenCalledTimes(3);
    for (const call of analyze.mock.calls) expect(call[5]).toBeUndefined();
  });
});

// ── Note rendering + fixture keep-list ───────────────────────────────────────

describe('note prompt section', () => {
  test('renders the targeted-request rule with the sanitized note', () => {
    const section = buildScanNoteSection('add this murphy bed');
    expect(section).toContain('The customer sent this media with a note: "add this murphy bed".');
    expect(section).toContain('THIS IS A TARGETED REQUEST: return ONLY the named item(s)');
    expect(section).toContain('ALSO include items the note attests are present but not visible');
    expect(section).toContain('If the note names no specific items, catalog everything as usual.');
  });

  test('neutralizes quotes/backticks/braces and caps length', () => {
    const section = buildScanNoteSection('add "this" `bed` {now} ' + 'x'.repeat(600));
    expect(section).toContain(`add 'this' bed now`);
    expect(section).not.toContain('`');
    expect(section).not.toContain('{now}');
    // capped at 500 chars of note (plus truncation marker)
    expect(section).toContain('…[truncated]');
  });
});

describe('fixture keep-list — a note-named item beats the fixture filter', () => {
  const items = [
    { name: 'Built-in Murphy Bed' },
    { name: 'Toilet' },
    { name: 'Sofa' },
  ];

  test('noteNamesItem matches the murphy bed but not the toilet', () => {
    expect(noteNamesItem(MURPHY, 'Built-in Murphy Bed')).toBe(true);
    expect(noteNamesItem(MURPHY, 'Toilet')).toBe(false);
  });

  test('partitionFixtures keeps the note-named murphy bed, still drops the toilet', () => {
    const { kept, fixtures } = partitionFixtures(items, MURPHY);
    expect(kept.map(i => i.name)).toEqual(['Built-in Murphy Bed', 'Sofa']);
    expect(fixtures.map(i => i.name)).toEqual(['Toilet']);
  });

  test('without a note the built-in pattern still drops it (behavior unchanged)', () => {
    const { kept, fixtures } = partitionFixtures(items);
    expect(kept.map(i => i.name)).toEqual(['Sofa']);
    expect(fixtures.map(i => i.name)).toEqual(['Built-in Murphy Bed', 'Toilet']);
  });

  test('chunked video analysis applies the keep-list and notes every chunk', async () => {
    const frames = Array.from({ length: 30 }, () => ({ buffer: Buffer.from('f') }));
    const analyze = jest.fn().mockResolvedValue({
      items: [{ name: 'Built-in Murphy Bed' }, { name: 'Toilet' }],
      parseError: null, truncated: false, narrationNotes: null,
    });
    const res = await videoService.analyzeFramesChunked(
      frames, 'basic', null, null, null, { _analyzeFn: analyze, userNote: MURPHY });

    expect(analyze).toHaveBeenCalledTimes(3);
    for (const call of analyze.mock.calls) {
      expect(call[5]).toEqual({ userNote: MURPHY }); // the note goes to EVERY chunk
    }
    expect(res.items.map(i => i.name)).toEqual(['Built-in Murphy Bed']);
    expect(res.fixturesDropped).toBe(1); // the toilet
  });
});

// ── /rescan note pass-through ────────────────────────────────────────────────

describe('POST /rescan with a note', () => {
  const BASE = '/api/agents/nexus';
  const OWN_PHOTO = 'https://storage.googleapis.com/test-bucket/users/user-1/chat/nexus/a.jpg';

  function makeApp() {
    const app = express();
    app.use(BASE, nexusRouter);
    return app;
  }

  test('threads note as user_note + scan_mode and surfaces scanMode', async () => {
    mockAnalyzePhoto.mockResolvedValue({ success: true, items: [{ name: 'Piano' }] });
    const res = await request(makeApp()).post(`${BASE}/rescan`)
      .send({ url: OWN_PHOTO, mimeType: 'image/jpeg', note: 'Just the piano' });

    expect(res.status).toBe(200);
    const args = mockAnalyzePhoto.mock.calls[0][0];
    expect(args.user_note).toBe('Just the piano');
    expect(args.scan_mode).toBe('targeted');
    expect(res.body.scanMode).toBe('targeted');
    expect(res.body.userNote).toBe('Just the piano');
  });

  test('no note → args unchanged and scanMode full', async () => {
    mockAnalyzePhoto.mockResolvedValue({ success: true, items: [{ name: 'Sofa' }] });
    const res = await request(makeApp()).post(`${BASE}/rescan`)
      .send({ url: OWN_PHOTO, mimeType: 'image/jpeg' });

    expect(res.status).toBe(200);
    const args = mockAnalyzePhoto.mock.calls[0][0];
    expect(Object.keys(args).sort()).toEqual(['file_url', 'mime_type', 'mode', 'room_hint']);
    expect(res.body.scanMode).toBe('full');
    expect(res.body).not.toHaveProperty('userNote');
  });
});
