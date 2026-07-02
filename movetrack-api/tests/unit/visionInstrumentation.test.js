/**
 * Unit tests for vision-call instrumentation (issue #41, Pathway B).
 *
 * The heaviest calls in the system (Gemini photo/video) previously bypassed the
 * resilient wrapper entirely — no timeout, no retry, no token metering. These
 * tests cover instrumentVisionModel: a transient 503 recovers without user
 * action, permanent errors don't, hung calls time out, and token usage is
 * recorded into user_costs.
 */

jest.mock('../../services/infra/cost/aiCostService', () => ({
  recordUsage: jest.fn(),
}));

const { recordUsage } = require('../../services/infra/cost/aiCostService');
const {
  instrumentVisionModel,
  DEFAULT_VISION_TIMEOUT_MS,
} = require('../../services/infra/ai/resilientModel');

const noSleep = () => Promise.resolve();

const usageResponse = () => ({
  response: {
    usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 50, thoughtsTokenCount: 10 },
  },
});

beforeEach(() => jest.clearAllMocks());

describe('instrumentVisionModel', () => {
  test('retries a simulated 503 then succeeds (no user action needed)', async () => {
    let calls = 0;
    const model = {
      generateContent: async () => {
        calls++;
        if (calls < 3) { const e = new Error('model overloaded'); e.status = 503; throw e; }
        return usageResponse();
      },
    };

    instrumentVisionModel(model, {
      userId: 'user1', modelName: 'gemini-2.5-flash',
      retries: 3, baseDelayMs: 1, sleepFn: noSleep,
    });

    const result = await model.generateContent(['frames']);
    expect(calls).toBe(3);            // initial + 2 retries before success
    expect(result).toBeTruthy();
  });

  test('records token usage into user_costs on success', async () => {
    const model = { generateContent: async () => usageResponse() };
    instrumentVisionModel(model, { userId: 'user1', modelName: 'gemini-2.5-flash', sleepFn: noSleep });

    await model.generateContent(['frames']);

    expect(recordUsage).toHaveBeenCalledTimes(1);
    expect(recordUsage).toHaveBeenCalledWith('user1', {
      model: 'gemini-2.5-flash',
      inputTokens: 100,
      outputTokens: 60, // candidates + thoughts
    });
  });

  test('does not retry a permanent 4xx error', async () => {
    let calls = 0;
    const model = {
      generateContent: async () => { calls++; const e = new Error('bad request'); e.status = 400; throw e; },
    };
    instrumentVisionModel(model, { userId: 'u', modelName: 'gemini-2.5-flash', retries: 3, baseDelayMs: 1, sleepFn: noSleep });

    await expect(model.generateContent(['x'])).rejects.toThrow('bad request');
    expect(calls).toBe(1);
  });

  test('times out a hung vision call', async () => {
    const model = { generateContent: () => new Promise(() => {}) }; // never resolves
    instrumentVisionModel(model, { modelName: 'gemini-2.5-flash', timeoutMs: 20, retries: 0, sleepFn: noSleep });

    await expect(model.generateContent(['x'])).rejects.toThrow(/timed out/);
  });

  test('defaults to the generous vision timeout (not the 30s chat timeout)', () => {
    expect(DEFAULT_VISION_TIMEOUT_MS).toBeGreaterThanOrEqual(90000);
  });
});
