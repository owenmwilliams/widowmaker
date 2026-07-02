/**
 * Unit tests for the fail-loud scan pipeline (issue #41, Pathway B).
 *
 * Guiding principle: a scan must never report success after a degraded path ran.
 * DB-free — every collaborator (frame extraction, vision, GCS, persistence) is
 * mocked so we exercise only the workflow's fallback/error semantics + stage hook.
 */

jest.mock('../../services/infra/mediaDownloadService', () => ({
  downloadBuffer: jest.fn(),
}));
jest.mock('../../services/infra/mediaAssetService', () => ({
  ingestUpload: jest.fn().mockResolvedValue({ url: 'https://storage.googleapis.com/test/derived.jpg' }),
}));
jest.mock('../../services/infra/vision/frameExtractor', () => ({
  extractFramesForScan: jest.fn(),
  extractAudio: jest.fn().mockResolvedValue(null),
  extractSharpestFrame: jest.fn(),
}));
jest.mock('../../services/infra/vision/videoService', () => ({
  analyzeFrames: jest.fn(),
  analyzeVideo: jest.fn(),
}));
jest.mock('../../services/infra/vision/imageService', () => ({
  analyzeMultiItemPhoto: jest.fn(),
  analyzeMultiImagePhoto: jest.fn(),
  analyzeItemPhoto: jest.fn(),
}));
jest.mock('../../services/infra/vision/imageUtils', () => ({
  drawBoundingBox: jest.fn().mockResolvedValue(null),
}));
jest.mock('../../services/infra/gcsService', () => ({
  uploadBuffer: jest.fn().mockResolvedValue(undefined),
  BUCKET: 'test-bucket',
}));
jest.mock('../../services/inventory/roomVideoService', () => ({
  recordRoomVideo: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../services/inventory/itemSpecsReference', () => ({
  specForName: jest.fn().mockReturnValue(null),
}));

const workflow = require('../../services/inventory/mediaInventoryWorkflowService');
const { extractFramesForScan } = require('../../services/infra/vision/frameExtractor');
const { analyzeFrames } = require('../../services/infra/vision/videoService');
const { analyzeMultiItemPhoto } = require('../../services/infra/vision/imageService');
const { SCAN_STAGES, SCAN_STATUS } = require('../../services/inventory/scanStatus');
const { downloadBuffer } = require('../../services/infra/mediaDownloadService');

const frame = () => ({ buffer: Buffer.from('frame-bytes') });

beforeEach(() => {
  jest.clearAllMocks();
  // Every scan starts by downloading media; stub the download so no network runs.
  // (Download correctness is issue #40's domain; here we only need bytes back.)
  downloadBuffer.mockResolvedValue(Buffer.from('media-bytes'));
});

afterEach(() => jest.restoreAllMocks());

describe('analyzeVideoForInventory — frame extraction fail-loud', () => {
  test('extraction failing twice returns an explicit failure (no silent inline fallback)', async () => {
    // Both the initial attempt and the retry yield nothing.
    extractFramesForScan.mockResolvedValue([]);

    const res = await workflow.analyzeVideoForInventory(
      { file_url: 'https://x/video.mov', mime_type: 'video/quicktime' }, 'user1', 'basic'
    );

    expect(res.success).toBe(false);
    expect(res.failureStage).toBe(SCAN_STAGES.EXTRACT_FRAMES);
    expect(res.userMessage).toMatch(/try again/i);
    expect(res.itemCount).toBe(0);
    // It must NOT have quietly fallen back to inline video analysis.
    expect(analyzeFrames).not.toHaveBeenCalled();
    // Retry actually happened: two extraction attempts.
    expect(extractFramesForScan).toHaveBeenCalledTimes(2);
  });

  test('extraction recovers on the retry, then succeeds', async () => {
    extractFramesForScan
      .mockResolvedValueOnce([])            // first attempt fails
      .mockResolvedValueOnce([frame()]);    // retry succeeds
    analyzeFrames.mockResolvedValue({ items: [{ name: 'Sofa', source_frame: 1 }], parseError: null, narrationNotes: null });

    const res = await workflow.analyzeVideoForInventory(
      { file_url: 'https://x/video.mov', mime_type: 'video/quicktime' }, 'user1', 'basic'
    );

    expect(extractFramesForScan).toHaveBeenCalledTimes(2);
    expect(res.success).toBe(true);
    expect(res.itemCount).toBe(1);
  });
});

