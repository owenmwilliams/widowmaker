'use strict';

/**
 * Media Inventory Workflow Service
 *
 * Orchestrates photo/video analysis into inventory item candidates.
 * Downloads media, calls vision services, crops bounding boxes, uploads to GCS.
 */

const https = require('https');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const gcs = require('../infra/gcsService');
const { drawBoundingBox } = require('../infra/vision/imageUtils');
const { analyzeMultiItemPhoto, analyzeMultiImagePhoto, analyzeItemPhoto } = require('../infra/vision/imageService');
const { analyzeVideo, analyzeFrames } = require('../infra/vision/videoService');
const { extractSharpestFrame, extractFramesForScan, extractAudio } = require('../infra/vision/frameExtractor');
const { recordRoomVideo } = require('./roomVideoService');
const { specForName } = require('./itemSpecsReference');

/**
 * Download a URL into a Buffer.
 */
function downloadBuffer(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    client.get(url, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    }).on('error', reject);
  });
}

/**
 * Analyze one or more photos for inventory items.
 *
 * @param {object} args - { files, file_url, mime_type, mode }
 * @param {string} userId
 * @param {string} plan - 'basic' or 'pro'
 * @returns {object} - { success, mode, items, itemCount, ... }
 */
async function analyzePhotoForInventory(args, userId, plan) {
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
    const imageBuffers = [];
    for (const file of files) {
      try {
        const buffer = await downloadBuffer(file.file_url);
        imageBuffers.push({ buffer, mimeType: file.mime_type, url: file.file_url });
      } catch (dlErr) {
        console.warn(`[census] Failed to download ${file.file_url}:`, dlErr.message);
      }
    }
    if (imageBuffers.length === 0) {
      return { success: false, error: 'Failed to download any of the provided photos' };
    }

    const visionStart = Date.now();

    // ── Single-item mode (close-up of one item) ──
    if (mode === 'single_item') {
      const base64 = imageBuffers[0].buffer.toString('base64');
      const result = await analyzeItemPhoto(base64, imageBuffers[0].mimeType, 'gemini', undefined, null, plan);
      const photoPath = `users/${userId}/nexus/photos/${Date.now()}.jpg`;
      await gcs.uploadBuffer(imageBuffers[0].buffer, photoPath, imageBuffers[0].mimeType);
      const pictureUrl = `https://storage.googleapis.com/${gcs.BUCKET}/${photoPath}`;
      const itemData = result.data || result;
      const conf = itemData.confidence || 0;
      return {
        success: true,
        mode: 'single_item',
        item: { ...itemData, picture_url: pictureUrl },
        _visionMs: Date.now() - visionStart,
        _detectedItemCount: 1,
        _avgConfidence: conf || null,
        _minConfidence: conf || null,
        _visionProvider: 'gemini',
      };
    }

    // ── Multi-item mode ──
    let items, itemCount;

    if (imageBuffers.length === 1) {
      const base64 = imageBuffers[0].buffer.toString('base64');
      const result = await analyzeMultiItemPhoto(base64, imageBuffers[0].mimeType, 'gemini', {}, plan);
      items = result.data?.items || result.items || [];
      itemCount = result.data?.itemCount || result.itemCount || items.length;
      items.forEach(item => { item.sourceImage = 1; });
    } else {
      console.log(`[census] Analyzing ${imageBuffers.length} photos holistically`);
      const imageSources = imageBuffers.map(ib => ({
        base64: ib.buffer.toString('base64'),
        mimeType: ib.mimeType,
      }));
      const result = await analyzeMultiImagePhoto(imageSources, 'gemini', plan);
      items = result.data?.items || result.items || [];
      itemCount = result.data?.itemCount || result.itemCount || items.length;
    }

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
        const cropPath = `users/${userId}/nexus/crops/${Date.now()}-${i}.jpg`;
        await gcs.uploadBuffer(annotated, cropPath, 'image/jpeg');
        item.picture_url = `https://storage.googleapis.com/${gcs.BUCKET}/${cropPath}`;
        console.log(`[census] Cropped item[${i}] "${item.name}" from image ${srcIdx + 1}`);
      } catch (cropErr) {
        console.warn(`[census] Crop failed for item[${i}]:`, cropErr.message);
      }
    }

    const visionElapsed = Date.now() - visionStart;
    const confidences = items.map(i => i.confidence || 0).filter(c => c > 0);
    return {
      success: true, mode: 'multi_item', imageCount: imageBuffers.length, items, itemCount,
      _visionMs: visionElapsed,
      _detectedItemCount: items.length,
      _avgConfidence: confidences.length > 0 ? confidences.reduce((a, b) => a + b, 0) / confidences.length : null,
      _minConfidence: confidences.length > 0 ? Math.min(...confidences) : null,
      _visionProvider: 'gemini',
    };
  } catch (err) {
    console.error('[census] analyzePhotoForInventory failed:', err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Analyze a video for inventory items. Extracts frames at item timestamps.
 *
 * @param {object} args - { file_url, mime_type }
 * @param {string} userId
 * @param {string} plan - 'basic' or 'pro'
 * @returns {object} - { success, items, itemCount, ... }
 */
async function analyzeVideoForInventory(args, userId, plan) {
  let tmpPath = null;
  try {
    const url = args.file_url;
    console.log(`[census] Downloading video for analysis: ${url}`);
    const videoBuffer = await downloadBuffer(url);
    console.log(`[census] Video downloaded: ${(videoBuffer.length / 1024 / 1024).toFixed(1)}MB`);

    const ext = (args.mime_type || 'video/mp4').split('/')[1] || 'mp4';
    tmpPath = path.join(os.tmpdir(), `nexus-video-${Date.now()}.${ext}`);
    fs.writeFileSync(tmpPath, videoBuffer);

    const videoVisionStart = Date.now();

    // Sample full-resolution frames across the clip and analyze those. Reading
    // crisp stills (vs a low-res inline video) is what lets small/medium items
    // get detected — the "kitchen → only oven + fridge" fix.
    let frames = [];
    try {
      frames = await extractFramesForScan(tmpPath, { maxFrames: 28, fps: 1 });
    } catch (e) {
      console.warn('[census] frame extraction failed:', e.message);
    }

    // Pull the narration track too (best-effort) so the model can use what the
    // user said while filming to sharpen names/materials/weights.
    let audio = null;
    try {
      audio = await extractAudio(tmpPath);
    } catch (e) {
      console.warn('[census] audio extraction failed:', e.message);
    }

    let items = [];
    let parseError = null;
    let firstFrameUrl = null;
    let narrationNotes = null;

    if (frames.length > 0) {
      // Upload the sampled frames so each detected item can carry a real photo.
      const frameUrls = [];
      for (let i = 0; i < frames.length; i++) {
        try {
          const framePath = `users/${userId}/nexus/video-frames/${Date.now()}-${i}.jpg`;
          await gcs.uploadBuffer(frames[i].buffer, framePath, 'image/jpeg');
          frameUrls[i] = `https://storage.googleapis.com/${gcs.BUCKET}/${framePath}`;
        } catch (e) {
          frameUrls[i] = null;
        }
      }
      firstFrameUrl = frameUrls.find(Boolean) || null;

      const result = await analyzeFrames(frames, plan, args.room_hint || null, audio);
      items = result.items || [];
      parseError = result.parseError;
      narrationNotes = result.narrationNotes || null;

      for (const item of items) {
        const sf = Number(item.source_frame);
        if (Number.isFinite(sf) && sf >= 1 && sf <= frameUrls.length && frameUrls[sf - 1]) {
          item.picture_url = frameUrls[sf - 1];
        }
      }
    } else {
      // Fallback: legacy inline-video analysis if frame extraction is unavailable.
      console.warn('[census] no frames extracted; falling back to inline video analysis');
      const result = await analyzeVideo(videoBuffer, args.mime_type, plan, null, args.room_hint || null);
      items = result.items || [];
      parseError = result.parseError;
    }

    // Guarantee weight AND dimensions so every item yields a cubic-foot estimate
    // that matches its weight — the model sometimes returns a weight but omits
    // dimensions. Fill any gaps from the typical-specs table (free, no LLM).
    for (const item of items) {
      const spec = specForName(item.name);
      if (!spec) continue;
      if (item.weight_lbs == null) item.weight_lbs = spec.w;
      if (item.length_in == null) item.length_in = spec.l;
      if (item.width_in == null) item.width_in = spec.wd;
      if (item.height_in == null) item.height_in = spec.h;
    }

    // Record the walkthrough so the user can share it with movers.
    try {
      await recordRoomVideo(userId, {
        videoUrl: url,
        mimeType: args.mime_type,
        roomName: args.room_hint || null,
        itemCount: items.length,
        thumbnailUrl: firstFrameUrl,
        notes: narrationNotes,
      });
    } catch (e) {
      console.warn('[census] recordRoomVideo failed:', e.message);
    }

    return {
      success: true, items, itemCount: items.length, parseError,
      _visionMs: Date.now() - videoVisionStart,
      _detectedItemCount: items.length,
      _visionProvider: 'gemini',
    };
  } catch (err) {
    console.error('[census] analyzeVideoForInventory failed:', err.message);
    return { success: false, error: err.message };
  } finally {
    if (tmpPath) { try { fs.unlinkSync(tmpPath); } catch (_) {} }
  }
}

module.exports = {
  downloadBuffer,
  analyzePhotoForInventory,
  analyzeVideoForInventory,
};
