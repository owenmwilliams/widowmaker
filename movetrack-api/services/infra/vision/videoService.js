'use strict';

const { GoogleGenerativeAI } = require('@google/generative-ai');

let geminiClient = null;

if (process.env.GOOGLE_AI_API_KEY) {
  geminiClient = new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY);
  console.log('[videoService] Gemini configured');
}

const GEMINI_MODELS = {
  basic: 'gemini-2.5-flash',
  pro: 'gemini-2.5-pro',
};

const INVENTORY_PROMPT = `You are analyzing a home walkthrough video for a moving company inventory system.
Your job is to identify household items visible in this video and produce a structured inventory a moving company can quote from.

Rules:
- List large or heavy items individually: furniture, appliances, gym equipment, large electronics (TVs, monitors).
- List fragile items individually: artwork, mirrors, musical instruments, glass items.
- Consolidate small packable items by category. Use a SINGULAR unit name and set quantity to the count (e.g., name "Box of books" with quantity 3, NOT "~3 boxes of books" with quantity 1).
- Target 15–20 total lines. Hard cap at 25 lines total.
- Do not list the same item twice.
- For each item, include:
  - name: descriptive name for ONE unit (e.g. "3-seat sofa", "55\\" TV", "Box of books", "Dining chair"). Always describe a single unit.
  - quantity: integer count of how many of this item exist. Use quantity > 1 for multiples.
  - room: the room or area where it appears (e.g. "living room", "bedroom", "kitchen", "garage", "unknown").
  - estimated_weight_lbs: estimated weight in pounds of ONE unit (your best estimate; never 0).
  - estimated_dimensions: estimated size of ONE unit in inches as {"length_in": L, "width_in": W, "height_in": H} (your best estimate).
  - material: primary material (e.g. "wood", "metal", "fabric", "glass", "plastic", "cardboard").
  - fragile: boolean — true if the item needs special handling.
  - notes: one of "fragile", "requires disassembly", "heavy", "boxable", or "" if none.
  - timestamp_seconds: integer seconds into the video where this item is most clearly visible.
  - bbox: bounding box at timestamp_seconds as normalized 0.0–1.0 {"x","y","w","h"}, or null.

Weights and dimensions are PER SINGLE UNIT — do not multiply by quantity. Movers quote on weight and cubic feet, so ALWAYS give your best numeric estimate; never leave weight or dimensions blank or zero.

Return ONLY a valid JSON array with no markdown or explanation. Example:
[
  {"name":"3-seat sofa","quantity":1,"room":"living room","estimated_weight_lbs":150,"estimated_dimensions":{"length_in":84,"width_in":36,"height_in":34},"material":"fabric","fragile":false,"notes":"heavy","timestamp_seconds":12,"bbox":{"x":0.05,"y":0.3,"w":0.6,"h":0.5}},
  {"name":"55\\" TV","quantity":1,"room":"living room","estimated_weight_lbs":40,"estimated_dimensions":{"length_in":49,"width_in":3,"height_in":29},"material":"glass","fragile":true,"notes":"fragile","timestamp_seconds":18,"bbox":{"x":0.2,"y":0.1,"w":0.35,"h":0.4}},
  {"name":"Box of books","quantity":3,"room":"office","estimated_weight_lbs":35,"estimated_dimensions":{"length_in":16,"width_in":12,"height_in":12},"material":"cardboard","fragile":false,"notes":"boxable","timestamp_seconds":45,"bbox":null}
]`;

