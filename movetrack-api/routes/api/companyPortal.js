'use strict';

/**
 * routes/api/companyPortal.js
 *
 * The mover dashboard API (F2, #99) — everything a logged-in moving company
 * sees at /mover. Mounted at /api/company (public prefix in
 * middleware/auth.js) with EVERY endpoint behind authenticateCompany, which
 * only accepts opaque `cmp_…` company session tokens — user JWTs and guest
 * capture JWTs are rejected by shape (see companyAuthService.js).
 *
 *   GET   /api/company/overview      profile + capture link + embed snippet
 *                                    + session counters (works day one, even
 *                                    with zero walkthroughs)
 *   GET   /api/company/walkthroughs  capture sessions newest first, with the
 *                                    guest inventory's item count and the
 *                                    share link once completed
 *   GET   /api/company/leads         quote requests — v1 returns [] with an
 *                                    honest note (see the route comment)
 *   PATCH /api/company/settings      { name?, contact_email?, is_active? }
 *
 * Scoping: every query filters on req.company.id from the verified session.
 * A company can only ever see its own sessions/counters — there is no id in
 * any path or body to tamper with.
 */

const express = require('express');
const { db } = require('../../services/infra/db');
const { authenticateCompany } = require('../../services/infra/companyAuthService');
const shareService = require('../../services/inventory/shareService');

const router = express.Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function appBaseUrl() {
  return (process.env.APP_BASE_URL || 'https://movetrack-app-7hwn7ggbiq-uc.a.run.app').replace(/\/$/, '');
}

// Same one-line widget embed the admin mint returns (companyCapture.js).
function embedSnippet(token) {
  return `<script src="${appBaseUrl()}/widget.js" data-nexus-token="${token}" async><\/script>`;
}

router.use(authenticateCompany);

// ── GET /api/company/overview ────────────────────────────────────────────────
router.get('/overview', async (req, res) => {
  const c = req.company;
  try {
    const counters = await db.one(
      `SELECT COUNT(*)::int AS sessions_total,
              COUNT(*) FILTER (WHERE status = 'completed')::int AS sessions_completed,
              COUNT(*) FILTER (WHERE source = 'widget')::int AS from_widget
       FROM company_capture_sessions
       WHERE company_id = $1`,
      [c.id]
    );
    res.json({
      company: {
        id: c.id,
        name: c.name,
        contactEmail: c.contact_email,
        isActive: c.is_active,
        createdAt: c.created_at,
      },
      captureUrl: `${appBaseUrl()}/c/${c.token}`,
      embedSnippet: embedSnippet(c.token),
      counters: {
        sessionsTotal: counters.sessions_total,
        sessionsCompleted: counters.sessions_completed,
        fromWidget: counters.from_widget,
      },
    });
  } catch (err) {
    console.error('[companyPortal] overview failed:', err.message);
    res.status(500).json({ error: 'Could not load your overview. Please try again.' });
  }
});

