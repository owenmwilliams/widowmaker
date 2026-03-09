'use strict';

const sharp = require('sharp');

async function resizeImage(buffer, options = {}) {
  if (!buffer) return null;
  const {
    width,
    height,
    fit = 'cover',
    withoutEnlargement = true,
    background
  } = options;

  return sharp(buffer)
    .rotate()
    .resize({ width, height, fit, withoutEnlargement, background })
    .toBuffer();
}

async function downscaleImage(buffer, maxWidth, maxHeight) {
  if (!buffer) return null;
  const image = sharp(buffer).rotate();
  const metadata = await image.metadata();
  const width = metadata.width || maxWidth;
  const height = metadata.height || maxHeight;

  if ((maxWidth && width > maxWidth) || (maxHeight && height > maxHeight)) {
    return image
      .resize({ width: maxWidth, height: maxHeight, fit: 'inside', withoutEnlargement: true })
      .toBuffer();
  }
  return image.toBuffer();
}

async function upscaleImage(buffer, minWidth, minHeight) {
  if (!buffer) return null;
  const image = sharp(buffer).rotate();
  const metadata = await image.metadata();
  const width = metadata.width || minWidth;
  const height = metadata.height || minHeight;

  if ((minWidth && width < minWidth) || (minHeight && height < minHeight)) {
    return image
      .resize({ width: minWidth, height: minHeight, fit: 'inside', withoutEnlargement: false })
      .toBuffer();
  }
  return image.toBuffer();
}

module.exports = {
  resizeImage,
  downscaleImage,
  upscaleImage
};
