'use strict';

/**
 * routes/api/discover.js
 *
 * Discover moving companies — invite-loop v1 (F3, issue #100). The customer
 * searches REAL moving companies near their move origin and sends up to five
 * of them their inventory doc, building mover supply from customer demand.
 *
 * Mounted at /api/discover behind the NORMAL user auth (the global
 * default-deny gate in middleware/auth.js authenticates every /api/discover
 * request; router.use(authenticate) below is the usual defense-in-depth).
 *
 *   GET  /api/discover/movers?moveId=…
 *       Resolve the saved move's origin (lat/lng on the location row, else
 *       forward-geocode its address; no moveId → the user's primary
 *       residence), then Google Places Nearby Search (type=moving_company,
 *       ≤50km) → top 12 with name/address/rating/place_id + onNexus flag.
 *       Results are cached in-memory per (user, move) for 24h — a customer
 *       browsing back and forth never hammers Places. No Places key → 503
 *       with honest copy; we NEVER fake results.
 *
 *   POST /api/discover/invite { moveId?, selections: [{place_id, name}] ≤5, message? }
 *       Create/reuse the customer's inventory share link, insert a
 *       mover_invites row per selection, and:
 *         • business already on Nexus → email its contact_email the share
 *           link + dashboard link directly (delivery: 'emailed').
 *         • not on Nexus → Google Places does NOT return business emails, so
 *           we cannot email them. HONEST v1 contact strategy: mint a
 *           single-use claim link {APP}/mover/claim/{inviteToken} and hand
 *           the CUSTOMER a prewritten message + mailto: to forward themselves
 *           (delivery: 'forward').
 *       Hard caps: ≤5 selections per request, ≤10 invites per rolling day
 *       per user (counted in SQL against mover_invites — restarts don't
 *       reset it).
 *
 * "On Nexus" matching is CONSERVATIVE (a false badge is worse than a miss):
 *   1. place_ref of a previously CLAIMED invite → that company, always.
 *   2. Normalized-name match only when EXACTLY ONE active company carries
 *      that normalized name (companies have no stored locality to
 *      disambiguate franchises, so any ambiguity → no match).
 */

const express = require('express');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const { db } = require('../../services/infra/db');
const { authenticate } = require('../../services/infra/authService');
const rateLimits = require('../../config/rateLimits');
const geocoding = require('../../services/infra/geocodingService');
// Read the key through the module (not destructured) so its presence is
// checked per-request — config changes and tests see the live value.
const googleConfig = require('../../config/google');
const shareService = require('../../services/inventory/shareService');

const router = express.Router();

router.use(authenticate);

const MAX_SELECTIONS = 5;
const DAILY_INVITE_CAP = 10;
const MAX_RESULTS = 12;
const SEARCH_RADIUS_METERS = 50000; // ~50km, Google's Nearby Search ceiling
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

const NOT_CONFIGURED_MESSAGE =
  'Mover search is not available right now — the maps service is not configured on this server. Your inventory and share links still work; try again later.';

function appBaseUrl() {
  return (process.env.APP_BASE_URL || 'https://movetrack-app-7hwn7ggbiq-uc.a.run.app').replace(/\/$/, '');
}

// Same SMTP transport shape as companyCapture.js / quoteLeads.js (#92):
// SendGrid SMTP via SMTP_* env, built per-request; null in local dev.
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

/** Best-effort mail. Throws so callers can record delivery failure honestly. */
async function sendMail({ to, subject, text }) {
  const transporter = buildTransporter();
  if (!transporter) {
    console.warn(`[discover] NO EMAIL TRANSPORT — would have mailed ${to}: ${subject}\n${text}`);
    return;
  }
  await transporter.sendMail({
    from: process.env.EMAIL_FROM || 'owen@we3kings.dev',
    to,
    subject,
    text,
  });
}

// ── In-memory search cache ────────────────────────────────────────────────────
// Key: `${userId}:${moveId||'primary'}` → { payload, timestamp }. One Places
// call per customer per move per day; a redeploy just re-fetches.
const searchCache = new Map();

function cacheGet(key) {
  const entry = searchCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
    searchCache.delete(key);
    return null;
  }
  return entry.payload;
}

function cacheSet(key, payload) {
  searchCache.set(key, { payload, timestamp: Date.now() });
}

/** Test hook — cached Places results would otherwise leak across tests. */
function __resetDiscoverCache() {
  searchCache.clear();
}

// ── Origin resolution ─────────────────────────────────────────────────────────

/**
 * Resolve the search origin for a user: the saved move's origin location
 * (scoped to the user) when moveId is given, else the primary residence.
 * Returns { location } or { error: { status, message } }.
 */
