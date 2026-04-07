'use strict';

const sharp = require('sharp');

// ── Bounding box math (from bbox.js) ─────────────────────────────────────────

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function clamp01(value) {
  if (typeof value !== 'number' || Number.isNaN(value)) return 0;
  return clamp(value, 0, 1);
}

function coerceNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function resolveBox(input) {
  if (!input || typeof input !== 'object') return null;
  const x = coerceNumber(input.x);
  const y = coerceNumber(input.y);
  const width = coerceNumber(input.width ?? input.w);
  const height = coerceNumber(input.height ?? input.h);
  if (x == null || y == null || width == null || height == null) return null;
  return { x, y, width, height };
}

function isLikelyNormalized(box) {
  const maxVal = Math.max(box.x, box.y, box.width, box.height);
  const minVal = Math.min(box.x, box.y, box.width, box.height);
  return maxVal <= 1.0 && minVal >= 0;
}

function toPixelCrop(input, imageWidth, imageHeight, options = {}) {
  const box = resolveBox(input);
  if (!box || !imageWidth || !imageHeight) return null;

  const minSize = Number.isFinite(options.minSize) ? options.minSize : 10;
  const normalized = isLikelyNormalized(box);

  let x = normalized ? box.x * imageWidth : box.x;
  let y = normalized ? box.y * imageHeight : box.y;
  let width = normalized ? box.width * imageWidth : box.width;
  let height = normalized ? box.height * imageHeight : box.height;

  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(width) || !Number.isFinite(height)) {
    return null;
  }

  x = Math.round(x);
  y = Math.round(y);
  width = Math.round(width);
  height = Math.round(height);

  x = clamp(x, 0, imageWidth - 1);
  y = clamp(y, 0, imageHeight - 1);
  width = clamp(width, 1, imageWidth - x);
  height = clamp(height, 1, imageHeight - y);

  if (width < minSize || height < minSize) return null;

  return { left: x, top: y, width, height };
}

// ── Crop / draw operations (from crop.js) ────────────────────────────────────

/**
 * Get the actual pixel dimensions AFTER EXIF auto-rotation.
 * sharp.metadata() returns pre-rotation dimensions, so we must
 * resolve the rotated buffer first to get correct width/height.
 */
async function getRotatedDimensions(buffer) {
  const rotated = await sharp(buffer).rotate().toBuffer();
  const metadata = await sharp(rotated).metadata();
  return { rotated, width: metadata.width, height: metadata.height };
}

async function cropByBoundingBox(buffer, bbox, options = {}) {
  if (!buffer) return null;
  const { rotated, width, height } = await getRotatedDimensions(buffer);
  const crop = toPixelCrop(bbox, width, height, options);
  if (!crop) return null;
  return sharp(rotated)
    .extract(crop)
    .jpeg({ quality: options.quality || 85 })
    .toBuffer();
}

async function drawBoundingBox(buffer, bbox, options = {}) {
  if (!buffer) return null;
  const { rotated, width, height } = await getRotatedDimensions(buffer);
  const rect = toPixelCrop(bbox, width, height, options);
  if (!rect) return null;

  const stroke = options.strokeWidth || 4;
  const color = options.color || 'rgba(0,200,80,0.85)';

  const svg = `<svg width="${width}" height="${height}">
    <rect x="${rect.left}" y="${rect.top}" width="${rect.width}" height="${rect.height}"
          fill="none" stroke="${color}" stroke-width="${stroke}" rx="4" />
  </svg>`;

  return sharp(rotated)
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
    .jpeg({ quality: options.quality || 85 })
    .toBuffer();
}

module.exports = {
  clamp01,
  resolveBox,
  toPixelCrop,
  cropByBoundingBox,
  drawBoundingBox,
};
