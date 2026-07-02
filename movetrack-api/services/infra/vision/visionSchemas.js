'use strict';

/**
 * Gemini structured-output schemas for the vision item-extraction calls.
 *
 * These are passed as `generationConfig.responseSchema` alongside
 * `responseMimeType: 'application/json'` so Gemini returns well-formed JSON that
 * matches the shape our parsers already expect — no markdown fences, no trailing
 * prose, no "``` json" wrapping. `jsonrepair` stays only as a legacy shim for the
 * (now rare) truncated-output case.
 *
 * Pathway E — see docs/notes/beta-scan-reliability-investigation.md §0.4, §3.4.
 */

const { SchemaType } = require('@google/generative-ai');

// Normalized 0.0–1.0 bounding box on the video/frame path ({x,y,w,h}). Nullable:
// the model may not be able to localize an item.
const videoBboxSchema = {
  type: SchemaType.OBJECT,
  nullable: true,
  description: 'Normalized 0.0–1.0 bounding box, or null if unknown.',
  properties: {
    x: { type: SchemaType.NUMBER },
    y: { type: SchemaType.NUMBER },
    w: { type: SchemaType.NUMBER },
    h: { type: SchemaType.NUMBER },
  },
};

const videoDimensionsSchema = {
  type: SchemaType.OBJECT,
  description: 'Per-unit size in inches.',
  properties: {
    length_in: { type: SchemaType.NUMBER },
    width_in: { type: SchemaType.NUMBER },
    height_in: { type: SchemaType.NUMBER },
  },
  // Required: with only name/quantity required, flash routinely omitted the
  // optional fields under structured output — the beta review card showed no
  // sizes, no weights, and (source_frame missing) no thumbnails at all.
  required: ['length_in', 'width_in', 'height_in'],
};

/**
 * Build the per-item schema for the video path. `locator` is either
 * 'timestamp_seconds' (inline video analysis) or 'source_frame' (sampled frames).
 */
function buildVideoItemSchema(locator) {
  const properties = {
    name: { type: SchemaType.STRING, description: 'Descriptive name for ONE unit.' },
    quantity: { type: SchemaType.INTEGER, description: 'Integer count of how many exist.' },
    room: { type: SchemaType.STRING },
    estimated_weight_lbs: { type: SchemaType.NUMBER, description: 'Per-unit weight in lbs; never 0.' },
    estimated_dimensions: videoDimensionsSchema,
    material: { type: SchemaType.STRING },
    fragile: { type: SchemaType.BOOLEAN },
    notes: { type: SchemaType.STRING },
  };
  if (locator === 'source_frame') {
    properties.source_frame = { type: SchemaType.INTEGER, description: '1-based index of the clearest frame.' };
  } else {
    properties.timestamp_seconds = { type: SchemaType.INTEGER, description: 'Seconds into the video where clearest.' };
    properties.bbox = videoBboxSchema;
  }
  return {
    type: SchemaType.OBJECT,
    properties,
    // The review card is only useful when every row carries a size, a weight,
    // and a frame to thumbnail from — make the model supply them rather than
    // hoping it volunteers optional fields.
    required: ['name', 'quantity', 'room', 'estimated_weight_lbs', 'estimated_dimensions',
      locator === 'source_frame' ? 'source_frame' : 'timestamp_seconds'],
  };
}

/** Bare array of items — inline video analysis (`analyzeVideo`). */
const videoItemsArraySchema = {
  type: SchemaType.ARRAY,
  items: buildVideoItemSchema('timestamp_seconds'),
};

/** Bare array of items — sampled-frame analysis without audio. */
const frameItemsArraySchema = {
  type: SchemaType.ARRAY,
  items: buildVideoItemSchema('source_frame'),
};

/**
 * Object { narration_notes, items } — sampled-frame analysis WITH audio, where
 * the owner narrates the walkthrough.
 */