describe('analyzeVideoForInventory — parseError fail-loud', () => {
  test('empty items + parseError is a failure, not "found nothing"', async () => {
    extractFramesForScan.mockResolvedValue([frame()]);
    analyzeFrames.mockResolvedValue({ items: [], parseError: 'Could not parse response as JSON', narrationNotes: null });

    const res = await workflow.analyzeVideoForInventory(
      { file_url: 'https://x/video.mov', mime_type: 'video/quicktime' }, 'user1', 'basic'
    );

    expect(res.success).toBe(false);
    expect(res.failureStage).toBe(SCAN_STAGES.ANALYZE);
    expect(res.error).toMatch(/could not be parsed/i);
    expect(res.userMessage).toMatch(/try again/i);
  });
});

describe('analyzeVideoForInventory — per-stage status hook', () => {
  test('emits ordered stage events and ends with success', async () => {
    extractFramesForScan.mockResolvedValue([frame(), frame()]);
    analyzeFrames.mockResolvedValue({ items: [{ name: 'Lamp', source_frame: 1 }], parseError: null, narrationNotes: null });

    const events = [];
    const res = await workflow.analyzeVideoForInventory(
      { file_url: 'https://x/video.mov', mime_type: 'video/quicktime', room_hint: 'living room' },
      'user1', 'basic',
      { onStage: (e) => events.push(e) }
    );

    expect(res.success).toBe(true);

    // Every event conforms to the { stage, status, meta } contract.
    for (const e of events) {
      expect(Object.values(SCAN_STAGES)).toContain(e.stage);
      expect(Object.values(SCAN_STATUS)).toContain(e.status);
      expect(typeof e.meta).toBe('object');
    }

    const seq = events.map(e => `${e.stage}:${e.status}`);
    expect(seq).toContain(`${SCAN_STAGES.DOWNLOAD}:${SCAN_STATUS.OK}`);
    expect(seq).toContain(`${SCAN_STAGES.EXTRACT_FRAMES}:${SCAN_STATUS.OK}`);
    expect(seq).toContain(`${SCAN_STAGES.ANALYZE}:${SCAN_STATUS.OK}`);
    // download precedes extract precedes analyze
    const idx = (s) => seq.findIndex(x => x.startsWith(s));
    expect(idx(SCAN_STAGES.DOWNLOAD)).toBeLessThan(idx(SCAN_STAGES.EXTRACT_FRAMES));
    expect(idx(SCAN_STAGES.EXTRACT_FRAMES)).toBeLessThan(idx(SCAN_STAGES.ANALYZE));
  });

  test('emits an error stage event when the scan fails', async () => {
    extractFramesForScan.mockResolvedValue([]);
    const events = [];
    await workflow.analyzeVideoForInventory(
      { file_url: 'https://x/video.mov', mime_type: 'video/quicktime' }, 'user1', 'basic',
      { onStage: (e) => events.push(e) }
    );
    expect(events.some(e => e.stage === SCAN_STAGES.EXTRACT_FRAMES && e.status === SCAN_STATUS.ERROR)).toBe(true);
  });
});

