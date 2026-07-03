/**
 * Pathway E review fix (#48), Fix 1 — the blocker.
 * `truncated` must be returned by analyzeVideoForInventory on BOTH the frames
 * path and the inline fallback, and surfaced as a degraded outcome (a warning
 * census threads into the SpecialistResponse) — never a clean-looking success.
 *
 * All heavy deps (network, ffmpeg, GCS, DB) are mocked; no live services.
 */

const mockExtractFrames = jest.fn();
const mockExtractAudio = jest.fn();
const mockAnalyzeFrames = jest.fn();
const mockAnalyzeVideo = jest.fn();

jest.mock('../../services/infra/mediaDownloadService', () => ({
  downloadBuffer: jest.fn().mockResolvedValue(Buffer.from('fake-video')),
}));
jest.mock('../../services/infra/mediaAssetService', () => ({
  ingestUpload: jest.fn().mockResolvedValue({ url: 'https://storage.googleapis.com/test/frame.jpg' }),
}));

jest.mock('../../services/infra/vision/frameExtractor', () => ({
  extractFramesForScan: (...a) => mockExtractFrames(...a),
  extractAudio: (...a) => mockExtractAudio(...a),
  extractSharpestFrame: jest.fn(),
}));
jest.mock('../../services/infra/vision/videoService', () => ({
  analyzeFrames: (...a) => mockAnalyzeFrames(...a),
  analyzeFramesChunked: (...a) => mockAnalyzeFrames(...a),
  analyzeVideo: (...a) => mockAnalyzeVideo(...a),
}));
jest.mock('../../services/infra/gcsService', () => ({
  uploadBuffer: jest.fn().mockResolvedValue(undefined),
  BUCKET: 'test-bucket',
}));
jest.mock('../../services/inventory/roomVideoService', () => ({ recordRoomVideo: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../../services/inventory/itemSpecsReference', () => ({ specForName: () => null }));
jest.mock('../../services/infra/vision/imageService', () => ({}));
jest.mock('../../services/infra/vision/imageUtils', () => ({ drawBoundingBox: jest.fn() }));

const { analyzeVideoForInventory } = require('../../services/inventory/mediaInventoryWorkflowService');

const ARGS = { file_url: 'https://example.com/walkthrough.mov', mime_type: 'video/mp4', room_hint: 'living room' };

beforeEach(() => {
  mockExtractFrames.mockReset();
  mockExtractAudio.mockReset().mockResolvedValue(null);
  mockAnalyzeFrames.mockReset();
  mockAnalyzeVideo.mockReset();
});

describe('analyzeVideoForInventory truncation propagation', () => {
  test('frames path: truncated flag + degraded warning are returned', async () => {
    mockExtractFrames.mockResolvedValue([{ buffer: Buffer.from('frame') }]);
    mockAnalyzeFrames.mockResolvedValue({ items: [{ name: 'Sofa' }], parseError: null, truncated: true, narrationNotes: null });

    const res = await analyzeVideoForInventory(ARGS, 'user-1', 'basic');

    expect(res.success).toBe(true);
    expect(res.truncated).toBe(true);
    expect(Array.isArray(res.warnings)).toBe(true);
    expect(res.warnings.join(' ')).toMatch(/incomplete/i);
  });

  test('inline fallback path (flag-gated) also propagates truncated', async () => {
    // Post-B the inline fallback is off by default (fail-loud); enable it for
    // this test only — the flag is read at module load, so re-require isolated.
    mockExtractFrames.mockResolvedValue([]); // no frames (twice) → gated fallback
    mockAnalyzeVideo.mockResolvedValue({ items: [{ name: 'Fridge' }], parseError: null, truncated: true });

    const prev = process.env.ENABLE_INLINE_VIDEO_FALLBACK;
    process.env.ENABLE_INLINE_VIDEO_FALLBACK = 'true';
    let res;
    await jest.isolateModulesAsync(async () => {
      const wf = require('../../services/inventory/mediaInventoryWorkflowService');
      res = await wf.analyzeVideoForInventory(ARGS, 'user-1', 'basic');
    });
    if (prev === undefined) delete process.env.ENABLE_INLINE_VIDEO_FALLBACK;
    else process.env.ENABLE_INLINE_VIDEO_FALLBACK = prev;

    expect(mockAnalyzeVideo).toHaveBeenCalled();
    expect(res.truncated).toBe(true);
    expect(res.degraded).toBe(true);
    expect(res.warnings.join(' ')).toMatch(/incomplete/i);
  });

  test('clean scan is not flagged and carries no warning', async () => {
    mockExtractFrames.mockResolvedValue([{ buffer: Buffer.from('frame') }]);
    mockAnalyzeFrames.mockResolvedValue({ items: [{ name: 'Table' }], parseError: null, truncated: false, narrationNotes: null });

    const res = await analyzeVideoForInventory(ARGS, 'user-1', 'basic');

    expect(res.success).toBe(true);
    expect(res.truncated).toBeUndefined();
    expect(res.warnings).toBeUndefined();
  });
});
