<script setup lang="ts">
import { ref } from 'vue';
import PrivacyPolicy from './PrivacyPolicy.vue';
import TermsOfService from './TermsAndConditions.vue';
import { ArrowRight, Check, Clock, FileText, Lock, Package, Share2, Sparkles } from 'lucide-vue-next';

const showPrivacyPolicy = ref(false);
const showTermsOfService = ref(false);

const planRows = [
  { feature: 'Items & photos', basic: 'Up to 500', pro: 'Unlimited', proCheck: true },
  { feature: 'Locations', basic: 'Up to 2', pro: 'Unlimited', proCheck: true },
  { feature: 'Capture & attributes', basic: 'AI name & description', pro: 'Full AI + auto attributes', proCheck: true },
  { feature: 'AI model', basic: 'AI name & description', pro: 'Full AI + auto attributes', proCheck: true },
  { feature: 'Packing tools', basic: 'Basic checks', pro: 'Smart Pack algorithm', proCheck: true },
  { feature: 'Exports (PDF)', basic: '—', pro: 'Photos & counts', proCheck: true },
  { feature: 'Sharing', basic: '—', pro: 'Links + permissions', proCheck: true },
  { feature: 'Photo quality', basic: 'Reduced', pro: 'Full-res storage', proCheck: true },
  { feature: 'Support', basic: 'Standard', pro: 'Priority', proCheck: true },
];
</script>

