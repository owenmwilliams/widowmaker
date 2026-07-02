/**
 * Pathway E (#44) — structured-output plumbing for the video path.
 *
 * Mock-transport smoke test: stubs @google/generative-ai so no live API key is
 * needed, and verifies that
 *   (a) videoService requests structured output (responseMimeType + responseSchema),
 *   (b) items parse cleanly with no parseError,
 *   (c) a MAX_TOKENS finishReason is surfaced as `truncated`, not swallowed.
 * Also covers the visionSchemas shapes directly.
 */

process.env.GOOGLE_AI_API_KEY = 'test-key'; // let videoService construct its client

const mockGenerateContent = jest.fn();
const mockGetGenerativeModel = jest.fn(() => ({ generateContent: mockGenerateContent }));

jest.mock('@google/generative-ai', () => {
  const actual = jest.requireActual('@google/generative-ai');
  return {
    SchemaType: actual.SchemaType,
    GoogleGenerativeAI: function () {
      return { getGenerativeModel: mockGetGenerativeModel };
    },
  };
});

const { analyzeVideo, analyzeFrames } = require('../../services/infra/vision/videoService');
const schemas = require('../../services/infra/vision/visionSchemas');
const { SchemaType } = require('@google/generative-ai');

function geminiResult(text, finishReason = 'STOP') {
  return { response: { text: () => text, candidates: [{ finishReason }] } };
}

const SAMPLE_ITEMS = JSON.stringify([
  { name: '3-seat sofa', quantity: 1, room: 'living room', estimated_weight_lbs: 150, source_frame: 1 },
  { name: 'Dining chair', quantity: 4, room: 'dining room', estimated_weight_lbs: 15, source_frame: 2 },
]);

beforeEach(() => {
  mockGenerateContent.mockReset();
  mockGetGenerativeModel.mockClear();
});

describe('videoService structured output', () => {
  test('analyzeFrames requests responseSchema and parses cleanly', async () => {
    mockGenerateContent.mockResolvedValue(geminiResult(SAMPLE_ITEMS));
    const out = await analyzeFrames([{ buffer: Buffer.from('frame') }], 'basic', 'living room', null);

    const cfg = mockGetGenerativeModel.mock.calls.at(-1)[0].generationConfig;
    expect(cfg.responseMimeType).toBe('application/json');
    expect(cfg.responseSchema).toBeDefined();
    expect(cfg.responseSchema.type).toBe(SchemaType.ARRAY); // no-audio → bare array

    expect(out.parseError).toBeNull();
    expect(out.truncated).toBe(false);
    expect(out.items).toHaveLength(2);
    expect(out.items[0].weight_lbs).toBe(150); // normalizeVideoItem still applied
  });

  test('analyzeFrames with audio uses the object (narration) schema', async () => {
    mockGenerateContent.mockResolvedValue(
      geminiResult(JSON.stringify({ narration_notes: 'solid oak dresser, heavy', items: JSON.parse(SAMPLE_ITEMS) }))
    );
    const out = await analyzeFrames([{ buffer: Buffer.from('f') }], 'basic', 'bedroom', {
      buffer: Buffer.from('audio'), mimeType: 'audio/aac',
    });

    const cfg = mockGetGenerativeModel.mock.calls.at(-1)[0].generationConfig;
    expect(cfg.responseSchema.type).toBe(SchemaType.OBJECT);
    expect(out.narrationNotes).toMatch(/oak/);
    expect(out.items).toHaveLength(2);
    expect(out.parseError).toBeNull();
  });

  test('analyzeVideo surfaces MAX_TOKENS truncation instead of silently dropping', async () => {
    mockGenerateContent.mockResolvedValue(geminiResult(SAMPLE_ITEMS, 'MAX_TOKENS'));
    const out = await analyzeVideo(Buffer.from('video'), 'video/mp4', 'basic');
    expect(out.truncated).toBe(true);
    expect(out.parseError).toBeNull();
    expect(out.items.length).toBeGreaterThan(0); // items we DID get are kept
  });

  test('analyzeVideo requests the array responseSchema', async () => {
    mockGenerateContent.mockResolvedValue(geminiResult(SAMPLE_ITEMS));
    await analyzeVideo(Buffer.from('video'), 'video/mp4', 'basic');
    const cfg = mockGetGenerativeModel.mock.calls.at(-1)[0].generationConfig;
    expect(cfg.responseSchema).toBe(schemas.videoItemsArraySchema);
  });
});

describe('visionSchemas', () => {
  test('framesResponseSchema switches on audio', () => {
    expect(schemas.framesResponseSchema(false).type).toBe(SchemaType.ARRAY);
    expect(schemas.framesResponseSchema(true).type).toBe(SchemaType.OBJECT);
    expect(schemas.framesResponseSchema(true).properties.items.type).toBe(SchemaType.ARRAY);
  });

  test('video item schema locator differs for frames vs inline', () => {
    const frameItem = schemas.buildVideoItemSchema('source_frame');
    const inlineItem = schemas.buildVideoItemSchema('timestamp_seconds');
    expect(frameItem.properties.source_frame).toBeDefined();
    expect(frameItem.properties.timestamp_seconds).toBeUndefined();
    expect(inlineItem.properties.timestamp_seconds).toBeDefined();
    expect(inlineItem.properties.bbox.nullable).toBe(true);
    expect(frameItem.required).toContain('name');
  });

  test('photo schemas require items and (multi-image) carry sourceImage', () => {
    expect(schemas.photoMultiItemSchema.properties.items.type).toBe(SchemaType.ARRAY);
    expect(schemas.photoMultiImageSchema.properties.items.items.properties.sourceImage).toBeDefined();
    expect(schemas.photoMultiItemSchema.properties.items.items.properties.sourceImage).toBeUndefined();
  });

  test('wasTruncated reads finishReason defensively', () => {
    expect(schemas.wasTruncated(geminiResult('[]', 'MAX_TOKENS'))).toBe(true);
    expect(schemas.wasTruncated(geminiResult('[]', 'STOP'))).toBe(false);
    expect(schemas.wasTruncated(undefined)).toBe(false);
    expect(schemas.wasTruncated({})).toBe(false);
  });
});