async function resolveOrigin(userId, moveId) {
  let location = null;

  if (moveId != null) {
    const idNum = Number(moveId);
    if (!Number.isInteger(idNum) || idNum <= 0) {
      return { error: { status: 400, message: 'moveId must be a positive integer' } };
    }
    const row = await db.oneOrNone(
      `SELECT l.id, l.name, l.address, l.city, l.state, l.zip, l.lat, l.lng
       FROM saved_moves sm
       JOIN locations l ON l.id = sm.origin_location_id
       WHERE sm.id = $1 AND sm.user_id = $2`,
      [idNum, userId]
    );
    if (!row) {
      return { error: { status: 404, message: 'Move not found, or it has no origin address yet' } };
    }
    location = row;
  } else {
    location = await db.oneOrNone(
      `SELECT id, name, address, city, state, zip, lat, lng
       FROM locations
       WHERE user_id = $1 AND location_type = 'primary_residence'
       ORDER BY created_at ASC
       LIMIT 1`,
      [userId]
    );
    if (!location) {
      return { error: { status: 404, message: 'Add your current home address first — that is where we search for movers.' } };
    }
  }

  let lat = location.lat != null ? Number(location.lat) : null;
  let lng = location.lng != null ? Number(location.lng) : null;

  if (!(Number.isFinite(lat) && Number.isFinite(lng))) {
    // Geocode the stored address; geocodingService caches for 24h itself.
    const fullAddress = [location.address, location.city, location.state, location.zip]
      .filter(Boolean).join(', ');
    const geo = await geocoding.forwardGeocode(location.city, location.state, 'USA', {
      correlationId: 'discover',
      addressOverride: fullAddress || null,
    });
    if (geo.lat == null || geo.lng == null) {
      return {
        error: {
          status: 422,
          message: "We couldn't place your origin address on the map. Add a city and state to your origin location and try again.",
        },
      };
    }
    lat = geo.lat;
    lng = geo.lng;
  }

  return {
    location: {
      name: location.name || null,
      city: location.city || null,
      state: location.state || null,
      lat,
      lng,
    },
  };
}

// ── Conservative "on Nexus" matching ──────────────────────────────────────────

// Lowercase, strip punctuation, collapse whitespace, drop trailing legal
// suffixes. Deliberately does NOT strip words like "moving"/"movers" — that
// would collapse half the industry onto each other.
function normalizeBusinessName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[.'’]/g, '') // "L.L.C." → "llc", "Bob's" → "bobs"
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\s+(llc|inc|co|corp|ltd|incorporated|corporation|company)$/g, '')
    .trim();
}

/**
 * Map Google place results to Nexus companies. Returns
 * Map<place_id, { companyId, companyName, contactEmail }>.
 *
 * Conservative by design: (1) a place_ref that a company CLAIMED through an
 * invite is authoritative; (2) a normalized-name match only counts when
 * exactly one active company has that name (no locality on companies to
 * disambiguate) and the normalized name is non-trivially long.
 */
async function matchNexusCompanies(places) {
  const matches = new Map();
  if (!places.length) return matches;

  const placeIds = places.map((p) => p.placeId).filter(Boolean);
  if (placeIds.length) {
    const claimed = await db.any(
      `SELECT DISTINCT ON (mi.place_ref) mi.place_ref, c.id, c.name, c.contact_email
       FROM mover_invites mi
       JOIN companies c ON c.id = mi.company_id
       WHERE mi.place_ref IN ($1:csv) AND mi.status = 'claimed'
       ORDER BY mi.place_ref, mi.claimed_at DESC`,
      [placeIds]
    );
    for (const row of claimed) {
      matches.set(row.place_ref, { companyId: row.id, companyName: row.name, contactEmail: row.contact_email });
    }
  }

  // Name pass for the rest. Companies list is small in v1; bounded regardless.
  const unmatched = places.filter((p) => !matches.has(p.placeId));
  if (unmatched.length) {
    const companies = await db.any(
      `SELECT id, name, contact_email FROM companies WHERE is_active = TRUE LIMIT 500`
    );
    const byNormalized = new Map(); // normalized name -> [company]
    for (const c of companies) {
      const key = normalizeBusinessName(c.name);
      if (!key) continue;
      if (!byNormalized.has(key)) byNormalized.set(key, []);
      byNormalized.get(key).push(c);
    }
    for (const place of unmatched) {
      const key = normalizeBusinessName(place.name);
      if (key.length < 5) continue; // too generic to trust
      const candidates = byNormalized.get(key);
      if (candidates && candidates.length === 1) {
        const c = candidates[0];
        matches.set(place.placeId, { companyId: c.id, companyName: c.name, contactEmail: c.contact_email });
      }
    }
  }

  return matches;
}

