/**
 * Unit tests for vision provider failover (services/infra/vision/visionFailover.js).
 * DB-free; runs in CI.
 */

const { buildProviderOrder, normalize, runWithFailover } = require('../../services/infra/vision/visionFailover');

describe('normalize', () => {
  test('maps aliases to canonical keys', () => {
    expect(normalize('google')).toBe('gemini');
    expect(normalize('gemini-pro')).toBe('gemini');
    expect(normalize('openai')).toBe('gpt4');
    expect(normalize('together')).toBe('scout');
    expect(normalize('Claude')).toBe('claude');
  });
});

describe('buildProviderOrder', () => {
  test('basic plan: requested gemini then the basic chain, deduped', () => {
    expect(buildProviderOrder('gemini', 'basic')).toEqual(['gemini', 'scout', 'qwen']);
  });
  test('pro plan: requested claude first, then chain', () => {
    expect(buildProviderOrder('claude', 'pro')).toEqual(['claude', 'gemini', 'gpt4']);
  });
  test('non-pro plan falls back to the basic chain', () => {
    expect(buildProviderOrder('scout', 'basic')).toEqual(['scout', 'gemini', 'qwen']);
  });
  test('aliases are normalized and not duplicated', () => {
    expect(buildProviderOrder('openai', 'pro')).toEqual(['gpt4', 'gemini', 'claude']);
  });
});

describe('runWithFailover', () => {
  test('returns the first successful provider result', async () => {
    const calls = [];
    const res = await runWithFailover(['gemini', 'claude'], async (p) => { calls.push(p); return { success: true, provider: p }; });
    expect(res).toEqual({ success: true, provider: 'gemini' });
    expect(calls).toEqual(['gemini']);
  });

  test('falls back when a provider throws', async () => {
    const calls = [];
    const res = await runWithFailover(['claude', 'gemini'], async (p) => {
      calls.push(p);
      if (p === 'claude') throw new Error('claude 503');
      return { success: true, provider: p };
    });
    expect(res.provider).toBe('gemini');
    expect(calls).toEqual(['claude', 'gemini']);
  });

  test('falls back when a provider returns { success: false }', async () => {
    const res = await runWithFailover(['scout', 'gemini'], async (p) =>
      p === 'scout' ? { success: false, error: 'no key' } : { success: true, provider: p });
    expect(res.provider).toBe('gemini');
  });

  test('treats a result without a success field as success', async () => {
    const res = await runWithFailover(['gemini'], async () => ({ data: 'ok' }));
    expect(res).toEqual({ data: 'ok' });
  });

  test('returns a failure when every provider fails', async () => {
    const res = await runWithFailover(['a', 'b'], async () => { throw new Error('down'); });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/All vision providers failed/);
  });
});
