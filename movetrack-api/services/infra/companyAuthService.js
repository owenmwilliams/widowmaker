'use strict';

/**
 * services/infra/companyAuthService.js
 *
 * Magic-link auth for MOVING COMPANIES (mover dashboard, F2 #99) — a separate
 * lane from user auth (authService.js) by construction:
 *
 *   • Company tokens are OPAQUE RANDOM STRINGS with a `cmp_` prefix, not JWTs.
 *     Handed to user authenticate(), they fail jwt.verify immediately — there
 *     is no signature to check, so a company session can never impersonate a
 *     user (and never reaches the users/auth_tokens tables at all).
 *   • authenticateCompany() only accepts the `cmp_` shape and only consults
 *     company_auth_tokens. A user session JWT or a guest capture JWT (both
 *     dot-separated base64) fails the shape check before any DB lookup.
 *   • Storage is a separate table (company_auth_tokens), so revocation,
 *     expiry, and forensics never interleave with user auth_tokens rows.
 *
 * Conventions mirror authService: tokens are SHA-256 hashed at rest, magic
 * links are single-use with a 15-minute expiry, sessions last 30 days, and
 * logout marks used_at.
 */

const crypto = require('crypto');
const { db } = require('./db');

const MAGIC_LINK_EXPIRY_MINUTES = 15;
const SESSION_DAYS = 30;

// Opaque company session/link tokens: cmp_<64 hex>. The prefix makes the
// token class self-describing in logs (masked) and lets authenticateCompany
// reject foreign token shapes (user JWTs, guest JWTs) without a DB roundtrip.
const COMPANY_TOKEN_RE = /^cmp_[0-9a-f]{64}$/;

function generateCompanyToken() {
  return `cmp_${crypto.randomBytes(32).toString('hex')}`;
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function publicCompany(row) {
  return { id: row.id, name: row.name, contactEmail: row.contact_email };
}

/**
 * Issue a magic link for the company whose contact_email matches (case-
 * insensitive). Returns { company: null } when no company matches — the ROUTE
 * must still answer 200 with neutral copy (no account enumeration); only the
 * email decides where the link lands.
 *
 * Unlike user auth, an unknown email NEVER creates an account: companies are
 * minted by the admin (companyCapture.js), never by typing an email.
 */
async function createCompanyMagicLink(email, ipAddress, userAgent) {
  // is_active does NOT gate login: pausing the capture link (a settings
  // toggle on the dashboard) must never lock the company out of the
  // dashboard where they'd un-pause it.
  const normalized = String(email || '').toLowerCase().trim();
  const company = await db.oneOrNone(
    `SELECT id, name, contact_email FROM companies
     WHERE LOWER(contact_email) = $1
     ORDER BY created_at DESC
     LIMIT 1`,
    [normalized]
  );
  if (!company) return { company: null, token: null };

  const token = generateCompanyToken();
  const expiresAt = new Date(Date.now() + MAGIC_LINK_EXPIRY_MINUTES * 60 * 1000).toISOString();
  await db.none(
    `INSERT INTO company_auth_tokens (company_id, token_hash, purpose, expires_at, ip_address, user_agent)
     VALUES ($1, $2, 'magic_link', $3, $4, $5)`,
    [company.id, hashToken(token), expiresAt, ipAddress || null, userAgent || null]
  );
  return { company, token };
}

/**
 * Verify a magic-link token (single-use, unexpired) and mint a 30-day session
 * token. Returns null for any invalid token — the route maps that to one
 * generic 401; which check failed never leaks.
 */
async function verifyCompanyMagicLink(token, ipAddress, userAgent) {
  if (!COMPANY_TOKEN_RE.test(String(token || ''))) return null;
  const tokenHash = hashToken(token);

  // Atomic single-use claim: the UPDATE only wins while used_at IS NULL, so a
  // double-click or replay loses the race instead of minting two sessions.
  const claimed = await db.oneOrNone(
    `UPDATE company_auth_tokens
     SET used_at = NOW()
     WHERE token_hash = $1 AND purpose = 'magic_link'
       AND used_at IS NULL AND expires_at > NOW()
     RETURNING company_id`,
    [tokenHash]
  );
  if (!claimed) return null;

  const company = await db.oneOrNone(
    `SELECT id, name, contact_email FROM companies WHERE id = $1`,
    [claimed.company_id]
  );
  if (!company) return null;

  const sessionToken = generateCompanyToken();
  const sessionExpiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  await db.none(
    `INSERT INTO company_auth_tokens (company_id, token_hash, purpose, expires_at, ip_address, user_agent)
     VALUES ($1, $2, 'session', $3, $4, $5)`,
    [company.id, hashToken(sessionToken), sessionExpiresAt, ipAddress || null, userAgent || null]
  );
  return { sessionToken, company };
}

/** Revoke a company session (logout). Best-effort; unknown tokens are a no-op. */
async function revokeCompanySession(sessionToken) {
  if (!COMPANY_TOKEN_RE.test(String(sessionToken || ''))) return;
  await db.none(
    `UPDATE company_auth_tokens SET used_at = NOW()
     WHERE token_hash = $1 AND purpose = 'session' AND used_at IS NULL`,
    [hashToken(sessionToken)]
  );
}

/**
 * Express middleware: authenticate a COMPANY session and attach req.company
 * ({ id, name, contact_email, token, is_active, created_at }).
 *
 * Rejects user JWTs and guest capture JWTs by SHAPE (not `cmp_…` → 401)
 * before touching the database; the reverse direction is covered because a
 * `cmp_…` string can never pass jwt.verify in user authenticate() or
 * verifyGuestCaptureToken(). 401 means "bad token"; DB failures are 503 so
 * clients retry instead of logging the company out (authService precedent).
 */
async function authenticateCompany(req, res, next) {
  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized - No token provided' });
  }
  const token = authHeader.substring(7);
  if (!COMPANY_TOKEN_RE.test(token)) {
    return res.status(401).json({ error: 'Unauthorized - Invalid token' });
  }

  try {
    const row = await db.oneOrNone(
      `SELECT c.id, c.name, c.contact_email, c.token, c.is_active, c.created_at
       FROM company_auth_tokens t
       JOIN companies c ON c.id = t.company_id
       WHERE t.token_hash = $1 AND t.purpose = 'session'
         AND t.used_at IS NULL AND t.expires_at > NOW()`,
      [hashToken(token)]
    );
    if (!row) {
      return res.status(401).json({ error: 'Unauthorized - Invalid token' });
    }
    // Paused companies (is_active = FALSE) can still open the dashboard —
    // that's where they un-pause. is_active only gates the PUBLIC capture
    // link and new magic-link requests, never an existing session.
    req.company = row;
    next();
  } catch (err) {
    console.error('[companyAuth] authenticateCompany infra error:', err.message);
    res.status(503).json({ error: 'Service temporarily unavailable - please retry' });
  }
}

module.exports = {
  MAGIC_LINK_EXPIRY_MINUTES,
  SESSION_DAYS,
  COMPANY_TOKEN_RE,
  generateCompanyToken,
  hashToken,
  publicCompany,
  createCompanyMagicLink,
  verifyCompanyMagicLink,
  revokeCompanySession,
  authenticateCompany,
};