<template>
  <q-layout view="hHh lpR fff">
    <q-header bordered class="header">
      <q-toolbar class="constrained">
        <div class="brand">
          <img src="../assets/brand/logo-lockup-light.svg" alt="Nexus Moves" class="brand-logo" height="32" />
        </div>
        <div class="actions">
          <q-btn flat no-caps color="primary" label="Login" to="/login" />
          <q-btn unelevated no-caps color="primary" label="Get started" to="/login" class="q-ml-sm" />
        </div>
      </q-toolbar>
    </q-header>

    <q-page-container>
      <q-page class="page">
        <!-- Hero -->
        <section class="constrained hero hero-surface">
          <div class="hero-copy">
            <div class="eyebrow">Verified inventory for your move</div>
            <h1>Build a verified inventory in minutes. Get quotes that match reality.</h1>
            <p>
              Capture photos, dimensions, and weights automatically. Share a verified inventory with movers for quotes you can trust.
            </p>
            <div class="hero-ctas">
              <q-btn unelevated no-caps class="cta-shimmer" to="/login">
                Start your inventory
                <ArrowRight :size="20" class="btn-icon-right" aria-hidden="true" />
              </q-btn>
            </div>
            <div class="hero-bullets vertical">
              <div class="bullet"><span class="bullet-check"><Check :size="15" aria-hidden="true" /></span> Photos, weight, and dimensions together</div>
              <div class="bullet"><span class="bullet-check"><Check :size="15" aria-hidden="true" /></span> Private links you control</div>
              <div class="bullet"><span class="bullet-check"><Check :size="15" aria-hidden="true" /></span> Export to PDF/CSV anytime</div>
            </div>
          </div>
          <div class="hero-visual">
            <q-card flat class="visual-card">
              <img src="../assets/brand/hero-inventory.svg" alt="Belongings being scanned into a verified inventory" class="hero-image" />
            </q-card>
          </div>
        </section>

        <!-- How it works -->
        <div class="section-divider"></div>
        <section id="how" class="constrained section surface">
          <div class="section-header">
            <h2>How it works</h2>
            <p>Three steps to a move-ready inventory.</p>
          </div>
          <div class="cards-grid">
            <q-card flat bordered class="info-card">
              <q-card-section>
                <div class="step-num">01</div>
                <div class="card-title">Capture</div>
                <div class="card-body">Snap photos or add items; AI helps with names, weights, and dimensions.</div>
              </q-card-section>
            </q-card>
            <q-card flat bordered class="info-card">
              <q-card-section>
                <div class="step-num">02</div>
                <div class="card-title">Organize</div>
                <div class="card-body">Group into rooms or boxes, check weight/volume fit, and prep labels.</div>
              </q-card-section>
            </q-card>
            <q-card flat bordered class="info-card">
              <q-card-section>
                <div class="step-num">03</div>
                <div class="card-title">Share</div>
                <div class="card-body">Send a private link or export so movers can quote without an in-home visit.</div>
              </q-card-section>
            </q-card>
          </div>
        </section>

        <!-- Why it helps -->
        <section class="constrained section surface">
          <div class="section-header">
            <h2>Why it helps</h2>
          </div>
          <div class="cards-grid">
            <q-card flat bordered class="info-card">
              <q-card-section>
                <div class="card-title">Accurate quotes</div>
                <div class="card-body">Fewer surprises when movers see photos, weights, and dimensions upfront.</div>
              </q-card-section>
            </q-card>
            <q-card flat bordered class="info-card">
              <q-card-section>
                <div class="card-title">Smoother move day</div>
                <div class="card-body">Packing constraints and labels keep everything organized.</div>
              </q-card-section>
            </q-card>
            <q-card flat bordered class="info-card">
              <q-card-section>
                <div class="card-title">Peace of mind</div>
                <div class="card-body">Timestamped photos and item history simplify claims and verification.</div>
              </q-card-section>
            </q-card>
          </div>
        </section>

        <!-- For movers -->
        <section id="movers" class="constrained section surface">
          <div class="section-header">
            <h2>Movers benefit, too</h2>
            <p>Share a “Verified Inventory” so movers can quote faster and plan better.</p>
          </div>
          <div class="cards-grid">
            <q-card flat bordered class="info-card">
              <q-card-section>
                <div class="card-title">Faster estimates</div>
                <div class="card-body">Photos + measurements often remove the need for a site visit.</div>
              </q-card-section>
            </q-card>
            <q-card flat bordered class="info-card">
              <q-card-section>
                <div class="card-title">Less risk</div>
                <div class="card-body">Clear counts and photo evidence reduce disputes and claims.</div>
              </q-card-section>
            </q-card>
            <q-card flat bordered class="info-card">
              <q-card-section>
                <div class="card-title">Better planning</div>
                <div class="card-body">Volume/weight estimates help with truck, crew, and materials.</div>
              </q-card-section>
            </q-card>
          </div>
        </section>

        <div class="constrained section-cta outside">
          <q-btn class="cta-strong" unelevated no-caps color="primary" to="/login">
            Create a shareable inventory
            <ArrowRight :size="18" class="btn-icon-right" aria-hidden="true" />
          </q-btn>
        </div>

        <!-- Features (expanded) -->
        <section id="features" class="constrained section surface">
          <div class="section-header">
            <h2>Smart moving inventory features powered by AI</h2>
            <p class="section-subtext">
              Create a complete, accurate home inventory in minutes using AI-powered item capture and smart packing tools—built for homeowners, renters, and moving professionals.
            </p>
          </div>
          <div class="feature-grid">
            <div class="feature-card">
              <span class="feature-icon"><Sparkles :size="22" aria-hidden="true" /></span>
              <div class="feature-title">AI item detection</div>
              <div class="feature-body">Snap photos and let the moving inventory app auto-label items, weights, and dimensions for a verified home inventory.</div>
            </div>
            <div class="feature-card">
              <span class="feature-icon"><Package :size="22" aria-hidden="true" /></span>
              <div class="feature-title">Smart packing & fit checks</div>
              <div class="feature-body">Drag-and-drop items into boxes with volume/weight constraints, so your packing checklist stays accurate.</div>
            </div>
            <div class="feature-card">
              <span class="feature-icon"><Share2 :size="22" aria-hidden="true" /></span>
              <div class="feature-title">Shareable “Verified Inventory”</div>
              <div class="feature-body">Private links movers can use instantly—no special software required. Control permissions, revoke anytime.</div>
            </div>
            <div class="feature-card">
              <span class="feature-icon"><FileText :size="22" aria-hidden="true" /></span>
              <div class="feature-title">Export ready (PDF & CSV)</div>
              <div class="feature-body">Download inventory export files with photos, counts, and details for insurance, claims, and move-day checklists.</div>
            </div>
            <div class="feature-card">
              <span class="feature-icon"><Lock :size="22" aria-hidden="true" /></span>
              <div class="feature-title">Secure & private</div>
              <div class="feature-body">Share only when you choose. Your home inventory stays secure with permissioned access and auditability.</div>
            </div>
            <div class="feature-card">
              <span class="feature-icon"><Clock :size="22" aria-hidden="true" /></span>
              <div class="feature-title">Fast setup, free to start</div>
              <div class="feature-body">Create your smart moving inventory in minutes—perfect for long-distance moves, local moves, or downsizing.</div>
            </div>
          </div>
        </section>

        <!-- Pricing -->
        <section id="pricing" class="constrained section surface">
          <div class="section-header">
            <h2>Pricing</h2>
            <p class="section-subtext">Pick the plan that matches your move—free to start, flexible to upgrade.</p>
          </div>
          <div class="cards-grid">
            <q-card flat bordered class="info-card pricing-card">
              <q-card-section>
                <div class="card-title">Monthly</div>
                <div class="price">$8<span class="price-suffix">/month</span></div>
                <div class="card-body q-mt-sm">
                  Unlimited items, photos, exports, and packing fit checks. Perfect if you’re mid-move or organizing now.
                </div>
              </q-card-section>
              <q-card-actions align="right">
                <q-btn unelevated no-caps color="primary" label="Choose monthly" to="/login" />
              </q-card-actions>
            </q-card>

            <q-card flat bordered class="info-card pricing-card">
              <q-card-section>
                <div class="card-title">Move Pack</div>
                <div class="price">$20<span class="price-suffix"> / 3 months</span></div>
                <div class="card-body q-mt-sm">
                  One-time access for a single move. Full features for 90 days to capture, share, and export your inventory.
                </div>
              </q-card-section>
              <q-card-actions align="right">
                <q-btn unelevated no-caps color="primary" label="Choose move pack" to="/login" />
              </q-card-actions>
            </q-card>

            <q-card flat bordered class="info-card pricing-card">
              <q-card-section>
                <div class="card-title">Annual</div>
                <div class="price">$70<span class="price-suffix">/year</span></div>
                <div class="card-body q-mt-sm">
                  Best value for planners and organizers. All features, all year—great for multiple moves or ongoing inventory.
                </div>
              </q-card-section>
              <q-card-actions align="right">
                <q-btn unelevated no-caps color="primary" label="Choose annual" to="/login" />
              </q-card-actions>
            </q-card>
          </div>
        </section>

        <!-- Plan comparison -->
        <section class="constrained section surface">
          <div class="section-header">
            <h2>Compare plans</h2>
            <p class="section-subtext">See what’s included on the free track vs. paid plans.</p>
          </div>
            <div class="plan-grid">
              <div class="plan-grid-row plan-grid-head">
                <div class="plan-grid-cell plan-label-cell">Feature</div>
                <div class="plan-grid-cell">Basic (Free)</div>
                <div class="plan-grid-cell">Pro (Monthly / Annual)</div>
              </div>
              <div v-for="row in planRows" :key="row.feature" class="plan-grid-row">
                <div class="plan-grid-cell plan-label-cell">{{ row.feature }}</div>
                <div class="plan-grid-cell">{{ row.basic }}</div>
                <div class="plan-grid-cell">
                  <span v-if="row.proCheck" class="check-icon">
                    <Check :size="13" aria-hidden="true" />
                  </span>
                  <span>{{ row.pro }}</span>
                </div>
            </div>
          </div>
        </section>

        <!-- FAQ -->
        <section id="faq" class="constrained section surface">
          <div class="section-header">
            <h2>Frequently asked questions</h2>
          </div>
          <div class="faq-buckets">
            <q-expansion-item dense expand-separator expand-icon="add" expanded-icon="remove" label="AI capture" header-class="faq-header">
              <div class="faq-list">
                <q-expansion-item dense expand-separator expand-icon="add" expanded-icon="remove" label="How does AI item detection work for home inventory?" header-class="faq-subheader">
                  <div class="faq-answer">
                    AI item detection reads photos to suggest labels, weights, and dimensions. You can edit anything, and we store the photo with the record for verification.
                  </div>
                </q-expansion-item>
                <q-expansion-item dense expand-separator expand-icon="add" expanded-icon="remove" label="Can AI capture fragile or unusual items?" header-class="faq-subheader">
                  <div class="faq-answer">
                    If AI isn’t confident, it flags the item so you can confirm or edit the label before sharing your moving inventory.
                  </div>
                </q-expansion-item>
                <q-expansion-item dense expand-separator expand-icon="add" expanded-icon="remove" label="Do I have to add dimensions manually?" header-class="faq-subheader">
                  <div class="faq-answer">
                    If AI can’t infer dimensions, you can enter length/width/height. Fit checks only need rough dimensions to warn about oversized items.
                  </div>
                </q-expansion-item>
              </div>
            </q-expansion-item>

            <q-expansion-item dense expand-separator expand-icon="add" expanded-icon="remove" label="Movers" header-class="faq-header">
              <div class="faq-list">
                <q-expansion-item dense expand-separator expand-icon="add" expanded-icon="remove" label="How do movers use shared inventories?" header-class="faq-subheader">
                  <div class="faq-answer">
                    Movers open your “Verified Inventory” in a browser—no special software needed. They review photos, dimensions, and weights to quote or plan without a site visit.
                  </div>
                </q-expansion-item>
                <q-expansion-item dense expand-separator expand-icon="add" expanded-icon="remove" label="Can movers add notes or adjust items?" header-class="faq-subheader">
                  <div class="faq-answer">
                    You can grant edit access so movers can propose changes, add packing notes, or flag items that need special handling.
                  </div>
                </q-expansion-item>
                <q-expansion-item dense expand-separator expand-icon="add" expanded-icon="remove" label="Do movers still need an in-home visit?" header-class="faq-subheader">
                  <div class="faq-answer">
                    Often no. Detailed photos, weights, and dimensions reduce the need for a visit. Some movers may still choose to confirm complex jobs on-site.
                  </div>
                </q-expansion-item>
              </div>
            </q-expansion-item>

            <q-expansion-item dense expand-separator expand-icon="add" expanded-icon="remove" label="Long-distance moves" header-class="faq-header">
              <div class="faq-list">
                <q-expansion-item dense expand-separator expand-icon="add" expanded-icon="remove" label="Can I use this app to prepare for a long-distance move?" header-class="faq-subheader">
                  <div class="faq-answer">
                    Yes. A complete, exportable inventory helps movers quote accurately for long-distance moves and plan truck space, crew, and materials.
                  </div>
                </q-expansion-item>
                <q-expansion-item dense expand-separator expand-icon="add" expanded-icon="remove" label="Does this help with weight tickets and valuation?" header-class="faq-subheader">
                  <div class="faq-answer">
                    Your itemized weights and dimensions help prevent overloading and clarify declared value for long hauls.
                  </div>
                </q-expansion-item>
                <q-expansion-item dense expand-separator expand-icon="add" expanded-icon="remove" label="Can I share with multiple movers for competing quotes?" header-class="faq-subheader">
                  <div class="faq-answer">
                    Yes. Send read-only links to multiple movers and revoke access anytime. You own the inventory.
                  </div>
                </q-expansion-item>
              </div>
            </q-expansion-item>

            <q-expansion-item dense expand-separator expand-icon="add" expanded-icon="remove" label="Privacy & security" header-class="faq-header">
              <div class="faq-list">
                <q-expansion-item dense expand-separator expand-icon="add" expanded-icon="remove" label="Is my inventory secure and private?" header-class="faq-subheader">
                  <div class="faq-answer">
                    You control sharing. Links can be read-only or editable, and you can revoke access anytime. Data is encrypted in transit and at rest.
                  </div>
                </q-expansion-item>
                <q-expansion-item dense expand-separator expand-icon="add" expanded-icon="remove" label="Can I remove photos after sharing?" header-class="faq-subheader">
                  <div class="faq-answer">
                    Yes. You can update or remove photos; shared links update instantly, or you can disable the link entirely.
                  </div>
                </q-expansion-item>
                <q-expansion-item dense expand-separator expand-icon="add" expanded-icon="remove" label="Who owns my data?" header-class="faq-subheader">
                  <div class="faq-answer">
                    You own your data. We only process it to provide the moving inventory app features; you can export or delete it anytime.
                  </div>
                </q-expansion-item>
              </div>
            </q-expansion-item>

            <q-expansion-item dense expand-separator expand-icon="add" expanded-icon="remove" label="Exports & packing" header-class="faq-header">
              <div class="faq-list">
                <q-expansion-item dense expand-separator expand-icon="add" expanded-icon="remove" label="What export formats are available?" header-class="faq-subheader">
                  <div class="faq-answer">
                    You can export PDF and CSV with photos, counts, and item details. Exports work for insurance, claims, or sharing with movers.
                  </div>
                </q-expansion-item>
                <q-expansion-item dense expand-separator expand-icon="add" expanded-icon="remove" label="Can I track packing and fit checks?" header-class="faq-subheader">
                  <div class="faq-answer">
                    Yes. Drag items into boxes with volume/weight constraints to build a packing checklist and prevent overload.
                  </div>
                </q-expansion-item>
                <q-expansion-item dense expand-separator expand-icon="add" expanded-icon="remove" label="Do you support inventory labels or QR codes?" header-class="faq-subheader">
                  <div class="faq-answer">
                    You can generate label-ready item lists now; QR labeling is on the roadmap so you can scan items in/out of boxes.
                  </div>
                </q-expansion-item>
              </div>
            </q-expansion-item>
          </div>
        </section>

        <!-- Final CTA (dark aurora band) -->
        <section class="cta-band">
          <div class="cta-band__aurora" aria-hidden="true"></div>
          <div class="constrained cta-band__inner">
            <h3>Create your smart moving inventory in minutes—free to start.</h3>
            <q-btn unelevated no-caps color="primary" to="/login" class="cta-band__btn">
              Get started
              <ArrowRight :size="18" class="btn-icon-right" aria-hidden="true" />
            </q-btn>
          </div>
        </section>
      </q-page>
    </q-page-container>

    <q-footer bordered class="footer">
      <div class="constrained footer-content">
        <img src="../assets/brand/logo-lockup-light.svg" alt="Nexus Moves" class="footer-logo" height="24" />
        <div class="footer-copy">&copy; 2025 Nexus Moves</div>
        <div class="footer-links">
          <q-btn flat no-caps dense label="Terms" class="footer-link" @click="showTermsOfService = true" />
          <q-btn flat no-caps dense label="Privacy" class="footer-link" @click="showPrivacyPolicy = true" />
        </div>
      </div>
    </q-footer>

    <q-dialog v-model="showTermsOfService" transition-show="fade" transition-hide="fade">
      <q-card style="max-width: 800px; width: 90vw;">
        <q-card-section><div class="text-h6">Terms of Service</div></q-card-section>
        <q-card-section class="q-pt-none"><TermsOfService /></q-card-section>
        <q-card-actions align="right"><q-btn flat no-caps label="Close" color="primary" v-close-popup /></q-card-actions>
      </q-card>
    </q-dialog>

    <q-dialog v-model="showPrivacyPolicy" transition-show="fade" transition-hide="fade">
      <q-card style="max-width: 800px; width: 90vw;">
        <q-card-section><div class="text-h6">Privacy Policy</div></q-card-section>
        <q-card-section class="q-pt-none"><PrivacyPolicy /></q-card-section>
        <q-card-actions align="right"><q-btn flat no-caps label="Close" color="primary" v-close-popup /></q-card-actions>
      </q-card>
    </q-dialog>

  </q-layout>
