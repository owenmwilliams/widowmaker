<script setup lang="ts">
import { ref } from 'vue';
import PrivacyPolicy from './PrivacyPolicy.vue';
import TermsOfService from './TermsAndConditions.vue';
import ReloPrepLogo from '../components/brand/ReloPrepLogo.vue';

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
          <ReloPrepLogo :width="120" :height="28" />
        </div>
        <div class="actions">
          <q-btn flat color="primary" label="Login" to="/login" />
          <q-btn unelevated color="primary" label="Get started" to="/login" class="q-ml-sm" />
        </div>
      </q-toolbar>
    </q-header>

    <q-page-container>
      <q-page class="page">
        <!-- Hero -->
        <section class="constrained hero hero-surface">
          <div class="hero-copy">
            <div class="eyebrow">Verified Inventory for your move</div>
            <h1>Build a verified inventory in minutes. Get quotes that match reality.</h1>
            <p>
              Capture photos, dimensions, and weights automatically. Share a verified inventory with movers for quotes you can trust.
            </p>
            <div class="hero-ctas">
              <q-btn unelevated color="primary" icon-right="arrow_forward" label="Start your inventory" to="/login" />
            </div>
            <div class="hero-bullets vertical">
              <div class="bullet"><q-icon name="check_circle" color="positive" size="18px" /> Photos, weight, and dimensions together</div>
              <div class="bullet"><q-icon name="check_circle" color="positive" size="18px" /> Private links you control</div>
              <div class="bullet"><q-icon name="check_circle" color="positive" size="18px" /> Export to PDF/CSV anytime</div>
            </div>
          </div>
          <div class="hero-visual">
            <q-card flat class="visual-card">
              <img src="https://storage.googleapis.com/widowmaker-site-images/temp_hero_banner_4.png" alt="Nexus Moves hero" class="hero-image" />
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
                <div class="text-subtitle1 semi-bold">Capture</div>
                <div class="text-body2 text-grey-8">Snap photos or add items; AI helps with names, weights, and dimensions.</div>
              </q-card-section>
            </q-card>
            <q-card flat bordered class="info-card">
              <q-card-section>
                <div class="text-subtitle1 semi-bold">Organize</div>
                <div class="text-body2 text-grey-8">Group into rooms or boxes, check weight/volume fit, and prep labels.</div>
              </q-card-section>
            </q-card>
            <q-card flat bordered class="info-card">
              <q-card-section>
                <div class="text-subtitle1 semi-bold">Share</div>
                <div class="text-body2 text-grey-8">Send a private link or export so movers can quote without an in-home visit.</div>
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
                <div class="text-subtitle1 semi-bold">Accurate quotes</div>
                <div class="text-body2 text-grey-8">Fewer surprises when movers see photos, weights, and dimensions upfront.</div>
              </q-card-section>
            </q-card>
            <q-card flat bordered class="info-card">
              <q-card-section>
                <div class="text-subtitle1 semi-bold">Smoother move day</div>
                <div class="text-body2 text-grey-8">Packing constraints and labels keep everything organized.</div>
              </q-card-section>
            </q-card>
            <q-card flat bordered class="info-card">
              <q-card-section>
                <div class="text-subtitle1 semi-bold">Peace of mind</div>
                <div class="text-body2 text-grey-8">Timestamped photos and item history simplify claims and verification.</div>
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
                <div class="text-subtitle1 semi-bold">Faster estimates</div>
                <div class="text-body2 text-grey-8">Photos + measurements often remove the need for a site visit.</div>
              </q-card-section>
            </q-card>
            <q-card flat bordered class="info-card">
              <q-card-section>
                <div class="text-subtitle1 semi-bold">Less risk</div>
                <div class="text-body2 text-grey-8">Clear counts and photo evidence reduce disputes and claims.</div>
              </q-card-section>
            </q-card>
            <q-card flat bordered class="info-card">
              <q-card-section>
                <div class="text-subtitle1 semi-bold">Better planning</div>
                <div class="text-body2 text-grey-8">Volume/weight estimates help with truck, crew, and materials.</div>
              </q-card-section>
            </q-card>
          </div>
        </section>

        <div class="constrained section-cta outside">
          <q-btn class="cta-strong" unelevated color="primary" label="Create a shareable inventory" to="/login" icon-right="arrow_forward" />
        </div>

        <!-- Features (expanded) -->
        <section id="features" class="constrained section surface">
          <div class="section-header">
            <h2>Smart Moving Inventory Features Powered by AI</h2>
            <p class="section-subtext">
              Create a complete, accurate home inventory in minutes using AI-powered item capture and smart packing tools—built for homeowners, renters, and moving professionals.
            </p>
          </div>
          <div class="feature-grid">
            <div class="feature-card">
              <q-icon name="auto_awesome" color="primary" size="28px" />
              <div class="feature-title">AI item detection</div>
              <div class="feature-body">Snap photos and let the moving inventory app auto-label items, weights, and dimensions for a verified home inventory.</div>
            </div>
            <div class="feature-card">
              <q-icon name="view_in_ar" color="primary" size="28px" />
              <div class="feature-title">Smart packing & fit checks</div>
              <div class="feature-body">Drag-and-drop items into boxes with volume/weight constraints, so your packing checklist stays accurate.</div>
            </div>
            <div class="feature-card">
              <q-icon name="share" color="primary" size="28px" />
              <div class="feature-title">Shareable “Verified Inventory”</div>
              <div class="feature-body">Private links movers can use instantly—no special software required. Control permissions, revoke anytime.</div>
            </div>
            <div class="feature-card">
              <q-icon name="description" color="primary" size="28px" />
              <div class="feature-title">Export ready (PDF & CSV)</div>
              <div class="feature-body">Download inventory export files with photos, counts, and details for insurance, claims, and move-day checklists.</div>
            </div>
            <div class="feature-card">
              <q-icon name="lock" color="primary" size="28px" />
              <div class="feature-title">Secure & private</div>
              <div class="feature-body">Share only when you choose. Your home inventory stays secure with permissioned access and auditability.</div>
            </div>
            <div class="feature-card">
              <q-icon name="schedule" color="primary" size="28px" />
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
                <div class="semi-bold text-subtitle1">Monthly</div>
                <div class="price">$8<span class="price-suffix">/month</span></div>
                <div class="text-body2 text-grey-8 q-mt-sm">
                  Unlimited items, photos, exports, and packing fit checks. Perfect if you’re mid-move or organizing now.
                </div>
              </q-card-section>
              <q-card-actions align="right">
                <q-btn unelevated color="primary" label="Choose monthly" to="/login" />
              </q-card-actions>
            </q-card>

            <q-card flat bordered class="info-card pricing-card">
              <q-card-section>
                <div class="semi-bold text-subtitle1">Move Pack</div>
                <div class="price">$20<span class="price-suffix"> / 3 months</span></div>
                <div class="text-body2 text-grey-8 q-mt-sm">
                  One-time access for a single move. Full features for 90 days to capture, share, and export your inventory.
                </div>
              </q-card-section>
              <q-card-actions align="right">
                <q-btn unelevated color="primary" label="Choose move pack" to="/login" />
              </q-card-actions>
            </q-card>

            <q-card flat bordered class="info-card pricing-card">
              <q-card-section>
                <div class="semi-bold text-subtitle1">Annual</div>
                <div class="price">$70<span class="price-suffix">/year</span></div>
                <div class="text-body2 text-grey-8 q-mt-sm">
                  Best value for planners and organizers. All features, all year—great for multiple moves or ongoing inventory.
                </div>
              </q-card-section>
              <q-card-actions align="right">
                <q-btn unelevated color="primary" label="Choose annual" to="/login" />
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
                    <q-icon name="check" size="16px" />
                  </span>
                  <span>{{ row.pro }}</span>
                </div>
            </div>
          </div>
        </section>

        <!-- FAQ -->
        <section id="faq" class="constrained section surface">
          <div class="section-header">
            <h2>Frequently Asked Questions</h2>
          </div>
          <div class="faq-buckets">
            <q-expansion-item dense expand-separator expand-icon="add" expanded-icon="remove" label="AI capture" header-class="faq-header">
              <div class="faq-list">
                <q-expansion-item dense expand-separator expand-icon="add" expanded-icon="remove" label="How does AI item detection work for home inventory?" header-class="faq-subheader">
                  <div class="faq-answer text-body2 text-grey-8">
                    AI item detection reads photos to suggest labels, weights, and dimensions. You can edit anything, and we store the photo with the record for verification.
                  </div>
                </q-expansion-item>
                <q-expansion-item dense expand-separator expand-icon="add" expanded-icon="remove" label="Can AI capture fragile or unusual items?" header-class="faq-subheader">
                  <div class="faq-answer text-body2 text-grey-8">
                    If AI isn’t confident, it flags the item so you can confirm or edit the label before sharing your moving inventory.
                  </div>
                </q-expansion-item>
                <q-expansion-item dense expand-separator expand-icon="add" expanded-icon="remove" label="Do I have to add dimensions manually?" header-class="faq-subheader">
                  <div class="faq-answer text-body2 text-grey-8">
                    If AI can’t infer dimensions, you can enter length/width/height. Fit checks only need rough dimensions to warn about oversized items.
                  </div>
                </q-expansion-item>
              </div>
            </q-expansion-item>

            <q-expansion-item dense expand-separator expand-icon="add" expanded-icon="remove" label="Movers" header-class="faq-header">
              <div class="faq-list">
                <q-expansion-item dense expand-separator expand-icon="add" expanded-icon="remove" label="How do movers use shared inventories?" header-class="faq-subheader">
                  <div class="faq-answer text-body2 text-grey-8">
                    Movers open your “Verified Inventory” in a browser—no special software needed. They review photos, dimensions, and weights to quote or plan without a site visit.
                  </div>
                </q-expansion-item>
                <q-expansion-item dense expand-separator expand-icon="add" expanded-icon="remove" label="Can movers add notes or adjust items?" header-class="faq-subheader">
                  <div class="faq-answer text-body2 text-grey-8">
                    You can grant edit access so movers can propose changes, add packing notes, or flag items that need special handling.
                  </div>
                </q-expansion-item>
                <q-expansion-item dense expand-separator expand-icon="add" expanded-icon="remove" label="Do movers still need an in-home visit?" header-class="faq-subheader">
                  <div class="faq-answer text-body2 text-grey-8">
                    Often no. Detailed photos, weights, and dimensions reduce the need for a visit. Some movers may still choose to confirm complex jobs on-site.
                  </div>
                </q-expansion-item>
              </div>
            </q-expansion-item>

            <q-expansion-item dense expand-separator expand-icon="add" expanded-icon="remove" label="Long-distance moves" header-class="faq-header">
              <div class="faq-list">
                <q-expansion-item dense expand-separator expand-icon="add" expanded-icon="remove" label="Can I use this app to prepare for a long-distance move?" header-class="faq-subheader">
                  <div class="faq-answer text-body2 text-grey-8">
                    Yes. A complete, exportable inventory helps movers quote accurately for long-distance moves and plan truck space, crew, and materials.
                  </div>
                </q-expansion-item>
                <q-expansion-item dense expand-separator expand-icon="add" expanded-icon="remove" label="Does this help with weight tickets and valuation?" header-class="faq-subheader">
                  <div class="faq-answer text-body2 text-grey-8">
                    Your itemized weights and dimensions help prevent overloading and clarify declared value for long hauls.
                  </div>
                </q-expansion-item>
                <q-expansion-item dense expand-separator expand-icon="add" expanded-icon="remove" label="Can I share with multiple movers for competing quotes?" header-class="faq-subheader">
                  <div class="faq-answer text-body2 text-grey-8">
                    Yes. Send read-only links to multiple movers and revoke access anytime. You own the inventory.
                  </div>
                </q-expansion-item>
              </div>
            </q-expansion-item>

            <q-expansion-item dense expand-separator expand-icon="add" expanded-icon="remove" label="Privacy & security" header-class="faq-header">
              <div class="faq-list">
                <q-expansion-item dense expand-separator expand-icon="add" expanded-icon="remove" label="Is my inventory secure and private?" header-class="faq-subheader">
                  <div class="faq-answer text-body2 text-grey-8">
                    You control sharing. Links can be read-only or editable, and you can revoke access anytime. Data is encrypted in transit and at rest.
                  </div>
                </q-expansion-item>
                <q-expansion-item dense expand-separator expand-icon="add" expanded-icon="remove" label="Can I remove photos after sharing?" header-class="faq-subheader">
                  <div class="faq-answer text-body2 text-grey-8">
                    Yes. You can update or remove photos; shared links update instantly, or you can disable the link entirely.
                  </div>
                </q-expansion-item>
                <q-expansion-item dense expand-separator expand-icon="add" expanded-icon="remove" label="Who owns my data?" header-class="faq-subheader">
                  <div class="faq-answer text-body2 text-grey-8">
                    You own your data. We only process it to provide the moving inventory app features; you can export or delete it anytime.
                  </div>
                </q-expansion-item>
              </div>
            </q-expansion-item>

            <q-expansion-item dense expand-separator expand-icon="add" expanded-icon="remove" label="Exports & packing" header-class="faq-header">
              <div class="faq-list">
                <q-expansion-item dense expand-separator expand-icon="add" expanded-icon="remove" label="What export formats are available?" header-class="faq-subheader">
                  <div class="faq-answer text-body2 text-grey-8">
                    You can export PDF and CSV with photos, counts, and item details. Exports work for insurance, claims, or sharing with movers.
                  </div>
                </q-expansion-item>
                <q-expansion-item dense expand-separator expand-icon="add" expanded-icon="remove" label="Can I track packing and fit checks?" header-class="faq-subheader">
                  <div class="faq-answer text-body2 text-grey-8">
                    Yes. Drag items into boxes with volume/weight constraints to build a packing checklist and prevent overload.
                  </div>
                </q-expansion-item>
                <q-expansion-item dense expand-separator expand-icon="add" expanded-icon="remove" label="Do you support inventory labels or QR codes?" header-class="faq-subheader">
                  <div class="faq-answer text-body2 text-grey-8">
                    You can generate label-ready item lists now; QR labeling is on the roadmap so you can scan items in/out of boxes.
                  </div>
                </q-expansion-item>
              </div>
            </q-expansion-item>
          </div>
        </section>

        <!-- Final CTA -->
        <section class="constrained section final-cta">
          <div class="final-card simple">
            <div class="final-text">
              <h3 class="q-mt-none q-mb-xs">Create your smart moving inventory in minutes—free to start.</h3>
            </div>
            <div class="final-btn">
              <q-btn unelevated color="primary" label="Get started" to="/login" icon-right="arrow_forward" />
            </div>
          </div>
        </section>
      </q-page>
    </q-page-container>

    <q-footer bordered class="footer">
      <div class="constrained footer-content">
        <div class="text-caption text-grey-7">&copy; 2025 Nexus Moves</div>
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
        <q-card-actions align="right"><q-btn flat label="Close" color="primary" v-close-popup /></q-card-actions>
      </q-card>
    </q-dialog>

    <q-dialog v-model="showPrivacyPolicy" transition-show="fade" transition-hide="fade">
      <q-card style="max-width: 800px; width: 90vw;">
        <q-card-section><div class="text-h6">Privacy Policy</div></q-card-section>
        <q-card-section class="q-pt-none"><PrivacyPolicy /></q-card-section>
        <q-card-actions align="right"><q-btn flat label="Close" color="primary" v-close-popup /></q-card-actions>
      </q-card>
    </q-dialog>

  </q-layout>
