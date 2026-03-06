'use strict';

const { GoogleGenerativeAI } = require('@google/generative-ai');

let geminiClient = null;

if (process.env.GOOGLE_AI_API_KEY) {
  geminiClient = new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY);
  console.log('[videoScanService] Gemini configured');
}

const GEMINI_MODELS = {
  basic: 'gemini-2.5-flash',
  pro: 'gemini-2.5-pro',
};

const INVENTORY_PROMPT = `You are analyzing a home walkthrough video for a moving company inventory system.
Your job is to identify household items visible in this video and produce a structured inventory.

Rules:
- List large or heavy items individually: furniture, appliances, gym equipment, large electronics (TVs, monitors).
- List fragile items individually: artwork, mirrors, musical instruments, glass items.
- Consolidate small packable items by category using "~N boxes of [category]" format (e.g., "~3 boxes of books", "~2 boxes of kitchen items", "~1 box of clothing").
- Target 15–20 total lines. Hard cap at 25 lines total.
- Do not list the same item twice.
- For each item, include:
  - name: descriptive item name (e.g. "3-seat sofa", "55\\" TV", "~3 boxes of books")
  - quantity: integer count (use 1 for consolidated box entries)
  - room: the room or area where it appears (e.g. "living room", "bedroom", "kitchen", "garage", "unknown")
  - notes: one of "fragile", "requires disassembly", "heavy", "boxable", or "" if none
  - timestamp_seconds: integer seconds into the video where this item is most clearly visible

Return ONLY a valid JSON array with no markdown or explanation. Example:
[
  {"name":"3-seat sofa","quantity":1,"room":"living room","notes":"heavy","timestamp_seconds":12},
  {"name":"55\\" TV","quantity":1,"room":"living room","notes":"fragile","timestamp_seconds":18},
  {"name":"~3 boxes of books","quantity":1,"room":"office","notes":"boxable","timestamp_seconds":45}
]`;

/**
 * Analyze a video via Gemini using inline base64 data.
 *
 * @param {Buffer} videoBuffer  - Video file buffer
 * @param {string} mimeType     - e.g. "video/mp4"
 * @param {string} [plan]       - "basic" or "pro" for model tier
 * @param {string} [customPrompt]
 * @returns {{ rawText: string, items: Array, parseError: string|null }}
 */
async function analyzeVideo(videoBuffer, mimeType, plan = 'basic', customPrompt = null) {
  if (!geminiClient) {
    throw new Error('GOOGLE_AI_API_KEY is not configured');
  }

  const modelId = GEMINI_MODELS[plan] || GEMINI_MODELS.basic;
  const prompt = customPrompt || INVENTORY_PROMPT;
  const base64Video = videoBuffer.toString('base64');

  console.log(`[videoScanService] Analyzing video (${(videoBuffer.length / 1024 / 1024).toFixed(1)}MB) with model=${modelId}`);

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
    console.error('[videoScanService] Gemini generateContent failed:', err?.message || err);
    throw new Error(`Gemini video analysis failed: ${err?.message || err}`);
  }

  const rawText = result.response.text();
  console.log(`[videoScanService] Response length: ${rawText.length} chars`);
  console.log('[videoScanService] Raw response preview:', rawText.substring(0, 500));

  let items = [];
  let parseError = null;

  try {
    const cleaned = rawText.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
    const parsed = JSON.parse(cleaned);
    items = Array.isArray(parsed) ? parsed : [];
    console.log(`[videoScanService] Parsed ${items.length} items`);
  } catch (err) {
    try {
      const { jsonrepair } = require('jsonrepair');
      const repaired = jsonrepair(rawText);
      const parsed = JSON.parse(repaired);
      items = Array.isArray(parsed) ? parsed : [];
      console.log(`[videoScanService] jsonrepair recovered ${items.length} items`);
    } catch (repairErr) {
      parseError = `Could not parse response as JSON: ${err.message}`;
      console.warn('[videoScanService] JSON parse failed:', err.message);
    }
  }

  return { rawText, items, parseError };
}

module.exports = { analyzeVideo, INVENTORY_PROMPT, GEMINI_MODELS };
