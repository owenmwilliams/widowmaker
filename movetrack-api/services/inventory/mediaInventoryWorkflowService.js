'use strict';

/**
 * Media Inventory Workflow Service
 *
 * Orchestrates photo/video analysis into inventory item candidates.
 * Downloads media, calls vision services, crops bounding boxes, uploads to GCS.
 *
 * Fail-loud contract (issue #41, Pathway B): a scan must NEVER report success
 * after a degraded path ran. Frame-extraction failure, an unparseable model
 * response, or an implausibly-fast empty result all return { success: false }
 * with a user-facing message — never a quietly-degraded "found N" or "found
 * nothing". Per-stage progress is emitted through an optional onStage callback
 * (see ./scanStatus) that Pathway C (SSE) and Pathway F (scan_events) consume.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const mediaAssetService = require('../infra/mediaAssetService');
const { downloadBuffer } = require('../infra/mediaDownloadService');
const { drawBoundingBox } = require('../infra/vision/imageUtils');
const { analyzeMultiItemPhoto, analyzeMultiImagePhoto, analyzeItemPhoto } = require('../infra/vision/imageService');
const { analyzeVideo, analyzeFrames } = require('../infra/vision/videoService');
const { extractSharpestFrame, extractFramesForScan, extractAudio } = require('../infra/vision/frameExtractor');
const { recordRoomVideo } = require('./roomVideoService');
const { specForName } = require('./itemSpecsReference');
const { SCAN_STAGES, SCAN_STATUS, makeStageEmitter } = require('./scanStatus');

// ── Fail-loud tuning (issue #41) ───────────────────────────────────────────────

// An "empty success" that came back faster than this almost certainly means the
// provider failed before really looking (the beta wine photo: 0 items in 460ms).
// Treat it as an error, not an empty result.
const VISION_MIN_LATENCY_MS = Number(process.env.VISION_MIN_LATENCY_MS || 2000);

// The legacy inline-video analysis path (low-res, poor recall) used to run
// silently whenever frame extraction failed and still reported success — exactly
// the degradation that burned the beta. It is now OFF by default; when explicitly
// enabled it is marked degraded (never a clean success).
const INLINE_VIDEO_FALLBACK_ENABLED = process.env.ENABLE_INLINE_VIDEO_FALLBACK === 'true';

// User-facing copy for a scan that could not be completed. The truth ("couldn't
// process this") costs less trust than a confident wrong answer.
const SCAN_FAILED_MESSAGE = 'Scan failed — please try again.';

/**
 * Build a standard fail-loud result. Callers return this directly so a degraded
 * pipeline never masquerades as success. `items`/`itemCount` are always present
 * and empty so consumers that read them don't crash.
 *
 * @param {string} stage   - which SCAN_STAGES step failed
 * @param {string} error   - technical detail (logs / telemetry)
 * @param {object} [extra] - extra fields to merge (e.g. _visionMs)
 */
function scanFailure(stage, error, extra = {}) {
  return {
    success: false,
    degraded: true,
    failureStage: stage,
    error,
    userMessage: SCAN_FAILED_MESSAGE,
    items: [],
    itemCount: 0,
    ...extra,
  };
}

/**
 * Fill weight/dimension gaps from the typical-specs table (free, no LLM) so every
 * item yields a cubic-foot estimate that matches its weight.
 */
function fillItemSpecs(items) {
  for (const item of items) {
    const spec = specForName(item.name);
    if (!spec) continue;
    if (item.weight_lbs == null) item.weight_lbs = spec.w;
    if (item.length_in == null) item.length_in = spec.l;
    if (item.width_in == null) item.width_in = spec.wd;
    if (item.height_in == null) item.height_in = spec.h;
  }
  return items;
}

/**
 * Look up the byte count the client reported for this URL when it uploaded the
 * file (set on the attachment before /message), so downloadBuffer can catch an
 * upload that never fully landed in GCS — a Content-Length check alone can't
 * see that, since the truncated object's own Content-Length matches its
 * (wrong) size.
 */
