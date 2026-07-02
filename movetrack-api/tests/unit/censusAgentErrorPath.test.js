'use strict';

/**
 * Acceptance criterion (issue #45): "A hard-thrown turn produces a
 * beta_interaction_logs row with had_error = true." This exercises the real
 * processMessage() catch path (not just metricsService in isolation) by
 * forcing the session lookup to reject, and asserts (a) a row is logged with
 * had_error=true before the original error is rethrown, and (b) the route's
 * existing error handling is unaffected — the error still propagates.
 */
describe('censusAgent processMessage — error path', () => {
  let logInteraction;
  let processMessage;

  beforeEach(() => {
    jest.resetModules();
    process.env.GOOGLE_AI_API_KEY = 'test-key';

    jest.doMock('../../services/infra/db', () => ({
      db: {
        oneOrNone: jest.fn().mockRejectedValue(new Error('connection terminated unexpectedly')),
        one: jest.fn(),
        any: jest.fn(),
        none: jest.fn(),
      },
    }));

    logInteraction = jest.fn().mockResolvedValue(undefined);
    jest.doMock('../../services/infra/metricsService', () => ({
      logInteraction,
      logItemFeedback: jest.fn(),
      recordCommitInteraction: jest.fn(),
    }));

    ({ processMessage } = require('../../agents/censusAgent'));
  });

  afterEach(() => {
    jest.dontMock('../../services/infra/db');
    jest.dontMock('../../services/infra/metricsService');
    delete process.env.GOOGLE_AI_API_KEY;
  });

  test('logs had_error=true and rethrows when the session lookup throws', async () => {
    await expect(
      processMessage('user-1', 'hello', [], 'basic', null)
    ).rejects.toThrow('connection terminated unexpectedly');

    expect(logInteraction).toHaveBeenCalledTimes(1);
    const [payload] = logInteraction.mock.calls[0];
    expect(payload.userId).toBe('user-1');
    expect(payload.error).toEqual({ hadError: true, message: 'connection terminated unexpectedly' });
  });

  test('previously this failure mode wrote NO row at all — regression guard', async () => {
    // Before the fix, a thrown error during processMessage propagated straight
    // to the route's catch block with no telemetry call in between. Assert the
    // call actually happens (not just that the promise rejects).
    await processMessage('user-1', 'hello', [], 'basic', null).catch(() => {});
    expect(logInteraction).toHaveBeenCalled();
  });
});

/**
 * Arbiter review on #52, major 4: "The one failure mode the beta actually hit
 * still writes no row" — `throw new AiUnavailableError()` sat before the
 * logging try, so a missing/unavailable API key bypassed telemetry entirely.
 * This is a distinct code path from the DB-throws test above: geminiClient is
 * resolved once at module load from GOOGLE_AI_API_KEY, so this suite must NOT
 * set that env var (the other suite in this file always does).
 */
describe('censusAgent processMessage — AiUnavailableError path', () => {
  let logInteraction;
  let processMessage;

  beforeEach(() => {
    jest.resetModules();
    delete process.env.GOOGLE_AI_API_KEY;

    jest.doMock('../../services/infra/db', () => ({
      db: { oneOrNone: jest.fn(), one: jest.fn(), any: jest.fn(), none: jest.fn() },
    }));

    logInteraction = jest.fn().mockResolvedValue(undefined);
    jest.doMock('../../services/infra/metricsService', () => ({
      logInteraction,
      logItemFeedback: jest.fn(),
      recordCommitInteraction: jest.fn(),
    }));

    ({ processMessage } = require('../../agents/censusAgent'));
  });

  afterEach(() => {
    jest.dontMock('../../services/infra/db');
    jest.dontMock('../../services/infra/metricsService');
  });

  test('logs had_error=true and rethrows AiUnavailableError when no API key is configured', async () => {
    await expect(
      processMessage('user-1', 'hello', [], 'basic', null)
    ).rejects.toMatchObject({ name: 'AiUnavailableError', status: 503 });

    expect(logInteraction).toHaveBeenCalledTimes(1);
    const [payload] = logInteraction.mock.calls[0];
    expect(payload.userId).toBe('user-1');
    expect(payload.error.hadError).toBe(true);
  });
});
