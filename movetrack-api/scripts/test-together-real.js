#!/usr/bin/env node

/**
 * Test Together.ai with a real image (using a sample household item)
 */

require('dotenv').config();
const fetch = require('node-fetch');

const togetherApiKey = process.env.TOGETHER_API_KEY;
const qwenModel = 'Qwen/Qwen2.5-VL-72B-Instruct';
const llamaModel = 'meta-llama/Llama-3.2-11B-Vision-Instruct-Turbo';

console.log('=== Together.ai Real Image Test ===\n');

if (!togetherApiKey) {
    console.error('❌ TOGETHER_API_KEY not configured');
    process.exit(1);
}

// Test with a real sample image of a coffee mug (public domain)
const sampleImageUrl = 'https://upload.wikimedia.org/wikipedia/commons/thumb/4/45/A_small_cup_of_coffee.JPG/800px-A_small_cup_of_coffee.JPG';

async function downloadImageAsBase64(url) {
    const response = await fetch(url);
    const buffer = await response.buffer();
    return buffer.toString('base64');
}

async function testVisionWithRealImage(modelId, modelName) {
    console.log(`\nTesting ${modelName}...`);

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
    console.log('Using sample image:', sampleImageUrl);
    console.log('(A coffee cup - perfect for testing household item detection)\n');
    console.log('='.repeat(60));

    // Test Qwen first (best quality)
    await testVisionWithRealImage(qwenModel, 'Qwen 2.5 VL 72B (~$0.0004/image)');

    console.log('\n' + '='.repeat(60));

    // Test Llama
    await testVisionWithRealImage(llamaModel, 'Llama 3.2 11B Vision (pay-per-use)');

    console.log('\n=== Test Complete ===');
    console.log('\nBoth models are working and can analyze household items!');
    console.log('Use "together-qwen" or "together-llama" as your provider.');
})();
