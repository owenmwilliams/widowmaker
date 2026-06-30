/**
 * frameExtractor.js
 * Extract the sharpest JPEG frame from a video near a given timestamp.
 *
 * Uses ffmpeg-static (statically compiled, no system ffmpeg required) to pull
 * a short clip around the target second, then scores each candidate frame with
 * a Laplacian-variance sharpness metric via sharp.
 *
 * High Laplacian variance  ⟹  lots of edges  ⟹  sharp frame.
 * Low Laplacian variance   ⟹  smooth / blurry frame.
 */

const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
const sharp = require('sharp');
const os = require('os');
const path = require('path');
const fs = require('fs');

ffmpeg.setFfmpegPath(ffmpegPath);

/**
 * Compute Laplacian variance of a JPEG buffer as a sharpness proxy.
 * Returns a non-negative float; higher = sharper.
 */
async function sharpnessScore(jpegBuffer) {
  try {
    // Downsample first for speed, then apply 3×3 Laplacian kernel
    const { data } = await sharp(jpegBuffer)
      .resize(120, 90, { fit: 'cover' })
      .grayscale()
      .convolve({ width: 3, height: 3, kernel: [0, -1, 0, -1, 4, -1, 0, -1, 0] })
      .raw()
      .toBuffer({ resolveWithObject: true });

    let sum = 0, sumSq = 0;
    for (const v of data) { sum += v; sumSq += v * v; }
    const n = data.length;
    const mean = sum / n;
    return sumSq / n - mean * mean;
  } catch {
    return 0;
  }
}

/**
 * Extract the sharpest JPEG frame from a video around `seconds`.
 *
 * @param {string} videoSource - Local file path OR HTTPS URL (e.g. signed GCS URL)
 * @param {number} seconds     - Target timestamp in seconds
 * @returns {Promise<Buffer|null>} JPEG buffer of the sharpest frame, or null on failure
 */
