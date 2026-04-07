#!/usr/bin/env node

/**
 * Model Connection Service
 *
 * Tests connectivity and availability of all configured vision AI providers.
 * Consolidates individual provider tests into a single runnable service.
 *
 * Usage:
 *   node services/infra/modelConnectionService.js           # test all providers
 *   node services/infra/modelConnectionService.js huggingface  # test specific provider
 *   node services/infra/modelConnectionService.js together
 *   node services/infra/modelConnectionService.js scout
 */

require('dotenv').config();
const fetch = require('node-fetch');

// 1x1 red pixel PNG for lightweight provider checks
const TEST_IMAGE_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==';

// ── Provider configs ────────────────────────────────────────────────────────────

const providers = {
  huggingface: {
    name: 'HuggingFace',
    keyEnv: ['HUGGINGFACE_API_TOKEN', 'HUGGING_FACE_API_TOKEN'],
    models: () => ({
      florence: process.env.HUGGINGFACE_FLORENCE_MODEL || 'microsoft/Florence-2-base',
      nemotron: process.env.HUGGINGFACE_NEMOTRON_MODEL || 'nvidia/Nemotron-4-140B-Vision-Instruction',
    }),
    async testConnection(apiKey, models) {
      const res = await fetch(`https://huggingface.co/api/models/${models.florence}`, {
        headers: { 'Authorization': `Bearer ${apiKey}` }
      });
      if (res.status === 401) return { ok: false, error: 'Invalid API token' };
      if (res.status === 404) return { ok: false, error: `Model not found: ${models.florence}` };
      if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
      return { ok: true };
    },
    async testInference(apiKey, models) {
      const res = await fetch(`https://router.huggingface.co/hf-inference/models/${models.florence}`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          inputs: [{ role: 'user', content: [
            { type: 'text', text: 'Describe this image in one word.' },
            { type: 'image_url', image_url: `data:image/png;base64,${TEST_IMAGE_BASE64}` }
          ]}],
          parameters: { max_new_tokens: 50 }
        })
      });
      if (res.status === 503) return { ok: true, warning: 'Model loading (normal for cold start)' };
      if (!res.ok) return { ok: false, error: `Inference failed: HTTP ${res.status}` };
      return { ok: true };
    }
  },

  together: {
    name: 'Together.ai',
    keyEnv: ['TOGETHER_API_KEY'],
    models: () => ({
      llama: process.env.TOGETHER_LLAMA_MODEL || 'meta-llama/Llama-Vision-Free',
      qwen: process.env.TOGETHER_QWEN_MODEL || 'Qwen/Qwen2.5-VL-72B-Instruct',
    }),
    async testConnection(apiKey) {
      const res = await fetch('https://api.together.xyz/v1/models', {
        headers: { 'Authorization': `Bearer ${apiKey}` }
      });
      if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
      const models = await res.json();
      const visionModels = models.filter(m => m.id.includes('Vision') || m.id.includes('VL') || m.id.includes('Llama-3.2'));
      return { ok: true, info: `${models.length} models total, ${visionModels.length} vision` };
    },
    async testInference(apiKey, models) {
      return testTogetherModel(apiKey, models.llama, 'Llama Vision');
    }
  },

  scout: {
    name: 'Together.ai (Llama 4 Scout)',
    keyEnv: ['TOGETHER_API_KEY'],
    models: () => ({
      scout: process.env.TOGETHER_SCOUT_MODEL || 'meta-llama/Llama-4-Scout-17B-16E-Instruct',
    }),
    async testConnection(apiKey) {
      // Shares key with together
      return { ok: true, info: 'Uses Together.ai API key' };
    },
    async testInference(apiKey, models) {
      return testTogetherModel(apiKey, models.scout, 'Llama 4 Scout');
    }
  }
};

// ── Shared helpers ──────────────────────────────────────────────────────────────

async function testTogetherModel(apiKey, modelId, modelName) {
  const res = await fetch('https://api.together.xyz/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: modelId,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: 'Describe this image in one word.' },
          { type: 'image_url', image_url: { url: `data:image/png;base64,${TEST_IMAGE_BASE64}` } }
        ]
      }],
      max_tokens: 50,
      temperature: 0.7
    })
  });
  if (!res.ok) {
    const errorText = await res.text();
    return { ok: false, error: `${modelName} failed (${res.status}): ${errorText.substring(0, 200)}` };
  }
  const result = await res.json();
  return { ok: true, response: result.choices[0]?.message?.content, usage: result.usage };
}

function resolveApiKey(envNames) {
  for (const name of envNames) {
    if (process.env[name]) return { key: process.env[name], envName: name };
  }
  return null;
}

// ── Runner ──────────────────────────────────────────────────────────────────────

async function testProvider(providerId) {
  const provider = providers[providerId];
  if (!provider) {
    console.log(`Unknown provider: ${providerId}`);
    return { provider: providerId, ok: false, error: 'Unknown provider' };
  }

  console.log(`\n=== ${provider.name} ===`);

  const auth = resolveApiKey(provider.keyEnv);
  if (!auth) {
    console.log(`  SKIP - No API key (set ${provider.keyEnv.join(' or ')})`);
    return { provider: providerId, ok: false, error: 'No API key' };
  }
  console.log(`  Key: ${auth.envName} = ${auth.key.substring(0, 10)}...`);

  const models = provider.models();
  console.log(`  Models: ${JSON.stringify(models)}`);

  // Connection test
  const conn = await provider.testConnection(auth.key, models);
  if (!conn.ok) {
    console.log(`  Connection: FAIL - ${conn.error}`);
    return { provider: providerId, ok: false, error: conn.error };
  }
  console.log(`  Connection: OK${conn.info ? ` (${conn.info})` : ''}`);

  // Inference test
  const infer = await provider.testInference(auth.key, models);
  if (!infer.ok) {
    console.log(`  Inference: FAIL - ${infer.error}`);
    return { provider: providerId, ok: false, error: infer.error };
  }
  console.log(`  Inference: OK${infer.warning ? ` (${infer.warning})` : ''}`);
  if (infer.response) console.log(`  Response: ${infer.response}`);

  return { provider: providerId, ok: true };
}

async function testAll(filter) {
  const ids = filter ? [filter] : Object.keys(providers);
  console.log('Model Connection Test');
  console.log(`Testing: ${ids.join(', ')}`);

  const results = [];
  for (const id of ids) {
    try {
      results.push(await testProvider(id));
    } catch (err) {
      console.log(`  ERROR: ${err.message}`);
      results.push({ provider: id, ok: false, error: err.message });
    }
  }

  console.log('\n=== Summary ===');
  for (const r of results) {
    console.log(`  ${r.ok ? 'PASS' : 'FAIL'} ${r.provider}${r.error ? ` - ${r.error}` : ''}`);
  }

  return results;
}

// ── Exports & CLI ───────────────────────────────────────────────────────────────

module.exports = { testAll, testProvider, providers };

if (require.main === module) {
  const filter = process.argv[2] || null;
  testAll(filter).then(() => process.exit(0)).catch(err => {
    console.error(err);
    process.exit(1);
  });
}
