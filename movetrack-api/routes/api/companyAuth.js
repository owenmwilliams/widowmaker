'use strict';

/**
 * routes/api/companyAuth.js
 *
 * Magic-link login for MOVING COMPANIES (mover dashboard, F2 #99). Mounted
 * PUBLICLY at /api/company/auth (allowlisted via the /api/company prefix in
 * middleware/auth.js); every endpoint carries its own gate:
 *
 *   POST /api/company/auth/request-link { email }
 *       If a company with that contact_email exists, mail a single-use
 *       15-minute magic link to {APP_BASE_URL}/mover/login?token=…
 *       ALWAYS answers 200 with neutral copy — an attacker cannot tell
 *       registered emails from strangers. Rate-limited per (email, IP).
 *
 *   POST /api/company/auth/verify { token }
 *       Single-use check → 30-day company session token (opaque `cmp_…`
 *       string, hashed at rest) → { sessionToken, company }.
 *
 *   POST /api/company/auth/logout
 *       Revokes the presented session token. Best-effort, always 200.
 *
 * Isolation from user auth (see services/infra/companyAuthService.js):
 * company tokens are opaque `cmp_…` strings, never JWTs, and live in
 * company_auth_tokens — a company session fails user authenticate() at
 * jwt.verify, and user/guest JWTs fail authenticateCompany's shape check.
 */

const express = require('express');
const nodemailer = require('nodemailer');
const rateLimits = require('../../config/rateLimits');
const companyAuth = require('../../services/infra/companyAuthService');

const router = express.Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const isProduction = process.env.NODE_ENV === 'production';

function appBaseUrl() {
  return (process.env.APP_BASE_URL || 'https://movetrack-app-7hwn7ggbiq-uc.a.run.app').replace(/\/$/, '');
}

// Same SMTP transport shape as companyCapture.js / quoteLeads.js: SendGrid
// SMTP via SMTP_* env, built per-request so config changes need no restart;
// null when credentials are absent (local dev) — then the link is logged.
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

/** Mail the dashboard magic link. Throws are caught by the caller. */
async function sendCompanyMagicLinkEmail(company, token) {
  const link = `${appBaseUrl()}/mover/login?token=${token}`;

  // SECURITY: never log the full link in production (authService precedent);
  // in dev it IS the login path, so log it loudly.
  if (!isProduction) {
    console.log('\n' + '='.repeat(80));
    console.log('COMPANY DASHBOARD MAGIC LINK (development only)');
    console.log('='.repeat(80));
    console.log(`Company: ${company.name} <${company.contact_email}>`);
    console.log(`Link: ${link}`);
    console.log('='.repeat(80) + '\n');
  } else {
    const masked = company.contact_email.replace(/^(.).*(@.*)$/, '$1***$2');
    console.log(`[companyAuth] magic link generated for ${masked} (expires in ${companyAuth.MAGIC_LINK_EXPIRY_MINUTES}m)`);
  }

  const transporter = buildTransporter();
  if (!transporter) {
    console.warn('[companyAuth] NO EMAIL TRANSPORT — magic link logged above (dev only)');
    return;
  }
  await transporter.sendMail({
    from: process.env.EMAIL_FROM || 'owen@we3kings.dev',
    to: company.contact_email,
    subject: 'Your Nexus Moves dashboard login link',
    text: `Click the link below to open your ${company.name} dashboard. It expires in ${companyAuth.MAGIC_LINK_EXPIRY_MINUTES} minutes and works once.\n\n`
      + `${link}\n\n`
      + `If you didn't request this, you can safely ignore this email.\n`,
  });
}

// The one neutral answer for request-link: identical for registered and
// unknown emails, and even for malformed ones past basic shape (a 400 there
// reveals nothing — the format is public knowledge).
const NEUTRAL_MESSAGE =
  "If that email manages a company on Nexus Moves, a login link is on its way. It expires in 15 minutes.";

// ── POST /api/company/auth/request-link ──────────────────────────────────────
router.post('/request-link', rateLimits.companyAuthRequestLimiter, express.json(), async (req, res) => {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  if (!email || email.length > 255 || !EMAIL_RE.test(email)) {
    return res.status(400).json({ error: 'A valid email is required' });
  }

  try {
    const { company, token } = await companyAuth.createCompanyMagicLink(
      email,
      req.ip,
      req.get('user-agent')
    );

    if (company && token) {
      // Best-effort mail — a transport failure must not turn into a
      // distinguishable error response (that would leak registration).
      try {
        await sendCompanyMagicLinkEmail(company, token);
      } catch (err) {
        console.error('[companyAuth] magic link email failed (answer stays neutral):', err.message);
      }
    }

    res.json({ success: true, message: NEUTRAL_MESSAGE });
  } catch (err) {
    console.error('[companyAuth] request-link failed:', err.message);
    res.status(500).json({ error: 'Could not process the request. Please try again.' });
  }
});

// ── POST /api/company/auth/verify ────────────────────────────────────────────
router.post('/verify', rateLimits.companyAuthVerifyLimiter, express.json(), async (req, res) => {
  const token = typeof req.body?.token === 'string' ? req.body.token.trim() : '';
  if (!token) {
    return res.status(400).json({ error: 'Token is required' });
  }

  try {
    const result = await companyAuth.verifyCompanyMagicLink(token, req.ip, req.get('user-agent'));
    if (!result) {
      return res.status(401).json({ error: 'This login link is invalid or has expired. Request a fresh one.' });
    }
    res.json({
      sessionToken: result.sessionToken,
      company: companyAuth.publicCompany(result.company),
    });
  } catch (err) {
    console.error('[companyAuth] verify failed:', err.message);
    res.status(500).json({ error: 'Could not verify the link. Please try again.' });
  }
});

// ── POST /api/company/auth/logout ────────────────────────────────────────────
router.post('/logout', rateLimits.companyAuthVerifyLimiter, express.json(), async (req, res) => {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.substring(7) : null;
  try {
    if (token) await companyAuth.revokeCompanySession(token);
  } catch (err) {
    console.error('[companyAuth] logout failed (client clears local state regardless):', err.message);
  }
  res.json({ success: true });
});

module.exports = router;
