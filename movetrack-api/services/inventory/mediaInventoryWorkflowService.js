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
const { drawBoundingBox } = require('../primitives/images/crop');
const { analyzeMultiItemPhoto, analyzeMultiImagePhoto, analyzeItemPhoto } = require('../infra/vision/imageService');
const { analyzeVideo } = require('../infra/vision/videoService');
const { extractSharpestFrame } = require('../infra/vision/frameExtractor');

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
  try {
    const url = args.file_url;
    console.log(`[census] Downloading video for analysis: ${url}`);
    const videoBuffer = await downloadBuffer(url);

    console.log(`[census] Video downloaded: ${(videoBuffer.length / 1024 / 1024).toFixed(1)}MB`);
    const videoVisionStart = Date.now();
    const result = await analyzeVideo(videoBuffer, args.mime_type, plan);
    const items = result.items || [];

    // Extract frames for each item with a timestamp and upload to GCS
    const ext = (args.mime_type || 'video/mp4').split('/')[1] || 'mp4';
    const tmpPath = path.join(os.tmpdir(), `nexus-video-${Date.now()}.${ext}`);
    fs.writeFileSync(tmpPath, videoBuffer);

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const ts = item.timestamp_seconds || item.timestamp;
      if (ts == null) continue;
      try {
        const frameBuffer = await extractSharpestFrame(tmpPath, ts);
        if (frameBuffer && frameBuffer.length > 0) {
          const framePath = `users/${userId}/nexus/video-frames/${Date.now()}-${i}.jpg`;
          await gcs.uploadBuffer(frameBuffer, framePath, 'image/jpeg');
          item.picture_url = `https://storage.googleapis.com/${gcs.BUCKET}/${framePath}`;
          console.log(`[census] Extracted frame for item[${i}] "${item.name}" at ${ts}s`);
        }
      } catch (frameErr) {
        console.warn(`[census] Frame extraction failed for item[${i}]:`, frameErr.message);
      }
    }

    // Clean up temp file
    try { fs.unlinkSync(tmpPath); } catch (_) {}

    const videoVisionElapsed = Date.now() - videoVisionStart;
    const videoConfidences = items.map(i => i.confidence || 0).filter(c => c > 0);
    return {
      success: true, items, itemCount: items.length, parseError: result.parseError,
      _visionMs: videoVisionElapsed,
      _detectedItemCount: items.length,
      _avgConfidence: videoConfidences.length > 0 ? videoConfidences.reduce((a, b) => a + b, 0) / videoConfidences.length : null,
      _minConfidence: videoConfidences.length > 0 ? Math.min(...videoConfidences) : null,
      _visionProvider: 'gemini',
    };
  } catch (err) {
    console.error('[census] analyzeVideoForInventory failed:', err.message);
    return { success: false, error: err.message };
  }
}

module.exports = {
  downloadBuffer,
  analyzePhotoForInventory,
  analyzeVideoForInventory,
};