function expectedBytesFor(url, attachments) {
  if (!url || !Array.isArray(attachments)) return null;
  const match = attachments.find(a => a && a.url === url);
  const n = match && Number(match.byteLength);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Extract scan frames with a single retry. Frame extraction was intermittently
 * failing in the beta (same video → 2/2/9/3 items across four runs); one retry
 * recovers the transient case. Returns [] only after both attempts fail.
 */
async function extractFramesWithRetry(tmpPath) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const frames = await extractFramesForScan(tmpPath, { maxFrames: 28, fps: 1 });
      if (frames && frames.length > 0) return frames;
      console.warn(`[census] frame extraction attempt ${attempt}/2 produced 0 frames`);
    } catch (e) {
      console.warn(`[census] frame extraction attempt ${attempt}/2 failed:`, e.message);
    }
  }
  return [];
}

/**
 * Analyze one or more photos for inventory items.
 *
 * @param {object} args - { files, file_url, mime_type, mode }
 * @param {string} userId
 * @param {string} plan - 'basic' or 'pro'
 * @param {object} [opts] - { onStage } per-stage status callback (see scanStatus)
 * @returns {object} - { success, mode, items, itemCount, ... } | fail-loud result
 */
async function analyzePhotoForInventory(args, userId, plan, opts = {}) {
  const emitStage = makeStageEmitter(opts.onStage);
  const attachments = opts.attachments || [];
  try {
    // ── Normalize inputs ──
    let files = args.files || [];
    if (files.length === 0 && args.file_url) {
      files = [{ file_url: args.file_url, mime_type: args.mime_type }];
    }
    if (files.length === 0) {
      return { success: false, error: 'No photos provided' };
    }
    if (files.length > 5) {
      return { success: false, error: 'Maximum 5 photos per call. Send additional photos in a separate call.' };
    }

    const mode = args.mode || 'multi_item';

    // ── Download all images ──
    emitStage(SCAN_STAGES.DOWNLOAD, SCAN_STATUS.START, { total: files.length });
    const imageBuffers = [];
    for (const file of files) {
      try {
        const expectedBytes = expectedBytesFor(file.file_url, attachments);
        const buffer = await downloadBuffer(file.file_url, { userId, expectedBytes });
        imageBuffers.push({ buffer, mimeType: file.mime_type, url: file.file_url });
      } catch (dlErr) {
        console.warn(`[census] Failed to download ${file.file_url}:`, dlErr.message);
      }
    }
    if (imageBuffers.length === 0) {
      emitStage(SCAN_STAGES.DOWNLOAD, SCAN_STATUS.ERROR, { downloaded: 0, total: files.length });
      return scanFailure(SCAN_STAGES.DOWNLOAD, 'Failed to download any of the provided photos');
    }
    // Partial download: some photos never landed (the beta's truncated-object
    // mode). Proceed with what we have, but mark the scan degraded and emit it —
    // never report a clean success when input was silently lost.
    const downloadDegraded = imageBuffers.length < files.length;
    emitStage(
      SCAN_STAGES.DOWNLOAD,
      downloadDegraded ? SCAN_STATUS.DEGRADED : SCAN_STATUS.OK,
      { downloaded: imageBuffers.length, total: files.length }
    );

    const visionStart = Date.now();

    // ── Single-item mode (close-up of one item) ──
    if (mode === 'single_item') {
      emitStage(SCAN_STAGES.ANALYZE, SCAN_STATUS.START, { mode });
      const base64 = imageBuffers[0].buffer.toString('base64');
      const result = await analyzeItemPhoto(base64, imageBuffers[0].mimeType, 'gemini', undefined, null, plan, userId);
      const visionMs = Date.now() - visionStart;

      // Fail loud: a provider failure must not read as a blank item.
      if (result && result.success === false) {
        emitStage(SCAN_STAGES.ANALYZE, SCAN_STATUS.ERROR, { error: result.error, latencyMs: visionMs });
        return scanFailure(SCAN_STAGES.ANALYZE, result.error || 'Vision analysis failed', { _visionMs: visionMs });
      }

      const persisted = await mediaAssetService.ingestUpload({
        userId,
        buffer: imageBuffers[0].buffer,
        mimeType: imageBuffers[0].mimeType || 'image/jpeg',
        source: 'derived_thumbnail',
      });
      const pictureUrl = persisted.url;
      const itemData = result.data || result;
      const conf = itemData.confidence || 0;
      emitStage(SCAN_STAGES.ANALYZE, SCAN_STATUS.OK, { itemCount: 1, latencyMs: visionMs, provider: 'gemini' });
      return {
        success: true,
        mode: 'single_item',
        item: { ...itemData, picture_url: pictureUrl },
        _visionMs: visionMs,
        _detectedItemCount: 1,
        _avgConfidence: conf || null,
        _minConfidence: conf || null,
        _visionProvider: 'gemini',
        ...(downloadDegraded ? { degraded: true, degradedStage: SCAN_STAGES.DOWNLOAD } : {}),
      };
    }

    // ── Multi-item mode ──
    emitStage(SCAN_STAGES.ANALYZE, SCAN_STATUS.START, { imageCount: imageBuffers.length });
    let result;
    if (imageBuffers.length === 1) {
      const base64 = imageBuffers[0].buffer.toString('base64');
      result = await analyzeMultiItemPhoto(base64, imageBuffers[0].mimeType, 'gemini', {}, plan, userId);
    } else {
      console.log(`[census] Analyzing ${imageBuffers.length} photos holistically`);
      const imageSources = imageBuffers.map(ib => ({
        base64: ib.buffer.toString('base64'),
        mimeType: ib.mimeType,
      }));
      result = await analyzeMultiImagePhoto(imageSources, 'gemini', plan, userId);
    }
    const visionElapsed = Date.now() - visionStart;

    // Fail loud: a provider/parse failure returns { success:false } here — do NOT
    // let it collapse into an empty-but-successful result (the beta wine photo).
    if (result && result.success === false) {
      emitStage(SCAN_STAGES.ANALYZE, SCAN_STATUS.ERROR, { error: result.error, latencyMs: visionElapsed });
      return scanFailure(SCAN_STAGES.ANALYZE, result.error || 'Vision analysis failed', { _visionMs: visionElapsed });
    }

    let items = result.data?.items || result.items || [];
    let itemCount = result.data?.itemCount || result.itemCount || items.length;

    // Plausibility floor: 0 items returned implausibly fast means something failed
    // at/before the provider and was swallowed — surface it as an error.
    if (items.length === 0 && visionElapsed < VISION_MIN_LATENCY_MS) {
      emitStage(SCAN_STAGES.ANALYZE, SCAN_STATUS.ERROR, { latencyMs: visionElapsed, reason: 'implausibly_fast_empty' });
      return scanFailure(
        SCAN_STAGES.ANALYZE,
        `Vision returned 0 items in ${visionElapsed}ms (below ${VISION_MIN_LATENCY_MS}ms floor)`,
        { _visionMs: visionElapsed }
      );
    }

    if (imageBuffers.length === 1) items.forEach(item => { item.sourceImage = 1; });
    emitStage(SCAN_STAGES.ANALYZE, SCAN_STATUS.OK, { itemCount: items.length, latencyMs: visionElapsed, provider: 'gemini' });

    // ── Crop each item from its source image ──
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const bbox = item.boundingBox || item.bbox;
      if (!bbox) continue;

      const srcIdx = (item.sourceImage || 1) - 1;
      const sourceBuffer = imageBuffers[Math.min(srcIdx, imageBuffers.length - 1)].buffer;

      try {
        const annotated = await drawBoundingBox(sourceBuffer, bbox, { minSize: 10, quality: 85 });
        if (!annotated) continue;
        const persisted = await mediaAssetService.ingestUpload({
          userId,
          buffer: annotated,
          mimeType: 'image/jpeg',
          source: 'derived_crop',
        });
        item.picture_url = persisted.url;
        console.log(`[census] Cropped item[${i}] "${item.name}" from image ${srcIdx + 1}`);
      } catch (cropErr) {
        console.warn(`[census] Crop failed for item[${i}]:`, cropErr.message);
      }
    }

    const confidences = items.map(i => i.confidence || 0).filter(c => c > 0);
    return {
      success: true, mode: 'multi_item', imageCount: imageBuffers.length, items, itemCount,
      _visionMs: visionElapsed,
      _detectedItemCount: items.length,
      _avgConfidence: confidences.length > 0 ? confidences.reduce((a, b) => a + b, 0) / confidences.length : null,
      _minConfidence: confidences.length > 0 ? Math.min(...confidences) : null,
      _visionProvider: 'gemini',
      ...(downloadDegraded ? { degraded: true, degradedStage: SCAN_STAGES.DOWNLOAD } : {}),
    };
  } catch (err) {
    console.error('[census] analyzePhotoForInventory failed:', err.message);
    emitStage(SCAN_STAGES.OTHER, SCAN_STATUS.ERROR, { error: err.message });
    return scanFailure(SCAN_STAGES.OTHER, err.message);
  }
}

