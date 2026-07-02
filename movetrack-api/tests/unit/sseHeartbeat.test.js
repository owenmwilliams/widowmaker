/**
 * Unit tests for the SSE heartbeat helper (services/infra/sseHeartbeat.js). DB-free.
 */

const { EventEmitter } = require('events');
const { startSSEHeartbeat, HEARTBEAT_INTERVAL_MS } = require('../../services/infra/sseHeartbeat');

function mockRes() {
  const res = new EventEmitter();
  res.writableEnded = false;
  res.destroyed = false;
  res.writes = [];
  res.write = (chunk) => { res.writes.push(chunk); return true; };
  return res;
}

describe('startSSEHeartbeat', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  test('writes a comment heartbeat after a silent interval', () => {
    const res = mockRes();
    const hb = startSSEHeartbeat(res);
    jest.advanceTimersByTime(HEARTBEAT_INTERVAL_MS);
    expect(res.writes).toHaveLength(1);
    expect(res.writes[0]).toMatch(/^: heartbeat \d+\n\n$/);
    hb.stop();
  });

  test('heartbeats repeat for as long as the stream stays silent', () => {
    const res = mockRes();
    const hb = startSSEHeartbeat(res);
    jest.advanceTimersByTime(HEARTBEAT_INTERVAL_MS * 12); // ~2 min of vision silence
    expect(res.writes.length).toBe(12);
    hb.stop();
  });

  test('touch() suppresses the next heartbeat when real events flow', () => {
    const res = mockRes();
    const hb = startSSEHeartbeat(res);
    jest.advanceTimersByTime(HEARTBEAT_INTERVAL_MS - 1000);
    hb.touch(); // a real event was just written
    jest.advanceTimersByTime(1000); // interval tick fires, but gap since touch is small
    expect(res.writes).toHaveLength(0);
    hb.stop();
  });

  test('stop() ends heartbeats', () => {
    const res = mockRes();
    const hb = startSSEHeartbeat(res);
    hb.stop();
    jest.advanceTimersByTime(HEARTBEAT_INTERVAL_MS * 3);
    expect(res.writes).toHaveLength(0);
  });

  test('stops writing after the client disconnects', () => {
    const res = mockRes();
    startSSEHeartbeat(res);
    res.emit('close');
    jest.advanceTimersByTime(HEARTBEAT_INTERVAL_MS * 3);
    expect(res.writes).toHaveLength(0);
  });

  test('does not write to an ended response', () => {
    const res = mockRes();
    startSSEHeartbeat(res);
    res.writableEnded = true;
    jest.advanceTimersByTime(HEARTBEAT_INTERVAL_MS * 3);
    expect(res.writes).toHaveLength(0);
  });
});
