'use strict';

/**
 * mediaDownloadService
 *
 * Deterministic media transport for the scan pipeline (Pathway A of the beta
 * scan-reliability program — see docs/notes/beta-scan-reliability-investigation.md).
 *
 * The old `downloadBuffer` in mediaInventoryWorkflowService.js accumulated an
 * HTTP response body regardless of status code, over an unauthenticated
 * `https.get`, with no timeout, no retry, and no length verification. A
 * truncated `.mov` or a GCS 403/404 XML error page would silently reach ffmpeg
 * or a vision model and get analyzed as if it were real media. This module
 * replaces that: every failure mode throws instead of resolving with bad bytes.
 */

const https = require('https');
const http = require('http');
const { storage, BUCKET } = require('./gcsService');
const { isRetryable, backoffDelay } = require('./ai/resilientModel');

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Inactivity timeout (resets on every byte received via downloadFromGcs/
// downloadViaHttp's own timers below), not a flat overall cap — a slow-but-
// steady multi-minute video walkthrough shouldn't time out purely for being
// large. Raised from 30s: a stalled transfer on a big file was exactly the
// OOM-adjacent failure this module exists to prevent, so it needs headroom.
const DEFAULT_TIMEOUT_MS = Number(process.env.MEDIA_DOWNLOAD_TIMEOUT_MS || 60000);
const DEFAULT_RETRIES = Number(process.env.MEDIA_DOWNLOAD_RETRIES || 2);

class MediaDownloadError extends Error {
  constructor(message, { status, code } = {}) {
    super(message);
    this.name = 'MediaDownloadError';
    if (status !== undefined) this.status = status;
    if (code !== undefined) this.code = code;
  }
}

function isGcsUrl(url) {
  return url.startsWith('gs://') || url.includes('storage.googleapis.com');
}

/**
 * Split a gs://, path-style (https://storage.googleapis.com/bucket/path), or
 * virtual-hosted-style (https://bucket.storage.googleapis.com/path) URL into
 * {bucket, path}. Percent-decodes the path so an encoded traversal segment
 * can't slip past the bucket/prefix check below unnoticed.
 */
function parseGcsUrl(url) {
  if (url.startsWith('gs://')) {
    const rest = url.slice('gs://'.length);
    const [bucket, ...parts] = rest.split('/');
    return { bucket, path: decodeURIComponent(parts.join('/')) };
  }
  const parsed = new URL(url);
  const virtualHosted = parsed.hostname.match(/^([^.]+)\.storage\.googleapis\.com$/);
  if (virtualHosted) {
    return { bucket: virtualHosted[1], path: decodeURIComponent(parsed.pathname.replace(/^\//, '')) };
  }
  const parts = parsed.pathname.replace(/^\//, '').split('/');
  return { bucket: decodeURIComponent(parts[0] || ''), path: decodeURIComponent(parts.slice(1).join('/')) };
}

/**
 * Refuse to read anything outside the app's own bucket and, when the calling
 * user is known, that user's own prefix. `file_url` on analyze_photo/
 * analyze_video is an LLM-generated tool-call argument copied from prompt
 * text — a prompt injection could point it at an arbitrary GCS URL, and
 * authenticated SDK reads (unlike the old unauthenticated public fetch) can
 * see private objects the old code never could.
 */
function assertAllowedGcsPath(bucket, filePath, userId) {
  if (bucket !== BUCKET) {
    throw new MediaDownloadError(`Refusing to read from untrusted bucket "${bucket}" (expected "${BUCKET}")`);
  }
  if (userId && !filePath.startsWith(`users/${userId}/`)) {
    throw new MediaDownloadError(`Refusing to read a path outside the calling user's own prefix: ${filePath}`);
  }
}

/**
 * Download via the authenticated GCS SDK instead of an unauthenticated public
 * fetch. Uses a readable stream (not the `.download()` convenience wrapper)
 * so an inactivity timeout can actually destroy the in-flight transfer
 * instead of merely abandoning it while it keeps buffering in the background.
 */
function downloadFromGcs(url, { userId, timeoutMs } = {}) {
  return new Promise((resolve, reject) => {
    let bucket, filePath;
    try {
      ({ bucket, path: filePath } = parseGcsUrl(url));
      if (!bucket || !filePath) throw new MediaDownloadError(`Malformed GCS URL: ${url}`);
      assertAllowedGcsPath(bucket, filePath, userId);
    } catch (err) {
      reject(err);
      return;
    }

    const stream = storage.bucket(bucket).file(filePath).createReadStream();
    const chunks = [];
    let received = 0;
    let timer = null;
    let settled = false;

    const settle = (fn, arg) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(arg);
    };

    const armTimer = () => {
      if (!timeoutMs) return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        stream.destroy(new Error(`GCS download timed out after ${timeoutMs}ms of inactivity`));
      }, timeoutMs);
    };

    armTimer();
    stream.on('data', (c) => { chunks.push(c); received += c.length; armTimer(); });
    stream.on('end', () => settle(resolve, Buffer.concat(chunks)));
    stream.on('error', (err) => {
      const isTimeout = /timed out/.test(err.message || '');
      settle(reject, new MediaDownloadError(`GCS download failed for ${url}: ${err.message}`, {
        status: isTimeout ? 504 : (typeof err.code === 'number' ? err.code : undefined),
        code: isTimeout ? undefined : (typeof err.code === 'string' ? err.code : undefined),
      }));
    });
  });
}

/**
 * Download a generic http(s) URL, failing loudly on non-2xx or a truncated
 * body. Destroys the request on inactivity (no bytes for `timeoutMs`) instead
 * of just abandoning it, matching downloadFromGcs — a slow 150MB video
 * shouldn't leave 3 concurrent in-memory copies behind across retries.
 */
function downloadViaHttp(url, { timeoutMs } = {}) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const req = client.get(url, (res) => {
      const status = res.statusCode || 0;
      if (status < 200 || status >= 300) {
        res.resume(); // drain so the socket can be released
        reject(new MediaDownloadError(`Download failed with HTTP ${status} for ${url}`, { status }));
        return;
      }

      const expectedLength = res.headers['content-length'] != null
        ? Number(res.headers['content-length'])
        : null;

      const chunks = [];
      let received = 0;
      res.on('data', (c) => { chunks.push(c); received += c.length; });
      res.on('end', () => {
        if (expectedLength != null && received !== expectedLength) {
          // Treat as a transient transport failure (worth a retry), not a
          // permanent one — a fresh attempt may not truncate again.
          reject(new MediaDownloadError(
            `Truncated download: got ${received} bytes, expected ${expectedLength} (Content-Length) for ${url}`,
            { status: 502 }
          ));
          return;
        }
        resolve(Buffer.concat(chunks));
      });
      res.on('error', reject);
    });

    if (timeoutMs) {
      // Node resets this on any socket activity, so it's an inactivity
      // timeout in practice, not a flat cap on the whole transfer.
      req.setTimeout(timeoutMs, () => {
        req.destroy(new MediaDownloadError(`Download timed out after ${timeoutMs}ms of inactivity for ${url}`, { status: 504 }));
      });
    }
    req.on('error', reject);
  });
}