</template>

<style scoped>
.constrained {
  max-width: var(--content-max);
  margin: 0 auto;
  width: 100%;
  padding: 0 var(--gutter);
}

/* ---- Header ---- */
.header {
  background: color-mix(in srgb, var(--bg) 85%, transparent);
  backdrop-filter: blur(12px);
  color: var(--text-primary);
  border-bottom: 1px solid var(--border);
}

.brand {
  display: flex;
  align-items: center;
}

.brand-logo {
  display: block;
  height: 32px;
  width: auto;
}

.actions {
  margin-left: auto;
  display: flex;
  align-items: center;
}

/* ---- Buttons: shared interaction states ---- */
.q-btn {
  border-radius: var(--r-md);
  font-weight: var(--fw-bold);
  letter-spacing: var(--ls-title);
}

.q-btn:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring);
}

.q-btn:active {
  transform: scale(0.97);
}

.q-btn.disabled {
  opacity: 0.45 !important;
}

.q-btn.bg-primary:hover {
  background: var(--accent-hover) !important;
}

.btn-icon-right {
  margin-left: var(--sp-3);
}

/* The ONE shimmer CTA on this page — the hero action. */
.cta-shimmer {
  background: var(--shimmer);
  color: var(--on-accent);
  padding: var(--sp-4) var(--sp-7);
  font-size: var(--fs-body-l);
  transition: box-shadow var(--dur-base) var(--ease-standard), transform var(--dur-fast) var(--ease-standard);
}

