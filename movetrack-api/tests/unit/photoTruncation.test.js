/**
 * Pathway E review fixes (#48) — photo multi-item parsers.
 * Fix 2: jsonrepair salvages partial items on truncation (no zero-item hard fail),
 *        and `truncated` is read from the RETRIED result, not the original.
 * Fix 4: analyzeWithGemini only forces singleItemSchema for the standard prompt.
 *
 * Mock-transport: stubs @google/generative-ai; no live key needed.
 */

process.env.GOOGLE_AI_API_KEY = 'test-key';
// Ensure the failover order lands on gemini (no other provider clients configured).
delete process.env.ANTHROPIC_API_KEY;
delete process.env.OPENAI_API_KEY;
delete process.env.TOGETHER_API_KEY;

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

const imageService = require('../../services/infra/vision/imageService');

function geminiResult(text, finishReason = 'STOP') {
  return { response: { text: () => text, candidates: [{ finishReason }] } };
}

beforeEach(() => {
  mockGenerateContent.mockReset();
  mockGetGenerativeModel.mockClear();
});

describe('multi-item photo truncation (Fix 2)', () => {
  test('jsonrepair salvages partial items from a truncated response instead of throwing', async () => {
    const truncated = '{"itemCount": 3, "items": [{"name":"Sofa","quantity":1},{"name":"Coffee table","quantity":1},{"name":"Floor la';
    mockGenerateContent.mockResolvedValue(geminiResult(truncated, 'MAX_TOKENS'));

    const res = await imageService.analyzeMultiItemPhoto('base64img', 'image/jpeg', 'gemini', {}, 'basic');

    expect(res.success).toBe(true);
    expect(res.provider).toBe('gemini');
    expect(res.data.items.length).toBeGreaterThanOrEqual(2); // partial items recovered, not zero
    expect(res.data.truncated).toBe(true);
    // pre-E this dense room hard-failed to zero; now it degrades gracefully.
    expect(mockGenerateContent).toHaveBeenCalledTimes(1);
  });

  test('truncation flag reflects the RETRIED result, not the original', async () => {
    // First call: empty/unparseable (jsonrepair throws → null) → triggers retry.
    // Retry: valid JSON but MAX_TOKENS. The flag must come from the retry.
    mockGenerateContent
      .mockResolvedValueOnce(geminiResult('', 'STOP'))
      .mockResolvedValueOnce(geminiResult('{"items":[{"name":"Dresser","quantity":1}]}', 'MAX_TOKENS'));

    const res = await imageService.analyzeMultiItemPhoto('base64img', 'image/jpeg', 'gemini', {}, 'basic');

    expect(res.success).toBe(true);
    expect(res.data.items).toHaveLength(1);
    expect(res.data.truncated).toBe(true); // would be false if we checked the original
    expect(mockGenerateContent).toHaveBeenCalledTimes(2);
  });

  test('clean response is not flagged truncated', async () => {
    mockGenerateContent.mockResolvedValue(geminiResult('{"itemCount":1,"items":[{"name":"Lamp","quantity":1}]}', 'STOP'));
    const res = await imageService.analyzeMultiItemPhoto('base64img', 'image/jpeg', 'gemini', {}, 'basic');
    expect(res.data.truncated).toBeUndefined();
    expect(res.data.items).toHaveLength(1);
  });
});

describe('single-item schema gating (Fix 4)', () => {
  test('standard VISION_PROMPT gets responseSchema', async () => {
    mockGenerateContent.mockResolvedValue(geminiResult('{"name":"Lamp","fragile":true}'));
    await imageService.analyzeItemPhoto('base64img', 'image/jpeg', 'gemini', imageService.VISION_PROMPT, null, 'basic');
    const cfg = mockGetGenerativeModel.mock.calls.at(-1)[0].generationConfig;
    expect(cfg.responseSchema).toBeDefined();
    expect(cfg.responseMimeType).toBe('application/json');
  });

  test('arbitrary vision-lab prompt is NOT forced onto singleItemSchema', async () => {
    mockGenerateContent.mockResolvedValue(geminiResult('{"anything":"the lab wants"}'));
    await imageService.analyzeItemPhoto('base64img', 'image/jpeg', 'gemini', 'Describe the mood of this room as a haiku in JSON', null, 'basic');
    const cfg = mockGetGenerativeModel.mock.calls.at(-1)[0].generationConfig;
    expect(cfg.responseSchema).toBeUndefined(); // lab keeps plain JSON mode
    expect(cfg.responseMimeType).toBe('application/json');
  });
});