async function extractSharpestFrame(videoSource, seconds) {
  // Extract a 0.5s window centred just before the target timestamp.
  // Fast-seek (-ss before -i) lets ffmpeg jump to the keyframe, avoiding
  // full decode of the preceding video.
  const seekTo = Math.max(0, seconds - 0.25);

  const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'mtscan-'));
  try {
    await new Promise((resolve, reject) => {
      ffmpeg(videoSource)
        .inputOptions([`-ss ${seekTo}`])
        .outputOptions([
          '-t 0.5',       // grab half a second of video
          '-vf fps=10',   // ≈5 candidate frames
          '-frames:v 5',  // hard cap
          '-q:v 4',       // decent JPEG quality (lower = better, 1–31)
        ])
        .output(path.join(tmpDir, 'f%02d.jpg'))
        .on('end', resolve)
        .on('error', reject)
        .run();
    });

    const files = (await fs.promises.readdir(tmpDir)).sort();
    if (files.length === 0) return null;

    let bestBuf = null, bestScore = -1;
    for (const f of files) {
      const buf = await fs.promises.readFile(path.join(tmpDir, f));
      const score = await sharpnessScore(buf);
      if (score > bestScore) { bestScore = score; bestBuf = buf; }
    }

    console.log(`[frameExtractor] t=${seconds}s — scored ${files.length} frames, best sharpness=${bestScore.toFixed(1)}`);
    return bestBuf;
  } catch (err) {
    console.warn(`[frameExtractor] Failed at t=${seconds}s:`, err.message);
    return null;
  } finally {
    await fs.promises.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Sample frames across an entire video for inventory detection. Pulls one frame
 * per `fps` second (downscaled), then evenly subsamples to at most `maxFrames`,
 * preserving order. Full-resolution still frames let the model read small items
 * a low-res inline video would miss — and sidesteps the inline-video size limit.
 *
 * @param {string} videoSource - local file path or HTTPS URL
 * @param {{maxFrames?:number, fps?:number, width?:number}} [opts]
 * @returns {Promise<Array<{buffer: Buffer, tsSeconds: number}>>}
 */
async function extractFramesForScan(videoSource, { maxFrames = 14, fps = 1, width = 1280 } = {}) {
  const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'mtscan-frames-'));
  try {
    await new Promise((resolve, reject) => {
      ffmpeg(videoSource)
        .outputOptions([
          `-vf fps=${fps},scale=${width}:-2`,
          '-q:v 3',
        ])
        .output(path.join(tmpDir, 'f%04d.jpg'))
        .on('end', resolve)
        .on('error', reject)
        .run();
    });

    const files = (await fs.promises.readdir(tmpDir)).filter((f) => f.endsWith('.jpg')).sort();
    if (files.length === 0) return [];

    // Evenly subsample to maxFrames, keeping chronological order.
    let chosen = files;
    if (files.length > maxFrames) {
      const step = files.length / maxFrames;
      chosen = [];
      for (let i = 0; i < maxFrames; i++) chosen.push(files[Math.floor(i * step)]);
    }

    const frames = [];
    for (const f of chosen) {
      const buffer = await fs.promises.readFile(path.join(tmpDir, f));
      const frameNum = parseInt(f.replace(/\D/g, ''), 10) || 1; // 1-based extraction order
      frames.push({ buffer, tsSeconds: Math.max(0, Math.round((frameNum - 1) / fps)) });
    }
    console.log(`[frameExtractor] extracted ${files.length} frames, using ${frames.length} for analysis`);
    return frames;
  } catch (err) {
    console.warn('[frameExtractor] extractFramesForScan failed:', err.message);
    return [];
  } finally {
    await fs.promises.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Diagnostic check: verifies that ffmpeg-static and sharp are functional.
 * Returns a plain object (never throws); suitable for a health/debug endpoint.
 *
 * @returns {{ ffmpegPath: string|null, ffmpegExists: boolean, sharpOk: boolean, sharpBufferSize?: number, error?: string, env: string }}
 */
async function getInfraDiagnostics() {
  const diag = {
    ffmpegPath: ffmpegPath || null,
    ffmpegExists: ffmpegPath ? fs.existsSync(ffmpegPath) : false,
    sharpOk: false,
    env: process.env.NODE_ENV,
  };
  try {
    const buf = await sharp({ create: { width: 4, height: 4, channels: 3, background: 'red' } }).jpeg().toBuffer();
    diag.sharpOk = buf.length > 0;
    diag.sharpBufferSize = buf.length;
  } catch (err) {
    diag.error = err.message;
  }
  return diag;
}

/**
 * Extract thumbnail frames for an array of items that have `timestamp_seconds`.
 * Uploads each JPEG to GCS and sets `item.thumbnailUrl`.
 * Mutates `items` in place.
 *
 * @param {string} videoPath       - Local file path to the video
 * @param {Array}  items           - Items with `timestamp_seconds`
 * @param {string} userId
 * @param {string} scanId
 * @param {{ uploadBuffer: Function, BUCKET: string }} gcs
 * @returns {{ successCount: number, errors: string[] }}
 */
async function extractThumbnails(videoPath, items, userId, scanId, gcs) {
  const debug = { successCount: 0, errors: [] };
  const thumbnailPromises = items.map(async (item, idx) => {
    const ts = item.timestamp_seconds;
    if (typeof ts !== 'number') {
      debug.errors.push(`item[${idx}]: no timestamp_seconds`);
      return;
    }
    try {
      const frameBuffer = await extractSharpestFrame(videoPath, ts);
      if (!frameBuffer) {
        debug.errors.push(`item[${idx}] t=${ts}s: ffmpeg returned no frames`);
        return;
      }
      const thumbPath = `users/${userId}/room-scans/${scanId}/thumbnails/${idx}-t${ts}.jpg`;
      const { gcsPath } = await gcs.uploadBuffer(frameBuffer, thumbPath, 'image/jpeg');
      item.thumbnailUrl = gcsPath
        ? `https://storage.googleapis.com/${gcs.BUCKET}/${gcsPath}`
        : null;
      if (item.thumbnailUrl) debug.successCount++;
    } catch (err) {
      debug.errors.push(`item[${idx}] t=${ts}s: ${err.message}`);
    }
  });
  await Promise.all(thumbnailPromises);
  console.log(`[frameExtractor] Thumbnails: ${debug.successCount}/${items.length} succeeded`);
  return debug;
}

module.exports = { extractSharpestFrame, extractFramesForScan, getInfraDiagnostics, extractThumbnails };