.cta-shimmer:hover {
  box-shadow: var(--glow-shimmer);
}

/* ---- Page ---- */
.page {
  background: var(--bg);
  color: var(--text-primary);
  padding: var(--sp-11) 0 var(--sp-12);
}

.hero-surface {
  background: transparent;
  border-radius: var(--r-lg);
  padding-top: var(--sp-7);
  padding-bottom: var(--sp-8);
}

.hero {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: var(--sp-8);
  align-items: center;
  margin-bottom: var(--sp-10);
}

.hero-copy h1 {
  font-family: var(--font-display);
  font-size: var(--fs-display-xl);
  font-weight: var(--fw-extrabold);
  letter-spacing: var(--ls-display);
  line-height: var(--lh-tight);
  margin: var(--sp-5) 0 0;
  color: var(--text-primary);
}

.hero-copy p {
  color: var(--text-secondary);
  font-size: var(--fs-title-s);
  line-height: var(--lh-body);
  margin: var(--sp-6) 0 var(--sp-7);
  max-width: 470px;
}

.eyebrow {
  font-family: var(--font-mono);
  text-transform: uppercase;
  letter-spacing: var(--ls-eyebrow);
  font-size: var(--fs-label);
  color: var(--accent);
  font-weight: var(--fw-semibold);
}

