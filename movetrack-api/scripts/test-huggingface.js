#!/usr/bin/env node

/**
 * Test script for HuggingFace Vision API integration
 *
 * This script tests the HuggingFace API connection and model availability
 * Run with: node test-huggingface.js
 */

require('dotenv').config();
const fetch = require('node-fetch');

const huggingFaceToken = process.env.HUGGINGFACE_API_TOKEN || process.env.HUGGING_FACE_API_TOKEN;
const florenceModelId = process.env.HUGGINGFACE_FLORENCE_MODEL || 'microsoft/Florence-2-base';
const nemotronModelId = process.env.HUGGINGFACE_NEMOTRON_MODEL || 'nvidia/Nemotron-4-140B-Vision-Instruction';

console.log('=== HuggingFace Vision API Test ===\n');

// Check if token is configured
if (!huggingFaceToken) {
    console.error('❌ HUGGINGFACE_API_TOKEN not found in environment variables');
    console.log('\nPlease set one of:');
    console.log('  - HUGGINGFACE_API_TOKEN');
    console.log('  - HUGGING_FACE_API_TOKEN');
    console.log('\nIn your .env file');
    process.exit(1);
}

console.log('✓ Token configured:', huggingFaceToken.substring(0, 10) + '...');
console.log('✓ Florence model:', florenceModelId);
console.log('✓ Nemotron model:', nemotronModelId);
console.log('');

// Test a simple HuggingFace API call (check if token is valid)
async function testHuggingFaceAPI() {
    console.log('Testing HuggingFace API connection...');

    try {
        // Test with a simple model info request (using new endpoint)
        const response = await fetch(`https://huggingface.co/api/models/${florenceModelId}`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${huggingFaceToken}`
            }
        });

        if (response.status === 401) {
            console.error('❌ API Token is invalid or unauthorized');
            console.log('Response:', await response.text());
            return false;
        }

        if (response.status === 404) {
            console.error(`❌ Model not found: ${florenceModelId}`);
            return false;
        }

        if (response.ok) {
            console.log('✓ API connection successful');
            const data = await response.json();
            console.log('✓ Model info retrieved:', data.modelId || florenceModelId);
            return true;
        } else {
            console.error(`❌ Unexpected response: ${response.status}`);
            console.log('Response:', await response.text());
            return false;
        }
    } catch (error) {
        console.error('❌ Network error:', error.message);
        return false;
    }
}

// Test with a simple vision request using a placeholder
async function testVisionInference() {
    console.log('\nTesting vision inference capabilities...');
    console.log('(This may take a moment if the model needs to load)');

    // Create a simple 1x1 red pixel PNG as base64
    const testImageBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==';

    try {
        const response = await fetch(`https://router.huggingface.co/hf-inference/models/${florenceModelId}`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${huggingFaceToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                inputs: [
                    {
                        role: "user",
                        content: [
                            { type: "text", text: "Describe this image in one word." },
                            { type: "image_url", image_url: `data:image/png;base64,${testImageBase64}` }
                        ]
                    }
                ],
                parameters: {
                    max_new_tokens: 50
                }
            })
        });

        if (response.status === 503) {
            console.log('⚠️  Model is loading... This is normal for the first request');
            const data = await response.json();
            console.log('Estimated wait time:', data.estimated_time || 'unknown');
            console.log('\nThe model will be available shortly. Try again in a minute.');
            return true; // This is not an error, just a loading state
        }

        if (!response.ok) {
            console.error(`❌ Inference failed: ${response.status}`);
            const errorText = await response.text();
            console.log('Error details:', errorText);
            return false;
        }

        const result = await response.json();
        console.log('✓ Vision inference successful!');
        console.log('Response sample:', JSON.stringify(result).substring(0, 200) + '...');
        return true;

    } catch (error) {
        console.error('❌ Inference error:', error.message);
        return false;
    }
}

// Run tests
(async () => {
    const apiTest = await testHuggingFaceAPI();

    if (apiTest) {
        await testVisionInference();
    }

    console.log('\n=== Test Complete ===');
    console.log('\nIf all tests passed, HuggingFace is configured correctly!');
    console.log('You can now use "florence" or "nemotron" as vision providers in the app.');
})();
