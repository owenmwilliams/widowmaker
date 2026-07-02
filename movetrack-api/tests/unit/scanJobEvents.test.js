'use strict';

/**
 * The durable-job path is the primary iOS scan flow, so it must leave the same
 * scan_events forensic trail as the chat path (issue #45): a recorder is
 * created per attempt, the workflow gets its onStage hook, and finish() runs
 * on success AND on a thrown analysis.
 */

const mockOnStage = jest.fn();
const mockFinish = jest.fn();
const mockCreateScanRecorder = jest.fn(() => ({ onStage: mockOnStage, finish: mockFinish }));
const mockAnalyzeVideo = jest.fn();
const mockAnalyzePhoto = jest.fn();

jest.mock('../../services/infra/scanEventsService', () => ({
  createScanRecorder: (...a) => mockCreateScanRecorder(...a),
  recordScanEvent: jest.fn(),
}));
jest.mock('../../services/inventory/mediaInventoryWorkflowService', () => ({
  analyzeVideoForInventory: (...a) => mockAnalyzeVideo(...a),
  analyzePhotoForInventory: (...a) => mockAnalyzePhoto(...a),
}));
jest.mock('../../services/infra/metricsService', () => ({
  logInteraction: jest.fn().mockResolvedValue(undefined),
}));

const dbCalls = [];
jest.mock('../../services/infra/db', () => ({
  db: {
    oneOrNone: jest.fn(async (sql, params) => {
      dbCalls.push(sql);
      // claimNextJob: return a processing-claimed video job on the first claim
      if (/UPDATE scan_jobs[\s\S]*RETURNING/.test(sql) && /processing/.test(sql)) {
        return dbCalls.filter(s => /RETURNING/.test(s)).length === 1
          ? {
              id: '11111111-1111-4111-8111-111111111111',
              user_id: 'user-1',
              session_id: 'sess-1',
              media_url: 'https://storage.googleapis.com/b/users/user-1/chat/nexus/x.mov',
              mime_type: 'video/quicktime',
              media_kind: 'video',
              room_hint: 'Dining Room',
              caption: null,
              plan: 'basic',
              attempts: 1,
              created_at: new Date().toISOString(),
              started_at: new Date().toISOString(),
            }
          : null;
      }
      return null;
    }),
    result: jest.fn(async () => ({ rowCount: 1 })),
    none: jest.fn(async () => undefined),
    any: jest.fn(async () => []),
  },
}));

const scanJobs = require('../../services/inventory/scanJobService');

beforeEach(() => {
  dbCalls.length = 0;
  mockOnStage.mockClear();
  mockFinish.mockClear();
  mockCreateScanRecorder.mockClear();
  mockAnalyzeVideo.mockReset();
  mockAnalyzePhoto.mockReset();
});

test('a completed job creates a scan recorder, passes onStage to the workflow, and finishes with the result', async () => {
  const analysis = { success: true, items: [{ name: 'Dining table' }], itemCount: 1, _visionMs: 4000 };
  mockAnalyzeVideo.mockResolvedValue(analysis);

  await scanJobs.processJob();

  expect(mockCreateScanRecorder).toHaveBeenCalledTimes(1);
  const meta = mockCreateScanRecorder.mock.calls[0][0];
  expect(meta.userId).toBe('user-1');
  expect(meta.mediaKind).toBe('video');
  expect(meta.requestId).toMatch(/^scan_job:/);

  // Workflow received the recorder's onStage hook as its 4th arg.
  const opts = mockAnalyzeVideo.mock.calls[0][3];
  expect(opts.onStage).toBe(mockOnStage);

  expect(mockFinish).toHaveBeenCalledTimes(1);
  expect(mockFinish).toHaveBeenCalledWith(analysis);
});

test('a thrown analysis still finishes the recorder (forensic row for the failure)', async () => {
  mockAnalyzeVideo.mockRejectedValue(new Error('ffmpeg exploded'));

  await scanJobs.processJob();

  expect(mockCreateScanRecorder).toHaveBeenCalledTimes(1);
  expect(mockFinish).toHaveBeenCalledTimes(1);
  // finish() sees undefined when the analysis threw — the recorder records the
  // stage trail it observed, which is the point.
  expect(mockFinish).toHaveBeenCalledWith(undefined);
});
