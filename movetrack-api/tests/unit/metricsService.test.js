'use strict';

describe('metricsService', () => {
  let insert, update, metrics;

  beforeEach(() => {
    jest.resetModules();
    insert = jest.fn().mockResolvedValue(undefined);
    update = jest.fn().mockResolvedValue(undefined);
    jest.doMock('../../services/infra/db', () => ({
      db: {
        none: jest.fn((sql, params) => {
          if (/INSERT INTO beta_interaction_logs/.test(sql)) return insert(sql, params);
          if (/UPDATE nexus_sessions/.test(sql)) return update(sql, params);
          return Promise.resolve();
        }),
      },
    }));
    metrics = require('../../services/infra/metricsService');
  });

  afterEach(() => {
    jest.dontMock('../../services/infra/db');
  });

  describe('logInteraction', () => {
    test('writes had_error=true and the error message for a thrown-turn row', async () => {
      await metrics.logInteraction({
        userId: 'u1', sessionId: 's1',
        timing: { totalMs: 5000 },
        context: { toolCalls: ['analyze_video'], itemsAdded: 0 },
        vision: {},
        error: { hadError: true, message: 'Cannot read properties of undefined' },
      });

      expect(insert).toHaveBeenCalledTimes(1);
      const [, params] = insert.mock.calls[0];
      // params order: userId, sessionId, totalMs, ttfeMs, geminiMs, visionMs,
      // hadAttachments, attachmentCount, attachmentTypes, toolCalls, toolCallCount,
      // itemsAdded, detectedItemCount, avgConfidence, minConfidence, visionProvider,
      // geminiModel, geminiRounds, hadError, errorMessage
      expect(params[18]).toBe(true); // had_error
      expect(params[19]).toBe('Cannot read properties of undefined'); // error_message
    });

    test('defaults had_error to false when no error payload is given', async () => {
      await metrics.logInteraction({ userId: 'u1', sessionId: 's1' });
      const [, params] = insert.mock.calls[0];
      expect(params[18]).toBe(false);
      expect(params[19]).toBeNull();
    });

    test('never throws even if the insert rejects (fire-and-forget)', async () => {
      insert.mockRejectedValueOnce(new Error('db down'));
      await expect(metrics.logInteraction({ userId: 'u1' })).resolves.toBeUndefined();
    });
  });

  describe('recordCommitInteraction', () => {
    test('increments nexus_sessions.items_added and logs a row tagged inventory_commit', async () => {
      await metrics.recordCommitInteraction({ userId: 'u1', sessionId: 's1', itemsAdded: 6, errors: [] });

      expect(update).toHaveBeenCalledTimes(1);
      const [, updateParams] = update.mock.calls[0];
      expect(updateParams).toEqual([6, 's1']);

      expect(insert).toHaveBeenCalledTimes(1);
      const [, insertParams] = insert.mock.calls[0];
      expect(insertParams[9]).toEqual(['inventory_commit']); // tool_calls
      expect(insertParams[11]).toBe(6); // items_added_this_turn
      expect(insertParams[18]).toBe(false); // had_error (items were added)
    });

    test('flags had_error when nothing was added and there were failures', async () => {
      await metrics.recordCommitInteraction({
        userId: 'u1', sessionId: 's1', itemsAdded: 0, errors: ['No location found'],
      });
      const [, insertParams] = insert.mock.calls[0];
      expect(insertParams[18]).toBe(true);
      expect(insertParams[19]).toBe('No location found');
    });

    test('skips the session update when no session is active (still logs the row)', async () => {
      await metrics.recordCommitInteraction({ userId: 'u1', sessionId: null, itemsAdded: 3, errors: [] });
      expect(update).not.toHaveBeenCalled();
      expect(insert).toHaveBeenCalledTimes(1);
    });
  });
});
