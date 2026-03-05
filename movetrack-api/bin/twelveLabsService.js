const { TwelveLabs } = require('twelvelabs-js');
const axios = require('axios');

let client = null;
let cachedIndexId = process.env.TWELVE_LABS_INDEX_ID || null;

// Inventory extraction prompt used by default for the /analyze endpoint
const INVENTORY_PROMPT = `You are analyzing a home walkthrough video for a moving company inventory system.
Your job is to identify household items visible in this video and produce a structured inventory.

Rules:
- List large or heavy items individually: furniture, appliances, gym equipment, large electronics (TVs, monitors).
- List fragile items individually: artwork, mirrors, musical instruments, glass items.
- Consolidate small packable items by category using "~N boxes of [category]" format (e.g., "~3 boxes of books", "~2 boxes of kitchen items", "~1 box of clothing").
- Target 15–20 total lines. Hard cap at 25 lines total.
- Do not list the same item twice.
- For each item, include:
  - name: descriptive item name (e.g. "3-seat sofa", "55\" TV", "~3 boxes of books")
  - quantity: integer count (use 1 for consolidated box entries)
  - room: the room or area where it appears (e.g. "living room", "bedroom", "kitchen", "garage", "unknown")
  - notes: one of "fragile", "requires disassembly", "heavy", "boxable", or "" if none
  - timestamp_seconds: integer seconds into the video where this item is most clearly visible

Return ONLY a valid JSON array with no markdown or explanation. Example:
[
  {"name":"3-seat sofa","quantity":1,"room":"living room","notes":"heavy","timestamp_seconds":12},
  {"name":"55\" TV","quantity":1,"room":"living room","notes":"fragile","timestamp_seconds":18},
  {"name":"~3 boxes of books","quantity":1,"room":"office","notes":"boxable","timestamp_seconds":45}
]`;

function getClient() {
  if (!client) {
    const apiKey = process.env.TWELVE_LABS_API_KEY;
    if (!apiKey) {
      throw new Error('TWELVE_LABS_API_KEY environment variable is not set');
    }
    client = new TwelveLabs({ apiKey });
  }
  return client;
}

// Extract a human-readable message from a Twelve Labs SDK error
function formatTLError(err) {
  // SDK wraps API error bodies; try to surface the message field
  const body = err?.body;
  if (body) {
    const msg = body?.message || body?.error || JSON.stringify(body);
    return `TwelveLabs API error: ${msg}`;
  }
  return err?.message || String(err);
}

const INDEX_NAME = 'movetrack-dev';

async function ensureIndex() {
  if (cachedIndexId) {
    console.log(`[TwelveLabs] Using cached index: ${cachedIndexId}`);
    return cachedIndexId;
  }

  // Look for an existing index with this name before trying to create one
  console.log(`[TwelveLabs] Looking up existing index "${INDEX_NAME}"...`);
  try {
    const page = await getClient().indexes.list({ indexName: INDEX_NAME, pageLimit: 1 });
    // page is an async iterable — grab the first result
    for await (const idx of page) {
      if (idx.indexName === INDEX_NAME && idx.id) {
        cachedIndexId = idx.id;
        console.log(`[TwelveLabs] Found existing index: ${cachedIndexId}`);
        return cachedIndexId;
      }
    }
  } catch (err) {
    console.warn('[TwelveLabs] Index lookup failed, will try to create:', err?.message);
  }

  console.log(`[TwelveLabs] Creating new index "${INDEX_NAME}"...`);
  try {
    const response = await getClient().indexes.create({
      indexName: INDEX_NAME,
      models: [
        { modelName: 'pegasus1.2', modelOptions: ['visual', 'audio'] }
      ]
    });
    cachedIndexId = response.id;
    console.log(`[TwelveLabs] Created index: ${cachedIndexId}`);
    return cachedIndexId;
  } catch (err) {
    console.error('[TwelveLabs] Failed to create index:', err?.body || err?.message || err);
    throw new Error(formatTLError(err));
  }
}

/**
 * Upload a video buffer to Twelve Labs for indexing.
 * @param {Buffer} buffer  - Video file buffer (from multer memoryStorage)
 * @param {string} mimeType - MIME type e.g. "video/mp4"
 * @param {string} originalname - Original filename e.g. "walkthrough.mp4"
 * @returns {{ taskId: string, indexId: string }}
 */
async function uploadVideo(buffer, mimeType, originalname) {
  console.log(`[TwelveLabs] uploadVideo called — size: ${buffer.length} bytes, mime: ${mimeType}, name: ${originalname}`);

  const indexId = await ensureIndex();
  console.log(`[TwelveLabs] Uploading to index: ${indexId}`);

  // Use File (Node 20+) so the SDK can attach a filename to the multipart field.
  // A plain Blob has no .name and Twelve Labs rejects the upload as invalid_argument.
  const videoFile = new File([buffer], originalname || 'video.mp4', { type: mimeType });
  console.log(`[TwelveLabs] File object: name=${videoFile.name}, size=${videoFile.size}, type=${videoFile.type}`);

  try {
    const task = await getClient().tasks.create({ indexId, videoFile });
    const taskId = task.id;
    console.log(`[TwelveLabs] Upload task created: taskId=${taskId}`);
    return { taskId, indexId };
  } catch (err) {
    console.error('[TwelveLabs] tasks.create failed:', err?.body || err?.message || err);
    throw new Error(formatTLError(err));
  }
}

