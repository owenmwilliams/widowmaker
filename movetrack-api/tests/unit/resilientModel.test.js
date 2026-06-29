/**
 * Unit tests for the resilient model wrapper (services/infra/ai/resilientModel.js).
 * DB-free; retries use an injected no-op sleep so they run instantly.
 */

const {
  isRetryable,
  backoffDelay,
  callWithResilience,
  AiUnavailableError,
} = require('../../services/infra/ai/resilientModel');

const noSleep = () => Promise.resolve();

describe('isRetryable', () => {
  test('429 and 5xx are retryable; other 4xx are not', () => {
    expect(isRetryable({ status: 429 })).toBe(true);
    expect(isRetryable({ status: 503 })).toBe(true);
    expect(isRetryable({ status: 500 })).toBe(true);
    expect(isRetryable({ status: 400 })).toBe(false);
    expect(isRetryable({ status: 401 })).toBe(false);
  });

  test('network/timeout error codes are retryable', () => {
    expect(isRetryable({ code: 'ETIMEDOUT' })).toBe(true);
    expect(isRetryable({ code: 'ECONNRESET' })).toBe(true);
  });

  test('classifies by message when no status', () => {
    expect(isRetryable(new Error('model is overloaded, try again'))).toBe(true);
    expect(isRetryable(new Error('rate limit exceeded'))).toBe(true);
    expect(isRetryable(new Error('invalid argument: bad request'))).toBe(false);
  });

  test('null/undefined are not retryable', () => {
    expect(isRetryable(null)).toBe(false);
    expect(isRetryable(undefined)).toBe(false);
  });
});

describe('backoffDelay', () => {
  test('grows with attempt number', () => {
    const a0 = backoffDelay(0, 100);
    const a2 = backoffDelay(2, 100);
    expect(a0).toBeGreaterThanOrEqual(100);
    expect(a2).toBeGreaterThanOrEqual(400); // 100 * 2^2
  });
});

describe('callWithResilience', () => {
  test('returns immediately on success (one call)', async () => {
    let calls = 0;
    const r = await callWithResilience(async () => { calls++; return 'ok'; }, { sleepFn: noSleep });
    expect(r).toBe('ok');
    expect(calls).toBe(1);
  });

  test('retries a transient failure then succeeds', async () => {
    let calls = 0;
    const r = await callWithResilience(async () => {
      calls++;
      if (calls < 3) { const e = new Error('overloaded'); e.status = 503; throw e; }
      return 'recovered';
    }, { retries: 3, sleepFn: noSleep });
    expect(r).toBe('recovered');
    expect(calls).toBe(3);
  });

  test('does not retry a permanent error', async () => {
    let calls = 0;
    await expect(callWithResilience(async () => {
      calls++; const e = new Error('bad request'); e.status = 400; throw e;
    }, { retries: 3, sleepFn: noSleep })).rejects.toThrow('bad request');
    expect(calls).toBe(1);
  });

  test('gives up after exhausting retries', async () => {
    let calls = 0;
    await expect(callWithResilience(async () => {
      calls++; const e = new Error('still 503'); e.status = 503; throw e;
    }, { retries: 2, sleepFn: noSleep })).rejects.toThrow('still 503');
    expect(calls).toBe(3); // initial + 2 retries
  });

  test('times out a hung call', async () => {
    await expect(callWithResilience(
      () => new Promise(() => {}), // never resolves
      { retries: 0, timeoutMs: 20, sleepFn: noSleep }
    )).rejects.toThrow(/timed out/);
  });
});

describe('AiUnavailableError', () => {
  test('carries a 503 status', () => {
    const e = new AiUnavailableError();
    expect(e.status).toBe(503);
    expect(e.name).toBe('AiUnavailableError');
  });
});
