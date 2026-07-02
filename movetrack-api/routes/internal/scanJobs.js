'use strict';

/**
 * routes/internal/scanJobs.js
 *
 * Cloud Tasks push target for async scan processing (#42 Phase 2). Not a user
 * endpoint: it is on the auth allowlist (no session token) and instead
 * requires a Google-signed OIDC identity token minted by Cloud Tasks for the
 * configured invoker service account, with this endpoint's URL as audience.
 *
 * Response contract with Cloud Tasks:
 *   2xx → task acknowledged (job terminal, or nothing to do — idempotent);
 *   5xx → task redelivered with backoff (job was re-queued for another try).
 *
 * Setup: infra/gcp/setup-scan-jobs.sh (one-time IAM) + the `ensure-scan-queue`
 * step in cloudbuild.yaml (queue) + SCAN_TASKS_* env vars on the service.
 */

const express = require('express');
const { OAuth2Client } = require('google-auth-library');
const scanJobs = require('../../services/inventory/scanJobService');

const router = express.Router();
const oidcClient = new OAuth2Client();

async function verifyOidcToken(req, res, next) {
  const expectedEmail = process.env.SCAN_TASKS_SERVICE_ACCOUNT;
  const baseUrl = process.env.SCAN_TASKS_TARGET_BASE_URL;
  if (!expectedEmail || !baseUrl) {
    // Without Cloud Tasks config, jobs process inline in-process and nothing
    // legitimate calls this endpoint — refuse rather than guess.
    return res.status(503).json({ error: 'Scan task processing is not configured' });
  }

  const header = req.headers.authorization || '';
  const idToken = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!idToken) return res.status(401).json({ error: 'Missing bearer token' });

  try {
    const audience = `${baseUrl.replace(/\/+$/, '')}/internal/scan-jobs/process`;
    const ticket = await oidcClient.verifyIdToken({ idToken, audience });
    const payload = ticket.getPayload();
    if (!payload?.email_verified || payload.email !== expectedEmail) {
      return res.status(403).json({ error: 'Wrong identity' });
    }
    return next();
  } catch (err) {
    console.warn('[scanJobs] OIDC verification failed:', err.message);
    return res.status(401).json({ error: 'Invalid identity token' });
  }
}

router.post('/process', express.json(), verifyOidcToken, async (req, res) => {
  const jobId = String(req.body?.jobId || '');
  if (!scanJobs.UUID_RE.test(jobId)) {
    // Malformed payloads must not be redelivered forever — ack with 200-range.
    return res.status(204).end();
  }
  try {
    const outcome = await scanJobs.processJob(jobId);
    if (outcome === 'retry') {
      return res.status(500).json({ outcome }); // Cloud Tasks redelivers
    }
    return res.json({ outcome }); // completed | failed | skipped
  } catch (err) {
    console.error(`[scanJobs] processing endpoint error for ${jobId}:`, err.message);
    return res.status(500).json({ error: 'processing error' }); // redeliver
  }
});

module.exports = router;
