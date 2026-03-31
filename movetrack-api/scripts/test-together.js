#!/usr/bin/env node

/**
 * Test script for Together.ai Vision API integration
 *
 * This script tests the Together.ai API connection and vision model availability
 * Run with: node test-together.js
 */

require('dotenv').config();
const fetch = require('node-fetch');

const togetherApiKey = process.env.TOGETHER_API_KEY;
const llamaModel = process.env.TOGETHER_LLAMA_MODEL || 'meta-llama/Llama-Vision-Free';
const qwenModel = process.env.TOGETHER_QWEN_MODEL || 'Qwen/Qwen2.5-VL-72B-Instruct';

console.log('=== Together.ai Vision API Test ===\n');

// Check if token is configured
if (!togetherApiKey) {
    console.error('❌ TOGETHER_API_KEY not found in environment variables');
    console.log('\nPlease set TOGETHER_API_KEY in your .env file');
    console.log('Get your key at: https://api.together.xyz/settings/api-keys');
    process.exit(1);
}

console.log('✓ API Key configured:', togetherApiKey.substring(0, 10) + '...');
console.log('✓ Llama Vision model:', llamaModel);
console.log('✓ Qwen Vision model:', qwenModel);
console.log('');

// Test Together.ai API with vision request
async function testTogetherVision(modelId, modelName) {
    console.log(`\nTesting ${modelName}...`);
    console.log('(This may take a moment if the model needs to load)');

    // Create a simple 1x1 red pixel PNG as base64
    const testImageBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==';

    try {
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
                                text: "Describe this image in one word."
                            },
                            {
                                type: "image_url",
                                image_url: {
                                    url: `data:image/png;base64,${testImageBase64}`
                                }
                            }
                        ]
                    }
                ],
                max_tokens: 50,
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
        console.log('Model response:', result.choices[0].message.content);
        console.log('Usage:', JSON.stringify(result.usage, null, 2));
        return true;

    } catch (error) {
        console.error('❌ Inference error:', error.message);
        return false;
    }
}

// Test listing available models
async function testListModels() {
    console.log('\nTesting model listing API...');

    try {
        const response = await fetch('https://api.together.xyz/v1/models', {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${togetherApiKey}`
            }
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error(`❌ Model listing failed (${response.status}):`, errorText);
            return false;
        }

        const models = await response.json();
        const visionModels = models.filter(m =>
            m.id.includes('Vision') ||
            m.id.includes('VL') ||
            m.id.includes('Llama-3.2')
        );

        console.log(`✓ Found ${models.length} total models`);
        console.log(`✓ Found ${visionModels.length} vision models:`);
        visionModels.forEach(m => {
            console.log(`  - ${m.id}`);
        });

        return true;

    } catch (error) {
        console.error('❌ Model listing error:', error.message);
        return false;
    }
}

// Run tests
(async () => {
    const listTest = await testListModels();

    if (listTest) {
        console.log('\n' + '='.repeat(50));
        await testTogetherVision(llamaModel, 'Llama Vision (FREE)');

        console.log('\n' + '='.repeat(50));
        await testTogetherVision(qwenModel, 'Qwen Vision');
    }

    console.log('\n=== Test Complete ===');
    console.log('\nIf all tests passed, Together.ai is configured correctly!');
    console.log('You can now use "together-llama" or "together-qwen" as vision providers in the app.');
    console.log('\nCost comparison:');
    console.log('  - together-llama: FREE (Llama-Vision-Free)');
    console.log('  - together-qwen: ~$0.0003-0.0005 per image');
    console.log('  - gemini/gpt4/claude: ~$0.01-0.015 per image');
})();
