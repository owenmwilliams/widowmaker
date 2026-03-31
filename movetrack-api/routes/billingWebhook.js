const Stripe = require('stripe');
const { setUserPlanStatus } = require('../services/infra/authService');

const stripeSecret = process.env.STRIPE_SECRET_KEY;
const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
const stripe = stripeSecret ? new Stripe(stripeSecret, { apiVersion: '2024-06-20' }) : null;

const MOVE_PACK_DURATION_DAYS = 90;

module.exports = async function billingWebhook(req, res) {
  if (!stripe || !webhookSecret) {
    return res.status(500).send('Stripe webhook not configured');
  }

  const sig = req.headers['stripe-signature'];

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (err) {
    console.error('Stripe webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed':
        await handleCheckoutCompleted(event.data.object);
        break;
      case 'customer.subscription.updated':
      case 'customer.subscription.created':
        await handleSubscriptionUpdated(event.data.object);
        break;
      case 'customer.subscription.deleted':
        await handleSubscriptionDeleted(event.data.object);
        break;
      default:
        break;
    }
    res.status(200).json({ received: true });
  } catch (error) {
    console.error('Error handling Stripe event:', error);
    res.status(500).json({ error: 'Failed to process webhook' });
  }
};

async function handleCheckoutCompleted(session) {
  const plan = session.metadata?.plan;
  const email = session.metadata?.user_email || session.customer_details?.email;
  if (!plan || !email) return;

  if (session.mode === 'payment' && plan === 'move_pack') {
    const expires = new Date();
    expires.setUTCDate(expires.getUTCDate() + MOVE_PACK_DURATION_DAYS);
    await setUserPlanStatus(email, {
      plan_tier: 'pro',
      plan_source: 'move_pack',
      plan_status: 'active',
      plan_expires_at: expires.toISOString(),
      stripe_customer_id: session.customer
    });
  }
}

async function handleSubscriptionUpdated(subscription) {
  const plan = subscription.metadata?.plan || subscription.plan?.metadata?.plan;
  const email = subscription.metadata?.user_email || subscription.customer_email;
  if (!plan || !email) return;

  const planTier = 'pro';
  await setUserPlanStatus(email, {
    plan_tier: planTier,
    plan_source: plan,
    plan_status: subscription.status,
    plan_expires_at: subscription.current_period_end
      ? new Date(subscription.current_period_end * 1000).toISOString()
      : null,
    stripe_customer_id: subscription.customer,
    stripe_subscription_id: subscription.id
  });
}

async function handleSubscriptionDeleted(subscription) {
  const email = subscription.metadata?.user_email || subscription.customer_email;
  if (!email) return;
  await setUserPlanStatus(email, {
    plan_tier: 'basic',
    plan_source: 'basic',
    plan_status: 'canceled',
    plan_expires_at: null,
    stripe_customer_id: subscription.customer,
    stripe_subscription_id: null
  });
}