.hero-ctas {
  margin-top: var(--sp-3);
  display: flex;
  flex-wrap: wrap;
}

.hero-bullets {
  margin-top: var(--sp-6);
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: var(--sp-4) var(--sp-4);
  color: var(--text-primary);
}

.hero-bullets.vertical {
  grid-template-columns: 1fr;
}

.bullet {
  display: flex;
  align-items: center;
  gap: var(--sp-4);
  font-size: var(--fs-body);
  font-weight: var(--fw-semibold);
}

.bullet-check {
  width: 26px;
  height: 26px;
  flex: none;
  border-radius: var(--r-pill);
  background: var(--success-quiet);
  color: var(--success);
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.hero-visual {
  display: flex;
  justify-content: center;
  align-items: center;
  position: relative;
}

.visual-card {
  width: 100%;
  border-radius: var(--r-lg);
  background: transparent;
  box-shadow: none;
  overflow: hidden;
  position: relative;
}

.hero-image {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

/* ---- Sections ---- */
.section {
  margin-bottom: var(--sp-11);
}

.section-divider {
  height: var(--sp-8);
}

.section.surface {
  background: var(--surface-card);
  border: 1px solid var(--border);
  border-radius: var(--r-xl);
  padding: var(--sp-9) var(--sp-8);
  box-shadow: var(--shadow-sm);
}

.section-header h2 {
  margin: 0;
  font-family: var(--font-display);
  font-size: var(--fs-display-m);
  font-weight: var(--fw-extrabold);
  letter-spacing: var(--ls-display);
  color: var(--text-primary);
}

.section-header p {
  margin: var(--sp-3) 0 0;
  color: var(--text-secondary);
}

.section-subtext {
  color: var(--text-secondary);
  margin-top: var(--sp-3);
}

.cards-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: var(--sp-5);
  margin-top: var(--sp-6);
}

.info-card {
  border-radius: var(--r-lg);
  background: var(--surface-card);
  border: 1px solid var(--border);
  box-shadow: var(--shadow-xs);
}

.step-num {
  font-family: var(--font-mono);
  font-size: var(--fs-body);
  font-weight: var(--fw-semibold);
  color: var(--cyan-600);
  margin-bottom: var(--sp-4);
}

.card-title {
  font-size: var(--fs-title-s);
  font-weight: var(--fw-bold);
  letter-spacing: var(--ls-title);
  color: var(--text-primary);
}

.card-body {
  color: var(--text-secondary);
  font-size: var(--fs-body);
  line-height: var(--lh-body);
  margin-top: var(--sp-2);
}

/* ---- FAQ ---- */
.faq-buckets {
  display: flex;
  flex-direction: column;
  gap: var(--sp-4);
  margin-top: var(--sp-4);
}

.faq-list {
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
  margin-top: var(--sp-4);
}

.faq-header {
  font-weight: var(--fw-bold);
  color: var(--text-primary);
}

.faq-subheader {
  font-weight: var(--fw-bold);
  color: var(--text-primary);
}

.faq-answer {
  padding: var(--sp-4) 0;
  color: var(--text-secondary);
  font-size: var(--fs-body);
  line-height: var(--lh-body);
}

.section-cta {
  margin-top: var(--sp-6);
  display: flex;
  justify-content: center;
}

.section-cta.outside {
  margin-top: var(--sp-3);
  margin-bottom: var(--sp-10);
}

/* ---- Pricing ---- */
.pricing-card {
  display: grid;
  gap: var(--sp-2);
}

.price {
  font-family: var(--font-display);
  font-size: var(--fs-title-l);
  font-weight: var(--fw-extrabold);
  letter-spacing: var(--ls-title);
  color: var(--text-primary);
  margin-top: var(--sp-2);
}

.price-suffix {
  font-family: var(--font-ui);
  font-size: var(--fs-body);
  font-weight: var(--fw-medium);
  color: var(--text-secondary);
  margin-left: var(--sp-2);
}

/* ---- Plan comparison ---- */
.plan-grid {
  margin-top: var(--sp-4);
  display: grid;
  grid-template-columns: 1fr;
  border-radius: var(--r-lg);
  overflow: hidden;
  background: var(--surface-card);
  border: 1px solid var(--border);
}

.plan-grid-row {
  display: grid;
  grid-template-columns: 1.2fr 1fr 1fr;
  align-items: center;
  padding: var(--sp-4) var(--sp-5);
  border-bottom: 1px solid var(--border);
}

.plan-grid-row:last-child {
  border-bottom: none;
}

.plan-grid-head {
  background: var(--surface-hover);
  font-weight: var(--fw-bold);
  color: var(--text-primary);
}

.plan-grid-cell {
  display: flex;
  align-items: center;
  line-height: var(--lh-body);
  color: var(--text-secondary);
  justify-content: flex-start;
  text-align: left;
}

.plan-label-cell {
  font-weight: var(--fw-bold);
  color: var(--text-primary);
}

.plan-grid-row:not(.plan-grid-head) .plan-label-cell {
  font-weight: var(--fw-semibold);
  margin-right: var(--sp-4);
}

.plan-grid-row:nth-child(2n + 1):not(.plan-grid-head) {
  background: var(--surface-sunk);
}

.check-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  flex: none;
  border-radius: var(--r-pill);
  background: var(--success-quiet);
  color: var(--success);
  margin-right: var(--sp-3);
}

