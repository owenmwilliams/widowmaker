'use strict';

/**
 * routes/api/companyClaim.js
 *
 * Mover account claim via customer invite (F3, issue #100). When a customer
 * "finds movers" and one of them is NOT on Nexus, the invite carries a
 * single-use claim link {APP}/mover/claim/{inviteToken}. This router is what
 * that page talks to.
 *
 * Mounted PUBLICLY at /api/company/claim (inside the /api/company allowlist
 * prefix in middleware/auth.js, mounted in app.js BEFORE the portal router so
 * authenticateCompany never sees these paths); every endpoint carries its own
 * gate — rate limits + the unclaimed invite token itself:
 *
 *   GET  /api/company/claim/:inviteToken
 *       Lookup for the claim page: { businessName, status }. Unknown tokens
 *       are 404; a claimed token says so (the page renders an honest "already
 *       claimed" state instead of a dead form).
 *
 *   POST /api/company/claim { inviteToken, name, contact_email }
 *       Creates the companies row (same mint shape as the admin path in
 *       companyCapture.js — fresh capture token and all) but gated by the
 *       invite token instead of an admin session. SINGLE-USE ATOMIC like
 *       magic links: the invite row is claimed with SELECT … FOR UPDATE
 *       inside one transaction, so a double-submit creates exactly one
 *       company. On success: the new company gets a magic login link + the
 *       customer's shared doc by email, and the inviting customer is told
 *       "{Company} joined Nexus Moves". Best-effort mail — the claim itself
 *       is the source of truth.
 */

const express = require('express');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const { db } = require('../../services/infra/db');
const rateLimits = require('../../config/rateLimits');
const companyAuth = require('../../services/infra/companyAuthService');

const router = express.Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TOKEN_RE = /^[0-9a-f]{32}$/;
const isProduction = process.env.NODE_ENV === 'production';

function appBaseUrl() {
  return (process.env.APP_BASE_URL || 'https://movetrack-app-7hwn7ggbiq-uc.a.run.app').replace(/\/$/, '');
}

// Same SMTP transport shape as companyAuth.js / companyCapture.js.
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
    console.warn(`[companyClaim] NO EMAIL TRANSPORT — would have mailed ${to}: ${subject}\n${text}`);
    return;
  }
  await transporter.sendMail({
    from: process.env.EMAIL_FROM || 'owen@we3kings.dev',
    to,
    subject,
    text,
  });
}

// ── GET /api/company/claim/:inviteToken ──────────────────────────────────────
router.get('/:inviteToken', rateLimits.publicLimiter, async (req, res) => {
  const token = String(req.params.inviteToken || '');
  if (!TOKEN_RE.test(token)) {
    return res.status(404).json({ error: 'This invite link is not valid.' });
  }
  try {
    const invite = await db.oneOrNone(
      `SELECT business_name, status, claimed_at FROM mover_invites WHERE invite_token = $1`,
      [token]
    );
    if (!invite) return res.status(404).json({ error: 'This invite link is not valid.' });
    res.json({
      businessName: invite.business_name,
      status: invite.claimed_at ? 'claimed' : invite.status,
    });
  } catch (err) {
    console.error('[companyClaim] lookup failed:', err.message);
    res.status(500).json({ error: 'Could not load this invite. Please try again.' });
  }
});

