'use strict';

const { GoogleGenerativeAI } = require('@google/generative-ai');
const { instrumentVisionModel } = require('../ai/resilientModel');
const { createLogger } = require('../logger');
const {
  videoItemsArraySchema,
  framesResponseSchema,
  wasTruncated,
} = require('./visionSchemas');

const log = createLogger({ component: 'videoService' });

let geminiClient = null;

if (process.env.GOOGLE_AI_API_KEY) {
  geminiClient = new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY);
  log.info('Gemini configured');
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
- List EVERY distinct item a mover would need to handle — do not stop early or artificially shorten the list. A cluttered room can be many lines.
- Do not list the same item twice.
- For each item, include:
  - name: descriptive name for ONE unit (e.g. "3-seat sofa", "55\\" TV", "Box of books", "Dining chair"). Always describe a single unit.
  - quantity: integer count of how many of this item exist. Use quantity > 1 for multiples.
  - room: the room or area where it appears (e.g. "living room", "bedroom", "kitchen", "garage", "unknown").
  - estimated_weight_lbs: estimated weight in pounds of ONE unit (your best estimate; never 0).
  - estimated_dimensions: estimated size of ONE unit in inches as {"length_in": L, "width_in": W, "height_in": H} (your best estimate).
  - material: primary material (e.g. "wood", "metal", "fabric", "glass", "plastic", "cardboard").
  - fragile: boolean — decide for EVERY item. Set true for anything breakable or needing protective packing: glass/glass-topped items, mirrors, framed art & photos, TVs and monitors, lamps, ceramics/china/dishware/stemware, vases, small electronics, musical instruments. When in doubt, mark it fragile.
  - notes: one of "fragile", "requires disassembly", "heavy", "boxable", or "" if none.
  - timestamp_seconds: integer seconds into the video where this item is most clearly visible.
  - bbox: bounding box at timestamp_seconds as normalized 0.0–1.0 {"x","y","w","h"}, or null.

Weights and dimensions are PER SINGLE UNIT — do not multiply by quantity. Movers quote on weight and cubic feet, so ALWAYS give your best numeric estimate; never leave weight or dimensions blank or zero.

FIXTURES STAY WITH THE HOUSE — NEVER list them: toilets, sinks, bathtubs, showers, faucets, countertops, built-in cabinets/shelving/appliances, ceiling lights and fans, chandeliers, light switches, thermostats, radiators, water heaters, fireplaces, doors, windows, and window blinds. Movable appliances DO count (fridge, washer/dryer, microwave, window AC unit).

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
- A typical room is 15–40 lines; a kitchen or garage may have more. Do NOT artificially shorten the list — capture everything that's actually there.
- The same physical item can appear in several frames — list it ONCE.
FIXTURES STAY WITH THE HOUSE — NEVER list them: toilets, sinks, bathtubs, showers, faucets, countertops, built-in cabinets/shelving/appliances, ceiling lights and fans, chandeliers, light switches, thermostats, radiators, water heaters, fireplaces, doors, windows, and window blinds. Movable appliances DO count (fridge, washer/dryer, microwave, window AC unit).

For each item include:
- name: descriptive name for ONE unit (e.g. "3-seat sofa", "55\\" TV", "Box of dishes").
- quantity: integer count.
- room: the room/area (e.g. "kitchen", "living room", "garage", "unknown").
- estimated_weight_lbs: per-unit weight in pounds (best estimate; never 0).
- estimated_dimensions: per-unit {"length_in":L,"width_in":W,"height_in":H}.
- material, fragile (boolean — see FRAGILE below), notes ("fragile"/"requires disassembly"/"heavy"/"boxable"/"").
- source_frame: 1-based index of the frame where this item is clearest.

FRAGILE: For EVERY item, decide fragile true or false — do not leave it out. Set fragile=true for anything breakable or that needs protective/careful packing: glass or glass-topped items, mirrors, framed art & photos, TVs and monitors, lamps, ceramics/china/dishware/stemware, vases, small electronics, and musical instruments. When in doubt, mark it fragile.

Weights and dimensions are PER SINGLE UNIT — never multiply by quantity. Every item MUST have BOTH estimated_weight_lbs AND all three estimated_dimensions (length_in, width_in, height_in) — never leave dimensions blank or zero; movers quote on cubic feet.

Return ONLY a valid JSON array, no markdown. Example:
[{"name":"3-seat sofa","quantity":1,"room":"living room","estimated_weight_lbs":150,"estimated_dimensions":{"length_in":84,"width_in":36,"height_in":34},"material":"fabric","fragile":false,"notes":"heavy","source_frame":2}]`;

function positiveNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Pull token counts off a Gemini response, in the shape scan_events.token_usage expects. */
function extractUsageMetadata(result) {
  const um = result && result.response && result.response.usageMetadata;
  if (!um) return null;
  return {
    promptTokens: um.promptTokenCount || 0,
    candidatesTokens: (um.candidatesTokenCount || 0) + (um.thoughtsTokenCount || 0),
    totalTokens: um.totalTokenCount || 0,
  };
}

/**
 * Coerce a parsed model response into { items, narrationNotes }. Accepts either a
 * bare array of items (no-audio path) or an object { items, narration_notes }
 * (audio path).
 */
function coerceParsed(parsed) {
  if (Array.isArray(parsed)) return { items: parsed, narrationNotes: null };
  if (parsed && Array.isArray(parsed.items)) {
    const notes = typeof parsed.narration_notes === 'string' ? parsed.narration_notes.trim() : '';
    return { items: parsed.items, narrationNotes: notes || null };
  }
  return { items: [], narrationNotes: null };
}

/** Parse items (and optional narration notes) from a model response (tolerant of code fences). */
function parseItemsArray(rawText) {
  try {
    const cleaned = rawText.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
    const { items, narrationNotes } = coerceParsed(JSON.parse(cleaned));
    return { items, narrationNotes, parseError: null };
  } catch (err) {
    try {
      const { jsonrepair } = require('jsonrepair');
      const { items, narrationNotes } = coerceParsed(JSON.parse(jsonrepair(rawText)));
      return { items, narrationNotes, parseError: null };
    } catch (repairErr) {
      return { items: [], narrationNotes: null, parseError: `Could not parse response as JSON: ${err.message}` };
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
async function analyzeVideo(videoBuffer, mimeType, plan = 'basic', customPrompt = null, roomHint = null, userId = null, userNote = null) {
  if (!geminiClient) {
    throw new Error('GOOGLE_AI_API_KEY is not configured');
  }

  const modelId = GEMINI_MODELS[plan] || GEMINI_MODELS.basic;
  let prompt = customPrompt || INVENTORY_PROMPT;
  if (!customPrompt && roomHint) {
    prompt += `\n\nThis video is a walkthrough of the "${roomHint}". Set "room" to "${roomHint}" for every item unless an item is clearly in a different room.`;
  }
  if (!customPrompt) {
    // Targeted scans: '' when no note — the no-note prompt is byte-identical.
    prompt += buildScanNoteSection(userNote);
  }
  const base64Video = videoBuffer.toString('base64');

  log.info('Analyzing video', { megabytes: (videoBuffer.length / 1024 / 1024).toFixed(1), model: modelId });

  // Resilience + token metering: timeout, transient-error retry (429/503/network),
  // and usage recording into user_costs. Uses the generous vision timeout.
  const model = instrumentVisionModel(geminiClient.getGenerativeModel({
    model: modelId,
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: videoItemsArraySchema,
      maxOutputTokens: 8192,
    },
  }), { userId, modelName: modelId });

  let result;
  try {
    result = await model.generateContent([
      { inlineData: { mimeType, data: base64Video } },
      { text: prompt },
    ]);
  } catch (err) {
    log.error('Gemini generateContent failed', { error: err?.message || String(err) });
    throw new Error(`Gemini video analysis failed: ${err?.message || err}`);
  }

  const rawText = result.response.text();
  log.info('Response received', { chars: rawText.length });

  // With structured output, truncation is the only way JSON comes back
  // incomplete — surface it instead of silently returning a short list.
  const truncated = wasTruncated(result);
  if (truncated) {
    console.warn('[videoService] Response hit maxOutputTokens — item list is truncated');
  }

  let items = [];
  let parseError = null;

  try {
    const cleaned = rawText.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
    const parsed = JSON.parse(cleaned);
    items = Array.isArray(parsed) ? parsed : [];
    log.info('Parsed items', { itemCount: items.length });
  } catch (err) {
    try {
      const { jsonrepair } = require('jsonrepair');
      const repaired = jsonrepair(rawText);
      const parsed = JSON.parse(repaired);
      items = Array.isArray(parsed) ? parsed : [];
      log.info('jsonrepair recovered items', { itemCount: items.length });
    } catch (repairErr) {
      parseError = `Could not parse response as JSON: ${err.message}`;
      log.warn('JSON parse failed', { error: err.message });
    }
  }

  items = items.map(normalizeVideoItem);

  return { rawText, items, parseError, truncated, usageMetadata: extractUsageMetadata(result), model: modelId };
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
async function analyzeFrames(frames, plan = 'basic', roomHint = null, audio = null, userId = null, opts = {}) {
  if (!geminiClient) throw new Error('GOOGLE_AI_API_KEY is not configured');
  if (!frames || frames.length === 0) {
    return { rawText: '', items: [], narrationNotes: null, parseError: 'no frames' };
  }

  const modelId = GEMINI_MODELS[plan] || GEMINI_MODELS.basic;
  let prompt = INVENTORY_PROMPT_FRAMES;
  if (roomHint) {
    prompt += `\n\nThese frames are the "${roomHint}". Set "room" to "${roomHint}" for every item unless an item is clearly in a different room.`;
  }
  // Targeted scans: '' when no note — the no-note prompt is byte-identical.
  prompt += buildScanNoteSection(opts && opts.userNote);
  if (audio) {
    prompt += `\n\nAUDIO: The room's audio is included — the owner is narrating the walkthrough. Use what they say to correct item names, materials, weights, and fragility, and to catch items the frames missed. Return a JSON OBJECT (not a bare array): {"narration_notes": "<= 3 short sentences capturing anything the owner said that a mover should know (special handling, what an item is, access); empty string if nothing useful", "items": [ ...the item objects exactly as specified above... ]}.`;
  }

  log.info('Analyzing sampled frames', { frameCount: frames.length, hasAudio: !!audio, model: modelId });

  // Resilience + token metering (timeout / transient-error retry / usage into
  // user_costs) on the heaviest call in the scan pipeline.
  const model = instrumentVisionModel(geminiClient.getGenerativeModel({
    model: modelId,
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: framesResponseSchema(!!audio),
      maxOutputTokens: 8192,
    },
  }), { userId, modelName: modelId });

  const parts = frames.map((f) => ({
    inlineData: { mimeType: 'image/jpeg', data: f.buffer.toString('base64') },
  }));
  if (audio) {
    parts.push({ inlineData: { mimeType: audio.mimeType, data: audio.buffer.toString('base64') } });
  }
  parts.push({ text: prompt });

  let result;
  try {
    result = await model.generateContent(parts);
  } catch (err) {
    log.error('Gemini frame analysis failed', { error: err?.message || String(err) });
    throw new Error(`Gemini frame analysis failed: ${err?.message || err}`);
  }

  const rawText = result.response.text();
  const truncated = wasTruncated(result);
  if (truncated) {
    console.warn('[videoService] Frame analysis hit maxOutputTokens — item list is truncated');
  }
  const { items: parsed, narrationNotes, parseError } = parseItemsArray(rawText);
  log.info('Frame analysis parsed items', { itemCount: parsed.length, hasNarrationNotes: !!narrationNotes });
  return {
    rawText, items: parsed.map(normalizeVideoItem), narrationNotes, parseError, truncated,
    usageMetadata: extractUsageMetadata(result), model: modelId,
  };
}