</template>

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

.brand {
  display: flex;
  align-items: center;
  font-weight: 700;
  letter-spacing: -0.4px;
  color: #1f2a44;
}

.nav {
  display: flex;
  gap: 4px;
  margin-left: 16px;
}

.nav-link {
  color: #3e4a5a;
  font-weight: 600;
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

.hero-surface {
  background: transparent;
  border-radius: 16px;
  padding: 24px 20px 28px;
}

.hero {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 32px;
  align-items: center;
  margin-bottom: 56px;
}

.hero-copy h1 {
  font-size: 2.6rem;
  line-height: 1.2;
  margin: 0.5rem 0 0.9rem;
  color: #1f2a44;
}

.hero-copy p {
  color: #4b5563;
  font-size: 1.05rem;
  line-height: 1.65;
  margin: 0 0 1rem;
}

.eyebrow {
  text-transform: uppercase;
  letter-spacing: 0.1em;
  font-size: 0.75rem;
  color: #3b82f6;
  font-weight: 700;
}

.hero-ctas {
  margin-top: 8px;
  display: flex;
  flex-wrap: wrap;
}

.tertiary-link :deep(.q-btn__content) {
  text-decoration: underline;
}

.hero-bullets {
  margin-top: 14px;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 8px 12px;
  color: #374151;
}

.hero-bullets.vertical {
  grid-template-columns: 1fr;
}

.bullet {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.95rem;
}

.hero-visual {
  display: flex;
  justify-content: center;
  align-items: center;
  position: relative;
}

.visual-card {
  width: 100%;
  border-radius: 14px;
  background: transparent;
  box-shadow: none;
  overflow: hidden;
  position: relative;
}

.hero-image {
  width: 100%;
  height: 100%;
  object-fit: cover;
  border-radius: 12px;
}


.section {
  margin-bottom: 64px;
}

.section-divider {
  height: 32px;
}

.section.surface {
  background: #f2f5ff;
  border-radius: 16px;
  padding: 32px 24px;
}

.section-header h2 {
  margin: 0;
  font-size: 2rem;
  color: #1f2a44;
}

.section-header p {
  margin: 6px 0 0;
  color: #374151;
}

.section-subtext {
  color: #4b5563;
  margin-top: 6px;
}

.cards-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 14px;
  margin-top: 16px;
}

