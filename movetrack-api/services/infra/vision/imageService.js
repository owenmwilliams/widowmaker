const Anthropic = require('@anthropic-ai/sdk');
const OpenAI = require('openai');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { HfInference } = require('@huggingface/inference');
const fetch = require('node-fetch');
const sharp = require('sharp');
const { Storage } = require('@google-cloud/storage');
const path = require('path');
const { jsonrepair } = require('jsonrepair');
const { buildProviderOrder, runWithFailover } = require('./visionFailover');
const { instrumentVisionModel } = require('../ai/resilientModel');
const {
  photoMultiItemSchema,
  photoMultiImageSchema,
  singleItemSchema,
  wasTruncated,
} = require('./visionSchemas');

// Initialize GCS client for fetching images from URLs
const isLocalEnvironment = process.env.NODE_ENV !== 'production';
const storageOptions = {
  projectId: 'widowmaker-477505',
};

if (isLocalEnvironment) {
  const localKeyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS
    || path.join(__dirname, '../devkeys/service-account.json');
  storageOptions.keyFilename = localKeyPath;
}

const storage = new Storage(storageOptions);

// Initialize clients
let anthropicClient = null;
let openaiClient = null;
let geminiClient = null;

const huggingFaceToken = process.env.HUGGINGFACE_API_TOKEN || process.env.HUGGING_FACE_API_TOKEN;
const florenceModelId = process.env.HUGGINGFACE_FLORENCE_MODEL || 'microsoft/Florence-2-base';
const nemotronModelId = process.env.HUGGINGFACE_NEMOTRON_MODEL || 'nvidia/Nemotron-4-140B-Vision-Instruction';
const samModelId = process.env.SAM_MODEL_ID || 'facebook/sam-vit-base';
const hfInference = huggingFaceToken ? new HfInference(huggingFaceToken) : null;

// Only initialize if API keys are provided
if (process.env.ANTHROPIC_API_KEY) {
    anthropicClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    console.log('Anthropic Claude Vision configured');
}

if (process.env.OPENAI_API_KEY) {
    openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    console.log('OpenAI GPT-4 Vision configured');
}

if (process.env.GOOGLE_AI_API_KEY) {
    geminiClient = new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY);
    console.log('Google Gemini Vision configured');
}

if (huggingFaceToken) {
    console.log(
      `HuggingFace Vision configured - Models: ${florenceModelId}, ${nemotronModelId}, SAM: ${samModelId}`
    );
}

// Together.ai configuration
const togetherApiKey = process.env.TOGETHER_API_KEY;
const togetherScoutModel = process.env.TOGETHER_SCOUT_MODEL || 'meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8';
const togetherQwenModel = process.env.TOGETHER_QWEN_MODEL || 'Qwen/Qwen3-VL-8B-Instruct';

if (togetherApiKey) {
    console.log(`Together.ai Vision configured - Maverick: ${togetherScoutModel}, Qwen: ${togetherQwenModel}`);
}

// Default provider (can be changed via admin settings)
let currentProvider = process.env.VISION_PROVIDER || 'gemini';

/**
 * Helper function to determine if input is a URL or base64
 */
function isUrl(imageSource) {
  return typeof imageSource === 'string' &&
         (imageSource.startsWith('http://') ||
          imageSource.startsWith('https://') ||
          imageSource.startsWith('gs://'));
}

/**
 * Helper function to fetch image from URL and convert to base64
 */
