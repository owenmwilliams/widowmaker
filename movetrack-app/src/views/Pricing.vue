<template>
  <q-layout view="hHh lpR fff">
    <q-header bordered class="header">
      <q-toolbar class="constrained">
        <div class="brand">
          <q-btn flat dense no-caps to="/" class="brand-btn">
            <ReloPrepLogo :width="120" :height="28" />
          </q-btn>
        </div>
        <div class="actions">
          <q-btn flat color="primary" label="Login" to="/login" />
          <q-btn unelevated color="primary" label="Get started" to="/login" class="q-ml-sm" />
        </div>
      </q-toolbar>
    </q-header>

    <q-page-container>
      <q-page class="page">
        <section class="hero constrained">
          <div class="hero-copy">
            <h1>Pick the plan that keeps your move organized.</h1>
            <p>Start free, build your inventory, and upgrade when you’re ready to scan entire rooms at once.</p>
          </div>
        </section>

        <section class="constrained plans">
          <div class="q-pa-md q-mb-lg text-center text-weight-medium"
               style="background:#FFF3E0; color:#8a5a00; border-radius:8px;">
            🎉 Everything’s free while we’re in launch — paid plans are coming soon.
          </div>
          <div class="plan-grid">
            <q-card flat bordered class="plan-card">
              <q-card-section class="plan-head">
                <div class="plan-type">Basic</div>
                <div class="plan-price">$0<span>/month</span></div>
                <div class="plan-desc">Great for inventory starter projects.</div>
                <q-btn unelevated color="primary" class="plan-cta" to="/login">Start Free</q-btn>
              </q-card-section>
              <q-card-section class="plan-body">
                <ul>
                  <li><strong>Up to 500 items</strong> and 2 locations</li>
                  <li><strong>Scout or Qwen AI</strong> single-item capture</li>
                  <li><strong>3 multi-item scans</strong> per week (resets weekly)</li>
                  <li>Basic packing tools & manual exports</li>
                  <li>Email support</li>
                </ul>
              </q-card-section>
            </q-card>

            <q-card flat bordered class="plan-card">
              <q-card-section class="plan-head">
                <div class="plan-type">Pro</div>
                <div class="plan-price">$8<span>/month</span></div>
                <div class="plan-desc">Unlimited scanning and move-day tools.</div>
                <q-btn unelevated color="primary" class="plan-cta" disable>Coming soon</q-btn>
              </q-card-section>
              <q-card-section class="plan-body">
                <ul>
                  <li>Unlimited items, locations, and multi-item scans</li>
                  <li>Access to Gemini, Claude, GPT-4o, Scout, and Qwen</li>
                  <li>Move Day Mode + real-time tracking</li>
                  <li>Exports with photos, weight, dimensions</li>
                  <li>Priority support & version history</li>
                </ul>
              </q-card-section>
            </q-card>

            <q-card flat bordered class="plan-card move-pack-card">
              <div class="shimmer-overlay"></div>
              <q-card-section class="plan-head move-pack-head">
                <div class="plan-type-movepack">Move Pack</div>
                <div class="plan-price-movepack">$20<span>/3 months</span></div>
                <div class="plan-desc">Perfect for a single move or short project.</div>
                <q-btn unelevated class="plan-cta shimmer-btn" disable>Coming soon</q-btn>
              </q-card-section>
              <q-card-section class="plan-body">
                <ul>
                  <li>Full Pro features for 90 days</li>
                  <li>Unlimited AI scans + premium models</li>
                  <li>Move Day Mode and shareable links</li>
                  <li>Auto expires after your move (no auto-renew)</li>
                  <li>Upgrade to annual anytime</li>
                </ul>
              </q-card-section>
            </q-card>

            <q-card flat bordered class="plan-card">
              <q-card-section class="plan-head">
                <div class="plan-type">Annual</div>
                <div class="plan-price">$70<span>/year</span></div>
                <div class="plan-desc">Best value if you plan and inventory year-round.</div>
                <q-btn unelevated color="primary" class="plan-cta" disable>Coming soon</q-btn>
              </q-card-section>
              <q-card-section class="plan-body">
                <ul>
                  <li>All Pro features, billed once per year</li>
                  <li>Great for repeat movers or estate catalogues</li>
                  <li>Unlimited scans, exports, and Move Day sessions</li>
                  <li>Priority support for the entire year</li>
                  <li>Save 27% compared to monthly</li>
                </ul>
              </q-card-section>
            </q-card>
          </div>
          <div class="footnote text-caption text-grey-7">
            Multi-item demo scans reset every Monday (UTC). Pro plans unlock unlimited AI modes + premium models instantly.
          </div>
        </section>

        <section class="constrained integration">
          <div class="integration-card">
            <h2>Billing is coming soon</h2>
            <p>While we’re in launch, every feature is free. When billing goes live we’ll add:</p>
            <ol>
              <li>Secure Stripe checkout for Monthly ($8/mo), Annual ($70/yr), and Move Pack ($20/3 mo).</li>
              <li>Automatic plan management and renewals.</li>
              <li>A customer portal to update payment methods or cancel anytime.</li>
            </ol>
            <p class="text-grey-7">No payment is required today — enjoy everything free while we build it out.</p>
          </div>
        </section>
      </q-page>
    </q-page-container>
  </q-layout>
