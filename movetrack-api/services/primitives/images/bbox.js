'use strict';

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

module.exports = {
  clamp01,
  resolveBox,
  toPixelCrop
};