.cta-strong {
  padding: var(--sp-4) var(--sp-6);
  font-size: var(--fs-body-l);
}

/* ---- Features ---- */
.feature-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: var(--sp-5);
  margin-top: var(--sp-6);
}

.feature-card {
  background: var(--surface-card);
  border-radius: var(--r-lg);
  padding: var(--sp-5);
  border: 1px solid var(--border);
  box-shadow: var(--shadow-xs);
  display: grid;
  gap: var(--sp-3);
}

.feature-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border-radius: var(--r-md);
  background: var(--accent-quiet);
  color: var(--accent);
}

.feature-title {
  font-weight: var(--fw-bold);
  letter-spacing: var(--ls-title);
  color: var(--text-primary);
}

.feature-body {
  color: var(--text-secondary);
  font-size: var(--fs-body);
  line-height: var(--lh-body);
}

/* ---- Final CTA: dark aurora band ---- */
.cta-band {
  position: relative;
  overflow: hidden;
  background: var(--navy-800);
  border-radius: var(--r-xl);
  margin: 0 var(--gutter) var(--sp-8);
  padding: var(--sp-11) 0;
}

.cta-band__aurora {
  position: absolute;
  inset: 0;
  background: var(--aurora);
  pointer-events: none;
}

.cta-band__inner {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-6);
  flex-wrap: wrap;
}

