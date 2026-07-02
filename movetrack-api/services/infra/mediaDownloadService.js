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
const { storage } = require('./gcsService');
const { callWithResilience } = require('./ai/resilientModel');

const DEFAULT_TIMEOUT_MS = Number(process.env.MEDIA_DOWNLOAD_TIMEOUT_MS || 30000);
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

/** Split a gs:// or https://storage.googleapis.com/... URL into {bucket, path}. */
function parseGcsUrl(url) {
  if (url.startsWith('gs://')) {
    const rest = url.slice('gs://'.length);
    const [bucket, ...parts] = rest.split('/');
    return { bucket, path: parts.join('/') };
  }
  const parsed = new URL(url);
  const parts = parsed.pathname.replace(/^\//, '').split('/');
  return { bucket: parts[0], path: parts.slice(1).join('/') };
}

/** Download via the authenticated GCS SDK instead of an unauthenticated public fetch. */
async function downloadFromGcs(url) {
  const { bucket, path: filePath } = parseGcsUrl(url);
  if (!bucket || !filePath) {
    throw new MediaDownloadError(`Malformed GCS URL: ${url}`);
  }
  try {
    const [buffer] = await storage.bucket(bucket).file(filePath).download();
    return buffer;
  } catch (err) {
    throw new MediaDownloadError(`GCS download failed for ${url}: ${err.message}`, {
      status: typeof err.code === 'number' ? err.code : undefined,
      code: typeof err.code === 'string' ? err.code : undefined,
    });
  }
}

/** Download a generic http(s) URL, failing loudly on non-2xx or a truncated body. */
function downloadViaHttp(url) {
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

    req.on('error', reject);
  });
}

/**
 * Download a URL into a Buffer with status checking, timeout, retry-with-backoff,
 * and (optionally) end-to-end size verification against a caller-supplied byte
 * count captured before upload. Every failure mode throws — a truncated or
 * failed download can never reach ffmpeg or a vision model as if it succeeded.
 *
 * @param {string} url
 * @param {object} [opts]
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
    timeoutMs = DEFAULT_TIMEOUT_MS,
    retries = DEFAULT_RETRIES,
    baseDelayMs,
    sleepFn,
    expectedBytes = null,
  } = opts;

  const buffer = await callWithResilience(
    () => (isGcsUrl(url) ? downloadFromGcs(url) : downloadViaHttp(url)),
    { timeoutMs, retries, baseDelayMs, sleepFn, label: `media download (${url})` }
  );

  if (expectedBytes != null && buffer.length !== expectedBytes) {
    throw new MediaDownloadError(
      `Downloaded ${buffer.length} bytes but the client reported ${expectedBytes} bytes for ${url} — upload was likely incomplete`
    );
  }

  return buffer;
}

module.exports = { downloadBuffer, MediaDownloadError };
