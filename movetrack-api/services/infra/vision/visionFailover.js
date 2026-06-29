'use strict';

/**
 * services/infra/vision/visionFailover.js
 *
 * Provider failover for vision analysis (WS2). Previously a single provider was
 * called and a provider outage failed the whole request. This tries providers in
 * order and returns the first success. A provider "fails" if it throws OR returns
 * a falsy / { success: false } result.
 *
 * Fallback chains are plan-aware so a basic-plan request never falls back to a
 * pro-only provider.
 */

const FALLBACK_CHAINS = {
  basic: ['gemini', 'scout', 'qwen'],
  pro: ['gemini', 'claude', 'gpt4'],
};

// Map provider aliases to a canonical key for de-duplication.
function normalize(provider) {
  const p = String(provider || '').toLowerCase();
  if (['google', 'gemini-pro', 'gemini-3-pro'].includes(p)) return 'gemini';
  if (p === 'openai') return 'gpt4';
  if (p === 'together') return 'scout';
  return p;
}

/**
 * Ordered provider list: the requested provider first, then the plan's fallback
 * chain, de-duplicated.
 */
function buildProviderOrder(requested, plan) {
  const chain = FALLBACK_CHAINS[plan === 'pro' ? 'pro' : 'basic'];
  const order = [];
  const seen = new Set();
  for (const candidate of [requested, ...chain]) {
    const n = normalize(candidate);
    if (n && !seen.has(n)) {
      seen.add(n);
      order.push(n);
    }
  }
  return order;
}

/**
 * Try each provider via attemptFn until one succeeds.
 * @param {string[]} providers ordered provider keys
 * @param {(provider:string)=>Promise<any>} attemptFn
 */
async function runWithFailover(providers, attemptFn) {
  let lastResult = null;
  let lastError = null;
  for (const provider of providers) {
    try {
      const result = await attemptFn(provider);
      if (result && result.success !== false) return result;
      lastResult = result;
      console.warn(`[vision] provider "${provider}" returned an unsuccessful result — trying next`);
    } catch (err) {
      lastError = err;
      console.warn(`[vision] provider "${provider}" threw: ${err.message} — trying next`);
    }
  }
  if (lastResult) return lastResult;
  return {
    success: false,
    error: lastError ? `All vision providers failed: ${lastError.message}` : 'All vision providers failed',
  };
}

module.exports = { FALLBACK_CHAINS, normalize, buildProviderOrder, runWithFailover };