// ── POST /api/company/claim ──────────────────────────────────────────────────
router.post('/', rateLimits.companyClaimLimiter, express.json(), async (req, res) => {
  const inviteToken = typeof req.body?.inviteToken === 'string' ? req.body.inviteToken.trim() : '';
  const name = typeof req.body?.name === 'string' ? req.body.name.trim().slice(0, 255) : '';
  const contactEmail = typeof req.body?.contact_email === 'string'
    ? req.body.contact_email.trim().toLowerCase()
    : '';

  if (!TOKEN_RE.test(inviteToken)) {
    return res.status(400).json({ error: 'This invite link is not valid.' });
  }
  if (!name) return res.status(400).json({ error: 'Company name is required' });
  if (!contactEmail || contactEmail.length > 255 || !EMAIL_RE.test(contactEmail)) {
    return res.status(400).json({ error: 'A valid contact email is required' });
  }

  let claimed;
  try {
    // Atomic single-use claim: lock the invite row, verify it's unclaimed,
    // mint the company, link it — all or nothing. A concurrent double-submit
    // blocks on the lock, then fails the status check.
    claimed = await db.tx(async (t) => {
      const invite = await t.oneOrNone(
        `SELECT id, user_id, business_name, share_token_or_url
         FROM mover_invites
         WHERE invite_token = $1 AND status = 'sent' AND claimed_at IS NULL
         FOR UPDATE`,
        [inviteToken]
      );
      if (!invite) return null;

      // Same mint shape as the admin path (companyCapture.js): url-safe,
      // unguessable capture token, active from day one.
      const captureToken = crypto.randomUUID().replace(/-/g, '');
      const company = await t.one(
        `INSERT INTO companies (name, contact_email, token)
         VALUES ($1, $2, $3)
         RETURNING id, name, contact_email, token`,
        [name, contactEmail, captureToken]
      );

      await t.none(
        `UPDATE mover_invites
         SET status = 'claimed', claimed_at = NOW(), company_id = $2, business_email = $3
         WHERE id = $1`,
        [invite.id, company.id, contactEmail]
      );

      return { invite, company };
    });
  } catch (err) {
    console.error('[companyClaim] claim failed:', err.message);
    return res.status(500).json({ error: 'Could not create your account. Please try again.' });
  }

  if (!claimed) {
    return res.status(410).json({
      error: 'This invite was already used or is no longer valid. If that was you, check your email for your login link — or log in at the mover dashboard.',
    });
  }

  const { invite, company } = claimed;

  // Magic login link for the new company — same hashed-at-rest single-use
  // token conventions as companyAuthService (insert directly against the new
  // company id; createCompanyMagicLink's email lookup could hit a different
  // company sharing the same contact email).
  let loginToken = null;
  try {
    loginToken = companyAuth.generateCompanyToken();
    const expiresAt = new Date(Date.now() + companyAuth.MAGIC_LINK_EXPIRY_MINUTES * 60 * 1000).toISOString();
    await db.none(
      `INSERT INTO company_auth_tokens (company_id, token_hash, purpose, expires_at, ip_address, user_agent)
       VALUES ($1, $2, 'magic_link', $3, $4, $5)`,
      [company.id, companyAuth.hashToken(loginToken), expiresAt, req.ip || null, req.get('user-agent') || null]
    );
  } catch (err) {
    // The account exists; they can request a fresh link from /mover/login.
    console.error('[companyClaim] magic link mint failed (account is created):', err.message);
    loginToken = null;
  }

  // SECURITY: never log the login link in production (companyAuth precedent).
  if (loginToken && !isProduction) {
    console.log(`[companyClaim] DEV login link for ${company.name}: ${appBaseUrl()}/mover/login?token=${loginToken}`);
  }

  // Welcome email: login link + the customer's shared doc that started this.
  try {
    await sendMail({
      to: contactEmail,
      subject: 'Welcome to Nexus Moves — your dashboard login link',
      text:
        `Your free ${company.name} mover account on Nexus Moves is ready.\n\n` +
        (loginToken
          ? `Log in to your dashboard (link works once, expires in ${companyAuth.MAGIC_LINK_EXPIRY_MINUTES} minutes):\n${appBaseUrl()}/mover/login?token=${loginToken}\n\n`
          : `Log in to your dashboard: ${appBaseUrl()}/mover/login (enter this email to get a login link).\n\n`) +
        (invite.share_token_or_url
          ? `The customer's inventory that was sent to you:\n${invite.share_token_or_url}\n\n`
          : '') +
        `Your dashboard includes your own capture link and an embeddable quote widget for your website.\n`,
    });
  } catch (err) {
    console.error(`[companyClaim] welcome email failed for company ${company.id} (account is created):`, err.message);
  }

  // Tell the inviting customer their invite landed.
  try {
    const customer = await db.oneOrNone(
      `SELECT email FROM users WHERE user_id = $1`,
      [invite.user_id]
    );
    if (customer?.email && !customer.email.endsWith('.invalid')) {
      await sendMail({
        to: customer.email,
        subject: `${company.name} joined Nexus Moves`,
        text:
          `Good news — ${company.name} accepted your invite and joined Nexus Moves.\n\n` +
          `They received your inventory and can now respond with a quote.\n`,
      });
    }
  } catch (err) {
    console.error(`[companyClaim] customer notification failed for invite ${invite.id}:`, err.message);
  }

  res.status(201).json({
    success: true,
    company: { name: company.name },
    message: 'Check your email for your login link.',
  });
});

module.exports = router;
