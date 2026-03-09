'use strict';

const sharp = require('sharp');
const { toPixelCrop } = require('./bbox');

async function cropByBoundingBox(buffer, bbox, options = {}) {
  if (!buffer) return null;
  const image = sharp(buffer).rotate();
  const metadata = await image.metadata();
  const crop = toPixelCrop(bbox, metadata.width, metadata.height, options);
  if (!crop) return null;
  return image
    .extract(crop)
    .jpeg({ quality: options.quality || 85 })
    .toBuffer();
}

module.exports = {
  cropByBoundingBox
};
