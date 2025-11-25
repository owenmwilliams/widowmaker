const express = require('express');
const router = express.Router();
const { authenticate, getPlanRecord, upsertPlanRecord } = require('../bin/authService');
const Stripe = require('stripe');

const stripeSecret = process.env.STRIPE_SECRET_KEY;
const appBaseUrl = process.env.APP_BASE_URL || 'https://movetrack-app-7hwn7ggbiq-uc.a.run.app/items';
const stripe = stripeSecret ? new Stripe(stripeSecret, { apiVersion: '2024-06-20' }) : null;

const PRICE_MAP = {
  pro_monthly: process.env.STRIPE_PRICE_PRO_MONTHLY,
  pro_annual: process.env.STRIPE_PRICE_PRO_ANNUAL,
  move_pack: process.env.STRIPE_PRICE_MOVE_PACK
};

function requireStripeConfigured(res) {
  if (!stripe || !PRICE_MAP.pro_monthly || !PRICE_MAP.pro_annual || !PRICE_MAP.move_pack) {
    res.status(500).json({ error: 'Stripe is not configured. Set STRIPE_SECRET_KEY and price IDs.' });
    return false;
  }
  return true;
}

async function getOrCreateCustomer(email) {
  const record = await getPlanRecord(email);
  if (record?.stripe_customer_id) {
    return record.stripe_customer_id;
  }
  const customer = await stripe.customers.create({ email });
  await upsertPlanRecord(email, {
    stripe_customer_id: customer.id
  });
  return customer.id;
}

router.post('/checkout', authenticate, async (req, res) => {
  try {
    if (!requireStripeConfigured(res)) return;
    const { plan } = req.body;
    if (!PRICE_MAP[plan]) {
      return res.status(400).json({ error: 'Invalid plan selection' });
    }

    const customerId = await getOrCreateCustomer(req.user.email);
    const successUrl = `${appBaseUrl}?checkout=success`;
    const cancelUrl = `${appBaseUrl}?checkout=cancel`;

    let mode = 'subscription';
    const lineItems = [{ price: PRICE_MAP[plan], quantity: 1 }];
    const metadata = {
      plan,
      user_email: req.user.email
    };

    const sessionConfig = {
      customer: customerId,
      line_items: lineItems,
      mode,
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata
    };

    if (plan === 'move_pack') {
      mode = 'payment';
      sessionConfig.mode = 'payment';
    } else {
      sessionConfig.subscription_data = {
        metadata
      };
    }

    const session = await stripe.checkout.sessions.create(sessionConfig);
    res.json({ url: session.url });
  } catch (error) {
    console.error('Stripe checkout error:', error);
    res.status(500).json({ error: 'Unable to start checkout' });
  }
});

router.post('/portal', authenticate, async (req, res) => {
  try {
    if (!requireStripeConfigured(res)) return;
    const customerId = await getOrCreateCustomer(req.user.email);
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${appBaseUrl}`
    });
    res.json({ url: session.url });
  } catch (error) {
    console.error('Stripe portal error:', error);
    res.status(500).json({ error: 'Unable to create portal session' });
  }
});

module.exports = router;
