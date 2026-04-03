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
Your job is to identify household items visible in this video and produce a structured inventory.

Rules:
- List large or heavy items individually: furniture, appliances, gym equipment, large electronics (TVs, monitors).
- List fragile items individually: artwork, mirrors, musical instruments, glass items.
- Consolidate small packable items by category. Use a SINGULAR unit name and set quantity to the count (e.g., name "Box of books" with quantity 3, NOT "~3 boxes of books" with quantity 1).
- Target 15–20 total lines. Hard cap at 25 lines total.
- Do not list the same item twice.
- For each item, include:
  - name: descriptive name for ONE unit of the item (e.g. "3-seat sofa", "55\\" TV", "Box of books", "Dining chair"). Always describe a single unit.
  - quantity: integer count of how many of this item exist. Use quantity > 1 for multiples (e.g. 4 dining chairs, 3 boxes of books).
  - room: the room or area where it appears (e.g. "living room", "bedroom", "kitchen", "garage", "unknown")
  - notes: one of "fragile", "requires disassembly", "heavy", "boxable", or "" if none
  - timestamp_seconds: integer seconds into the video where this item is most clearly visible
  - bbox: bounding box of the item in the frame at timestamp_seconds, as normalized 0.0–1.0 coordinates: {"x": left, "y": top, "w": width, "h": height}. If you cannot determine the bounding box, set bbox to null.

Return ONLY a valid JSON array with no markdown or explanation. Example:
[
  {"name":"3-seat sofa","quantity":1,"room":"living room","notes":"heavy","timestamp_seconds":12,"bbox":{"x":0.05,"y":0.3,"w":0.6,"h":0.5}},
  {"name":"55\\" TV","quantity":1,"room":"living room","notes":"fragile","timestamp_seconds":18,"bbox":{"x":0.2,"y":0.1,"w":0.35,"h":0.4}},
  {"name":"Box of books","quantity":3,"room":"office","notes":"boxable","timestamp_seconds":45,"bbox":null},
  {"name":"Dining chair","quantity":4,"room":"dining room","notes":"","timestamp_seconds":30,"bbox":null}
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

  return { rawText, items, parseError };
}

module.exports = { analyzeVideo, INVENTORY_PROMPT, GEMINI_MODELS };