.info-card {
  border-radius: 12px;
  background: white;
}

.semi-bold {
  font-weight: 600;
}

.faq-buckets {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-top: 12px;
}

.faq-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 12px;
}

.faq-header {
  font-weight: 700;
}

.faq-subheader {
  font-weight: 700;
}

.faq-answer {
  padding: 12px 0;
}

.dialog-list {
  margin: 0;
  padding-left: 18px;
  color: #4b5563;
  line-height: 1.5;
}

.section-cta {
  margin-top: 20px;
  display: flex;
  justify-content: center;
}

.section-cta.outside {
  margin-top: 8px;
  margin-bottom: 56px;
}

.pricing-card {
  display: grid;
  gap: 6px;
}

.price {
  font-size: 1.6rem;
  font-weight: 700;
  color: #1f2a44;
}

.price-suffix {
  font-size: 0.95rem;
  color: #374151;
  margin-left: 4px;
}

.plan-grid {
  margin-top: 12px;
  display: grid;
  grid-template-columns: 1fr;
  border-radius: 12px;
  overflow: hidden;
  background: white;
  box-shadow: 0 10px 24px rgba(0, 0, 0, 0.04);
}

.plan-grid-row {
  display: grid;
  grid-template-columns: 1.2fr 1fr 1fr;
  align-items: center;
  padding: 12px 16px;
  border-bottom: 1px solid #e5e7eb;
}