/**
 * Poll the status of an indexing task.
 * @param {string} taskId
 * @returns {{ status: string, videoId: string|null }}
 */
async function getTaskStatus(taskId) {
  console.log(`[TwelveLabs] Polling task status: ${taskId}`);
  try {
    const task = await getClient().tasks.retrieve(taskId);
    console.log(`[TwelveLabs] Task ${taskId}: status=${task.status}, videoId=${task.videoId}`);
    return {
      status: task.status || 'pending',
      videoId: task.videoId || null
    };
  } catch (err) {
    console.error('[TwelveLabs] tasks.retrieve failed:', err?.body || err?.message || err);
    throw new Error(formatTLError(err));
  }
}

/**
 * Fetch a thumbnail URL for a specific video timestamp from Twelve Labs.
 * @param {string} indexId
 * @param {string} videoId
 * @param {number} seconds
 * @returns {string|null} thumbnail URL or null on failure
 */
async function fetchThumbnail(indexId, videoId, seconds) {
  const apiKey = process.env.TWELVE_LABS_API_KEY;
  if (!apiKey) return null;

  try {
    const res = await axios.get(
      `https://api.twelvelabs.io/v1.3/indexes/${indexId}/videos/${videoId}/thumbnail`,
      {
        params: { time: seconds },
        headers: { 'x-api-key': apiKey },
        timeout: 10000
      }
    );
    // Response shape: { thumbnail: "https://..." }
    return res.data?.thumbnail || null;
  } catch (err) {
    console.warn(`[TwelveLabs] Thumbnail fetch failed for t=${seconds}s:`, err?.message);
    return null;
  }
}

/**
 * Run Pegasus analysis on an indexed video to extract a household inventory.
 * @param {string} videoId
 * @param {string} indexId - Required for thumbnail fetching
 * @param {string} [customPrompt] - Optional prompt override
 * @returns {{ rawText: string, items: Array, parseError: string|null }}
 */
async function analyzeVideo(videoId, indexId, customPrompt) {
  const prompt = customPrompt || INVENTORY_PROMPT;
  console.log(`[TwelveLabs] Analyzing videoId=${videoId}, prompt length=${prompt.length}`);

  let result;
  try {
    result = await getClient().analyze({
      videoId,
      prompt,
      temperature: 0.2,
      responseFormat: {
        type: 'json_schema',
        jsonSchema: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              quantity: { type: 'integer' },
              room: { type: 'string' },
              notes: { type: 'string' },
              timestamp_seconds: { type: 'integer' }
            },
            required: ['name', 'quantity', 'room', 'notes', 'timestamp_seconds']
          }
        }
      }
    });
  } catch (err) {
    console.error('[TwelveLabs] analyze failed:', err?.body || err?.message || err);
    throw new Error(formatTLError(err));
  }

  const rawText = result.data || '';
  console.log(`[TwelveLabs] analyze response length: ${rawText.length} chars`);
  console.log('[TwelveLabs] analyze raw response:', rawText.substring(0, 500));

  let items = [];
  let parseError = null;

  try {
    const cleaned = rawText.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
    const parsed = JSON.parse(cleaned);
    items = Array.isArray(parsed) ? parsed : [];
    console.log(`[TwelveLabs] Parsed ${items.length} items`);
  } catch (err) {
    try {
      const { jsonrepair } = require('jsonrepair');
      const repaired = jsonrepair(rawText);
      const parsed = JSON.parse(repaired);
      items = Array.isArray(parsed) ? parsed : [];
      console.log(`[TwelveLabs] jsonrepair recovered ${items.length} items`);
    } catch (repairErr) {
      parseError = `Could not parse response as JSON: ${err.message}`;
      console.warn('[TwelveLabs] JSON parse failed, returning raw text:', err.message);
    }
  }

  // Fetch thumbnails in parallel for items that have a timestamp
  if (indexId && items.length > 0) {
    const thumbnailPromises = items.map(async (item) => {
      if (typeof item.timestamp_seconds === 'number' && item.timestamp_seconds >= 0) {
        item.thumbnailUrl = await fetchThumbnail(indexId, videoId, item.timestamp_seconds);
      }
      return item;
    });
    items = await Promise.all(thumbnailPromises);
    console.log(`[TwelveLabs] Thumbnail fetch complete for ${items.length} items`);
  }

  return { rawText, items, parseError };
}

module.exports = {
  uploadVideo,
  getTaskStatus,
  analyzeVideo,
  ensureIndex,
  INVENTORY_PROMPT
};
