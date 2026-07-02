// Keeps an SSE response alive through long silent stretches. Vision processing
// (video download → ffmpeg → frame uploads → Gemini) emits no events for
// 70–90s on real scans, and iOS's URLSession aborts at 120s between bytes.
// Writing an SSE comment line (": …") resets that clock without reaching any
// client handler — both the iOS parser (NexusService.streamSSE) and the web
// parser (NexusStore) skip lines that don't start with "data:".

const HEARTBEAT_INTERVAL_MS = 10_000;

/**
 * Start a heartbeat on an SSE response. Call `touch()` whenever a real event
 * is written so heartbeats only fill genuine silence, and `stop()` when the
 * stream ends. Stops itself if the client disconnects.
 *
 * @param {import('http').ServerResponse} res - response already in SSE mode
 * @param {number} [intervalMs] - max silence before a comment is written
 */
function startSSEHeartbeat(res, intervalMs = HEARTBEAT_INTERVAL_MS) {
  let lastWrite = Date.now();

  const timer = setInterval(() => {
    if (res.writableEnded || res.destroyed) {
      clearInterval(timer);
      return;
    }
    if (Date.now() - lastWrite >= intervalMs) {
      res.write(`: heartbeat ${Date.now()}\n\n`);
      lastWrite = Date.now();
    }
  }, intervalMs);
  timer.unref?.();

  const stop = () => clearInterval(timer);
  res.on('close', stop);

  return {
    touch() { lastWrite = Date.now(); },
    stop,
  };
}

module.exports = { startSSEHeartbeat, HEARTBEAT_INTERVAL_MS };