/**
 * Download a URL into a Buffer with status checking, an inactivity timeout,
 * retry-with-backoff, and (optionally) end-to-end size verification against a
 * caller-supplied byte count captured before upload. Every failure mode
 * throws — a truncated or failed download can never reach ffmpeg or a vision
 * model as if it succeeded.
 *
 * Retries directly with `isRetryable`/`backoffDelay` (reused from
 * resilientModel) rather than through `callWithResilience` — that helper's
 * `withTimeout` is a flat, non-resetting race, which would undo the
 * inactivity semantics above for exactly the large/slow videos this timeout
 * needs to tolerate (a steady multi-minute transfer would get killed at the
 * flat cap even though no individual gap ever stalled).
 *
 * @param {string} url
 * @param {object} [opts]
 * @param {string} [opts.userId] - the calling user; GCS reads of storage.googleapis.com
 *   /gs:// URLs are refused unless they resolve to the app's own bucket under
 *   `users/${userId}/` (see assertAllowedGcsPath) — file_url is LLM-controlled.
 * @param {number} [opts.timeoutMs]
 * @param {number} [opts.retries]
 * @param {number} [opts.baseDelayMs] - retry backoff base (tests only; production uses the default)
 * @param {function} [opts.sleepFn] - retry sleep implementation (tests only, for instant retries)
 * @param {number|null} [opts.expectedBytes] - byte count the client reported
 *   when it uploaded this file, if known. A mismatch means the upload itself
 *   was incomplete (not a transport blip) so it is NOT retried.
 * @returns {Promise<Buffer>}
 */
async function downloadBuffer(url, opts = {}) {
  const {
    userId,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    retries = DEFAULT_RETRIES,
    baseDelayMs = 500,
    sleepFn = defaultSleep,
    expectedBytes = null,
  } = opts;

  const attempt = () => (isGcsUrl(url) ? downloadFromGcs(url, { userId, timeoutMs }) : downloadViaHttp(url, { timeoutMs }));

  let buffer;
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try {
      buffer = await attempt();
      lastErr = null;
      break;
    } catch (err) {
      lastErr = err;
      if (i < retries && isRetryable(err)) {
        const delay = backoffDelay(i, baseDelayMs);
        console.warn(`[media-download] attempt ${i + 1}/${retries + 1} failed for ${url}: ${err.message} — retrying in ${delay}ms`);
        await sleepFn(delay);
        continue;
      }
      break;
    }
  }
  if (lastErr) throw lastErr;

  if (expectedBytes != null && buffer.length !== expectedBytes) {
    throw new MediaDownloadError(
      `Downloaded ${buffer.length} bytes but the client reported ${expectedBytes} bytes for ${url} — upload was likely incomplete`
    );
  }

  return buffer;
}

module.exports = { downloadBuffer, MediaDownloadError, parseGcsUrl, assertAllowedGcsPath };
