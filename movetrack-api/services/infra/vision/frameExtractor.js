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

module.exports = { extractSharpestFrame };
