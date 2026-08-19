'use strict';

/**
 * routes/api/companyCapture.js
 *
 * Moving-company capture links (H1, issue #96). A company puts
 * https://app…/c/{companyToken} on its website or mails it to a customer; the
 * customer opens it on their phone, enters an email + consent, and records one
 * video per room in the browser — NO account, NO OTP. Scans run through the
 * existing scan-jobs pipeline under a lightweight guest user; on completion
 * the company is automatically emailed the Mover Inventory share link (with
 * playable walkthrough videos) and the customer gets the same link.
 *
 * Mounted PUBLICLY at /api/capture (allowlisted in middleware/auth.js), so
 * every endpoint here carries its own gate:
 *
 *   Admin (magic-link session + is_admin — how Owen mints links):
 *     POST /api/capture/companies                 create company + token
 *     GET  /api/capture/companies                 list companies
 *
 *   Public (rate-limited by company token + IP):
 *     GET  /api/capture/:companyToken             company display name only
 *                                                 (any-origin CORS — the #98
 *                                                 widget calls it from movers'
 *                                                 own websites)
 *     POST /api/capture/:companyToken/start       email+consent → guest JWT
 *                                                 (+ optional source marker:
 *                                                 'widget'|'link'|'email')
 *
 *   Guest (Bearer guest JWT scoped to ONE capture session):
 *     GET  /api/capture/:companyToken/session     resume state after reload
 *     POST /api/capture/:companyToken/upload-url  signed PUT for a room video
 *     POST /api/capture/:companyToken/scan-jobs   register uploaded video
 *     GET  /api/capture/:companyToken/scan-jobs/:id  poll; auto-commits items
 *     POST /api/capture/:companyToken/complete    share link + company email
 *
 * Guest-auth design: the guest JWT ({ captureSessionId, userId, guest: true },
 * signed with the same JWT secret via authService) has no auth_tokens row and
 * a different claim shape, so it can never pass the normal authenticate()
 * path — it only works here, and only while its capture session is active and
 * unexpired. Guests are ALWAYS a fresh users row with a synthetic unique
 * email (users.source = 'company_link'); reusing an existing account matched
 * by a typed-in email (no OTP!) would let anyone pull a stranger's inventory
 * into a company share. The customer's real email lives on the session row.
 *
 * Caps are enforced server-side per session (≤20 videos, ≤500MB) via a single
 * conditional UPDATE on the counter columns — no read-modify-write race.
 */

const express = require('express');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const { db } = require('../../services/infra/db');
const {
  authenticate,
  signGuestCaptureToken,
  verifyGuestCaptureToken,
} = require('../../services/infra/authService');
const { requireAdmin } = require('../../middleware/auth');
const rateLimits = require('../../config/rateLimits');
const mediaAssetService = require('../../services/infra/mediaAssetService');
const scanJobs = require('../../services/inventory/scanJobService');
const inventoryMutation = require('../../services/inventory/inventoryMutationService');
const shareService = require('../../services/inventory/shareService');

const router = express.Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Per-session caps (owner decision, #96). Enforced in SQL, surfaced with
// human copy — a customer filming a big house hits these honestly.
const MAX_VIDEOS = 20;
const MAX_BYTES = 500 * 1024 * 1024; // 500MB
const SESSION_DAYS = 30;

const VIDEO_CAP_MESSAGE =
  "You've reached the 20-video limit for this session. Tap \"I'm done\" to send what you have — that's already a great walkthrough.";
const BYTES_CAP_MESSAGE =
  "You've reached the 500MB upload limit for this session. Tap \"I'm done\" to send what you have — that's already a great walkthrough.";

function appBaseUrl() {
  return (process.env.APP_BASE_URL || 'https://movetrack-app-7hwn7ggbiq-uc.a.run.app').replace(/\/$/, '');
}

// One-line embed for the "Get a quote" widget (F1, #98) — what a moving
// company pastes into its own site. Same base URL as captureUrl: the widget
// script lives in the app bundle's public/ dir and derives all links from its
// own src, so this single line needs no other config.
function embedSnippet(token) {
  return `<script src="${appBaseUrl()}/widget.js" data-nexus-token="${token}" async><\/script>`;
}

// How the customer reached the capture page (session attribution, #98).
// Junk values become null rather than 400 — attribution must never block a
// customer from starting a walkthrough.
const CAPTURE_SOURCES = ['widget', 'link', 'email'];
function normalizeSource(value) {
  return CAPTURE_SOURCES.includes(value) ? value : null;
}

// The public landing lookup must be callable from ANY origin: the widget runs
// on moving companies' own websites and fetches the display name from there.
// Permissive CORS on ONLY this endpoint — it returns the company name and
// nothing else (no contact email, id, or volume), so there is nothing to
// protect; every other capture endpoint keeps the app-origin-only global CORS.
function permissiveCors(req, res, next) {
  res.set('Access-Control-Allow-Origin', '*');
  next();
}

// Same SMTP transport shape as routes/api/move/quoteLeads.js (#92): SendGrid
// SMTP via SMTP_* env, built per-request so config changes need no restart;
// null when credentials are absent (local dev) — then we log loudly instead.
function buildTransporter() {
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!user || !pass || pass === 'your-sendgrid-api-key') return null;

  const port = Number(process.env.SMTP_PORT || 587);
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.sendgrid.net',
    port,
    secure: port === 465,
    auth: { user, pass },
  });
}