// ── GET /api/discover/movers ──────────────────────────────────────────────────

function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

router.get('/movers', rateLimits.discoverSearchLimiter, async (req, res) => {
  const userId = req.user?.user_id;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  // Honest degrade: without a Places key there ARE no results to show.
  if (!googleConfig.GOOGLE_API_KEY) {
    return res.status(503).json({ error: NOT_CONFIGURED_MESSAGE });
  }

  const moveId = req.query.moveId != null && req.query.moveId !== '' ? req.query.moveId : null;

  try {
    const origin = await resolveOrigin(userId, moveId);
    if (origin.error) return res.status(origin.error.status).json({ error: origin.error.message });
    const loc = origin.location;

    const cacheKey = `${userId}:${moveId || 'primary'}`;
    const cached = cacheGet(cacheKey);
    if (cached) return res.json({ ...cached, cached: true });

    const data = await geocoding.searchNearbyMovingCompanies(loc.lat, loc.lng, {
      radiusMeters: SEARCH_RADIUS_METERS,
    });

    if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
      console.error(`[discover] Places search failed: ${data.status} — ${data.error_message || 'no message'}`);
      return res.status(503).json({ error: NOT_CONFIGURED_MESSAGE });
    }

    const places = (Array.isArray(data.results) ? data.results : [])
      .filter((r) => r.business_status !== 'CLOSED_PERMANENTLY')
      .slice(0, MAX_RESULTS)
      .map((r) => ({
        placeId: r.place_id,
        name: r.name,
        address: r.vicinity || r.formatted_address || null,
        rating: Number.isFinite(Number(r.rating)) ? Number(r.rating) : null,
        userRatingCount: Number.isFinite(Number(r.user_ratings_total)) ? Number(r.user_ratings_total) : 0,
        distanceKm: r.geometry?.location
          ? Math.round(haversineKm(loc.lat, loc.lng, r.geometry.location.lat, r.geometry.location.lng) * 10) / 10
          : null,
      }));

    const nexusMatches = await matchNexusCompanies(places);
    const movers = places.map((p) => {
      const match = nexusMatches.get(p.placeId);
      return {
        ...p,
        onNexus: !!match,
        companyId: match ? match.companyId : null,
      };
    });

    const payload = {
      origin: { name: loc.name, city: loc.city, state: loc.state },
      movers,
    };
    cacheSet(cacheKey, payload);
    res.json({ ...payload, cached: false });
  } catch (err) {
    console.error('[discover] movers search failed:', err.message);
    res.status(500).json({ error: 'Could not search for movers. Please try again.' });
  }
});

// ── POST /api/discover/invite ─────────────────────────────────────────────────

/** Reuse the customer's newest live share link, or mint one. */
async function getOrCreateShareUrl(userId, moveId) {
  const existing = await db.oneOrNone(
    `SELECT token FROM inventory_shares
     WHERE user_id = $1 AND revoked_at IS NULL
       AND (expires_at IS NULL OR expires_at > NOW())
     ORDER BY created_at DESC LIMIT 1`,
    [userId]
  );
  if (existing) return shareService.shareUrl(existing.token);
  const share = await shareService.createShare(userId, {
    moveId: moveId || null,
    title: 'Moving inventory',
  });
  return share.url;
}

function forwardMessage({ shareUrl, claimUrl, message }) {
  const custom = message ? `${message}\n\n` : '';
  return (
    `${custom}I built my moving inventory with Nexus Moves — here's everything I own, with weights, dimensions, and room videos:\n${shareUrl}\n\n` +
    `You can claim your free mover account here (dashboard + your own capture link):\n${claimUrl}\n`
  );
}