describe('analyzePhotoForInventory — fail-loud', () => {
  test('vision provider failure surfaces as an error, not an empty result', async () => {
    analyzeMultiItemPhoto.mockResolvedValue({ success: false, error: 'All vision providers failed' });

    const res = await workflow.analyzePhotoForInventory(
      { file_url: 'https://x/photo.jpg', mime_type: 'image/jpeg' }, 'user1', 'basic'
    );

    expect(res.success).toBe(false);
    expect(res.failureStage).toBe(SCAN_STAGES.ANALYZE);
    expect(res.error).toMatch(/vision providers failed/i);
  });

  test('an implausibly-fast empty result is flagged as a failure (the wine-photo bug)', async () => {
    // Provider "succeeds" but returns 0 items essentially instantly (< floor).
    analyzeMultiItemPhoto.mockResolvedValue({ success: true, data: { items: [], itemCount: 0 } });

    const res = await workflow.analyzePhotoForInventory(
      { file_url: 'https://x/wine.jpg', mime_type: 'image/jpeg' }, 'user1', 'basic'
    );

    expect(res.success).toBe(false);
    expect(res.failureStage).toBe(SCAN_STAGES.ANALYZE);
    expect(res.error).toMatch(/0 items/i);
  });

  test('a real multi-item result still succeeds', async () => {
    analyzeMultiItemPhoto.mockResolvedValue({ success: true, data: { items: [{ name: 'Chair' }, { name: 'Table' }], itemCount: 2 } });

    const res = await workflow.analyzePhotoForInventory(
      { file_url: 'https://x/room.jpg', mime_type: 'image/jpeg' }, 'user1', 'basic'
    );

    expect(res.success).toBe(true);
    expect(res.itemCount).toBe(2);
  });

  test('partial download degradation → success is marked degraded + emits download:degraded (fix #2)', async () => {
    // Two photos requested, first download fails, second succeeds.
    downloadBuffer.mockReset();
    downloadBuffer
      .mockRejectedValueOnce(new Error('truncated object'))
      .mockResolvedValue(Buffer.from('img-bytes'));
    analyzeMultiItemPhoto.mockResolvedValue({ success: true, data: { items: [{ name: 'Chair' }], itemCount: 1 } });

    const events = [];
    const res = await workflow.analyzePhotoForInventory(
      { files: [{ file_url: 'https://x/a.jpg', mime_type: 'image/jpeg' }, { file_url: 'https://x/b.jpg', mime_type: 'image/jpeg' }] },
      'user1', 'basic',
      { onStage: (e) => events.push(e) }
    );

    expect(res.success).toBe(true);
    expect(res.degraded).toBe(true);
    expect(res.degradedStage).toBe(SCAN_STAGES.DOWNLOAD);
    expect(events.some(e => e.stage === SCAN_STAGES.DOWNLOAD && e.status === SCAN_STATUS.DEGRADED)).toBe(true);
  });
});

describe('analyzeVideoForInventory — vision timer & guards (fix #1)', () => {
  test('implausible-empty guard now fires on an empty video analyze result', async () => {
    extractFramesForScan.mockResolvedValue([frame()]);
    // Model returns 0 items with no parse error — the "provider looked but found
    // nothing" shape. With the timer around the model call only, this trips the
    // sub-floor plausibility check instead of reporting clean empty success.
    analyzeFrames.mockResolvedValue({ items: [], parseError: null, narrationNotes: null });

    const res = await workflow.analyzeVideoForInventory(
      { file_url: 'https://x/video.mov', mime_type: 'video/quicktime' }, 'user1', 'basic'
    );

    expect(res.success).toBe(false);
    expect(res.failureStage).toBe(SCAN_STAGES.ANALYZE);
    expect(res.error).toMatch(/0 items/i);
  });

  test('_visionMs measures the model call, not the ffmpeg extraction that precedes it', async () => {
    // Extraction is slow; the model call is fast. _visionMs must reflect the model
    // call only — before the fix it included this 60ms extraction.
    extractFramesForScan.mockImplementation(async () => {
      await new Promise(r => setTimeout(r, 60));
      return [frame()];
    });
    analyzeFrames.mockResolvedValue({ items: [{ name: 'Sofa', source_frame: 1 }], parseError: null, narrationNotes: null });

    const res = await workflow.analyzeVideoForInventory(
      { file_url: 'https://x/video.mov', mime_type: 'video/quicktime' }, 'user1', 'basic'
    );

    expect(res.success).toBe(true);
    expect(res._visionMs).toBeLessThan(50); // excludes the 60ms extraction
  });
});

describe('analyzeVideoForInventory — outer-catch attribution (fix #5)', () => {
  test('an unexpected throw is attributed to SCAN_STAGES.OTHER, not analyze', async () => {
    extractFramesForScan.mockResolvedValue([frame()]);
    analyzeFrames.mockRejectedValue(new Error('unexpected boom'));

    const events = [];
    const res = await workflow.analyzeVideoForInventory(
      { file_url: 'https://x/video.mov', mime_type: 'video/quicktime' }, 'user1', 'basic',
      { onStage: (e) => events.push(e) }
    );

    expect(res.success).toBe(false);
    expect(res.failureStage).toBe(SCAN_STAGES.OTHER);
    expect(Object.values(SCAN_STAGES)).toContain(res.failureStage);
    expect(events.some(e => e.stage === SCAN_STAGES.OTHER && e.status === SCAN_STATUS.ERROR)).toBe(true);
  });
});