const frameItemsWithNarrationSchema = {
  type: SchemaType.OBJECT,
  properties: {
    narration_notes: { type: SchemaType.STRING, description: 'Short notes from the owner narration; empty string if none.' },
    items: frameItemsArraySchema,
  },
  required: ['items'],
};

/** Pick the frames schema based on whether audio narration is included. */
function framesResponseSchema(hasAudio) {
  return hasAudio ? frameItemsWithNarrationSchema : frameItemsArraySchema;
}

// ── Photo (imageService) schemas ────────────────────────────────────────────

const photoBoundingBoxSchema = {
  type: SchemaType.OBJECT,
  description: 'Normalized 0.0–1.0 box {x,y,width,height}.',
  properties: {
    x: { type: SchemaType.NUMBER },
    y: { type: SchemaType.NUMBER },
    width: { type: SchemaType.NUMBER },
    height: { type: SchemaType.NUMBER },
  },
};

function buildPhotoItemSchema(includeSourceImage) {
  const properties = {
    id: { type: SchemaType.INTEGER },
    name: { type: SchemaType.STRING, description: 'Name for ONE unit.' },
    quantity: { type: SchemaType.INTEGER },
    fragile: { type: SchemaType.BOOLEAN },
    boundingBox: photoBoundingBoxSchema,
    confidence: { type: SchemaType.NUMBER },
    reasoning: { type: SchemaType.STRING },
  };
  if (includeSourceImage) {
    properties.sourceImage = { type: SchemaType.INTEGER, description: '1-based index of the clearest image.' };
  }
  return { type: SchemaType.OBJECT, properties, required: ['name'] };
}

/** Multi-item single-photo response: { itemCount, items[], reasoning }. */
const photoMultiItemSchema = {
  type: SchemaType.OBJECT,
  properties: {
    itemCount: { type: SchemaType.INTEGER },
    items: { type: SchemaType.ARRAY, items: buildPhotoItemSchema(false) },
    reasoning: { type: SchemaType.STRING },
  },
  required: ['items'],
};

/** Multi-image (several photos of one room) response — items carry sourceImage. */
const photoMultiImageSchema = {
  type: SchemaType.OBJECT,
  properties: {
    itemCount: { type: SchemaType.INTEGER },
    items: { type: SchemaType.ARRAY, items: buildPhotoItemSchema(true) },
    reasoning: { type: SchemaType.STRING },
  },
  required: ['items'],
};

/** Single-item close-up response (VISION_PROMPT). */
const singleItemSchema = {
  type: SchemaType.OBJECT,
  properties: {
    name: { type: SchemaType.STRING },
    material: { type: SchemaType.STRING },
    color: { type: SchemaType.STRING },
    estimatedDimensions: {
      type: SchemaType.OBJECT,
      properties: {
        length: { type: SchemaType.NUMBER },
        width: { type: SchemaType.NUMBER },
        height: { type: SchemaType.NUMBER },
      },
    },
    estimatedWeight: { type: SchemaType.NUMBER },
    fragile: { type: SchemaType.BOOLEAN },
    tags: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
    confidence: { type: SchemaType.NUMBER },
    reasoning: { type: SchemaType.STRING },
  },
  required: ['name'],
};

/**
 * True when Gemini stopped because it hit maxOutputTokens — i.e. the JSON was
 * cut short and item recall was silently bounded. Callers surface this instead
 * of dropping items quietly (Pathway E acceptance: no silent truncation).
 */
function wasTruncated(result) {
  try {
    const reason = result?.response?.candidates?.[0]?.finishReason;
    return reason === 'MAX_TOKENS';
  } catch (_) {
    return false;
  }
}

module.exports = {
  buildVideoItemSchema,
  videoItemsArraySchema,
  frameItemsArraySchema,
  frameItemsWithNarrationSchema,
  framesResponseSchema,
  photoMultiItemSchema,
  photoMultiImageSchema,
  singleItemSchema,
  wasTruncated,
};
