/**
 * gcsService.js
 *
 * Shared Google Cloud Storage client and helpers.
 * Centralises bucket access, signed-URL generation, and upload utilities
 * so that files.js, vision video routes, and future endpoints share one client.
 */

const { Storage } = require('@google-cloud/storage');
const path = require('path');

const isLocalEnvironment = process.env.NODE_ENV !== 'production';
const BUCKET = 'movetrack-item-photos';
const PROJECT_ID = 'widowmaker-477505';

// ── Storage client ────────────────────────────────────────────────────────────
const storageOptions = { projectId: PROJECT_ID };

if (isLocalEnvironment) {
  const localKeyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS
    || path.join(__dirname, '../devkeys/service-account.json');
  storageOptions.keyFilename = localKeyPath;
}

const storage = new Storage(storageOptions);

// ── Signed URLs ───────────────────────────────────────────────────────────────

/** Default signed-URL lifetime: 1 hour */
const DEFAULT_EXPIRY_MS = 60 * 60 * 1000;

/**
 * Generate a short-lived v4 signed read URL for a GCS object.
 *
 * @param {string} gcsPath  – Object path inside BUCKET (e.g. "users/abc/photo.jpg")
 * @param {number} [expiresMs] – Lifetime in ms (default 1 h)
 * @returns {Promise<string>} Signed HTTPS URL
 */
async function signUrl(gcsPath, expiresMs = DEFAULT_EXPIRY_MS) {
  const [url] = await storage
    .bucket(BUCKET)
    .file(gcsPath)
    .getSignedUrl({
      version: 'v4',
      action: 'read',
      expires: Date.now() + expiresMs
    });
  return url;
}

/**
 * Convert a public GCS URL to the object path.
 * e.g. "https://storage.googleapis.com/movetrack-item-photos/users/x/pic.jpg"
 *   → "users/x/pic.jpg"
 *
 * Returns null if the URL doesn't match the expected bucket.
 */
function publicUrlToPath(url) {
  if (!url || typeof url !== 'string') return null;
  const prefix = `https://storage.googleapis.com/${BUCKET}/`;
  if (!url.startsWith(prefix)) return null;
  // Strip query params (present in signed URLs)
  const raw = url.slice(prefix.length);
  const qIdx = raw.indexOf('?');
  return qIdx >= 0 ? raw.slice(0, qIdx) : raw;
}

/**
 * Replace a public GCS URL with a signed URL (if it matches the bucket).
 * Returns the original value unchanged for data-URLs, nulls, etc.
 */
async function signPublicUrl(publicUrl, expiresMs = DEFAULT_EXPIRY_MS) {
  const gcsPath = publicUrlToPath(publicUrl);
  if (!gcsPath) return publicUrl; // not a GCS URL or already signed
  return signUrl(gcsPath, expiresMs);
}

/**
 * Normalise any GCS URL variant to a stable public URL (for DB storage).
 * Strips signed-URL query params. Returns non-GCS URLs unchanged.
 */
function toPublicUrl(url) {
  const gcsPath = publicUrlToPath(url);
  if (gcsPath) return `https://storage.googleapis.com/${BUCKET}/${gcsPath}`;
  return url; // data-URL, null, or non-GCS URL
}

// ── Item URL signing ─────────────────────────────────────────────────────────

/**
 * Replace public GCS picture_url with signed URLs in an array of items.
 * Non-GCS URLs (data URLs, nulls) pass through unchanged.
 * Mutates the array in place and returns it.
 */
async function signItemUrls(items) {
  if (!Array.isArray(items) || isLocalEnvironment) return items;
  await Promise.all(items.map(async (item) => {
    if (item.picture_url) {
      item.picture_url = await signPublicUrl(item.picture_url).catch(() => item.picture_url);
    }
  }));
  return items;
}

// ── Upload helpers ────────────────────────────────────────────────────────────

async function uploadBuffer(buffer, gcsPath, contentType) {
  if (isLocalEnvironment) {
    return {
      gcsPath,
      signedUrl: `https://storage.googleapis.com/${BUCKET}/${gcsPath}`
    };
  }

  const file = storage.bucket(BUCKET).file(gcsPath);
  // Use resumable uploads for files >5MB (GCS non-resumable limit)
  const useResumable = buffer.length > 5 * 1024 * 1024;
  await new Promise((resolve, reject) => {
    const stream = file.createWriteStream({
      metadata: { contentType },
      resumable: useResumable
    });
    stream.on('error', reject);
    stream.on('finish', resolve);
    stream.end(buffer);
  });

  // Sign URL if possible, but don't fail the upload if signing is denied
  const signedUrl = await signUrl(gcsPath).catch((err) => {
    console.warn('[gcsService] signUrl failed after upload (IAM issue?):', err.message);
    return null;
  });
  return { gcsPath, signedUrl };
}

// ── Video scan upload ─────────────────────────────────────────────────────────

/**
 * Upload a video buffer to GCS under the standard room-scan path.
 * Returns { gcsPath, signedUrl } — signedUrl is null in local dev.
 *
 * @param {Buffer} buffer
 * @param {string} userId
 * @param {string} scanId   - UUID for this scan session
 * @param {string} originalname - Original filename (for extension)
 * @param {string} mimeType
 */
async function uploadVideoScan(buffer, userId, scanId, originalname, mimeType) {
  const gcsPath = `users/${userId}/room-scans/${scanId}/${originalname}`;
  return uploadBuffer(buffer, gcsPath, mimeType);
}

// ── File utilities ────────────────────────────────────────────────────────────

/**
 * Stream a GCS object directly to an Express response.
 *
 * @param {string} bucketName
 * @param {string} gcsPath
 * @param {import('express').Response} res
 */
async function streamFileToResponse(bucketName, gcsPath, res) {
  const file = storage.bucket(bucketName).file(gcsPath);
  const [exists] = await file.exists();
  if (!exists) { res.status(404).send('File not found.'); return; }
  file.createReadStream().pipe(res);
}

/**
 * Delete a GCS object. Resolves silently if the file does not exist.
 *
 * @param {string} bucketName
 * @param {string} gcsPath
 */
async function deleteGcsFile(bucketName, gcsPath) {
  const file = storage.bucket(bucketName).file(gcsPath);
  const [exists] = await file.exists();
  if (exists) await file.delete();
}

// ── Image source resolution ───────────────────────────────────────────────────

/**
 * Resolve an image source from an Express request.
 * Accepts either a JSON body with `imageUrl` (GCS or data URL) or a multer file upload.
 *
 * @param {import('express').Request} req
 * @returns {{ imageSource: string, mimeType: string } | { error: string }}
 */
function resolveImageSource(req) {
  if (req.body.imageUrl) {
    const url = req.body.imageUrl;
    const isGcsUrl = url.includes('storage.googleapis.com') || url.startsWith('gs://');
    const isDataUrl = url.startsWith('data:');
    if (!isGcsUrl && !isDataUrl) return { error: 'Only Google Cloud Storage URLs or data URLs are allowed' };
    return { imageSource: url, mimeType: req.body.mimeType || 'image/jpeg' };
  }
  if (req.file) {
    return { imageSource: req.file.buffer.toString('base64'), mimeType: req.file.mimetype };
  }
  return { error: 'No image provided (imageUrl or file required)' };
}

module.exports = {
  storage,
  BUCKET,
  isLocalEnvironment,
  signUrl,
  publicUrlToPath,
  toPublicUrl,
  signPublicUrl,
  signItemUrls,
  uploadBuffer,
  uploadVideoScan,
  resolveImageSource,
  streamFileToResponse,
  deleteGcsFile,
};