// ── Chunked frame analysis ──────────────────────────────────────────────────
// One Gemini call has a hard output budget (maxOutputTokens 8192, and
// 2.5-flash spends thinking tokens from the same pool). With the review-card
// fields required, that caps a single call at roughly 40-60 items — and since
// the model emits items in frame order, a long walkthrough always loses
// EXACTLY the end-of-video items. Chunking gives every ~14-frame window its
// own full budget and full attention.

const { partitionFixtures, dedupeScanItems, buildScanNoteSection } = require('./scanItemFilters');

const CHUNK_FRAME_LIMIT = Number(process.env.SCAN_CHUNK_FRAMES || 14);
const CHUNK_SINGLE_CALL_MAX = Number(process.env.SCAN_SINGLE_CALL_FRAMES || 28);
const CHUNK_CONCURRENCY = Math.max(1, Number(process.env.SCAN_CHUNK_CONCURRENCY || 2));

/** Consecutive, chronological groups of at most CHUNK_FRAME_LIMIT frames. */
function chunkFrames(frames) {
  const chunks = [];
  for (let i = 0; i < frames.length; i += CHUNK_FRAME_LIMIT) {
    chunks.push({ offset: i, frames: frames.slice(i, i + CHUNK_FRAME_LIMIT) });
  }
  return chunks;
}

