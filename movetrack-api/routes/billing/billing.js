const express = require('express');
const router = express.Router();
const { authenticate } = require('../../services/infra/authService');

// ─────────────────────────────────────────────────────────────────────────────
// Billing is not yet active. Endpoints below are placeholders.
// No business logic should be implemented here until billing is ready.
// All Stripe interaction should live in services/billing/stripeService.js (TBD).
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /billing/checkout
 * Creates a Stripe Checkout session for the requested plan.
 * Body: { plan: 'pro_monthly' | 'pro_annual' | 'move_pack' }
 * Returns: { url: string } — redirect URL to Stripe-hosted checkout page.
 * On success, Stripe fires checkout.session.completed → POST /billing/webhook.
 */
router.post('/checkout', authenticate, (_req, res) => {
  res.status(501).json({ error: 'Billing not yet active' });
});

/**
 * POST /billing/portal
 * Creates a Stripe Billing Portal session for managing an existing subscription.
 * Returns: { url: string } — redirect URL to Stripe-hosted portal.
 */
router.post('/portal', authenticate, (_req, res) => {
  res.status(501).json({ error: 'Billing not yet active' });
});

/**
 * POST /billing/webhook  (registered directly in app.js with raw body parser)
 * Stripe webhook receiver. Verifies signature via STRIPE_WEBHOOK_SECRET.
 * Events handled:
 *   - checkout.session.completed  → activate plan (subscription or move_pack one-time)
 *   - customer.subscription.updated / created  → sync plan tier & expiry
 *   - customer.subscription.deleted  → revert user to 'basic' plan
 * Implementation will live in services/billing/stripeWebhookService.js (TBD).
 */

module.exports = router;