.cta-band__inner h3 {
  font-family: var(--font-display);
  font-size: var(--fs-display-m);
  font-weight: var(--fw-extrabold);
  letter-spacing: var(--ls-display);
  line-height: var(--lh-snug);
  color: var(--text-on-accent);
  margin: 0;
  max-width: 640px;
}

.cta-band__btn {
  padding: var(--sp-4) var(--sp-7);
  font-size: var(--fs-body-l);
}

/* ---- Footer ---- */
.footer {
  background: var(--surface);
  color: var(--text-secondary);
  border-top: 1px solid var(--border);
}

.footer-content {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-5);
  padding-top: var(--sp-4);
  padding-bottom: var(--sp-4);
}

.footer-logo {
  display: block;
  height: 24px;
  width: auto;
}

.footer-copy {
  font-size: var(--fs-label);
  color: var(--text-tertiary);
}

.footer-links {
  display: flex;
  gap: var(--sp-3);
}

.footer-link {
  color: var(--text-secondary);
}

@media (max-width: 900px) {
  .hero-copy h1 {
    font-size: var(--fs-display-l);
  }
  .section.surface {
    padding: var(--sp-8) var(--sp-6);
  }
  .cta-band__inner {
    flex-direction: column;
    align-items: flex-start;
  }
}
</style>
