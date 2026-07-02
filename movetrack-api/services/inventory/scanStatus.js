'use strict';

/**
 * services/inventory/scanStatus.js
 *
 * Per-stage status hook for the media scan pipeline (issue #41, Pathway B).
 *
 * `analyzeVideoForInventory` (and, for the analyze stage, the photo path) emit one
 * event per pipeline stage through an optional `onStage(evt)` callback. This is the
 * shared contract that downstream work subscribes to:
 *   - Pathway C (issue #42) forwards these to the SSE stream as progress events.
 *   - Pathway F (issue #45) persists them as `scan_events` rows.
 * Do NOT rename fields or values without updating those consumers.
 *
 * Event shape (all three fields always present):
 *   {
 *     stage:  <SCAN_STAGES value>  — which pipeline step this is about
 *     status: <SCAN_STATUS value>  — 'start' | 'ok' | 'degraded' | 'error'
 *     meta:   <object>             — stage-specific detail; {} when there is none.
 *                                    Common keys: bytes, frameCount, uploaded,
 *                                    total, itemCount, provider, model, latencyMs,
 *                                    parseError, error, reason, attempts.
 *   }
 *
 * Semantics of `status`:
 *   start    — the stage is about to run.
 *   ok       — the stage completed normally.
 *   degraded — the stage did not fully succeed but the scan can still proceed
 *              (e.g. audio track missing, some frame uploads failed). NON-fatal.
 *   error    — the stage failed in a way that fails the whole scan. Whenever an
 *              'error' is emitted the scan returns { success: false } — a scan
 *              must never report success after a degraded/failed path ran.
 */

const SCAN_STAGES = Object.freeze({
  DOWNLOAD: 'download',
  EXTRACT_FRAMES: 'extract_frames',
  EXTRACT_AUDIO: 'extract_audio',
  UPLOAD_FRAMES: 'upload_frames',
  ANALYZE: 'analyze',
  PERSIST: 'persist',
  // Catch-all for failures that don't belong to a specific pipeline stage
  // (unexpected throws: tmp-file writes, GCS errors, programmer error). Keeps
  // `failureStage` within the published enum instead of an ad-hoc 'unknown'.
  OTHER: 'other',
});

const SCAN_STATUS = Object.freeze({
  START: 'start',
  OK: 'ok',
  DEGRADED: 'degraded',
  ERROR: 'error',
});

/**
 * Wrap an optional consumer callback into a safe emitter. Returns a no-op when no
 * callback is supplied, and never lets a misbehaving consumer throw into the scan.
 *
 * @param {(evt: {stage: string, status: string, meta: object}) => void} [onStage]
 * @returns {(stage: string, status: string, meta?: object) => void}
 */
function makeStageEmitter(onStage) {
  if (typeof onStage !== 'function') return () => {};
  return (stage, status, meta = {}) => {
    try {
      onStage({ stage, status, meta: meta || {} });
    } catch (_) {
      /* a status consumer must never break the scan */
    }
  };
}

module.exports = { SCAN_STAGES, SCAN_STATUS, makeStageEmitter };