/**
 * Degraded inline-video fallback. Only reachable when ENABLE_INLINE_VIDEO_FALLBACK
 * is set (e.g. an environment that cannot run ffmpeg). Marked `degraded: true` so
 * it is never mistaken for a clean frames-path success.
 */
async function inlineVideoFallback({ args, userId, plan, url, videoBuffer, emitStage }) {
  console.warn('[census] ENABLE_INLINE_VIDEO_FALLBACK set — running degraded inline video analysis');
  emitStage(SCAN_STAGES.ANALYZE, SCAN_STATUS.START, { path: 'inline_fallback' });
  // Timer starts immediately before the model call — excludes the two failed
  // ffmpeg extraction attempts that preceded this fallback.
  const analyzeStart = Date.now();
  const result = await analyzeVideo(videoBuffer, args.mime_type, plan, null, args.room_hint || null, userId);
  const items = result.items || [];
  const parseError = result.parseError;
  const analyzeMs = Date.now() - analyzeStart;

  if (parseError && items.length === 0) {
    emitStage(SCAN_STAGES.ANALYZE, SCAN_STATUS.ERROR, { parseError, latencyMs: analyzeMs, path: 'inline_fallback' });
    return scanFailure(SCAN_STAGES.ANALYZE, `Vision response could not be parsed: ${parseError}`, { _visionMs: analyzeMs });
  }

  fillItemSpecs(items);
  emitStage(SCAN_STAGES.ANALYZE, SCAN_STATUS.DEGRADED, { itemCount: items.length, latencyMs: analyzeMs, path: 'inline_fallback' });
  try {
    await recordRoomVideo(userId, {
      videoUrl: url, mimeType: args.mime_type, roomName: args.room_hint || null,
      itemCount: items.length, thumbnailUrl: null, notes: null,
    });
  } catch (e) {
    console.warn('[census] recordRoomVideo failed:', e.message);
  }
  return {
    success: true, degraded: true, degradedPath: 'inline_video',
    items, itemCount: items.length, parseError: null,
    _visionMs: analyzeMs, _detectedItemCount: items.length, _visionProvider: 'gemini',
    usageMetadata: result.usageMetadata || null,
    model: result.model || null,
  };
}

