'use strict';

/**
 * services/infra/ai/resilientModel.js
 *
 * Reliability wrapper for LLM model calls (WS2). The agents previously called
 * Gemini's generateContent() with no timeout and no retry — a slow or transient
 * provider failure would hang or hard-fail the whole request. This adds:
 *   - a per-call timeout,
 *   - exponential backoff + jitter retries for *transient* errors only
 *     (429 / 5xx / network / timeout) — never for permanent 4xx,
 *   - best-effort token/cost recording (via aiCostService) on success.
 *
 * It also exports AiUnavailableError (HTTP 503) so callers can degrade gracefully
 * — e.g. when GOOGLE_AI_API_KEY is missing — instead of surfacing a raw 500.
 */

const { recordUsage } = require('../cost/aiCostService');

const DEFAULT_TIMEOUT_MS = Number(process.env.AI_CALL_TIMEOUT_MS || 30000);
const DEFAULT_RETRIES = Number(process.env.AI_CALL_RETRIES || 2);
const DEFAULT_BASE_DELAY_MS = Number(process.env.AI_RETRY_BASE_MS || 500);

class AiUnavailableError extends Error {
  constructor(message = 'The AI assistant is temporarily unavailable. Please try again in a moment.') {
    super(message);
    this.name = 'AiUnavailableError';
    this.status = 503;
  }
}

/** Decide whether an error is worth retrying (transient) vs permanent. */
function isRetryable(err) {
  if (!err) return false;

  const statusRaw = err.status ?? err.statusCode ?? err.code;
  const n = typeof statusRaw === 'number' ? statusRaw : parseInt(statusRaw, 10);
  if (Number.isFinite(n)) {
    if (n === 429) return true;            // rate limited
    if (n >= 500 && n <= 599) return true; // server error
    if (n >= 400 && n <= 499) return false; // other client errors are permanent
  }

  const code = String(err.code || '');
  if (['ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'EAI_AGAIN', 'ENOTFOUND', 'EPIPE', 'ECONNABORTED'].includes(code)) {
    return true;
  }

  const msg = String(err.message || '').toLowerCase();
  return /timeout|timed out|fetch failed|network|temporarily|overloaded|unavailable|rate limit|too many requests|\b(429|500|502|503|504)\b/.test(msg);
}

function backoffDelay(attempt, base = DEFAULT_BASE_DELAY_MS) {
  const exp = base * Math.pow(2, attempt);
  const jitter = Math.floor(Math.random() * base);
  return exp + jitter;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Race a promise-returning factory against a timeout. */
async function withTimeout(factory, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const e = new Error(`${label || 'AI call'} timed out after ${ms}ms`);
      e.code = 'ETIMEDOUT';
      reject(e);
    }, ms);
  });
  try {
    return await Promise.race([factory(), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** Call `factory` with timeout + transient-error retries. */
async function callWithResilience(factory, opts = {}) {
  const {
    retries = DEFAULT_RETRIES,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    baseDelayMs = DEFAULT_BASE_DELAY_MS,
    label = 'AI call',
    sleepFn = sleep,
  } = opts;

  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await withTimeout(factory, timeoutMs, label);
    } catch (err) {
      lastErr = err;
      if (attempt < retries && isRetryable(err)) {
        const delay = backoffDelay(attempt, baseDelayMs);
        console.warn(`[ai] ${label} failed (attempt ${attempt + 1}/${retries + 1}): ${err.message} — retrying in ${delay}ms`);
        await sleepFn(delay);
        continue;
      }
      break;
    }
  }
  throw lastErr;
}

/**
 * Wrap a Gemini GenerativeModel so every generateContent() call is resilient
 * (timeout + retry) and records token usage. Mutates and returns the
 * (per-request) model.
 */
function instrumentModel(model, { userId, modelName, timeoutMs, retries } = {}) {
  if (!model || typeof model.generateContent !== 'function') return model;
  const original = model.generateContent.bind(model);

  model.generateContent = async (...args) => {
    const result = await callWithResilience(() => original(...args), {
      timeoutMs,
      retries,
      label: `generateContent(${modelName || 'gemini'})`,
    });
    try {
      const um = result && result.response && result.response.usageMetadata;
      if (userId && um) {
        recordUsage(userId, {
          model: modelName,
          inputTokens: um.promptTokenCount || 0,
          outputTokens: (um.candidatesTokenCount || 0) + (um.thoughtsTokenCount || 0),
        });
      }
    } catch (_) { /* never let metering break a model call */ }
    return result;
  };
  return model;
}

module.exports = {
  AiUnavailableError,
  isRetryable,
  backoffDelay,
  withTimeout,
  callWithResilience,
  instrumentModel,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_RETRIES,
};