const INVENTORY_PROMPT_FRAMES = `You are analyzing a set of still frames sampled in order from a short walkthrough video of ONE room, for a moving-company inventory. Together the frames cover the whole room.

Identify EVERY household item a mover would need to pack or move — be thorough, not conservative:
- List large/heavy items individually (furniture, appliances, electronics).
- List fragile items individually (artwork, mirrors, glassware, instruments).
- Group many small packable items into boxes (e.g. "Box of dishes" quantity 3, "Box of pantry goods" quantity 2) instead of skipping them — kitchens, closets, and garages have lots of these.
- A typical room is 15–40 lines; a kitchen or garage may have more. Do NOT artificially shorten the list — capture what's actually there. Hard cap 60.
- The same physical item can appear in several frames — list it ONCE.

For each item include:
- name: descriptive name for ONE unit (e.g. "3-seat sofa", "55\\" TV", "Box of dishes").
- quantity: integer count.
- room: the room/area (e.g. "kitchen", "living room", "garage", "unknown").
- estimated_weight_lbs: per-unit weight in pounds (best estimate; never 0).
- estimated_dimensions: per-unit {"length_in":L,"width_in":W,"height_in":H}.
- material, fragile (boolean), notes ("fragile"/"requires disassembly"/"heavy"/"boxable"/"").
- source_frame: 1-based index of the frame where this item is clearest.

Weights and dimensions are PER SINGLE UNIT — never multiply by quantity. Every item MUST have BOTH estimated_weight_lbs AND all three estimated_dimensions (length_in, width_in, height_in) — never leave dimensions blank or zero; movers quote on cubic feet.

Return ONLY a valid JSON array, no markdown. Example:
[{"name":"3-seat sofa","quantity":1,"room":"living room","estimated_weight_lbs":150,"estimated_dimensions":{"length_in":84,"width_in":36,"height_in":34},"material":"fabric","fragile":false,"notes":"heavy","source_frame":2}]`;

function positiveNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Parse a JSON array of items from a model response (tolerant of code fences). */
function parseItemsArray(rawText) {
  try {
    const cleaned = rawText.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
    const parsed = JSON.parse(cleaned);
    return { items: Array.isArray(parsed) ? parsed : [], parseError: null };
  } catch (err) {
    try {
      const { jsonrepair } = require('jsonrepair');
      const parsed = JSON.parse(jsonrepair(rawText));
      return { items: Array.isArray(parsed) ? parsed : [], parseError: null };
    } catch (repairErr) {
      return { items: [], parseError: `Could not parse response as JSON: ${err.message}` };
    }
  }
}

/**
 * Map a raw model item onto the flat fields the inventory uses (weight_lbs,
 * length_in/width_in/height_in, material, fragile) while preserving the original
 * fields. Lets downstream persist mover-grade numbers without a second AI call.
 */
function normalizeVideoItem(it) {
  if (!it || typeof it !== 'object') return it;
  const dims = it.estimated_dimensions || it.estimatedDimensions || {};
  const fragile = typeof it.fragile === 'boolean' ? it.fragile : /fragile/i.test(it.notes || '');
  return {
    ...it,
    weight_lbs: positiveNumber(it.weight_lbs ?? it.estimated_weight_lbs ?? it.estimatedWeight),
    length_in: positiveNumber(it.length_in ?? dims.length_in ?? dims.length),
    width_in: positiveNumber(it.width_in ?? dims.width_in ?? dims.width),
    height_in: positiveNumber(it.height_in ?? dims.height_in ?? dims.height),
    material: it.material || null,
    fragile,
  };
}

/**
 * Analyze a video via Gemini using inline base64 data.
 *
 * @param {Buffer} videoBuffer  - Video file buffer
 * @param {string} mimeType     - e.g. "video/mp4"
 * @param {string} [plan]       - "basic" or "pro" for model tier
 * @param {string} [customPrompt] - overrides the inventory prompt entirely (admin lab)
 * @param {string} [roomHint]   - when set, items default to this room
 * @returns {{ rawText: string, items: Array, parseError: string|null }}
 */
