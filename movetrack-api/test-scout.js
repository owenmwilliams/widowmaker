#!/usr/bin/env node

/**
 * Test Together.ai Llama 4 Scout with a real image
 */

require('dotenv').config();
const fetch = require('node-fetch');

const togetherApiKey = process.env.TOGETHER_API_KEY;
const scoutModel = process.env.TOGETHER_SCOUT_MODEL || 'meta-llama/Llama-4-Scout-17B-16E-Instruct';

console.log('=== Together.ai Llama 4 Scout Test ===\n');

if (!togetherApiKey) {
    console.error('❌ TOGETHER_API_KEY not configured');
    process.exit(1);
}

console.log('✓ API Key configured');
console.log('✓ Scout model:', scoutModel);
console.log('');

// Test with a real sample image of a coffee mug
const sampleImageUrl = 'https://upload.wikimedia.org/wikipedia/commons/thumb/4/45/A_small_cup_of_coffee.JPG/800px-A_small_cup_of_coffee.JPG';

async function downloadImageAsBase64(url) {
    const response = await fetch(url);
    const buffer = await response.buffer();
    return buffer.toString('base64');
}

async function testScoutVision() {
    console.log('Testing Llama 4 Scout (FREE tier)...');
    console.log('Using sample image:', sampleImageUrl);
    console.log('');

    try {
        // Download image
        console.log('Downloading sample image...');
        const base64Image = await downloadImageAsBase64(sampleImageUrl);
        console.log(`✓ Image downloaded (${Math.round(base64Image.length / 1024)}KB)`);

        const prompt = `Analyze this household item for moving inventory. You must return ONLY valid JSON with this exact structure (no markdown, no additional text):

{
  "name": "item name",
  "material": "primary material",
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
  "reasoning": "brief explanation"
}`;

        console.log('Sending to Together.ai API...');
        const response = await fetch('https://api.together.xyz/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${togetherApiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: scoutModel,
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
                                    url: `data:image/jpeg;base64,${base64Image}`
                                }
                            }
                        ]
                    }
                ],
                max_tokens: 1024,
                temperature: 0.7
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error(`❌ API request failed (${response.status}):`, errorText);
            return false;
        }

        const result = await response.json();
        console.log('✓ Vision inference successful!');
        console.log('\nModel response:');
        console.log(result.choices[0].message.content);
        console.log('\nUsage:');
        console.log(`  Prompt tokens: ${result.usage.prompt_tokens}`);
        console.log(`  Completion tokens: ${result.usage.completion_tokens}`);
        console.log(`  Total tokens: ${result.usage.total_tokens}`);

        // Try to parse JSON
        try {
            const jsonText = result.choices[0].message.content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
            const parsed = JSON.parse(jsonText);
            console.log('\n✓ JSON parsed successfully:');
            console.log(JSON.stringify(parsed, null, 2));
        } catch (e) {
            console.log('\n⚠️  Could not parse as JSON:', e.message);
        }

        return true;

    } catch (error) {
        console.error('❌ Error:', error.message);
        return false;
    }
}

// Run test
(async () => {
    await testScoutVision();

    console.log('\n=== Test Complete ===');
    console.log('\nLlama 4 Scout is a FREE tier multimodal model!');
    console.log('- 17B active parameters (109B total with MoE)');
    console.log('- State-of-the-art for its size');
    console.log('- Supports text + image input');
    console.log('- 327K context (expandable to 10M)');
    console.log('\nUse "scout" or "together" as your provider for free tier.');
    console.log('Use "qwen" for higher accuracy (paid tier).');
})();