.plan-grid-row:last-child {
  border-bottom: none;
}

.plan-grid-head {
  background: #f8fafc;
  font-weight: 700;
  color: #1f2a44;
  border-bottom: 2px solid #d8deeb;
}

.plan-grid-cell {
  display: flex;
  align-items: center;
  line-height: 1.45;
  color: #374151;
  justify-content: flex-start;
  text-align: left;
}

.plan-label-cell {
  font-weight: 700;
  color: #1f2a44;
}

.plan-grid-row:not(.plan-grid-head) .plan-label-cell {
  font-weight: 600;
  margin-right: 12px;
}

.plan-grid-row:nth-child(2n + 1):not(.plan-grid-head) {
  background: #f9fbfd;
}

.text-muted {
  color: #9ba3af;
}

.check-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: #274690;
  color: white;
  box-shadow: 0 4px 10px rgba(39, 70, 144, 0.25);
  margin-right: 6px;
}

.cta-strong {
  padding: 12px 20px;
  font-weight: 600;
  font-size: 1.05rem;
  box-shadow: 0 10px 24px rgba(37, 99, 235, 0.25);
}

.micro-ctas {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 10px;
}

.trust-row {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 10px;
  margin-top: 16px;
  color: #374151;
}

.trust-item {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.95rem;
}