/**
 * Merge chunk results: remap each chunk's 1-based source_frame to the GLOBAL
 * frame index (so thumbnails keep working), and collapse cross-chunk
 * duplicates — a pan that carries the same sofa across a chunk boundary
 * reports it twice; same normalized (name, room) within one scan means the
 * same physical items, so keep the larger quantity rather than summing.
 */
function mergeChunkResults(chunkResults, chunks) {
  const items = [];
  const byKey = new Map();
  let parseError = null;
  let truncated = false;
  let narrationNotes = null;
  const usage = { promptTokenCount: 0, candidatesTokenCount: 0, totalTokenCount: 0 };
  let sawUsage = false;

  chunkResults.forEach((r, ci) => {
    if (!r) return;
    if (r.parseError && !parseError) parseError = r.parseError;
    if (r.truncated) truncated = true;
    if (r.narrationNotes && !narrationNotes) narrationNotes = r.narrationNotes;
    if (r.usageMetadata) {
      sawUsage = true;
      usage.promptTokenCount += r.usageMetadata.promptTokenCount || 0;
      usage.candidatesTokenCount += r.usageMetadata.candidatesTokenCount || 0;
      usage.totalTokenCount += r.usageMetadata.totalTokenCount || 0;
    }
    for (const it of (r.items || [])) {
      const sf = Number(it.source_frame);
      const global = Number.isFinite(sf) && sf >= 1 && sf <= chunks[ci].frames.length
        ? chunks[ci].offset + sf
        : null;
      const mapped = { ...it, source_frame: global };
      const key = `${String(it.name || '').toLowerCase().trim().replace(/\s+/g, ' ')}|${String(it.room || '').toLowerCase().trim()}`;
      const existing = key !== '|' ? byKey.get(key) : null;
      if (existing) {
        // Same physical items seen across a boundary — don't double-count.
        const q = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : 1);
        if (q(mapped.quantity) > q(existing.quantity)) existing.quantity = mapped.quantity;
        continue;
      }
      if (key !== '|') byKey.set(key, mapped);
      items.push(mapped);
    }
  });

  return {
    items,
    parseError: items.length > 0 ? null : parseError,
    truncated,
    narrationNotes,
    usageMetadata: sawUsage ? usage : null,
    model: chunkResults.find(r => r && r.model)?.model || null,
    chunkCount: chunks.length,
  };
}

