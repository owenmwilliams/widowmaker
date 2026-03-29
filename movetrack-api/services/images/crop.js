'use strict';

const sharp = require('sharp');
const { toPixelCrop } = require('./bbox');

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
  cropByBoundingBox,
  drawBoundingBox
};