.feature-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: 16px;
  margin-top: 16px;
}

.feature-card {
  background: #fff;
  border-radius: 12px;
  padding: 16px;
  border: 1px solid #e5e7eb;
  display: grid;
  gap: 6px;
}

.feature-title {
  font-weight: 600;
  color: #1f2a44;
}

.feature-body {
  color: #4b5563;
  font-size: 0.95rem;
  line-height: 1.5;
}

.feature-link {
  color: #2563eb;
  font-weight: 600;
  font-size: 0.9rem;
  text-decoration: none;
  cursor: pointer;
}

.feature-link:hover {
  text-decoration: underline;
}

.button-like {
  background: none;
  border: none;
  padding: 0;
}
.final-cta .final-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: white;
  border: 1px solid #e5e7eb;
  border-radius: 14px;
  padding: 18px 20px;
  gap: 12px;
}

.final-card.simple {
  padding: 20px 24px;
}

.final-text h3 {
  font-size: 1.8rem;
  color: #1f2a44;
}

.final-btn {
  display: flex;
  align-items: flex-end;
  justify-content: flex-end;
}

.footer {
  background: white;
}

.footer-content {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 16px;
}

.footer-links {
  display: flex;
  gap: 8px;
}

.footer-link {
  color: #4b5563;
}

@media (max-width: 900px) {
  .nav {
    display: none;
  }
  .hero-copy h1 {
    font-size: 2.2rem;
  }
  .final-cta .final-card {
    flex-direction: column;
    align-items: flex-start;
  }
  .section.alt {
    padding: 24px 16px;
  }
}
</style>