// ── GET /api/company/walkthroughs ────────────────────────────────────────────
// One row per capture session, newest first. Item count comes from the guest
// user's inventory (guests are always a fresh users row, so their items are
// exactly this walkthrough's items); shareUrl is the newest unrevoked share
// for that guest — the same one the company was emailed on completion.
router.get('/walkthroughs', async (req, res) => {
  try {
    const rows = await db.any(
      `SELECT s.id, s.customer_email, s.status, s.source, s.videos_count,
              s.created_at, s.completed_at,
              COALESCE(ic.items_count, 0)::int AS items_count,
              sh.token AS share_token
       FROM company_capture_sessions s
       LEFT JOIN LATERAL (
         SELECT COALESCE(SUM(GREATEST(i.quantity, 1)), 0) AS items_count
         FROM items i WHERE i.user_id = s.user_id
       ) ic ON TRUE
       LEFT JOIN LATERAL (
         SELECT token FROM inventory_shares
         WHERE user_id = s.user_id AND revoked_at IS NULL
         ORDER BY created_at DESC LIMIT 1
       ) sh ON TRUE
       WHERE s.company_id = $1
       ORDER BY s.created_at DESC
       LIMIT 200`,
      [req.company.id]
    );
    res.json({
      walkthroughs: rows.map((r) => ({
        id: r.id,
        customerEmail: r.customer_email,
        status: r.status,
        source: r.source,
        videosCount: r.videos_count,
        itemsCount: r.items_count,
        createdAt: r.created_at,
        completedAt: r.completed_at,
        // The share only becomes the company's to open once the customer
        // finished ("I'm done" completes the session and emails this link).
        shareUrl: r.status === 'completed' && r.share_token ? shareService.shareUrl(r.share_token) : null,
      })),
    });
  } catch (err) {
    console.error('[companyPortal] walkthroughs failed:', err.message);
    res.status(500).json({ error: 'Could not load your walkthroughs. Please try again.' });
  }
});

// ── GET /api/company/leads ───────────────────────────────────────────────────
// v1 DECISION: quote_leads predates companies and has NO company_id — leads
// are Nexus customers picking a service tier, brokered manually by the owner
// (#90/#92). There is no defensible way to attribute them to a company
// (matching contact_email domains would misfire on gmail/yahoo and leak
// other companies' prospects on a false positive), and refactoring
// quote_leads is out of scope here. So v1 returns an empty list with an
// honest note the dashboard renders as-is. When lead routing ships, this
// endpoint's shape already fits: { leads: [...], note? }.
router.get('/leads', async (req, res) => {
  res.json({
    leads: [],
    note: 'Quote leads from your website widget land here once lead routing launches. Walkthrough requests already appear under Walkthroughs.',
  });
});

// ── PATCH /api/company/settings ──────────────────────────────────────────────
// { name?, contact_email?, is_active? } — v1 keeps the email change simple:
// it takes effect immediately for notifications AND FUTURE LOGINS, but the
// magic link that authorizes any session was sent to the email on file at
// request time, so only someone who controls the CURRENT inbox can have a
// session to change it with. Existing sessions stay valid.
router.patch('/settings', express.json(), async (req, res) => {
  const updates = [];
  const params = [req.company.id];

  if (req.body?.name !== undefined) {
    const name = typeof req.body.name === 'string' ? req.body.name.trim().slice(0, 255) : '';
    if (!name) return res.status(400).json({ error: 'Company name cannot be empty' });
    params.push(name);
    updates.push(`name = $${params.length}`);
  }
  if (req.body?.contact_email !== undefined) {
    const email = typeof req.body.contact_email === 'string' ? req.body.contact_email.trim().toLowerCase() : '';
    if (!email || email.length > 255 || !EMAIL_RE.test(email)) {
      return res.status(400).json({ error: 'A valid contact email is required' });
    }
    params.push(email);
    updates.push(`contact_email = $${params.length}`);
  }
  if (req.body?.is_active !== undefined) {
    if (typeof req.body.is_active !== 'boolean') {
      return res.status(400).json({ error: 'is_active must be true or false' });
    }
    params.push(req.body.is_active);
    updates.push(`is_active = $${params.length}`);
  }
  if (!updates.length) {
    return res.status(400).json({ error: 'Nothing to update' });
  }

  try {
    const row = await db.one(
      `UPDATE companies SET ${updates.join(', ')} WHERE id = $1
       RETURNING id, name, contact_email, is_active, created_at`,
      params
    );
    res.json({
      company: {
        id: row.id,
        name: row.name,
        contactEmail: row.contact_email,
        isActive: row.is_active,
        createdAt: row.created_at,
      },
    });
  } catch (err) {
    console.error('[companyPortal] settings update failed:', err.message);
    res.status(500).json({ error: 'Could not save your settings. Please try again.' });
  }
});

module.exports = router;