/** Best-effort mail. Throws are caught by callers; never fails a request. */
async function sendMail({ to, subject, text }) {
  const transporter = buildTransporter();
  if (!transporter) {
    console.warn(`[companyCapture] NO EMAIL TRANSPORT — would have mailed ${to}: ${subject}\n${text}`);
    return;
  }
  await transporter.sendMail({
    from: process.env.EMAIL_FROM || 'owen@we3kings.dev',
    to,
    subject,
    text,
  });
}

// ── Admin: mint + list company links ─────────────────────────────────────────
// Defined BEFORE '/:companyToken' so 'companies' is never read as a token.

router.post('/companies', authenticate, requireAdmin, express.json(), async (req, res) => {
  const name = typeof req.body?.name === 'string' ? req.body.name.trim().slice(0, 255) : '';
  const contactEmail = typeof req.body?.contact_email === 'string' ? req.body.contact_email.trim() : '';

  if (!name) return res.status(400).json({ error: 'Company name is required' });
  if (!contactEmail || contactEmail.length > 255 || !EMAIL_RE.test(contactEmail)) {
    return res.status(400).json({ error: 'A valid contact email is required' });
  }

  // url-safe, unguessable, no dashes to mangle when pasted into an email.
  const token = crypto.randomUUID().replace(/-/g, '');
  try {
    const row = await db.one(
      `INSERT INTO companies (name, contact_email, token)
       VALUES ($1, $2, $3)
       RETURNING id, name, contact_email, token, is_active, created_at`,
      [name, contactEmail, token]
    );
    res.status(201).json({
      id: row.id,
      name: row.name,
      contactEmail: row.contact_email,
      token: row.token,
      captureUrl: `${appBaseUrl()}/c/${row.token}`,
      embedSnippet: embedSnippet(row.token),
      isActive: row.is_active,
      createdAt: row.created_at,
    });
  } catch (err) {
    console.error('[companyCapture] create company failed:', err.message);
    res.status(500).json({ error: 'Failed to create the company' });
  }
});

router.get('/companies', authenticate, requireAdmin, async (req, res) => {
  try {
    const rows = await db.any(
      `SELECT c.id, c.name, c.contact_email, c.token, c.is_active, c.created_at,
              COUNT(s.id)::int AS session_count
       FROM companies c
       LEFT JOIN company_capture_sessions s ON s.company_id = c.id
       GROUP BY c.id
       ORDER BY c.created_at DESC
       LIMIT 200`
    );
    res.json(rows.map((row) => ({
      id: row.id,
      name: row.name,
      contactEmail: row.contact_email,
      token: row.token,
      captureUrl: `${appBaseUrl()}/c/${row.token}`,
      embedSnippet: embedSnippet(row.token),
      isActive: row.is_active,
      createdAt: row.created_at,
      sessionCount: row.session_count,
    })));
  } catch (err) {
    console.error('[companyCapture] list companies failed:', err.message);
    res.status(500).json({ error: 'Failed to list companies' });
  }
});

// ── Admin: invite-loop research metrics (F3, #100) ───────────────────────────
// Defined BEFORE '/:companyToken' so 'invites' is never read as a token.
// Counts by status + the recent invites, so the owner can see whether the
// discover→invite→claim loop is actually converting.