async function fetchImageAsBase64(imageUrl) {
  try {
    // Handle GCS URLs (gs:// or https://storage.googleapis.com/)
    if (imageUrl.startsWith('gs://')) {
      const gsPath = imageUrl.replace('gs://', '');
      const [bucketName, ...filePath] = gsPath.split('/');
      const fileName = filePath.join('/');

      const bucket = storage.bucket(bucketName);
      const file = bucket.file(fileName);
      const [buffer] = await file.download();
      return buffer.toString('base64');
    } else if (imageUrl.includes('storage.googleapis.com')) {
      // Parse https://storage.googleapis.com/bucket/path URL
      // Use URL to safely strip signed-URL query params
      const parsed = new URL(imageUrl);
      const pathParts = parsed.pathname.replace(/^\//, '').split('/');
      const [bucketName, ...filePath] = pathParts;
      const fileName = filePath.join('/');

      const bucket = storage.bucket(bucketName);
      const file = bucket.file(fileName);
      const [buffer] = await file.download();
      return buffer.toString('base64');
    } else if (imageUrl.startsWith('data:')) {
      // Already a data URL, extract base64 part
      return imageUrl.split(',')[1];
    } else {
      // Generic HTTP(S) URL - fetch via HTTP
      const response = await fetch(imageUrl);
      if (!response.ok) {
        throw new Error(`Failed to fetch image from URL: ${response.status} ${response.statusText}`);
      }
      const buffer = await response.buffer();
      return buffer.toString('base64');
    }
  } catch (error) {
    console.error('Error fetching image from URL:', error);
    throw new Error(`Failed to fetch image from URL: ${error.message}`);
  }
}

function parseBase64Image(input, fallbackMime = 'image/png') {
  if (!input || typeof input !== 'string') {
    throw new Error('Image payload is required');
  }
  if (input.startsWith('data:')) {
    const [metadata, data] = input.split(',');
    const match = metadata.match(/^data:(.*?);base64$/);
    return {
      buffer: Buffer.from(data, 'base64'),
      mimeType: match ? match[1] : fallbackMime
    };
  }
  return {
    buffer: Buffer.from(input, 'base64'),
    mimeType: fallbackMime
  };
}

/**
 * Helper function to get MIME type from URL or default to jpeg
 */
function getMimeTypeFromUrl(imageUrl) {
  if (imageUrl.startsWith('data:')) {
    const match = imageUrl.match(/^data:([^;]+);/);
    return match ? match[1] : 'image/jpeg';
  }

  // Detect from file extension
  const ext = imageUrl.split('.').pop().split('?')[0].toLowerCase();
  const mimeTypes = {
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'png': 'image/png',
    'gif': 'image/gif',
    'webp': 'image/webp'
  };
  return mimeTypes[ext] || 'image/jpeg';
}

/**
 * Common prompt for all vision APIs - Single Item Mode
 */
const VISION_PROMPT = `Analyze this household item for moving inventory. You must return ONLY valid JSON with this exact structure (no markdown, no additional text):

{
  "name": "item name",
  "material": "primary material (e.g., ceramic, metal, glass, wood, plastic, fabric)",
  "color": "primary color",
  "estimatedDimensions": {
    "length": 0,
    "width": 0,
    "height": 0
  },
  "estimatedWeight": 0,
  "fragile": true or false,
  "tags": ["tag1", "tag2"],
  "confidence": 0.0 to 1.0,
  "reasoning": "brief explanation of your analysis"
}

Important:
- Dimensions should be in inches (approximate based on visual reference)
- Weight should be in pounds (approximate)
- Tags should be relevant categories like "Fragile", "Glass", "Metal", "Ceramic", "Antique", "Decorative", "Functional", etc.
- For items that should NOT be packed in standard moving boxes, add the "loose" tag. Examples include:
  * Furniture (chairs, tables, sofas, dressers, beds, cabinets, shelving)
  * Large appliances (refrigerators, washing machines, dryers, dishwashers, stoves)
  * Large electronics (TVs over 32", large monitors, floor speakers)
  * Exercise equipment (treadmills, bikes, weights over 25lbs)
  * Large artwork or mirrors
  * Musical instruments (pianos, guitars, drums)
- Smaller items that CAN be boxed (small electronics, monitors under 27", decorative items, kitchenware, books, etc.) should NOT have the "loose" tag
- Confidence should reflect how certain you are about the analysis (0.0 = very uncertain, 1.0 = very certain)
- fragile: set true for anything breakable or needing protective packing — glass/glass-topped items, mirrors, framed art & photos, TVs and monitors, lamps, ceramics/china/dishware/stemware, vases, small electronics, musical instruments. When in doubt, mark it fragile.

Return ONLY the JSON object, nothing else.`;

/**
 * Prompt for multi-item detection
 */
const MULTI_ITEM_VISION_PROMPT = `Analyze this photo for moving inventory. Identify EVERY household item a mover would need to pack or move — be thorough, prioritizing larger/more prominent items but not stopping early.

If there are multiple items of the same type (e.g., books, plates, cups), GROUP THEM TOGETHER as a single entry. Use a SINGULAR unit name and put the count in the "quantity" field (e.g., name "Book" with quantity 50, NOT "Books (approximately 50 items)").

Return ONLY valid JSON with this exact structure (no markdown, no additional text):

{
  "itemCount": 0,
  "items": [
    {
      "id": 1,
      "name": "brief name for ONE unit of the item",
      "quantity": 1,
      "fragile": false,
      "boundingBox": {
        "x": 0.0,
        "y": 0.0,
        "width": 0.0,
        "height": 0.0
      },
      "confidence": 0.0,
      "reasoning": "brief note about the item or group"
    }
  ],
  "reasoning": "brief explanation of what you detected"
}

Important:
- Include every prominent item — do NOT cap the list; a cluttered room legitimately has many entries.
- itemCount should match the number of items in the array.
- "name" must describe ONE unit. "quantity" holds the count. Example: name "Dining chair", quantity 4 — NOT "4 dining chairs".
- fragile: set true for anything breakable or needing protective packing — glass/glass-topped items, mirrors, framed art & photos, TVs and monitors, lamps, ceramics/china/dishware/stemware, vases, small electronics, musical instruments. When in doubt, mark it fragile.
- boundingBox coordinates are normalized (0.0 to 1.0 range) where:
  - x, y represent the top-left corner (as fraction of image width/height)
  - width, height represent the box size (as fraction of image width/height)
- For grouped items, use the bounding box that encompasses the entire group
- Prioritize larger, more prominent items over small details
- Confidence should reflect certainty about each item (0.0 = very uncertain, 1.0 = very certain)

Return ONLY the JSON object, nothing else.

FIXTURES STAY WITH THE HOUSE - NEVER list them: toilets, sinks, bathtubs, showers, faucets, countertops, built-in cabinets/shelving/appliances, ceiling lights and fans, chandeliers, light switches, thermostats, radiators, water heaters, fireplaces, doors, windows, and window blinds. Movable appliances DO count (fridge, washer/dryer, microwave, window AC unit).`;

const MULTI_IMAGE_VISION_PROMPT = `You are analyzing MULTIPLE photos of the SAME room for moving inventory. These images show the same space from different angles.

CRITICAL: Deduplicate across images. If the same item appears in multiple photos, count it ONLY ONCE. Use visual cues (position, color, size, surroundings) to determine when two photos show the same item from different angles.

Identify EVERY household item a mover would need to pack or move across ALL images combined — be thorough, prioritizing larger/more prominent items but not stopping early.

If there are multiple items of the same type (e.g., books, plates, cups), GROUP THEM TOGETHER as a single entry. Use a SINGULAR unit name and put the count in the "quantity" field.

Return ONLY valid JSON with this exact structure (no markdown, no additional text):

{
  "itemCount": 0,
  "items": [
    {
      "id": 1,
      "name": "brief name for ONE unit of the item",
      "quantity": 1,
      "sourceImage": 1,
      "fragile": false,
      "boundingBox": {
        "x": 0.0,
        "y": 0.0,
        "width": 0.0,
        "height": 0.0
      },
      "confidence": 0.0,
      "reasoning": "brief note; mention if visible in multiple photos"
    }
  ],
  "reasoning": "overview of the room and how images overlap"
}

Important:
- Include every prominent item — do NOT cap the list; a cluttered room legitimately has many entries.
- fragile: set true for anything breakable or needing protective packing — glass/glass-topped items, mirrors, framed art & photos, TVs and monitors, lamps, ceramics/china/dishware/stemware, vases, small electronics, musical instruments. When in doubt, mark it fragile.
- "sourceImage" is the 1-based index of the image where this item is MOST clearly visible (used for cropping the best photo of it)
- boundingBox coordinates are normalized (0.0 to 1.0) relative to the sourceImage
- "name" must describe ONE unit. "quantity" holds the count.
- For grouped items, use the bounding box that encompasses the group in the sourceImage
- Prioritize larger, more prominent items over small details
- Confidence should reflect certainty (0.0 = very uncertain, 1.0 = very certain)

Return ONLY the JSON object, nothing else.

FIXTURES STAY WITH THE HOUSE - NEVER list them: toilets, sinks, bathtubs, showers, faucets, countertops, built-in cabinets/shelving/appliances, ceiling lights and fans, chandeliers, light switches, thermostats, radiators, water heaters, fireplaces, doors, windows, and window blinds. Movable appliances DO count (fridge, washer/dryer, microwave, window AC unit).`;

/**
 * Analyze photo using Claude 3.5 Sonnet Vision
 * @param {string} imageSource - Base64 string or URL
 * @param {string} mimeType - MIME type of the image
 * @param {string} prompt - Analysis prompt
 */
async function analyzeWithClaude(imageSource, mimeType, prompt = VISION_PROMPT) {
    if (!anthropicClient) {
        throw new Error('Anthropic API key not configured');
    }

    try {
        // Convert URL to base64 if needed (Claude only supports base64)
        let base64Image = imageSource;
        let actualMimeType = mimeType;

        if (isUrl(imageSource)) {
            console.log('[Claude] Converting URL to base64...');
            base64Image = await fetchImageAsBase64(imageSource);
            actualMimeType = mimeType || getMimeTypeFromUrl(imageSource);
        }

        const response = await anthropicClient.messages.create({
            model: "claude-sonnet-4-6-latest",
            max_tokens: 1024,
            messages: [{
                role: "user",
                content: [
                    {
                        type: "image",
                        source: {
                            type: "base64",
                            media_type: actualMimeType,
                            data: base64Image
                        }
                    },
                    {
                        type: "text",
                        text: prompt
                    }
                ]
            }]
        });

        const textContent = response.content[0].text;
        // Remove markdown code blocks if present
        const jsonText = textContent.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        const result = JSON.parse(jsonText);

        return {
            success: true,
            data: result,
            provider: 'claude',
            model: 'claude-sonnet-4-6-latest'
        };
    } catch (error) {
        console.error('Claude Vision API error:', error);
        return {
            success: false,
            error: error.message,
            provider: 'claude'
        };
    }
}

/**
 * Analyze photo using GPT-4 Vision
 * @param {string} imageSource - Base64 string or URL
 * @param {string} mimeType - MIME type of the image
 * @param {string} prompt - Analysis prompt
 */
async function analyzeWithGPT4(imageSource, mimeType, prompt = VISION_PROMPT) {
    if (!openaiClient) {
        throw new Error('OpenAI API key not configured');
    }

    try {
        // GPT-4 supports both URLs and base64 - use URL if available for efficiency
        let imageUrl;
        if (isUrl(imageSource)) {
            console.log('[GPT-4] Using URL directly (native support)');
            imageUrl = imageSource;
        } else {
            // Convert base64 to data URL
            imageUrl = `data:${mimeType};base64,${imageSource}`;
        }

        const response = await openaiClient.chat.completions.create({
            model: "gpt-4o",
            messages: [{
                role: "user",
                content: [
                    {
                        type: "text",
                        text: prompt
                    },
                    {
                        type: "image_url",
                        image_url: {
                            url: imageUrl
                        }
                    }
                ]
            }],
            max_tokens: 500,
            response_format: { type: "json_object" }
        });

        const result = JSON.parse(response.choices[0].message.content);

        return {
            success: true,
            data: result,
            provider: 'gpt4',
            model: 'gpt-4o'
        };
    } catch (error) {
        console.error('GPT-4 Vision API error:', error);
        return {
            success: false,
            error: error.message,
            provider: 'gpt4'
        };
    }
}

/**
 * Analyze photo using Google Gemini
 * @param {string} imageSource - Base64 string or URL
 * @param {string} mimeType - MIME type of the image
 * @param {string} prompt - Analysis prompt
 */
async function analyzeWithGemini(imageSource, mimeType, prompt = VISION_PROMPT, modelId = 'gemini-2.5-flash', userId = null) {
    if (!geminiClient) {
        throw new Error('Google AI API key not configured');
    }

    try {
        // Convert URL to base64 if needed (Gemini prefers base64)
        let base64Image = imageSource;
        let actualMimeType = mimeType;

        if (isUrl(imageSource)) {
            console.log('[Gemini] Converting URL to base64...');
            base64Image = await fetchImageAsBase64(imageSource);
            actualMimeType = mimeType || getMimeTypeFromUrl(imageSource);
        } else if (typeof imageSource === 'string' && imageSource.startsWith('data:')) {
            // Strip data URL prefix — Gemini expects raw base64 only
            const [metadata, data] = imageSource.split(',');
            base64Image = data;
            const match = metadata.match(/^data:(.*?);base64$/);
            if (match) actualMimeType = match[1];
        }

        // Only constrain to the single-item schema for the standard prompt (and
        // the item-hint variant, which embeds it). The vision-lab route passes
        // arbitrary experimental prompts through here — forcing our schema would
        // corrupt their output, so those get plain JSON mode.
        const useSchema = typeof prompt === 'string' && prompt.includes(VISION_PROMPT);
        const singleItemConfig = useSchema
            ? { responseMimeType: "application/json", responseSchema: singleItemSchema }
            : { responseMimeType: "application/json" };
        // Resilience + token metering (timeout / usage). retries:0 — this function
        // has its own manual retry + flash-fallback layer below; letting the
        // wrapper also retry would stack (2×2×fallback = up to 12min in one call).
        const model = instrumentVisionModel(geminiClient.getGenerativeModel({
            model: modelId,
            generationConfig: singleItemConfig
        }), { userId, modelName: modelId, retries: 0 });

        const contentParts = [
            { inlineData: { data: base64Image, mimeType: actualMimeType } },
            { text: prompt }
        ];
        let result;
        let usedModel = modelId;
        try {
            result = await model.generateContent(contentParts);
        } catch (apiError) {
            if (modelId !== 'gemini-2.5-flash') {
                // Retry once with same model (transient errors)
                console.warn(`[Gemini] ${modelId} failed, retrying once: ${apiError.message}`);
                try {
                    result = await model.generateContent(contentParts);
                } catch (retryError) {
                    // Fall back to flash
                    console.warn(`[Gemini] ${modelId} retry failed, falling back to flash: ${retryError.message}`);
                    usedModel = 'gemini-2.5-flash';
                    const fallbackModel = instrumentVisionModel(geminiClient.getGenerativeModel({
                        model: usedModel,
                        generationConfig: singleItemConfig
                    }), { userId, modelName: usedModel, retries: 0 });
                    result = await fallbackModel.generateContent(contentParts);
                }
            } else {
                throw apiError;
            }
        }

        const jsonText = result.response.text();
        const data = JSON.parse(jsonText);

        return {
            success: true,
            data: data,
            provider: 'gemini',
            model: modelId
        };
    } catch (error) {
        console.error('Gemini Vision API error:', error);
        return {
            success: false,
            error: error.message,
            provider: 'gemini'
        };
    }
}

/**
 * Generic helper for Together.ai Vision API
 * @param {string} modelId - Together.ai model ID
 * @param {string} imageSource - Base64 string or URL
 * @param {string} mimeType - MIME type of the image
 * @param {string} prompt - Analysis prompt
 * @param {number} maxTokens - Maximum tokens to generate
 */
async function callTogetherVision(modelId, imageSource, mimeType, prompt, maxTokens = 1024) {
    if (!togetherApiKey) {
        throw new Error('Together.ai API key not configured');
    }

    try {
        // Together.ai supports URLs directly - use if available for efficiency
        let imageUrl;
        if (isUrl(imageSource)) {
            console.log('[Together.ai] Using URL directly (native support)');
            imageUrl = imageSource;
        } else {
            // Convert base64 to data URL
            imageUrl = `data:${mimeType};base64,${imageSource}`;
        }

        const response = await fetch('https://api.together.xyz/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${togetherApiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: modelId,
                messages: [
                    {
                        role: "user",
                        content: [
                            {
                                type: "text",
                                text: prompt
                            },
                            {
                                type: "image_url",
                                image_url: {
                                    url: imageUrl
                                }
                            }
                        ]
                    }
                ],
                max_tokens: maxTokens,
                temperature: 0.7,
                top_p: 0.7,
                top_k: 50,
                repetition_penalty: 1,
                stop: ["<|eot_id|>", "<|eom_id|>"]
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Together.ai API error (${response.status}): ${errorText}`);
        }

        const result = await response.json();
        const textContent = result.choices[0].message.content;

        // Remove markdown code blocks if present
        const jsonText = textContent
            .replace(/```json/gi, '```')
            .replace(/```/g, '')
            .trim();

        let parsedData;
        try {
            parsedData = JSON.parse(jsonText);
        } catch (parseError) {
            console.warn('Together.ai JSON parse failed, attempting repair', {
                message: parseError.message,
                preview: jsonText.slice(0, 400)
            });
            try {
                const repaired = jsonrepair(jsonText);
                parsedData = JSON.parse(repaired);
            } catch (repairError) {
                console.error('Together.ai JSON repair failed', {
                    repairError: repairError.message,
                    originalError: parseError.message,
                    preview: jsonText.slice(0, 400)
                });
                throw new Error(`Together.ai response parsing failed: ${repairError.message} (original: ${parseError.message})`);
            }
        }

        return {
            success: true,
            data: parsedData,
            rawResponse: textContent,
            model: modelId
        };
    } catch (error) {
        console.error(`Together.ai Vision API error (${modelId}):`, error);
        return {
            success: false,
            error: error.message,
            model: modelId
        };
    }
}

/**
 * Analyze photo using Together.ai Scout (Free tier)
 */
async function analyzeWithTogetherScout(base64Image, mimeType, prompt = VISION_PROMPT) {
    const result = await callTogetherVision(togetherScoutModel, base64Image, mimeType, prompt);
    if (result.success) {
        result.provider = 'together-scout';
    }
    return result;
}

/**
 * Analyze photo using Together.ai Qwen (Paid tier)
 */
async function analyzeWithTogetherQwen(base64Image, mimeType, prompt = VISION_PROMPT) {
    const result = await callTogetherVision(togetherQwenModel, base64Image, mimeType, prompt);
    if (result.success) {
        result.provider = 'together-qwen';
    }
    return result;
}

/**
 * Analyze photo using Together.ai (defaults to Scout/free tier)
 */
async function analyzeWithTogether(base64Image, mimeType) {
    return await analyzeWithTogetherScout(base64Image, mimeType);
}

/**
 * Analyze multi-item photo using Together.ai Scout (Free tier)
 */
async function analyzeMultiItemWithTogetherScout(base64Image, mimeType, promptOverride) {
    const result = await callTogetherVision(
        togetherScoutModel,
        base64Image,
        mimeType,
        promptOverride || MULTI_ITEM_VISION_PROMPT
    );
    if (result.success) {
        result.provider = 'together-scout';
    }
    return result;
}

/**
 * Analyze multi-item photo using Together.ai Qwen (Paid tier)
 */
async function analyzeMultiItemWithTogetherQwen(base64Image, mimeType, promptOverride) {
    const result = await callTogetherVision(
        togetherQwenModel,
        base64Image,
        mimeType,
        promptOverride || MULTI_ITEM_VISION_PROMPT
    );
    if (result.success) {
        result.provider = 'together-qwen';
    }
    return result;
}

/**
 * Analyze multi-item photo using Together.ai (defaults to Scout/free tier)
 */
async function analyzeMultiItemWithTogether(base64Image, mimeType) {
    return await analyzeMultiItemWithTogetherScout(base64Image, mimeType);
}

/**
 * Generic helper for Hugging Face Inference API (vision-language chat style)
 * @param {string} modelId - HuggingFace model ID
 * @param {string} imageSource - Base64 string or URL
 * @param {string} mimeType - MIME type of the image
 * @param {string} prompt - Analysis prompt
 * @param {number} maxTokens - Maximum tokens to generate
 */
async function callHuggingFaceVision(modelId, imageSource, mimeType, prompt, maxTokens = 512) {
    if (!huggingFaceToken) {
        throw new Error('Hugging Face token not configured');
    }

    // Convert URL to base64 if needed (HuggingFace typically requires base64)
    let base64Image = imageSource;
    let actualMimeType = mimeType;

    if (isUrl(imageSource)) {
        console.log('[HuggingFace] Converting URL to base64...');
        base64Image = await fetchImageAsBase64(imageSource);
        actualMimeType = mimeType || getMimeTypeFromUrl(imageSource);
    }

    // Use the new Hugging Face Inference Router endpoint
    const response = await fetch(`https://router.huggingface.co/hf-inference/models/${modelId}`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${huggingFaceToken}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            inputs: [
                {
                    role: "user",
                    content: [
                        { type: "text", text: prompt },
                        { type: "image_url", image_url: `data:${actualMimeType};base64,${base64Image}` }
                    ]
                }
            ],
            parameters: {
                max_new_tokens: maxTokens
            }
        })
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Hugging Face API error (${modelId}): ${response.status} ${errorText}`);
    }

    const data = await response.json();

    let text;
    if (Array.isArray(data)) {
        text = data[0]?.generated_text || data[0]?.text;
    } else if (data.generated_text || data.text) {
        text = data.generated_text || data.text;
    }

    if (!text) {
        throw new Error(`Unexpected response from Hugging Face (${modelId})`);
    }

    text = text.trim();
    // Strip code fences if present
    const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    return cleaned;
}

/**
 * Analyze photo using Florence-2 (Hugging Face)
 */
async function analyzeWithFlorence(base64Image, mimeType, prompt = VISION_PROMPT) {
    try {
        const jsonText = await callHuggingFaceVision(florenceModelId, base64Image, mimeType, prompt, 512);
        const result = JSON.parse(jsonText);
        return {
            success: true,
            data: result,
            provider: 'florence',
            model: florenceModelId
        };
    } catch (error) {
        console.error('Florence Vision API error:', error);
        return {
            success: false,
            error: error.message,
            provider: 'florence'
        };
    }
}

/**
 * Analyze photo using Nemotron Vision (Hugging Face)
 */
async function analyzeWithNemotron(base64Image, mimeType, prompt = VISION_PROMPT) {
    try {
        const jsonText = await callHuggingFaceVision(nemotronModelId, base64Image, mimeType, prompt, 512);
        const result = JSON.parse(jsonText);
        return {
            success: true,
            data: result,
            provider: 'nemotron',
            model: nemotronModelId
        };
    } catch (error) {
        console.error('Nemotron Vision API error:', error);
        return {
            success: false,
            error: error.message,
            provider: 'nemotron'
        };
    }
}

/**
 * Analyze photo for multiple items using Claude
 * @param {string} imageSource - Base64 string or URL
 * @param {string} mimeType - MIME type of the image
 */
async function analyzeMultiItemWithClaude(imageSource, mimeType) {
    if (!anthropicClient) {
        throw new Error('Anthropic API key not configured');
    }

    try {
        // Convert URL to base64 if needed
        let base64Image = imageSource;
        let actualMimeType = mimeType;

        if (isUrl(imageSource)) {
            console.log('[Claude Multi-Item] Converting URL to base64...');
            base64Image = await fetchImageAsBase64(imageSource);
            actualMimeType = mimeType || getMimeTypeFromUrl(imageSource);
        }

        const response = await anthropicClient.messages.create({
            model: "claude-sonnet-4-6-latest",
            max_tokens: 2048,
            messages: [{
                role: "user",
                content: [
                    {
                        type: "image",
                        source: {
                            type: "base64",
                            media_type: actualMimeType,
                            data: base64Image
                        }
                    },
                    {
                        type: "text",
                        text: MULTI_ITEM_VISION_PROMPT
                    }
                ]
            }]
        });

        const textContent = response.content[0].text;
        console.log('Claude raw response:', textContent);
        
        // Clean up the response - remove markdown, extra whitespace, etc.
        let jsonText = textContent
            .replace(/```json\n?/g, '')
            .replace(/```\n?/g, '')
            .replace(/^\s+|\s+$/g, '')
            .trim();
        
        // Try to parse JSON
        let result;
        try {
            result = JSON.parse(jsonText);
        } catch (parseError) {
            console.error('Failed to parse Claude response as JSON:', parseError);
            console.error('Cleaned text was:', jsonText);
            throw new Error('AI returned invalid JSON format');
        }

        // Validate required fields
        if (!result.itemCount && !result.items) {
            throw new Error('AI response missing required fields (itemCount or items)');
        }

        // Ensure items array exists and has proper structure
        if (!Array.isArray(result.items)) {
            result.items = [];
        }

        // No silent item cap — keep every detected item (dense rooms exceed 20).

        // Set itemCount if not provided
        if (typeof result.itemCount !== 'number') {
            result.itemCount = result.items.length;
        }

        return {
            success: true,
            data: result,
            provider: 'claude',
            model: 'claude-sonnet-4-6-latest'
        };
    } catch (error) {
        console.error('Claude Multi-Item Vision API error:', error);
        return {
            success: false,
            error: error.message,
            provider: 'claude'
        };
    }
}

/**
 * Analyze photo for multiple items using GPT-4
 * @param {string} imageSource - Base64 string or URL
 * @param {string} mimeType - MIME type of the image
 */
async function analyzeMultiItemWithGPT4(imageSource, mimeType) {
    if (!openaiClient) {
        throw new Error('OpenAI API key not configured');
    }

    try {
        // GPT-4 supports URLs natively - use if available
        let imageUrl;
        if (isUrl(imageSource)) {
            console.log('[GPT-4 Multi-Item] Using URL directly (native support)');
            imageUrl = imageSource;
        } else {
            imageUrl = `data:${mimeType};base64,${imageSource}`;
        }

        const response = await openaiClient.chat.completions.create({
            model: "gpt-4o",
            messages: [{
                role: "user",
                content: [
                    {
                        type: "text",
                        text: MULTI_ITEM_VISION_PROMPT
                    },
                    {
                        type: "image_url",
                        image_url: {
                            url: imageUrl
                        }
                    }
                ]
            }],
            max_tokens: 1500,
            response_format: { type: "json_object" }
        });

        const textContent = response.choices[0].message.content;
        console.log('GPT-4 raw response:', textContent);

        // Try to parse JSON
        let result;
        try {
            result = JSON.parse(textContent);
        } catch (parseError) {
            console.error('Failed to parse GPT-4 response as JSON:', parseError);
            console.error('Response was:', textContent);
            throw new Error('AI returned invalid JSON format');
        }

        // Validate required fields
        if (!result.itemCount && !result.items) {
            throw new Error('AI response missing required fields (itemCount or items)');
        }

        // Ensure items array exists and has proper structure
        if (!Array.isArray(result.items)) {
            result.items = [];
        }

        // No silent item cap — keep every detected item (dense rooms exceed 20).

        // Set itemCount if not provided
        if (typeof result.itemCount !== 'number') {
            result.itemCount = result.items.length;
        }

        return {
            success: true,
            data: result,
            provider: 'gpt4',
            model: 'gpt-4o'
        };
    } catch (error) {
        console.error('GPT-4 Multi-Item Vision API error:', error);
        return {
            success: false,
            error: error.message,
            provider: 'gpt4'
        };
    }
}

/**
 * Analyze photo for multiple items using Gemini
 * @param {string} imageSource - Base64 string or URL
 * @param {string} mimeType - MIME type of the image
 */
async function analyzeMultiItemWithGemini(imageSource, mimeType, modelId = 'gemini-2.5-flash', userId = null) {
    if (!geminiClient) {
        throw new Error('Google AI API key not configured');
    }

    try {
        // Convert URL to base64 if needed
        let base64Image = imageSource;
        let actualMimeType = mimeType;

        if (isUrl(imageSource)) {
            console.log('[Gemini Multi-Item] Converting URL to base64...');
            base64Image = await fetchImageAsBase64(imageSource);
            actualMimeType = mimeType || getMimeTypeFromUrl(imageSource);
        } else if (typeof imageSource === 'string' && imageSource.startsWith('data:')) {
            // Strip data URL prefix — Gemini expects raw base64 only
            const [metadata, data] = imageSource.split(',');
            base64Image = data;
            const match = metadata.match(/^data:(.*?);base64$/);
            if (match) actualMimeType = match[1];
        }

        // Resilience + token metering (timeout / usage). retries:0 — manual retry +
        // flash-fallback layer below handles retries; avoid wrapper retry stacking.
        const model = instrumentVisionModel(geminiClient.getGenerativeModel({
            model: modelId,
            generationConfig: {
                responseMimeType: "application/json",
                responseSchema: photoMultiItemSchema,
                maxOutputTokens: 8192  // Increase token limit to prevent truncation
            }
        }), { userId, modelName: modelId, retries: 0 });

        const contentParts = [
            { inlineData: { data: base64Image, mimeType: actualMimeType } },
            { text: MULTI_ITEM_VISION_PROMPT }
        ];
        let result;
        try {
            result = await model.generateContent(contentParts);
        } catch (apiError) {
            if (modelId !== 'gemini-2.5-flash') {
                // Retry once with same model (transient errors)
                console.warn(`[Gemini Multi-Item] ${modelId} failed, retrying once: ${apiError.message}`);
                try {
                    result = await model.generateContent(contentParts);
                } catch (retryError) {
                    // Fall back to flash
                    console.warn(`[Gemini Multi-Item] ${modelId} retry failed, falling back to flash: ${retryError.message}`);
                    const fallbackModel = instrumentVisionModel(geminiClient.getGenerativeModel({
                        model: 'gemini-2.5-flash',
                        generationConfig: { responseMimeType: "application/json", responseSchema: photoMultiItemSchema, maxOutputTokens: 8192 }
                    }), { userId, modelName: 'gemini-2.5-flash', retries: 0 });
                    try {
                        result = await fallbackModel.generateContent(contentParts);
                    } catch (fallbackError) {
                        console.error('Gemini flash fallback also failed:', fallbackError);
                        throw new Error(`Gemini API error: ${fallbackError.message}`);
                    }
                }
            } else {
                console.error('Gemini API call failed:', apiError);
                throw new Error(`Gemini API error: ${apiError.message}`);
            }
        }

        const jsonText = result.response.text();
        console.log('Gemini raw response:', jsonText);

        // Try to parse JSON, with extraction + jsonrepair fallback. Now that the
        // 20-item cap is gone, a dense room can overflow the 8192-token budget and
        // arrive as truncated-but-recoverable JSON — jsonrepair salvages the items
        // we DID get instead of throwing a zero-item hard failure (regressing the
        // pre-E "returned 20" behavior). jsonrepair is a legacy shim only.
        let data;
        const tryParseJson = (text) => {
            // First try direct parse
            try { return JSON.parse(text); } catch (_) {}
            // Extract outermost {...} block — handles trailing garbage text
            const match = text.match(/\{[\s\S]*\}/);
            if (match) {
                try { return JSON.parse(match[0]); } catch (_) {}
            }
            // Last resort: repair truncated/malformed JSON (partial items > none).
            try { return JSON.parse(jsonrepair(text)); } catch (_) {}
            return null;
        };

        let finalResult = result; // the result whose finishReason we trust for truncation
        data = tryParseJson(jsonText);

        if (!data) {
            // Retry once — corruption appears non-deterministic
            console.warn('[Gemini Multi-Item] Response was unparseable, retrying once...');
            let retryResult;
            try {
                retryResult = await model.generateContent([
                    { inlineData: { data: base64Image, mimeType: actualMimeType } },
                    { text: MULTI_ITEM_VISION_PROMPT }
                ]);
            } catch (retryError) {
                throw new Error(`Gemini API error on retry: ${retryError.message}`);
            }
            finalResult = retryResult;
            const retryText = retryResult.response.text();
            console.log('[Gemini Multi-Item] Retry response:', retryText);
            data = tryParseJson(retryText);
            if (!data) {
                console.error('Failed to parse Gemini response as JSON after retry');
                console.error('Original response:', jsonText);
                console.error('Retry response:', retryText);
                throw new Error('AI returned invalid JSON format');
            }
        }

        // Validate required fields
        if (!data.itemCount && !data.items) {
            throw new Error('AI response missing required fields (itemCount or items)');
        }

        // Ensure items array exists and has proper structure
        if (!Array.isArray(data.items)) {
            data.items = [];
        }

        // No silent item cap: dense rooms legitimately exceed 20. The only way the
        // list is bounded now is a maxOutputTokens cut, which we report explicitly.
        // Check the result we actually parsed (retry, if it ran) — not the original.
        if (wasTruncated(finalResult)) {
            console.warn(`[Gemini Multi-Item] Response hit maxOutputTokens — item list is truncated (${data.items.length} parsed)`);
            data.truncated = true;
        }

        // Set itemCount if not provided
        if (typeof data.itemCount !== 'number') {
            data.itemCount = data.items.length;
        }

        return {
            success: true,
            data: data,
            provider: 'gemini',
            model: modelId
        };
    } catch (error) {
        console.error('Gemini Multi-Item Vision API error:', error);
        return {
            success: false,
            error: error.message,
            provider: 'gemini'
        };
    }
}

/**
 * Analyze multiple photos of the same room holistically using Gemini.
 * Deduplicates items across images and returns sourceImage index for cropping.
 * @param {Array<{base64: string, mimeType: string}>} imageSources
 * @param {string} modelId
 */
async function analyzeMultiImageWithGemini(imageSources, modelId = 'gemini-2.5-flash', userId = null) {
    if (!geminiClient) {
        throw new Error('Google AI API key not configured');
    }

    try {
        // Resilience + token metering (timeout / usage). retries:0 — manual retry +
        // flash-fallback layer below handles retries; avoid wrapper retry stacking.
        const model = instrumentVisionModel(geminiClient.getGenerativeModel({
            model: modelId,
            generationConfig: {
                responseMimeType: "application/json",
                responseSchema: photoMultiImageSchema,
                maxOutputTokens: 8192
            }
        }), { userId, modelName: modelId, retries: 0 });

        // Build parts: label each image then append the prompt
        const parts = [];
        for (let i = 0; i < imageSources.length; i++) {
            let { base64, mimeType } = imageSources[i];
            if (base64.startsWith('data:')) {
                const [metadata, data] = base64.split(',');
                base64 = data;
                const match = metadata.match(/^data:(.*?);base64$/);
                if (match) mimeType = match[1];
            }
            parts.push({ text: `[Image ${i + 1} of ${imageSources.length}]` });
            parts.push({ inlineData: { data: base64, mimeType } });
        }
        parts.push({ text: MULTI_IMAGE_VISION_PROMPT });

        let result;
        try {
            result = await model.generateContent(parts);
        } catch (apiError) {
            if (modelId !== 'gemini-2.5-flash') {
                // Retry once with same model (transient errors)
                console.warn(`[Gemini Multi-Image] ${modelId} failed, retrying once: ${apiError.message}`);
                try {
                    result = await model.generateContent(parts);
                } catch (retryError) {
                    // Fall back to flash
                    console.warn(`[Gemini Multi-Image] ${modelId} retry failed, falling back to flash: ${retryError.message}`);
                    const fallbackModel = instrumentVisionModel(geminiClient.getGenerativeModel({
                        model: 'gemini-2.5-flash',
                        generationConfig: { responseMimeType: "application/json", responseSchema: photoMultiImageSchema, maxOutputTokens: 8192 }
                    }), { userId, modelName: 'gemini-2.5-flash', retries: 0 });
                    try {
                        result = await fallbackModel.generateContent(parts);
                    } catch (fallbackError) {
                        console.error('Gemini flash fallback also failed:', fallbackError);
                        throw new Error(`Gemini API error: ${fallbackError.message}`);
                    }
                }
            } else {
                console.error('Gemini multi-image API call failed:', apiError);
                throw new Error(`Gemini API error: ${apiError.message}`);
            }
        }

        const jsonText = result.response.text();
        console.log('[Gemini Multi-Image] Raw response:', jsonText);

        // JSON parsing with retry — reuse pattern from analyzeMultiItemWithGemini,
        // including the jsonrepair last resort so a truncated dense-room response
        // yields the partial items instead of a zero-item hard failure.
        const tryParseJson = (text) => {
            try { return JSON.parse(text); } catch (_) {}
            const match = text.match(/\{[\s\S]*\}/);
            if (match) {
                try { return JSON.parse(match[0]); } catch (_) {}
            }
            try { return JSON.parse(jsonrepair(text)); } catch (_) {}
            return null;
        };

        let finalResult = result; // trust this result's finishReason for truncation
        let data = tryParseJson(jsonText);

        if (!data) {
            console.warn('[Gemini Multi-Image] Response unparseable, retrying once...');
            let retryResult;
            try {
                retryResult = await model.generateContent(parts);
            } catch (retryError) {
                throw new Error(`Gemini API error on retry: ${retryError.message}`);
            }
            finalResult = retryResult;
            const retryText = retryResult.response.text();
            console.log('[Gemini Multi-Image] Retry response:', retryText);
            data = tryParseJson(retryText);
            if (!data) {
                throw new Error('AI returned invalid JSON format after retry');
            }
        }

        if (!data.itemCount && !data.items) {
            throw new Error('AI response missing required fields (itemCount or items)');
        }
        if (!Array.isArray(data.items)) {
            data.items = [];
        }
        // No silent item cap — report a maxOutputTokens cut (on the result we
        // actually parsed) instead of dropping items.
        if (wasTruncated(finalResult)) {
            console.warn(`[Gemini Multi-Image] Response hit maxOutputTokens — item list is truncated (${data.items.length} parsed)`);
            data.truncated = true;
        }
        if (typeof data.itemCount !== 'number') {
            data.itemCount = data.items.length;
        }

        return {
            success: true,
            data,
            provider: 'gemini',
            model: modelId
        };
    } catch (error) {
        console.error('Gemini Multi-Image Vision API error:', error);
        return {
            success: false,
            error: error.message,
            provider: 'gemini'
        };
    }
}

/**
 * Analyze photo for multiple items using Florence-2
 */
async function analyzeMultiItemWithFlorence(base64Image, mimeType) {
    try {
        const jsonText = await callHuggingFaceVision(florenceModelId, base64Image, mimeType, MULTI_ITEM_VISION_PROMPT, 1024);
        const data = JSON.parse(jsonText);
        return {
            success: true,
            data,
            provider: 'florence',
            model: florenceModelId
        };
    } catch (error) {
        console.error('Florence Multi-Item Vision API error:', error);
        return {
            success: false,
            error: error.message,
            provider: 'florence'
        };
    }
}

/**
 * Analyze photo for multiple items using Nemotron
 */
async function analyzeMultiItemWithNemotron(base64Image, mimeType) {
    try {
        const jsonText = await callHuggingFaceVision(nemotronModelId, base64Image, mimeType, MULTI_ITEM_VISION_PROMPT, 1024);
        const data = JSON.parse(jsonText);
        return {
            success: true,
            data,
            provider: 'nemotron',
            model: nemotronModelId
        };
    } catch (error) {
        console.error('Nemotron Multi-Item Vision API error:', error);
        return {
            success: false,
            error: error.message,
            provider: 'nemotron'
        };
    }
}

/**
 * Main function to analyze photo with current provider
 */
async function analyzeItemPhoto(base64Image, mimeType, provider = null, prompt = VISION_PROMPT, itemHint = null, plan = 'basic', userId = null) {
    const providerToUse = provider || currentProvider;

    // If a specific item name is provided (multi-item add flow), prepend a focus instruction
    const effectivePrompt = itemHint
        ? `This image may show multiple items in a room. Focus specifically on the item named "${itemHint}".\n\n${VISION_PROMPT}`
        : prompt;

    const geminiModel = plan === 'pro' ? 'gemini-2.5-pro' : 'gemini-2.5-flash';

    const dispatch = (p) => {
        switch (p) {
            case 'claude':
                return analyzeWithClaude(base64Image, mimeType, effectivePrompt);
            case 'gpt4':
            case 'openai':
                return analyzeWithGPT4(base64Image, mimeType, effectivePrompt);
            case 'gemini':
            case 'google':
            case 'gemini-pro':
                return analyzeWithGemini(base64Image, mimeType, effectivePrompt, geminiModel, userId);
            case 'together':
            case 'scout':
                return analyzeWithTogetherScout(base64Image, mimeType, prompt);
            case 'qwen':
                return analyzeWithTogetherQwen(base64Image, mimeType, prompt);
            case 'florence':
                return analyzeWithFlorence(base64Image, mimeType, prompt);
            case 'nemotron':
                return analyzeWithNemotron(base64Image, mimeType, prompt);
            default:
                return { success: false, error: `Unknown provider: ${p}` };
        }
    };

    // Try the chosen provider first, then fall back through the plan's chain.
    const order = buildProviderOrder(providerToUse, plan);
    console.log(`Analyzing photo — provider order: ${order.join(' -> ')} (model: ${geminiModel})`, itemHint ? `(hint: ${itemHint})` : '');
    return runWithFailover(order, dispatch);
}

/**
 * Main function to analyze photo for multiple items
 */
async function analyzeMultiItemPhoto(base64Image, mimeType, provider = null, options = {}, plan = 'basic', userId = null) {
    const providerToUse = provider || currentProvider;
    const promptOverride = options.prompt;

    const geminiModel = plan === 'pro' ? 'gemini-2.5-pro' : 'gemini-2.5-flash';

    const dispatch = (p) => {
        switch (p) {
            case 'claude':
                return analyzeMultiItemWithClaude(base64Image, mimeType);
            case 'gpt4':
            case 'openai':
                return analyzeMultiItemWithGPT4(base64Image, mimeType);
            case 'gemini':
            case 'google':
            case 'gemini-3-pro':
                return analyzeMultiItemWithGemini(base64Image, mimeType, geminiModel, userId);
            case 'together':
            case 'scout':
                return analyzeMultiItemWithTogetherScout(base64Image, mimeType, promptOverride);
            case 'qwen':
                return analyzeMultiItemWithTogetherQwen(base64Image, mimeType, promptOverride);
            case 'florence':
                return analyzeMultiItemWithFlorence(base64Image, mimeType);
            case 'nemotron':
                return analyzeMultiItemWithNemotron(base64Image, mimeType);
            default:
                return { success: false, error: `Unknown provider: ${p}` };
        }
    };

    const order = buildProviderOrder(providerToUse, plan);
    console.log(`Analyzing photo for multiple items — provider order: ${order.join(' -> ')} (model: ${geminiModel})`);
    return runWithFailover(order, dispatch);
}

/**
 * Analyze multiple photos of the same room holistically.
 * @param {Array<{base64: string, mimeType: string}>} imageSources
 * @param {string} provider
 */
async function analyzeMultiImagePhoto(imageSources, provider = null, plan = 'basic', userId = null) {
    const providerToUse = provider || currentProvider;
    const geminiModel = plan === 'pro' ? 'gemini-2.5-pro' : 'gemini-2.5-flash';
    console.log(`Analyzing ${imageSources.length} photos holistically with provider: ${providerToUse} (model: ${geminiModel})`);

    switch (providerToUse.toLowerCase()) {
        case 'gemini':
        case 'google':
            return await analyzeMultiImageWithGemini(imageSources, geminiModel, userId);
        default:
            // Fallback: analyze first image only with multi-item
            console.warn(`[Multi-Image] Provider ${providerToUse} does not support multi-image; falling back to first image only`);
            return await analyzeMultiItemPhoto(imageSources[0].base64, imageSources[0].mimeType, providerToUse, {}, plan, userId);
    }
}

/**
 * Set the default vision provider
 */
function setProvider(provider) {
    const validProviders = ['claude', 'gpt4', 'gemini', 'together', 'scout', 'qwen', 'florence', 'nemotron'];
    if (!validProviders.includes(provider.toLowerCase())) {
        throw new Error(`Invalid provider. Valid options: ${validProviders.join(', ')}`);
    }
    currentProvider = provider.toLowerCase();
    console.log(`Vision provider set to: ${currentProvider}`);
    return currentProvider;
}

/**
 * Get current provider
 */
function getCurrentProvider() {
    return currentProvider;
}

/**
 * Get available providers (based on configured API keys)
 */
function getAvailableProviders() {
    const available = [];
    if (anthropicClient) available.push('claude');
    if (openaiClient) available.push('gpt4');
    if (geminiClient) available.push('gemini');
    if (togetherApiKey) {
        available.push('scout');    // Free tier (Llama Scout)
        available.push('qwen');     // Paid tier (Qwen Vision)
    }
    // Note: HuggingFace providers (florence, nemotron) are not included
    // as they require paid Inference Endpoints, not available on free tier
    return available;
}

// ── Route helpers ─────────────────────────────────────────────────────────────

const ADMIN_USERS_ENV = () =>
    (process.env.ADMIN_USERS || '').toLowerCase().split(',').map(e => e.trim()).filter(Boolean);

/**
 * Resolve the vision provider to use for a request, based on plan + admin status.
 *
 * @param {{ plan: string, isAdmin: boolean, requestedProvider?: string }} opts
 * @returns {string} provider key
 */
function resolveProvider({ plan, isAdmin, requestedProvider = '' }) {
    const requested = requestedProvider.toLowerCase();
    if (isAdmin) return requested || currentProvider;
    if (plan === 'pro') return 'gemini-pro';
    return 'gemini';
}

/**
 * Resolve the multi-item provider (pro plan uses a higher-capacity model key).
 */
function resolveMultiProvider({ plan, isAdmin, requestedProvider = '' }) {
    const requested = requestedProvider.toLowerCase();
    if (isAdmin) return requested || currentProvider;
    if (plan === 'pro') return 'gemini-3-pro';
    return 'gemini';
}

/**
 * Resolve whether the request is from an admin user.
 * @param {import('express').Request} req
 */
function isAdminUser(req) {
    return !!(req.user?.is_admin || ADMIN_USERS_ENV().includes(req.user?.email?.toLowerCase()));
}

/**
 * Normalize a vision result data payload: ensures `primary_color`, `material`, and `tags`
 * are always present.
 * @param {object} data
 * @returns {object}
 */
function normalizeItemResult(data) {
    if (!data) return data;
    if (data.color && !data.primary_color) data.primary_color = data.color;
    data.material = data.material || null;
    data.primary_color = data.primary_color || null;
    data.tags = data.tags || [];
    return data;
}

module.exports = {
    analyzeItemPhoto,
    analyzeMultiItemPhoto,
    analyzeMultiImagePhoto,
    refineDetectionsWithSAM,
    setProvider,
    getCurrentProvider,
    getAvailableProviders,
    resolveProvider,
    resolveMultiProvider,
    isAdminUser,
    normalizeItemResult,
    fetchImageAsBase64,
    getMimeTypeFromUrl,
    VISION_PROMPT,
    MULTI_ITEM_VISION_PROMPT,
};
async function refineDetectionsWithSAM(imageInput, detections = []) {
    if (!hfInference) {
        throw new Error('Hugging Face SAM not configured');
    }
    if (!Array.isArray(detections) || detections.length === 0) {
        return detections;
    }
    const { buffer } = parseBase64Image(imageInput);
    const segmentation = await hfInference.imageSegmentation({
        model: samModelId,
        data: buffer
    });
    if (!Array.isArray(segmentation) || segmentation.length === 0) {
        return detections;
    }
    const maskBoxes = [];
    for (const entry of segmentation) {
        if (!entry?.mask) continue;
        const bbox = await maskToBoundingBox(entry.mask);
        if (bbox) {
            maskBoxes.push({
                bbox,
                score: entry.score || 0
            });
        }
    }
    if (!maskBoxes.length) {
        return detections;
    }
    return detections.map((det) => {
        if (!det?.boundingBox) return det;
        const best = maskBoxes
            .map((mask) => ({
                mask,
                iou: computeBoxIoU(det.boundingBox, mask.bbox)
            }))
            .sort((a, b) => b.iou - a.iou)[0];
        if (!best || best.iou <= 0) {
            return det;
        }
        return {
            ...det,
            boundingBox: best.mask.bbox,
            refined: true,
            samScore: best.mask.score
        };
    });
}

async function maskToBoundingBox(maskDataUrl) {
    if (!maskDataUrl || typeof maskDataUrl !== 'string') return null;
    const base64 = maskDataUrl.replace(/^data:image\/\w+;base64,/, '');
    const buffer = Buffer.from(base64, 'base64');
    const image = sharp(buffer);
    const metadata = await image.metadata();
    const { width, height } = metadata;
    if (!width || !height) return null;
    const raw = await image.ensureAlpha().raw().toBuffer();
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const idx = (y * width + x) * 4 + 3;
            if (raw[idx] > 10) {
                if (x < minX) minX = x;
                if (y < minY) minY = y;
                if (x > maxX) maxX = x;
                if (y > maxY) maxY = y;
            }
        }
    }
    if (maxX === -1 || maxY === -1) {
        return null;
    }
    return {
        x: clamp01(minX / width),
        y: clamp01(minY / height),
        width: clamp01((maxX - minX + 1) / width),
        height: clamp01((maxY - minY + 1) / height)
    };
}

function computeBoxIoU(a, b) {
    if (!a || !b) return 0;
    const ax1 = a.x ?? 0;
    const ay1 = a.y ?? 0;
    const ax2 = ax1 + (a.width ?? 0);
    const ay2 = ay1 + (a.height ?? 0);
    const bx1 = b.x ?? 0;
    const by1 = b.y ?? 0;
    const bx2 = bx1 + (b.width ?? 0);
    const by2 = by1 + (b.height ?? 0);
    const interWidth = Math.max(0, Math.min(ax2, bx2) - Math.max(ax1, bx1));
    const interHeight = Math.max(0, Math.min(ay2, by2) - Math.max(ay1, by1));
    const intersection = interWidth * interHeight;
    const union =
        (a.width ?? 0) * (a.height ?? 0) +
        (b.width ?? 0) * (b.height ?? 0) -
        intersection;
    if (union <= 0) return 0;
    return intersection / union;
}

function clamp01(value) {
    if (typeof value !== 'number' || Number.isNaN(value)) return 0;
    if (value < 0) return 0;
    if (value > 1) return 1;
    return value;
}
