/**
 * routes/api/move/quoteLeads.js
 *
 * Lean quote-shopping lead-gen (#90). The QuoteShoppingModal tier picker used
 * to make zero API calls — choosing a tier was pure theater. A tier confirm
 * now lands here: the lead is persisted to quote_leads and the owner is
 * notified by email (best-effort — a mail failure NEVER fails the request;
 * the row is the source of truth). Quotes are brokered manually for now.
 *
 *   POST /api/move/quote-leads  — authenticated; create a lead
 *   GET  /api/move/quote-leads  — admin only; list recent leads
 *
 * Mounted in ./index.js BEFORE the /move moves router so the moves router's
 * '/:id' params never swallow 'quote-leads'.
 */

const express = require('express');
const router = express.Router();
const nodemailer = require('nodemailer');
const { authenticate } = require('../../../services/infra/authService');
const { db } = require('../../../services/infra/db');

router.use(authenticate);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Same SMTP transport shape as routes/admin/email.js / authService (SendGrid
// SMTP via SMTP_* env). Built per-request so config changes need no restart;
// null when credentials are absent (local dev) — we then log the lead loudly.
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

// Best-effort owner notification. Throws are caught by the caller.
async function notifyOwner(lead) {
  const to = process.env.QUOTE_LEAD_NOTIFY_EMAIL || 'support@we3kings.dev';
  const summary = lead.move_summary ? JSON.stringify(lead.move_summary, null, 2) : '(none)';
  const lines = [
    `Tier: ${lead.tier}`,
    `Contact email: ${lead.contact_email}`,
    `Contact phone: ${lead.contact_phone || '(none)'}`,
    `User: ${lead.user_email || lead.user_id}`,
    `Lead id: ${lead.id}`,
    `Move summary: ${summary}`,
  ];

  const transporter = buildTransporter();
  if (!transporter) {
    // No SMTP configured — make the lead impossible to miss in the logs.
    console.warn('[quoteLeads] NO EMAIL TRANSPORT — new quote lead logged only:\n' + lines.join('\n'));
    return;
  }

  await transporter.sendMail({
    from: process.env.EMAIL_FROM || 'owen@we3kings.dev',
    to,
    subject: `New quote lead — ${lead.tier} (${lead.contact_email})`,
    text: `A new quote-shopping lead was submitted.\n\n${lines.join('\n')}\n`,
  });
  console.log(`[quoteLeads] owner notified of lead ${lead.id}`);
}

// ── POST /api/move/quote-leads ────────────────────────────────────────────────
router.post('/', async (req, res) => {
  const userId = req.user?.user_id;
  if (!userId) return res.status(400).json({ error: 'User not authenticated' });

  const body = req.body || {};
  const tier = typeof body.tier === 'string' ? body.tier.trim().toLowerCase() : '';
  const contactEmail = typeof body.contact_email === 'string' ? body.contact_email.trim() : '';
  const contactPhone = typeof body.contact_phone === 'string' ? body.contact_phone.trim().slice(0, 40) : null;
  const savedMoveIdNum = Number(body.saved_move_id);
  const savedMoveId = Number.isInteger(savedMoveIdNum) && savedMoveIdNum > 0 ? savedMoveIdNum : null;
  const moveSummary = body.move_summary && typeof body.move_summary === 'object' ? body.move_summary : null;

  if (!tier || tier.length > 40) {
    return res.status(400).json({ error: 'A service tier is required' });
  }
  if (!contactEmail || contactEmail.length > 255 || !EMAIL_RE.test(contactEmail)) {
    return res.status(400).json({ error: 'A valid contact email is required' });
  }

  let lead;
  try {
    lead = await db.one(
      `INSERT INTO quote_leads (user_id, saved_move_id, tier, contact_email, contact_phone, move_summary)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb)
       RETURNING id, tier, status, created_at`,
      [userId, savedMoveId, tier, contactEmail, contactPhone || null, moveSummary ? JSON.stringify(moveSummary) : null]
    );
  } catch (err) {
    console.error('[quoteLeads] createLead:', err.message);
    return res.status(500).json({ error: 'Failed to submit quote request' });
  }

  // Best-effort notification — never fail the request over email.
  try {
    await notifyOwner({
      ...lead,
      contact_email: contactEmail,
      contact_phone: contactPhone,
      move_summary: moveSummary,
      user_id: userId,
      user_email: req.user?.email,
    });
  } catch (err) {
    console.error(`[quoteLeads] owner notification failed for lead ${lead.id} (lead is persisted):`, err.message);
  }

  res.status(200).json({ id: lead.id, tier: lead.tier, status: lead.status, created_at: lead.created_at });
});

// ── GET /api/move/quote-leads ─────────────────────────────────────────────────
// Admin only. requireProOrAdmin is too loose here (any Pro user would see every
// lead's contact info), so gate on is_admin directly.
router.get('/', async (req, res) => {
  if (!req.user?.is_admin) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  try {
    const rows = await db.any(
      `SELECT id, user_id, saved_move_id, tier, contact_email, contact_phone, move_summary, status, created_at
       FROM quote_leads
       ORDER BY created_at DESC
       LIMIT 200`
    );
    res.json(rows);
  } catch (err) {
    console.error('[quoteLeads] listLeads:', err.message);
    res.status(500).json({ error: 'Failed to fetch quote leads' });
  }
});

module.exports = router;