router.get('/invites', authenticate, requireAdmin, async (req, res) => {
  try {
    const counts = await db.one(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE status = 'sent')::int AS sent,
              COUNT(*) FILTER (WHERE status = 'claimed')::int AS claimed,
              COUNT(*) FILTER (WHERE status = 'failed')::int AS failed
       FROM mover_invites`
    );
    const rows = await db.any(
      `SELECT mi.id, mi.business_name, mi.place_ref, mi.status,
              mi.company_id, mi.created_at, mi.claimed_at,
              c.name AS company_name
       FROM mover_invites mi
       LEFT JOIN companies c ON c.id = mi.company_id
       ORDER BY mi.created_at DESC
       LIMIT 200`
    );
    res.json({
      counts: { total: counts.total, sent: counts.sent, claimed: counts.claimed, failed: counts.failed },
      invites: rows.map((r) => ({
        id: r.id,
        businessName: r.business_name,
        placeRef: r.place_ref,
        status: r.status,
        companyId: r.company_id,
        companyName: r.company_name,
        createdAt: r.created_at,
        claimedAt: r.claimed_at,
      })),
    });
  } catch (err) {
    console.error('[companyCapture] list invites failed:', err.message);
    res.status(500).json({ error: 'Failed to list invites' });
  }
});

// ── Public: landing data + session start ─────────────────────────────────────

async function findActiveCompany(token) {
  if (!token || token.length > 80) return null;
  return db.oneOrNone(
    `SELECT id, name, contact_email, token FROM companies WHERE token = $1 AND is_active = TRUE`,
    [token]
  );
}

// GET /api/capture/:companyToken — display name only. Unknown and inactive
// tokens are indistinguishable (404), and nothing else about the company
// (contact email, id, volume) ever leaks to the public page.
router.get('/:companyToken', permissiveCors, rateLimits.captureLimiter, async (req, res) => {
  try {
    const company = await findActiveCompany(req.params.companyToken);
    if (!company) return res.status(404).json({ error: 'This link is not active. Check with your moving company for a fresh one.' });
    res.json({ name: company.name });
  } catch (err) {
    console.error('[companyCapture] company lookup failed:', err.message);
    res.status(500).json({ error: 'Could not load this link. Please try again.' });
  }
});

// POST /api/capture/:companyToken/start { email, consent, source? }
router.post('/:companyToken/start', rateLimits.captureStartLimiter, express.json(), async (req, res) => {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const consent = req.body?.consent === true;
  const source = normalizeSource(req.body?.source);

  if (!email || email.length > 255 || !EMAIL_RE.test(email)) {
    return res.status(400).json({ error: 'A valid email is required' });
  }
  if (!consent) {
    return res.status(400).json({ error: 'Please check the consent box to continue' });
  }

  try {
    const company = await findActiveCompany(req.params.companyToken);
    if (!company) return res.status(404).json({ error: 'This link is not active. Check with your moving company for a fresh one.' });

    // Fresh guest user, ALWAYS — never attach to an existing account by
    // typed-in email (no OTP here; see file header). Synthetic unique email
    // on a reserved .invalid domain; the real one lives on the session row.
    const guestEmail = `capture+${crypto.randomUUID()}@guest.invalid`;
    const guest = await db.one(
      `INSERT INTO users (email, source, created_at)
       VALUES ($1, 'company_link', NOW())
       RETURNING user_id`,
      [guestEmail]
    );

    // Guests need a home location before items can land (addItem resolves
    // rooms under the user's primary location), plus the owner permission row
    // every location read path filters through (see migration 031).
    const home = await db.one(
      `INSERT INTO locations (user_id, name, location_type)
       VALUES ($1, 'My Home', 'primary_residence')
       RETURNING id`,
      [guest.user_id]
    );
    await db.none(
      `INSERT INTO permissions (user_id, resource_id, resource_type, permission_level, granted_by)
       VALUES ($1, $2, 'location', 'owner', $1)`,
      [guest.user_id, home.id]
    );

    const session = await db.one(
      `INSERT INTO company_capture_sessions (company_id, customer_email, user_id, consent, source, expires_at)
       VALUES ($1, $2, $3, $4, $5, NOW() + INTERVAL '${SESSION_DAYS} days')
       RETURNING id, status, videos_count, bytes_total, expires_at, created_at`,
      [company.id, email, guest.user_id, consent, source]
    );

    const token = signGuestCaptureToken({ captureSessionId: session.id, userId: guest.user_id });
    res.status(201).json({
      token,
      sessionId: session.id,
      company: { name: company.name },
      expiresAt: session.expires_at,
      caps: { maxVideos: MAX_VIDEOS, maxBytes: MAX_BYTES },
    });
  } catch (err) {
    console.error('[companyCapture] start failed:', err.message);
    res.status(500).json({ error: 'Could not start your session. Please try again.' });
  }
});

// ── Guest auth ────────────────────────────────────────────────────────────────

/**
 * Verify the guest JWT, load its capture session + company, and check that
 * the session belongs to the company token in the path, is unexpired, and
 * (unless the route opts out) still active. Attaches req.capture.
 */
async function guestAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization || '';
    if (!authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized - No token provided' });
    }
    const decoded = verifyGuestCaptureToken(authHeader.substring(7));
    if (!decoded) {
      return res.status(401).json({ error: 'Unauthorized - Invalid token' });
    }

    const row = await db.oneOrNone(
      `SELECT s.id, s.company_id, s.customer_email, s.user_id, s.status, s.consent,
              s.videos_count, s.bytes_total, s.expires_at,
              c.name AS company_name, c.contact_email AS company_contact_email,
              c.token AS company_token, c.is_active AS company_is_active
       FROM company_capture_sessions s
       JOIN companies c ON c.id = s.company_id
       WHERE s.id = $1`,
      [decoded.captureSessionId]
    );
    if (!row || row.user_id !== decoded.userId || row.company_token !== req.params.companyToken) {
      return res.status(401).json({ error: 'Unauthorized - Invalid token' });
    }
    if (!row.company_is_active) {
      return res.status(410).json({ error: 'This link is no longer active. Check with your moving company.' });
    }
    if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) {
      return res.status(410).json({ error: 'This session has expired. Open the link again to start a new one.' });
    }

    req.capture = { session: row, userId: row.user_id };
    next();
  } catch (err) {
    // Infra failure, not an auth decision — let the client retry.
    console.error('[companyCapture] guestAuth infra error:', err.message);
    res.status(503).json({ error: 'Service temporarily unavailable - please retry' });
  }
}

/** Mutating capture endpoints need a session that hasn't been completed. */
function requireActiveSession(req, res, next) {
  if (req.capture.session.status !== 'active') {
    return res.status(403).json({ error: 'This walkthrough was already sent. Open the link again to start a new one.' });
  }
  next();
}

// GET /api/capture/:companyToken/session — resume after a page reload.
router.get('/:companyToken/session', rateLimits.captureLimiter, guestAuth, (req, res) => {
  const s = req.capture.session;
  res.json({
    sessionId: s.id,
    status: s.status,
    company: { name: s.company_name },
    videosCount: s.videos_count,
    bytesTotal: Number(s.bytes_total),
    expiresAt: s.expires_at,
    caps: { maxVideos: MAX_VIDEOS, maxBytes: MAX_BYTES },
  });
});

// POST /api/capture/:companyToken/upload-url { mimeType, filename, byteLength }
// Mints a signed PUT so the phone uploads the room video straight to GCS.
// Counters increment atomically UP FRONT (single conditional UPDATE); an
// abandoned upload therefore consumes cap — acceptable v1 honesty, the cap
// exists to bound abuse, not to meter billing.
router.post('/:companyToken/upload-url', rateLimits.captureLimiter, guestAuth, requireActiveSession, express.json(), async (req, res) => {
  const mimeType = String(req.body?.mimeType || '');
  const filename = String(req.body?.filename || 'walkthrough');
  const byteLength = Number(req.body?.byteLength);

  if (!mimeType.startsWith('video/')) {
    return res.status(400).json({ error: 'Only videos can be uploaded here' });
  }
  if (!Number.isFinite(byteLength) || byteLength <= 0) {
    return res.status(400).json({ error: 'byteLength is required' });
  }
  if (byteLength > MAX_BYTES) {
    return res.status(403).json({ error: BYTES_CAP_MESSAGE });
  }

  try {
    const updated = await db.oneOrNone(
      `UPDATE company_capture_sessions
       SET videos_count = videos_count + 1, bytes_total = bytes_total + $2
       WHERE id = $1 AND status = 'active'
         AND videos_count < $3
         AND bytes_total + $2 <= $4
       RETURNING videos_count, bytes_total`,
      [req.capture.session.id, Math.round(byteLength), MAX_VIDEOS, MAX_BYTES]
    );
    if (!updated) {
      // Which cap? Re-read for the honest message.
      const s = await db.oneOrNone(
        `SELECT videos_count, bytes_total FROM company_capture_sessions WHERE id = $1`,
        [req.capture.session.id]
      );
      const overVideos = s && s.videos_count >= MAX_VIDEOS;
      return res.status(403).json({ error: overVideos ? VIDEO_CAP_MESSAGE : BYTES_CAP_MESSAGE });
    }

    const asset = await mediaAssetService.reserveUpload({
      userId: req.capture.userId,
      mimeType,
      originalName: filename,
      source: 'company_capture',
      declaredSize: Math.round(byteLength),
    });
    res.json({
      uploadUrl: asset.uploadUrl,
      url: asset.url,
      gcsPath: asset.gcsPath,
      mimeType: asset.mimeType,
      videosCount: updated.videos_count,
      bytesTotal: Number(updated.bytes_total),
    });
  } catch (err) {
    console.error('[companyCapture] upload-url failed:', err.message);
    // Give the reservation back so a transient GCS failure doesn't eat cap.
    db.none(
      `UPDATE company_capture_sessions
       SET videos_count = GREATEST(videos_count - 1, 0),
           bytes_total = GREATEST(bytes_total - $2, 0)
       WHERE id = $1`,
      [req.capture.session.id, Math.round(byteLength)]
    ).catch(() => {});
    res.status(500).json({ error: 'Could not create an upload URL. Please try again.' });
  }
});

// POST /api/capture/:companyToken/scan-jobs { mediaUrl, mimeType, roomHint, idempotencyKey }
router.post('/:companyToken/scan-jobs', rateLimits.captureLimiter, guestAuth, requireActiveSession, express.json(), async (req, res) => {
  const userId = req.capture.userId;
  const mediaUrl = String(req.body?.mediaUrl || '').trim();
  const mimeType = req.body?.mimeType ? String(req.body.mimeType) : null;
  const roomHint = req.body?.roomHint ? String(req.body.roomHint).trim().slice(0, 255) : null;

  if (!mediaUrl || !scanJobs.isAllowedMediaUrl(mediaUrl, userId)) {
    return res.status(400).json({ error: 'mediaUrl must point at your uploaded media' });
  }
  if (!roomHint) {
    return res.status(400).json({ error: 'roomHint (the room name) is required' });
  }

  // Prefix the idempotency key with the capture session id — this is also
  // how scanJobService threads 'capture:{sessionId}:{jobId}' into
  // scan_events.request_id for forensics (no new columns).
  const clientKey = req.body?.idempotencyKey
    ? String(req.body.idempotencyKey).slice(0, 32)
    : crypto.randomBytes(6).toString('hex');
  const idempotencyKey = `capture:${req.capture.session.id}:${clientKey}`.slice(0, 80);

  try {
    const { job, created } = await scanJobs.createJob(userId, {
      mediaUrl,
      mimeType,
      roomHint,
      idempotencyKey,
      plan: 'basic',
    });
    res.status(created ? 201 : 200).json(scanJobs.toDTO(job));
  } catch (err) {
    console.error('[companyCapture] create scan job failed:', err.message);
    res.status(500).json({ error: 'Could not start the scan. Please try again.' });
  }
});

// GET /api/capture/:companyToken/scan-jobs/:id — poll status. Guests don't
// curate a review card, so the FIRST poll that sees a completed job commits
// its items to the guest inventory (markConsumed is the atomic once-only
// latch — a concurrent poll loses the UPDATE and commits nothing).
router.get('/:companyToken/scan-jobs/:id', rateLimits.captureLimiter, guestAuth, async (req, res) => {
  const userId = req.capture.userId;
  const id = String(req.params.id || '');
  if (!scanJobs.UUID_RE.test(id)) {
    return res.status(400).json({ error: 'Invalid scan job id' });
  }

  try {
    const job = await scanJobs.getJob(userId, id);
    if (!job) return res.status(404).json({ error: 'Scan job not found' });

    let committedCount = null;
    if (job.status === 'completed' && !job.consumed_at) {
      const won = await scanJobs.markConsumed(userId, id);
      if (won) {
        committedCount = 0;
        const items = Array.isArray(job.result?.items) ? job.result.items : [];
        for (const it of items) {
          try {
            const result = await inventoryMutation.addItem(userId, {
              name: String(it.name || 'Item').slice(0, 200),
              room_name: String(it.room || job.room_hint || 'Unsorted').slice(0, 120),
              quantity: Number.isFinite(Number(it.quantity)) && Number(it.quantity) > 0 ? Math.floor(Number(it.quantity)) : 1,
              weight_lbs: Number(it.weightLbs) > 0 ? Number(it.weightLbs) : undefined,
              length_in: Number(it.lengthIn) > 0 ? Number(it.lengthIn) : undefined,
              width_in: Number(it.widthIn) > 0 ? Number(it.widthIn) : undefined,
              height_in: Number(it.heightIn) > 0 ? Number(it.heightIn) : undefined,
              material: it.material ? String(it.material).slice(0, 60) : undefined,
              fragile: it.fragile === true,
              picture_url: typeof it.pictureUrl === 'string' ? it.pictureUrl : undefined,
              confidence_score: Number(it.confidence) > 0 ? Number(it.confidence) : undefined,
              confidence_source: 'scan_review',
            });
            if (result?.success) committedCount++;
          } catch (err) {
            console.error(`[companyCapture] auto-commit item failed for job ${id}:`, err.message);
          }
        }
      }
    }

    const dto = scanJobs.toDTO(job);
    res.json(committedCount === null ? dto : { ...dto, committedCount });
  } catch (err) {
    console.error('[companyCapture] get scan job failed:', err.message);
    res.status(500).json({ error: 'Could not fetch the scan status. Please try again.' });
  }
});

// POST /api/capture/:companyToken/complete — share link + company email.
// Idempotent: a completed session returns its existing share without
// re-emailing the company.
router.post('/:companyToken/complete', rateLimits.captureLimiter, guestAuth, express.json(), async (req, res) => {
  const s = req.capture.session;

  try {
    if (s.status === 'completed') {
      const existing = await db.oneOrNone(
        `SELECT token FROM inventory_shares
         WHERE user_id = $1 AND revoked_at IS NULL
         ORDER BY created_at DESC LIMIT 1`,
        [s.user_id]
      );
      if (existing) {
        return res.json({ shareUrl: shareService.shareUrl(existing.token), alreadyCompleted: true });
      }
      // Fall through: completed but somehow shareless — mint one.
    }

    const share = await shareService.createShare(s.user_id, {
      title: `${s.company_name} — walkthrough from ${s.customer_email}`,
    });

    await db.none(
      `UPDATE company_capture_sessions SET status = 'completed', completed_at = NOW() WHERE id = $1`,
      [s.id]
    );

    // Best-effort notifications — a mail failure NEVER fails the request;
    // the share link in the response is the source of truth.
    try {
      await sendMail({
        to: s.company_contact_email,
        subject: `New walkthrough from ${s.customer_email}`,
        text: `${s.customer_email} completed a video walkthrough through your Nexus Moves capture link.\n\n`
          + `View the inventory (item list + playable room videos):\n${share.url}\n\n`
          + `Rooms filmed: ${s.videos_count}\n`,
      });
    } catch (err) {
      console.error(`[companyCapture] company notification failed for session ${s.id} (share is created):`, err.message);
    }
    try {
      await sendMail({
        to: s.customer_email,
        subject: `Your moving inventory for ${s.company_name}`,
        text: `Thanks for filming your walkthrough! Your inventory was sent to ${s.company_name}.\n\n`
          + `Here's your copy:\n${share.url}\n`,
      });
    } catch (err) {
      console.error(`[companyCapture] customer copy failed for session ${s.id} (share is created):`, err.message);
    }

    res.json({ shareUrl: share.url });
  } catch (err) {
    console.error('[companyCapture] complete failed:', err.message);
    res.status(500).json({ error: 'Could not finish up. Please try again.' });
  }
});

module.exports = router;