async function analyzeVideo(videoBuffer, mimeType, plan = 'basic', customPrompt = null, roomHint = null) {
  if (!geminiClient) {
    throw new Error('GOOGLE_AI_API_KEY is not configured');
  }

  const modelId = GEMINI_MODELS[plan] || GEMINI_MODELS.basic;
  let prompt = customPrompt || INVENTORY_PROMPT;
  if (!customPrompt && roomHint) {
    prompt += `\n\nThis video is a walkthrough of the "${roomHint}". Set "room" to "${roomHint}" for every item unless an item is clearly in a different room.`;
  }
  const base64Video = videoBuffer.toString('base64');

  console.log(`[videoService] Analyzing video (${(videoBuffer.length / 1024 / 1024).toFixed(1)}MB) with model=${modelId}`);

  const model = geminiClient.getGenerativeModel({
    model: modelId,
    generationConfig: {
      responseMimeType: 'application/json',
      maxOutputTokens: 8192,
    },
  });

  let result;
  try {
    result = await model.generateContent([
      { inlineData: { mimeType, data: base64Video } },
      { text: prompt },
    ]);
  } catch (err) {
    console.error('[videoService] Gemini generateContent failed:', err?.message || err);
    throw new Error(`Gemini video analysis failed: ${err?.message || err}`);
  }

  const rawText = result.response.text();
  console.log(`[videoService] Response length: ${rawText.length} chars`);
  console.log('[videoService] Raw response preview:', rawText.substring(0, 500));

  let items = [];
  let parseError = null;

  try {
    const cleaned = rawText.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
    const parsed = JSON.parse(cleaned);
    items = Array.isArray(parsed) ? parsed : [];
    console.log(`[videoService] Parsed ${items.length} items`);
  } catch (err) {
    try {
      const { jsonrepair } = require('jsonrepair');
      const repaired = jsonrepair(rawText);
      const parsed = JSON.parse(repaired);
      items = Array.isArray(parsed) ? parsed : [];
      console.log(`[videoService] jsonrepair recovered ${items.length} items`);
    } catch (repairErr) {
      parseError = `Could not parse response as JSON: ${err.message}`;
      console.warn('[videoService] JSON parse failed:', err.message);
    }
  }

  items = items.map(normalizeVideoItem);

  return { rawText, items, parseError };
}

/**
 * Analyze still frames sampled from a walkthrough video. Full-resolution frames
 * let Gemini read small/medium items that a low-res inline video misses (the
 * "kitchen → only oven + fridge" failure). One model call for all frames.
 *
 * @param {Array<{buffer: Buffer}>} frames
 * @param {string} [plan]
 * @param {string} [roomHint]
 * @returns {{ rawText: string, items: Array, parseError: string|null }}
 */
async function analyzeFrames(frames, plan = 'basic', roomHint = null) {
  if (!geminiClient) throw new Error('GOOGLE_AI_API_KEY is not configured');
  if (!frames || frames.length === 0) {
    return { rawText: '', items: [], parseError: 'no frames' };
  }

  const modelId = GEMINI_MODELS[plan] || GEMINI_MODELS.basic;
  let prompt = INVENTORY_PROMPT_FRAMES;
  if (roomHint) {
    prompt += `\n\nThese frames are the "${roomHint}". Set "room" to "${roomHint}" for every item unless an item is clearly in a different room.`;
  }

  console.log(`[videoService] Analyzing ${frames.length} sampled frames with model=${modelId}`);

  const model = geminiClient.getGenerativeModel({
    model: modelId,
    generationConfig: { responseMimeType: 'application/json', maxOutputTokens: 8192 },
  });

  const parts = frames.map((f) => ({
    inlineData: { mimeType: 'image/jpeg', data: f.buffer.toString('base64') },
  }));
  parts.push({ text: prompt });

  let result;
  try {
    result = await model.generateContent(parts);
  } catch (err) {
    console.error('[videoService] Gemini frame analysis failed:', err?.message || err);
    throw new Error(`Gemini frame analysis failed: ${err?.message || err}`);
  }

  const rawText = result.response.text();
  const { items: parsed, parseError } = parseItemsArray(rawText);
  console.log(`[videoService] Frame analysis parsed ${parsed.length} items`);
  return { rawText, items: parsed.map(normalizeVideoItem), parseError };
}

module.exports = { analyzeVideo, analyzeFrames, normalizeVideoItem, parseItemsArray, INVENTORY_PROMPT, INVENTORY_PROMPT_FRAMES, GEMINI_MODELS };