/**
 * Analyze sampled frames, splitting long walkthroughs into windows so no part
 * of the video competes for one output budget. Short clips (≤
 * CHUNK_SINGLE_CALL_MAX frames) keep the proven single-call path. Narration
 * audio goes to the FIRST chunk only — the model uses it for names/notes once,
 * instead of re-inventing narration items per chunk.
 */
async function analyzeFramesChunked(frames, plan = 'basic', roomHint = null, audio = null, userId = null, opts = {}) {
  const analyze = opts._analyzeFn || analyzeFrames; // injectable for tests
  // Targeted scans: the user's note goes to EVERY chunk (unlike narration
  // audio) — each window must know the ask to honor it.
  const userNote = (opts && opts.userNote) || null;
  const noteOpts = userNote ? { userNote } : undefined;
  if (!frames || frames.length <= CHUNK_SINGLE_CALL_MAX) {
    const single = await analyze(frames, plan, roomHint, audio, userId, noteOpts);
    return { ...single, ...refineItems(single.items, userNote), chunkCount: 1 };
  }
  const chunks = chunkFrames(frames);
  log.info('Chunked frame analysis', { totalFrames: frames.length, chunks: chunks.length, perChunk: CHUNK_FRAME_LIMIT });

  const results = new Array(chunks.length);
  let next = 0;
  async function worker() {
    while (next < chunks.length) {
      const i = next++;
      try {
        results[i] = await analyze(chunks[i].frames, plan, roomHint, i === 0 ? audio : null, userId, noteOpts);
      } catch (err) {
        log.warn('Chunk analysis failed', { chunk: i + 1, of: chunks.length, error: err.message });
        results[i] = null; // partial coverage beats a dead scan; merge notes the gap
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CHUNK_CONCURRENCY, chunks.length) }, worker));

  const merged = mergeChunkResults(results, chunks);
  if (results.some(r => r === null)) merged.truncated = true; // a failed window = incomplete list
  return { ...merged, ...refineItems(merged.items, userNote) };
}

/**
 * Precision pass over a scan's items: drop house fixtures (prompt backstop)
 * and collapse same-item-different-name duplicates. Returns the replacement
 * fields to spread onto the result. `userNote` (optional) is the targeted-scan
 * keep-list: an item the note explicitly names is never dropped as a fixture.
 */
function refineItems(items, userNote = null) {
  const { kept, fixtures } = partitionFixtures(items || [], userNote);
  const deduped = dedupeScanItems(kept);
  if (fixtures.length > 0 || deduped.length !== (items || []).length) {
    log.info('Scan items refined', {
      raw: (items || []).length,
      fixturesDropped: fixtures.length,
      duplicatesCollapsed: kept.length - deduped.length,
    });
  }
  return { items: deduped, fixturesDropped: fixtures.length, duplicatesCollapsed: kept.length - deduped.length };
}

module.exports = { analyzeVideo, analyzeFrames, analyzeFramesChunked, chunkFrames, mergeChunkResults, normalizeVideoItem, parseItemsArray, INVENTORY_PROMPT, INVENTORY_PROMPT_FRAMES, GEMINI_MODELS };