/**
 * Analyze a video for inventory items. Samples full-resolution frames across the
 * clip and reads those (crisp stills recall small/medium items a low-res inline
 * video misses). Fails loudly rather than silently degrading.
 *
 * @param {object} args - { file_url, mime_type, room_hint }
 * @param {string} userId
 * @param {string} plan - 'basic' or 'pro'
 * @param {object} [opts] - { onStage } per-stage status callback (see scanStatus)
 * @returns {object} - { success, items, itemCount, ... } | fail-loud result
 */
async function analyzeVideoForInventory(args, userId, plan, opts = {}) {
  const emitStage = makeStageEmitter(opts.onStage);
  const attachments = opts.attachments || [];
  let tmpPath = null;
  try {
    const url = args.file_url;

    // ── Stage: download ── (A/#40 owns hardening; we surface failure loudly) ──
    emitStage(SCAN_STAGES.DOWNLOAD, SCAN_STATUS.START, { url });
    console.log(`[census] Downloading video for analysis: ${url}`);
    let videoBuffer;
    try {
      videoBuffer = await downloadBuffer(url, { userId, expectedBytes: expectedBytesFor(url, attachments) });
    } catch (dlErr) {
      emitStage(SCAN_STAGES.DOWNLOAD, SCAN_STATUS.ERROR, { error: dlErr.message });
      return scanFailure(SCAN_STAGES.DOWNLOAD, `Video download failed: ${dlErr.message}`);
    }
    const bytes = videoBuffer.length;
    console.log(`[census] Video downloaded: ${(bytes / 1024 / 1024).toFixed(1)}MB`);
    emitStage(SCAN_STAGES.DOWNLOAD, SCAN_STATUS.OK, { bytes });

    const ext = (args.mime_type || 'video/mp4').split('/')[1] || 'mp4';
    tmpPath = path.join(os.tmpdir(), `nexus-video-${Date.now()}.${ext}`);
    fs.writeFileSync(tmpPath, videoBuffer);

    // ── Stage: extract frames (retry once, then FAIL — no silent fallback) ──
    emitStage(SCAN_STAGES.EXTRACT_FRAMES, SCAN_STATUS.START, {});
    const frames = await extractFramesWithRetry(tmpPath);

    if (frames.length === 0) {
      emitStage(SCAN_STAGES.EXTRACT_FRAMES, SCAN_STATUS.ERROR, { attempts: 2 });
      if (INLINE_VIDEO_FALLBACK_ENABLED) {
        return await inlineVideoFallback({ args, userId, plan, url, videoBuffer, emitStage });
      }
      // Fail loud. The old silent inline fallback returned a 2–6 item result as
      // "success" and made users retry a working system four times. No vision
      // call ran here, so vision time is 0.
      return scanFailure(
        SCAN_STAGES.EXTRACT_FRAMES,
        'Frame extraction produced 0 frames after retry',
        { _visionMs: 0 }
      );
    }
    emitStage(SCAN_STAGES.EXTRACT_FRAMES, SCAN_STATUS.OK, { frameCount: frames.length });

    // ── Stage: audio (best-effort, non-fatal) ──
    emitStage(SCAN_STAGES.EXTRACT_AUDIO, SCAN_STATUS.START, {});
    let audio = null;
    try {
      audio = await extractAudio(tmpPath);
      emitStage(SCAN_STAGES.EXTRACT_AUDIO, audio ? SCAN_STATUS.OK : SCAN_STATUS.DEGRADED, {});
    } catch (e) {
      console.warn('[census] audio extraction failed:', e.message);
      emitStage(SCAN_STAGES.EXTRACT_AUDIO, SCAN_STATUS.DEGRADED, { error: e.message });
    }

    // ── Stage: upload frames (best-effort per-frame, non-fatal) ──
    emitStage(SCAN_STAGES.UPLOAD_FRAMES, SCAN_STATUS.START, { frameCount: frames.length });
    const frameUrls = [];
    for (let i = 0; i < frames.length; i++) {
      try {
        const persisted = await mediaAssetService.ingestUpload({
          userId,
          buffer: frames[i].buffer,
          mimeType: 'image/jpeg',
          source: 'derived_thumbnail',
        });
        frameUrls[i] = persisted.url;
      } catch (e) {
        frameUrls[i] = null;
      }
    }
    const uploaded = frameUrls.filter(Boolean).length;
    const firstFrameUrl = frameUrls.find(Boolean) || null;
    emitStage(
      SCAN_STAGES.UPLOAD_FRAMES,
      uploaded === frames.length ? SCAN_STATUS.OK : SCAN_STATUS.DEGRADED,
      { uploaded, total: frames.length }
    );

    // ── Stage: analyze ── (timer starts HERE, immediately before the model call,
    // so _visionMs and the analyze latencyMs measure the vision call only — not
    // ffmpeg + audio + frame uploads. That is what makes the implausible-empty
    // guard able to fire, and keeps the latency F persists honest.)
    emitStage(SCAN_STAGES.ANALYZE, SCAN_STATUS.START, { frameCount: frames.length });
    const analyzeStart = Date.now();
    const result = await analyzeFrames(frames, plan, args.room_hint || null, audio, userId);
    const items = result.items || [];
    const parseError = result.parseError;
    const narrationNotes = result.narrationNotes || null;
    const analyzeMs = Date.now() - analyzeStart;

    // Fail loud: an unparseable model response must never read as "found nothing".
    if (parseError && items.length === 0) {
      emitStage(SCAN_STAGES.ANALYZE, SCAN_STATUS.ERROR, { parseError, latencyMs: analyzeMs });
      return scanFailure(SCAN_STAGES.ANALYZE, `Vision response could not be parsed: ${parseError}`, { _visionMs: analyzeMs });
    }
    // Plausibility floor: an empty result returned implausibly fast means the
    // provider failed before really looking, not that the room was empty.
    if (items.length === 0 && analyzeMs < VISION_MIN_LATENCY_MS) {
      emitStage(SCAN_STAGES.ANALYZE, SCAN_STATUS.ERROR, { latencyMs: analyzeMs, reason: 'implausibly_fast_empty' });
      return scanFailure(
        SCAN_STAGES.ANALYZE,
        `Vision returned 0 items in ${analyzeMs}ms (below ${VISION_MIN_LATENCY_MS}ms floor)`,
        { _visionMs: analyzeMs }
      );
    }
    emitStage(SCAN_STAGES.ANALYZE, SCAN_STATUS.OK, { itemCount: items.length, latencyMs: analyzeMs, provider: 'gemini' });

    // Attach a real frame photo to each detected item.
    for (const item of items) {
      const sf = Number(item.source_frame);
      if (Number.isFinite(sf) && sf >= 1 && sf <= frameUrls.length && frameUrls[sf - 1]) {
        item.picture_url = frameUrls[sf - 1];
      }
    }
    fillItemSpecs(items);

    // ── Stage: persist (best-effort record, non-fatal) ──
    emitStage(SCAN_STAGES.PERSIST, SCAN_STATUS.START, {});
    try {
      await recordRoomVideo(userId, {
        videoUrl: url,
        mimeType: args.mime_type,
        roomName: args.room_hint || null,
        itemCount: items.length,
        thumbnailUrl: firstFrameUrl,
        notes: narrationNotes,
      });
      emitStage(SCAN_STAGES.PERSIST, SCAN_STATUS.OK, {});
    } catch (e) {
      console.warn('[census] recordRoomVideo failed:', e.message);
      emitStage(SCAN_STAGES.PERSIST, SCAN_STATUS.DEGRADED, { error: e.message });
    }

    return {
      success: true, items, itemCount: items.length, parseError: null,
      _visionMs: analyzeMs,
      _detectedItemCount: items.length,
      _visionProvider: 'gemini',
      usageMetadata: result.usageMetadata || null,
      model: result.model || null,
    };
  } catch (err) {
    console.error('[census] analyzeVideoForInventory failed:', err.message);
    emitStage(SCAN_STAGES.OTHER, SCAN_STATUS.ERROR, { error: err.message });
    return scanFailure(SCAN_STAGES.OTHER, err.message);
  } finally {
    if (tmpPath) { try { fs.unlinkSync(tmpPath); } catch (_) {} }
  }
}

module.exports = {
  analyzePhotoForInventory,
  analyzeVideoForInventory,
  // exported for tests / reuse
  extractFramesWithRetry,
  scanFailure,
  fillItemSpecs,
};