router.post('/invite', express.json(), async (req, res) => {
  const userId = req.user?.user_id;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  const body = req.body || {};
  const moveIdNum = Number(body.moveId);
  const moveId = Number.isInteger(moveIdNum) && moveIdNum > 0 ? moveIdNum : null;
  const message = typeof body.message === 'string' ? body.message.trim().slice(0, 500) : null;

  const selections = Array.isArray(body.selections) ? body.selections : [];
  if (!selections.length) {
    return res.status(400).json({ error: 'Pick at least one moving company' });
  }
  if (selections.length > MAX_SELECTIONS) {
    return res.status(400).json({ error: `You can send your inventory to at most ${MAX_SELECTIONS} companies at a time` });
  }

  // De-dupe by place_id and validate shape.
  const seen = new Set();
  const cleaned = [];
  for (const s of selections) {
    const placeId = typeof s?.place_id === 'string' ? s.place_id.trim().slice(0, 255) : '';
    const name = typeof s?.name === 'string' ? s.name.trim().slice(0, 255) : '';
    if (!placeId || !name) {
      return res.status(400).json({ error: 'Each selection needs a place_id and a name' });
    }
    if (seen.has(placeId)) continue;
    seen.add(placeId);
    cleaned.push({ placeId, name });
  }

  try {
    // Rolling daily cap, counted in SQL so restarts don't reset it.
    const { count } = await db.one(
      `SELECT COUNT(*)::int AS count FROM mover_invites
       WHERE user_id = $1 AND created_at > NOW() - INTERVAL '24 hours'`,
      [userId]
    );
    if (count + cleaned.length > DAILY_INVITE_CAP) {
      const remaining = Math.max(DAILY_INVITE_CAP - count, 0);
      return res.status(429).json({
        error: remaining > 0
          ? `You can send ${remaining} more invite${remaining === 1 ? '' : 's'} today (10/day). Unselect a few or try again tomorrow.`
          : "You've sent 10 invites in the last day — that's the daily limit. Try again tomorrow.",
        remainingToday: remaining,
      });
    }

    const shareUrl = await getOrCreateShareUrl(userId, moveId);
    const nexusMatches = await matchNexusCompanies(cleaned);

    const results = [];
    for (const sel of cleaned) {
      const match = nexusMatches.get(sel.placeId);

      if (match) {
        // Already on Nexus → the doc goes straight to their dashboard email.
        const invite = await db.one(
          `INSERT INTO mover_invites (user_id, company_id, place_ref, business_name, business_email, status, share_token_or_url)
           VALUES ($1, $2, $3, $4, $5, 'sent', $6)
           RETURNING id`,
          [userId, match.companyId, sel.placeId, sel.name, match.contactEmail, shareUrl]
        );
        let status = 'sent';
        try {
          await sendMail({
            to: match.contactEmail,
            subject: 'A customer sent you their inventory on Nexus Moves',
            text:
              `A customer moving near you sent ${match.companyName} their full moving inventory (item list, weights, room videos):\n${shareUrl}\n\n` +
              (message ? `Their note: ${message}\n\n` : '') +
              `It's also waiting in your dashboard:\n${appBaseUrl()}/mover/login\n`,
          });
        } catch (err) {
          console.error(`[discover] invite email to company ${match.companyId} failed:`, err.message);
          status = 'failed';
          await db.none(`UPDATE mover_invites SET status = 'failed' WHERE id = $1`, [invite.id]).catch(() => {});
        }
        results.push({
          placeId: sel.placeId,
          name: sel.name,
          onNexus: true,
          delivery: status === 'sent' ? 'emailed' : 'failed',
          status,
          // Email failed? Give the customer the honest fallback: the address
          // is known, they can send it themselves.
          ...(status === 'failed'
            ? {
                copyText: forwardMessage({ shareUrl, claimUrl: `${appBaseUrl()}/mover/login`, message }),
                mailto: `mailto:${match.contactEmail}?subject=${encodeURIComponent('My moving inventory')}&body=${encodeURIComponent(`Here is my full moving inventory: ${shareUrl}`)}`,
              }
            : {}),
        });
      } else {
        // Not on Nexus. Google Places does NOT return business emails, so we
        // cannot deliver directly — mint a single-use claim link and hand the
        // customer a message to forward. Recorded as 'sent' (the invite left
        // our hands in the only way it can).
        const inviteToken = crypto.randomBytes(16).toString('hex');
        await db.one(
          `INSERT INTO mover_invites (user_id, place_ref, business_name, status, share_token_or_url, invite_token)
           VALUES ($1, $2, $3, 'sent', $4, $5)
           RETURNING id`,
          [userId, sel.placeId, sel.name, shareUrl, inviteToken]
        );
        const claimUrl = `${appBaseUrl()}/mover/claim/${inviteToken}`;
        const copyText = forwardMessage({ shareUrl, claimUrl, message });
        results.push({
          placeId: sel.placeId,
          name: sel.name,
          onNexus: false,
          delivery: 'forward',
          status: 'sent',
          claimUrl,
          copyText,
          mailto: `mailto:?subject=${encodeURIComponent('My moving inventory — quote request')}&body=${encodeURIComponent(copyText)}`,
        });
      }
    }

    res.json({
      shareUrl,
      results,
      remainingToday: Math.max(DAILY_INVITE_CAP - count - results.length, 0),
    });
  } catch (err) {
    console.error('[discover] invite failed:', err.message);
    res.status(500).json({ error: 'Could not send your invites. Please try again.' });
  }
});

module.exports = router;
module.exports.__resetDiscoverCache = __resetDiscoverCache;
module.exports.normalizeBusinessName = normalizeBusinessName;