</template>

<script setup lang="ts">
import ReloPrepLogo from '../components/brand/ReloPrepLogo.vue';
</script>

<style scoped>
.constrained {
  max-width: 1100px;
  margin: 0 auto;
  width: 100%;
  padding: 0 16px;
}

.header {
  background: #f5f9ff;
}

.brand-btn {
  padding: 0;
  min-width: 0;
}

.actions {
  margin-left: auto;
  display: flex;
  align-items: center;
}

.page {
  background: #f7f8fa;
  padding: 64px 0 88px;
}

.hero {
  text-align: center;
  margin-bottom: 42px;
}

.eyebrow {
  text-transform: uppercase;
  letter-spacing: 0.1em;
  font-size: 0.75rem;
  color: #3b82f6;
  font-weight: 700;
}

.hero h1 {
  font-size: 2.6rem;
  line-height: 1.2;
  margin: 0.5rem 0 0.9rem;
  color: #1f2a44;
}

.hero p {
  color: #4b5563;
  font-size: 1.05rem;
  line-height: 1.65;
  margin: 0;
}

.plans {
  margin-top: 24px;
}

.plan-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 18px;
}

@media (min-width: 768px) {
  .plan-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}

@media (min-width: 1200px) {
  .plan-grid {
    grid-template-columns: repeat(4, 1fr);
  }
}

.plan-card {
  border-radius: 18px;
  box-shadow: 0 20px 60px rgba(31, 42, 68, 0.08);
  background: white;
}

.plan-card.highlight {
  border: 2px solid #3366ff;
  transform: translateY(-6px);
}

.move-pack-card {
  position: relative;
  overflow: hidden;
  border: 2px solid rgba(96, 165, 250, 0.8);
  box-shadow: 0 20px 60px rgba(60, 130, 255, 0.35);
  background: linear-gradient(160deg, #1e3a8a, #2563eb, #1cb5e0);
  color: white;
}

.move-pack-head .plan-desc {
  color: rgba(255, 255, 255, 0.85);
}

.move-pack-card .plan-body ul {
  color: rgba(255, 255, 255, 0.95);
  border-color: rgba(255, 255, 255, 0.2);
}
.move-pack-card .plan-body li {
  border-color: rgba(255, 255, 255, 0.2);
}
.move-pack-card .plan-price span {
  color: rgba(255, 255, 255, 0.85);
}
.shimmer-btn {
  background: linear-gradient(135deg, #ffffff, #f3f8ff);
  color: #1e3a8a;
  font-weight: 700;
  box-shadow: 0 12px 30px rgba(255, 255, 255, 0.35);
}

.shimmer-overlay {
  position: absolute;
  inset: 0;
  background: radial-gradient(circle at 20% 20%, rgba(255, 255, 255, 0.4), transparent 55%),
    radial-gradient(circle at 80% 10%, rgba(255, 255, 255, 0.25), transparent 60%),
    radial-gradient(circle at 50% 80%, rgba(255, 255, 255, 0.3), transparent 55%);
  mix-blend-mode: screen;
  animation: shimmer 6s ease-in-out infinite;
  pointer-events: none;
}

@keyframes shimmer {
  0% {
    opacity: 0.6;
    transform: translateY(0);
  }
  50% {
    opacity: 1;
    transform: translateY(-8px);
  }
  100% {
    opacity: 0.6;
    transform: translateY(0);
  }
}

.plan-head {
  text-align: center;
}

.plan-type-movepack {
  font-size: 1.1rem;
  font-weight: 600;
  color: #ffffff;
}

.plan-price-movepack {
  font-size: 2.4rem;
  font-weight: 700;
  color: #ffffff;
}
.plan-price-movepack span {
  font-size: 1rem;
  font-weight: 500;
  color: #ffffff;
  margin-left: 4px;
}

.plan-type {
  font-size: 1.1rem;
  font-weight: 600;
  color: #1f2a44;
}

.plan-price {
  font-size: 2.4rem;
  font-weight: 700;
  color: #1f2a44;
}
.plan-price span {
  font-size: 1rem;
  font-weight: 500;
  color: #4b5563;
  margin-left: 4px;
}

.plan-desc {
  color: #4b5563;
  margin-bottom: 16px;
}

.plan-cta {
  width: 100%;
}

.billing-note {
  margin-top: 10px;
  font-size: 0.85rem;
  color: #4b5563;
}

.plan-body ul {
  list-style: none;
  padding: 0;
  margin: 0;
  color: #1f2937;
  line-height: 1.6;
}
.plan-body li {
  padding: 6px 0;
  border-bottom: 1px solid #eef2ff;
}
.plan-body li:last-child {
  border-bottom: none;
}

.footnote {
  margin-top: 20px;
  text-align: center;
}

.integration {
  margin-top: 54px;
}

.integration-card {
  border-radius: 18px;
  background: white;
  box-shadow: 0 20px 50px rgba(31, 42, 68, 0.07);
  padding: 28px;
}

.integration-card h2 {
  margin: 0 0 10px;
  color: #1f2a44;
}

.integration-card ol {
  padding-left: 18px;
  color: #1f2937;
  line-height: 1.6;
}
</style>
