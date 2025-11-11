const Anthropic = require('@anthropic-ai/sdk');
const OpenAI = require('openai');
const { GoogleGenerativeAI } = require('@google/generative-ai');

// Initialize clients
let anthropicClient = null;
let openaiClient = null;
let geminiClient = null;

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

// Default provider (can be changed via admin settings)
let currentProvider = process.env.VISION_PROVIDER || 'gemini';

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
- Confidence should reflect how certain you are about the analysis (0.0 = very uncertain, 1.0 = very certain)
- For fragile, consider if the item is breakable or requires careful handling

Return ONLY the JSON object, nothing else.`;

/**
 * Prompt for multi-item detection
 */
const MULTI_ITEM_VISION_PROMPT = `Analyze this photo for moving inventory. Identify the TOP 20 MOST PROMINENT household items visible in the image.

If there are multiple items of the same type (e.g., books, plates, cups), GROUP THEM TOGETHER as a single entry like "Books (approximately X items)" or "Decorative vases (3 items)".

Return ONLY valid JSON with this exact structure (no markdown, no additional text):

{
  "itemCount": 0,
  "items": [
    {
      "id": 1,
      "name": "brief item name or grouped description",
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
- MAXIMUM 20 items in the items array
- itemCount should match the number of items in the array (max 20)
- boundingBox coordinates are normalized (0.0 to 1.0 range) where:
  - x, y represent the top-left corner (as fraction of image width/height)
  - width, height represent the box size (as fraction of image width/height)
- For grouped items, use the bounding box that encompasses the entire group
- Prioritize larger, more prominent items over small details
- Group similar items together (e.g., "Collection of books (50+ items)" instead of listing each book)
- Confidence should reflect certainty about each item (0.0 = very uncertain, 1.0 = very certain)

Return ONLY the JSON object, nothing else.`;

/**
 * Analyze photo using Claude 3.5 Sonnet Vision
 */
async function analyzeWithClaude(base64Image, mimeType) {
    if (!anthropicClient) {
        throw new Error('Anthropic API key not configured');
    }

    try {
        const response = await anthropicClient.messages.create({
            model: "claude-3-5-sonnet-20241022",
            max_tokens: 1024,
            messages: [{
                role: "user",
                content: [
                    {
                        type: "image",
                        source: {
                            type: "base64",
                            media_type: mimeType,
                            data: base64Image
                        }
                    },
                    {
                        type: "text",
                        text: VISION_PROMPT
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
            model: 'claude-3-5-sonnet-20241022'
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
 */
async function analyzeWithGPT4(base64Image, mimeType) {
    if (!openaiClient) {
        throw new Error('OpenAI API key not configured');
    }

    try {
        const response = await openaiClient.chat.completions.create({
            model: "gpt-4o",
            messages: [{
                role: "user",
                content: [
                    {
                        type: "text",
                        text: VISION_PROMPT
                    },
                    {
                        type: "image_url",
                        image_url: {
                            url: `data:${mimeType};base64,${base64Image}`
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
 */
async function analyzeWithGemini(base64Image, mimeType) {
    if (!geminiClient) {
        throw new Error('Google AI API key not configured');
    }

    try {
        const model = geminiClient.getGenerativeModel({
            model: "gemini-2.0-flash-exp",
            generationConfig: {
                responseMimeType: "application/json"
            }
        });

        const result = await model.generateContent([
            {
                inlineData: {
                    data: base64Image,
                    mimeType: mimeType
                }
            },
            {
                text: VISION_PROMPT
            }
        ]);

        const jsonText = result.response.text();
        const data = JSON.parse(jsonText);

        return {
            success: true,
            data: data,
            provider: 'gemini',
            model: 'gemini-2.0-flash-exp'
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
 * Analyze photo for multiple items using Claude
 */
async function analyzeMultiItemWithClaude(base64Image, mimeType) {
    if (!anthropicClient) {
        throw new Error('Anthropic API key not configured');
    }

    try {
        const response = await anthropicClient.messages.create({
            model: "claude-3-5-sonnet-20241022",
            max_tokens: 2048,
            messages: [{
                role: "user",
                content: [
                    {
                        type: "image",
                        source: {
                            type: "base64",
                            media_type: mimeType,
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

        // Enforce 20 item limit
        if (result.items.length > 20) {
            console.log(`Claude returned ${result.items.length} items, truncating to 20`);
            result.items = result.items.slice(0, 20);
        }

        // Set itemCount if not provided
        if (typeof result.itemCount !== 'number') {
            result.itemCount = result.items.length;
        }

        return {
            success: true,
            data: result,
            provider: 'claude',
            model: 'claude-3-5-sonnet-20241022'
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
 */
async function analyzeMultiItemWithGPT4(base64Image, mimeType) {
    if (!openaiClient) {
        throw new Error('OpenAI API key not configured');
    }

    try {
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
                            url: `data:${mimeType};base64,${base64Image}`
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

        // Enforce 20 item limit
        if (result.items.length > 20) {
            console.log(`GPT-4 returned ${result.items.length} items, truncating to 20`);
            result.items = result.items.slice(0, 20);
        }

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
 */
async function analyzeMultiItemWithGemini(base64Image, mimeType) {
    if (!geminiClient) {
        throw new Error('Google AI API key not configured');
    }

    try {
        const model = geminiClient.getGenerativeModel({
            model: "gemini-2.0-flash-exp",
            generationConfig: {
                responseMimeType: "application/json",
                maxOutputTokens: 8192  // Increase token limit to prevent truncation
            }
        });

        let result;
        try {
            result = await model.generateContent([
                {
                    inlineData: {
                        data: base64Image,
                        mimeType: mimeType
                    }
                },
                {
                    text: MULTI_ITEM_VISION_PROMPT
                }
            ]);
        } catch (apiError) {
            console.error('Gemini API call failed:', apiError);
            throw new Error(`Gemini API error: ${apiError.message}`);
        }

        const jsonText = result.response.text();
        console.log('Gemini raw response:', jsonText);

        // Try to parse JSON
        let data;
        try {
            data = JSON.parse(jsonText);
        } catch (parseError) {
            console.error('Failed to parse Gemini response as JSON:', parseError);
            console.error('Response was:', jsonText);
            throw new Error('AI returned invalid JSON format');
        }

        // Validate required fields
        if (!data.itemCount && !data.items) {
            throw new Error('AI response missing required fields (itemCount or items)');
        }

        // Ensure items array exists and has proper structure
        if (!Array.isArray(data.items)) {
            data.items = [];
        }

        // Enforce 20 item limit
        if (data.items.length > 20) {
            console.log(`Gemini returned ${data.items.length} items, truncating to 20`);
            data.items = data.items.slice(0, 20);
        }

        // Set itemCount if not provided
        if (typeof data.itemCount !== 'number') {
            data.itemCount = data.items.length;
        }

        return {
            success: true,
            data: data,
            provider: 'gemini',
            model: 'gemini-2.0-flash-exp'
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
 * Main function to analyze photo with current provider
 */
async function analyzeItemPhoto(base64Image, mimeType, provider = null) {
    const providerToUse = provider || currentProvider;

    console.log(`Analyzing photo with provider: ${providerToUse}`);

    switch (providerToUse.toLowerCase()) {
        case 'claude':
            return await analyzeWithClaude(base64Image, mimeType);
        case 'gpt4':
        case 'openai':
            return await analyzeWithGPT4(base64Image, mimeType);
        case 'gemini':
        case 'google':
            return await analyzeWithGemini(base64Image, mimeType);
        default:
            return {
                success: false,
                error: `Unknown provider: ${providerToUse}. Valid options: claude, gpt4, gemini`
            };
    }
}

/**
 * Main function to analyze photo for multiple items
 */
async function analyzeMultiItemPhoto(base64Image, mimeType, provider = null) {
    const providerToUse = provider || currentProvider;

    console.log(`Analyzing photo for multiple items with provider: ${providerToUse}`);

    switch (providerToUse.toLowerCase()) {
        case 'claude':
            return await analyzeMultiItemWithClaude(base64Image, mimeType);
        case 'gpt4':
        case 'openai':
            return await analyzeMultiItemWithGPT4(base64Image, mimeType);
        case 'gemini':
        case 'google':
            return await analyzeMultiItemWithGemini(base64Image, mimeType);
        default:
            return {
                success: false,
                error: `Unknown provider: ${providerToUse}. Valid options: claude, gpt4, gemini`
            };
    }
}

/**
 * Set the default vision provider
 */
function setProvider(provider) {
    const validProviders = ['claude', 'gpt4', 'gemini'];
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
    return available;
}

module.exports = {
    analyzeItemPhoto,
    analyzeMultiItemPhoto,
    setProvider,
    getCurrentProvider,
    getAvailableProviders
};
