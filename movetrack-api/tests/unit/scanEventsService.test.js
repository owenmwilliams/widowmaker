'use strict';

/**
 * createScanRecorder consumes the scan pipeline's onStage events
 * (services/inventory/scanStatus.js — Pathway B's shared contract) and
 * persists one scan_events row per analyze call. Stage names stored are
 * SCAN_STAGES values verbatim.
 */

const { SCAN_STAGES, SCAN_STATUS } = require('../../services/inventory/scanStatus');

function freshService(insertImpl) {
  jest.resetModules();
  const insert = insertImpl || jest.fn().mockResolvedValue(undefined);
  jest.doMock('../../services/infra/db', () => ({ db: { none: insert } }));
  const svc = require('../../services/infra/scanEventsService');
  return { svc, insert };
}

afterEach(() => {
  jest.dontMock('../../services/infra/db');
});

describe('createScanRecorder', () => {
  const META = { userId: 'u1', sessionId: 's1', requestId: 'r1', mediaKind: 'video', mediaUrl: 'https://x/y.mov' };

  test('a clean scan persists status=success with per-stage statuses and download/frame meta', async () => {
    const { svc, insert } = freshService();
    const rec = svc.createScanRecorder(META);

    rec.onStage({ stage: SCAN_STAGES.DOWNLOAD, status: SCAN_STATUS.START, meta: {} });
    rec.onStage({ stage: SCAN_STAGES.DOWNLOAD, status: SCAN_STATUS.OK, meta: { bytes: 12345 } });
    rec.onStage({ stage: SCAN_STAGES.EXTRACT_FRAMES, status: SCAN_STATUS.OK, meta: { frameCount: 28 } });
    rec.onStage({ stage: SCAN_STAGES.ANALYZE, status: SCAN_STATUS.OK, meta: { itemCount: 9, latencyMs: 4000, provider: 'gemini' } });

    rec.finish({ success: true, itemCount: 9, _visionMs: 4000, _visionProvider: 'gemini', model: 'gemini-2.5-flash', usageMetadata: { totalTokenCount: 900 } });
    await new Promise(r => setImmediate(r));

    expect(insert).toHaveBeenCalledTimes(1);
    const [, p] = insert.mock.calls[0];
    expect(p[0]).toBe('u1');                       // user_id
    expect(p[3]).toBe('video');                    // media_kind
    expect(p[5]).toBe(12345);                      // media_bytes from download meta
    expect(p[6]).toBe(28);                         // frame_count from extract_frames meta
    expect(p[9]).toBe('success');                  // status
    expect(p[10]).toBeNull();                      // error_stage
    expect(JSON.parse(p[12])).toEqual({            // stage_status uses SCAN_STAGES names
      [SCAN_STAGES.DOWNLOAD]: 'ok',
      [SCAN_STAGES.EXTRACT_FRAMES]: 'ok',
      [SCAN_STAGES.ANALYZE]: 'ok',
    });
    expect(p[15]).toBe(JSON.stringify({ totalTokenCount: 900 })); // token_usage
    expect(p[16]).toBe(9);                         // item_count
  });

  test('error_stage is the FIRST error emitted, and start events are ignored', async () => {
    const { svc, insert } = freshService();
    const rec = svc.createScanRecorder(META);

    rec.onStage({ stage: SCAN_STAGES.EXTRACT_FRAMES, status: SCAN_STATUS.ERROR, meta: { error: 'ffmpeg exited 1' } });
    rec.onStage({ stage: SCAN_STAGES.ANALYZE, status: SCAN_STATUS.ERROR, meta: { error: 'never reached, second error' } });
    rec.finish({ success: false, error: 'Scan failed', failureStage: SCAN_STAGES.EXTRACT_FRAMES });
    await new Promise(r => setImmediate(r));

    const [, p] = insert.mock.calls[0];
    expect(p[9]).toBe('error');
    expect(p[10]).toBe(SCAN_STAGES.EXTRACT_FRAMES);
    expect(p[11]).toBe('ffmpeg exited 1');
  });

  test('a parse-error result is recorded as an error even when items came back (silent-zero forensics)', async () => {
    const { svc, insert } = freshService();
    const rec = svc.createScanRecorder({ ...META, mediaKind: 'photo' });

    rec.onStage({ stage: SCAN_STAGES.ANALYZE, status: SCAN_STATUS.OK, meta: { latencyMs: 700 } });
    rec.finish({ success: true, items: [], itemCount: 0, parseError: 'Unexpected end of JSON input' });
    await new Promise(r => setImmediate(r));

    const [, p] = insert.mock.calls[0];
    expect(p[9]).toBe('error');
    expect(p[13]).toBe('Unexpected end of JSON input'); // parse_error
  });

  test('degraded stages are visible in stage_status without failing the row', async () => {
    const { svc, insert } = freshService();
    const rec = svc.createScanRecorder(META);

    rec.onStage({ stage: SCAN_STAGES.EXTRACT_AUDIO, status: SCAN_STATUS.DEGRADED, meta: { reason: 'no audio stream' } });
    rec.onStage({ stage: SCAN_STAGES.ANALYZE, status: SCAN_STATUS.OK, meta: { itemCount: 3 } });
    rec.finish({ success: true, itemCount: 3 });
    await new Promise(r => setImmediate(r));

    const [, p] = insert.mock.calls[0];
    expect(p[9]).toBe('success');
    expect(JSON.parse(p[12])[SCAN_STAGES.EXTRACT_AUDIO]).toBe('degraded');
  });

  test('malformed onStage input never breaks the recorder', () => {
    const { svc } = freshService();
    const rec = svc.createScanRecorder(META);
    expect(() => rec.onStage(null)).not.toThrow();
    expect(() => rec.onStage({})).not.toThrow();
  });
});

describe('recordScanEvent', () => {
  test('never throws, even with a broken db call', async () => {
    const { svc } = freshService(jest.fn().mockRejectedValue(new Error('connection refused')));
    await expect(svc.recordScanEvent({ userId: 'u1', mediaKind: 'photo', status: 'success' })).resolves.toBeUndefined();
  });
});
