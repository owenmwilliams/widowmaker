<script setup lang="ts">
import { ref, computed } from 'vue';
import { useDialogPluginComponent } from 'quasar';
import { CheckCircle2, Mail, Zap, Award } from 'lucide-vue-next';
import { API_BASE_URL } from '../../config/api';

interface Props {
  isPro: boolean;
  moveSummary?: Record<string, unknown> | null;
}

const props = defineProps<Props>();

// Required for Quasar dialog component
const { dialogRef, onDialogHide, onDialogOK, onDialogCancel } = useDialogPluginComponent();

const selectedTier = ref<{ tier: string; price: number } | null>(null);

const serviceTiers = computed(() => [
  {
    name: 'Basic',
    price: props.isPro ? 39 : 49,
    originalPrice: 49,
    quotes: '3-5',
    turnaround: '48 hours',
    icon: 'person',
    description: 'Get started with competitive quotes',
    features: [
      '3 vetted moving company quotes',
      '48-hour response time',
      'Email support'
    ]
  },
  {
    name: 'Premium',
    price: props.isPro ? 75 : 99,
    originalPrice: 99,
    quotes: '5-10',
    turnaround: '24 hours',
    icon: 'verified',
    description: 'More quotes, faster results',
    recommended: true,
    features: [
      '5+ vetted moving company quotes',
      '24-hour response time',
      'Priority email & chat support',
    ]
  },
  {
    name: 'White Glove',
    price: props.isPro ? 150 : 199,
    originalPrice: 199,
    quotes: 'Unlimited',
    turnaround: '12 hours',
    icon: 'workspace_premium',
    description: 'Full-service quote concierge',
    features: [
      'Unlimited quotes',
      '12-hour response time',
      'Phone support & consultation',
      'Negotiation assistance'
    ]
  }
]);

// Lead submission state (#90) — choosing a tier submits a real quote lead.
const submitting = ref(false);
const submitted = ref(false);
const submitError = ref<string | null>(null);

const selectTier = async (tier: any) => {
  if (submitting.value || submitted.value) return;
  submitError.value = null;
  submitting.value = true;
  selectedTier.value = { tier: tier.name.toLowerCase(), price: tier.price };

  try {
    const userData = JSON.parse(localStorage.getItem('user_data') || '{}');
    const sessionToken = localStorage.getItem('session_token');
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (sessionToken) {
      headers.Authorization = `Bearer ${sessionToken}`;
    }

    const response = await fetch(`${API_BASE_URL}/api/move/quote-leads`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        tier: tier.name.toLowerCase(),
        contact_email: userData.email || '',
        move_summary: props.moveSummary || null
      })
    });

    if (!response.ok) {
      throw new Error(`Quote lead request failed (${response.status})`);
    }

    submitted.value = true;
  } catch (error) {
    console.error('Error submitting quote lead:', error);
    submitError.value = "We couldn't send your request just now — please try again.";
  } finally {
    submitting.value = false;
  }
};
</script>

<template>
  <q-dialog ref="dialogRef" @hide="onDialogHide" style="width: 70vw; max-width: 70vw; margin-top: 20vh;">
    <q-card class="quote-modal" style="width: 80vw; max-width: 80vw; max-height: 70vh; display: flex; flex-direction: column;">
      <!-- Success state (#90): the lead landed — no payment, brokered manually -->
      <q-card-section v-if="submitted" class="lead-success">
        <CheckCircle2 :size="48" class="lead-success-icon" />
        <div class="lead-success-title">Request received — we'll be in touch within 1 business day.</div>
        <div class="lead-success-caption">
          Your {{ selectedTier?.tier }} quote request has been submitted. This service is free while we're in launch — no payment required.
        </div>
        <q-btn unelevated color="primary" label="Done" class="q-mt-md lead-success-done" @click="onDialogCancel" />
      </q-card-section>

      <q-card-section v-else class="q-pt-sm" style="flex: 1; overflow-y: auto;">

        <div v-if="submitError" class="lead-error" role="alert">
          {{ submitError }}
        </div>

        <div class="pricing-tiers">
          <div
            v-for="tier in serviceTiers"
            :key="tier.name"
            class="pricing-tier"
            :class="{
              'pricing-tier--recommended': tier.recommended,
              'pricing-tier--selected': submitting && selectedTier?.tier === tier.name.toLowerCase()
            }"
            @click="selectTier(tier)"
          >
            <div v-if="tier.recommended" class="recommended-pill">Recommended</div>

            <div class="tier-header">
              <!-- Pro Member Price Stack -->
              <div
                v-if="isPro && tier.price < tier.originalPrice"
                class="pricing-container"
              >
                <div class="tier-name-large">{{ tier.name }}</div>
                <div class="standard-price-line">
                  Standard: <span class="standard-price-amount">${{ tier.originalPrice }}</span>
                </div>
                <div class="pro-price-label">Pro price</div>
                <div class="pro-price">${{ tier.price }}</div>
                <div class="savings-callout">
                  Save ${{ tier.originalPrice - tier.price }}
                </div>
              </div>

              <!-- Standard Price (non-Pro users) -->
              <div v-else class="standard-pricing-container">
                <div class="tier-name-large">{{ tier.name }}</div>
                <div class="standard-price-line-basic">
                  Standard: ${{ tier.price }}
                </div>
                <div class="tier-price">
                  ${{ tier.price }}
                </div>
              </div>
            </div>

            <div class="tier-body">
              <!-- Feature Callout Box -->
              <div class="feature-callout">
                <div class="feature-callout-icon">
                  <Mail v-if="tier.name === 'Basic'" :size="20" />
                  <Zap v-else-if="tier.name === 'Premium'" :size="20" />
                  <Award v-else :size="20" />
                </div>
                <div class="feature-callout-text">
                  <div class="feature-callout-title">
                    <span v-if="tier.name === 'Basic'">Standard email support</span>
                    <span v-else-if="tier.name === 'Premium'">Priority support</span>
                    <span v-else>Dedicated concierge</span>
                  </div>

                  <div class="feature-callout-subtitle">
                    <span v-if="tier.name === 'Basic'">3-5 quotes within 48 hours</span>
                    <span v-else-if="tier.name === 'Premium'">24hr response & chat</span>
                    <span v-else-if="tier.name === 'White Glove'">Phone access & negotiation</span>
                  </div>
                </div>
              </div>
            </div>

            <div class="tier-actions">
              <q-btn
                unelevated
                color="primary"
                :label="`Choose ${tier.name}`"
                :loading="submitting && selectedTier?.tier === tier.name.toLowerCase()"
                :disable="submitting"
                class="tier-cta-button"
                @click.stop="selectTier(tier)"
              />
            </div>
          </div>
        </div>
      </q-card-section>
    </q-card>
  </q-dialog>
</template>

<style scoped>
.pricing-tiers {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: var(--sp-5);
  padding: var(--sp-4) var(--sp-2) var(--sp-2);
}

/* Card contract: white surface, hairline border, --r-lg, soft shadow.
   Selected/recommended = accent border + accent-quiet tint (no new hue). */
.pricing-tier {
  display: flex;
  flex-direction: column;
  min-height: 420px; /* fixed layout dimension */
  background: var(--surface-card);
  border: 1px solid var(--border);
  border-radius: var(--r-lg);
  box-shadow: var(--shadow-sm);
  cursor: pointer;
  transition:
    transform var(--dur-base) var(--ease-standard),
    box-shadow var(--dur-base) var(--ease-standard),
    border-color var(--dur-base) var(--ease-standard),
    background-color var(--dur-base) var(--ease-standard);
}

.pricing-tier:hover {
  transform: translateY(-2px);
  box-shadow: var(--shadow-md);
  border-color: var(--accent);
}

.pricing-tier:active {
  transform: scale(0.97);
}

.pricing-tier:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring);
}

.pricing-tier--recommended,
.pricing-tier--selected {
  border-color: var(--accent);
  background: var(--accent-quiet);
}

.recommended-pill {
  align-self: center;
  margin-top: var(--sp-4);
  margin-bottom: calc(-1 * var(--sp-3));
  background: var(--accent);
  color: var(--text-on-accent);
  font-size: var(--fs-micro);
  font-weight: var(--fw-semibold);
  letter-spacing: 0.02em;
  padding: var(--sp-1) var(--sp-4);
  border-radius: var(--r-pill);
  white-space: nowrap;
}

.tier-header {
  text-align: center;
  padding-bottom: var(--sp-4);
}

.tier-name-large {
  font-family: var(--font-display);
  font-size: var(--fs-title-m);
  font-weight: var(--fw-bold);
  letter-spacing: var(--ls-title);
  color: var(--text-primary);
  margin-bottom: var(--sp-3);
}

/* Pro Member Price Stack */
.pricing-container {
  padding: var(--sp-6);
  margin: var(--sp-4) 0;
  text-align: center;
}

/* Standard Pricing (non-Pro) */
.standard-pricing-container {
  text-align: center;
  margin: var(--sp-4) 0;
  padding: var(--sp-6) 0;
}

.standard-price-line,
.standard-price-line-basic {
  font-size: var(--fs-label);
  font-weight: var(--fw-regular);
  color: var(--text-secondary);
  margin-bottom: var(--sp-4);
}

.standard-price-line-basic {
  margin-bottom: var(--sp-5);
}

.standard-price-amount {
  text-decoration: line-through;
}

/* Mono uppercase eyebrow for the Pro-price label */
.pro-price-label {
  font-family: var(--font-mono);
  font-size: var(--fs-micro);
  font-weight: var(--fw-bold);
  text-transform: uppercase;
  letter-spacing: var(--ls-eyebrow);
  color: var(--accent);
  margin-bottom: var(--sp-4);
}

/* Pricing numbers use the display face per StatCard */
.pro-price {
  font-family: var(--font-display);
  font-size: var(--fs-display-m);
  font-weight: var(--fw-extrabold);
  line-height: var(--lh-tight);
  letter-spacing: var(--ls-display);
  color: var(--text-primary);
  margin-bottom: var(--sp-5);
}

/* Pro-discount tag as a token pill */
.savings-callout {
  display: inline-block;
  font-size: var(--fs-label);
  font-weight: var(--fw-semibold);
  color: var(--accent);
  background: var(--accent-quiet);
  border: 1px solid var(--accent-quiet-2);
  border-radius: var(--r-pill);
  padding: var(--sp-2) var(--sp-5);
}

/* Standard Price (non-Pro) */
.tier-price {
  font-family: var(--font-display);
  font-size: var(--fs-display-m);
  font-weight: var(--fw-extrabold);
  line-height: var(--lh-tight);
  letter-spacing: var(--ls-display);
  color: var(--text-primary);
  margin-bottom: var(--sp-3);
}

.tier-description {
  color: var(--text-secondary);
  font-size: var(--fs-label);
  margin-top: var(--sp-2);
  line-height: var(--lh-snug);
}

.tier-body {
  flex: 1;
  display: flex;
  flex-direction: column;
}

/* Feature Callout Box */
.feature-callout {
  background: var(--accent-quiet);
  border: 1px solid var(--border-soft);
  border-radius: var(--r-md);
  padding: var(--sp-5);
  margin: var(--sp-5);
  display: flex;
  align-items: center;
  gap: var(--sp-4);
}

.feature-callout-icon {
  flex-shrink: 0;
  display: inline-flex;
  color: var(--accent);
}

.feature-callout-text {
  flex: 1;
}

.feature-callout-title {
  font-size: var(--fs-body);
  font-weight: var(--fw-bold);
  line-height: var(--lh-snug);
  color: var(--text-primary);
}

.feature-callout-subtitle {
  font-size: var(--fs-label);
  color: var(--text-secondary);
  margin-top: var(--sp-1);
}

.tier-features {
  list-style: none;
  padding: 0;
  margin: 0;
  flex: 1;
}

.tier-features li {
  padding: var(--sp-2) 0;
  font-size: var(--fs-label);
  line-height: var(--lh-body);
}

.tier-actions {
  padding: 0;
  margin: var(--sp-5);
  margin-top: auto;
}

.tier-cta-button {
  width: 100%;
  border-radius: var(--r-md);
  font-weight: var(--fw-semibold);
  transition: transform var(--dur-fast) var(--ease-standard);
}

.tier-cta-button:active {
  transform: scale(0.97);
}

.tier-cta-button.disabled {
  opacity: 0.45 !important;
}

/* Lead submission states (#90) — presentation only, logic untouched */
.lead-success {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: var(--sp-10) var(--sp-8);
  margin: var(--sp-5);
  background: var(--success-quiet);
  border: 1px solid color-mix(in oklab, var(--success) 30%, transparent);
  border-radius: var(--r-lg);
}

.lead-success-icon {
  color: var(--success);
}

.lead-success-title {
  font-family: var(--font-display);
  font-size: var(--fs-title-s);
  font-weight: var(--fw-bold);
  letter-spacing: var(--ls-title);
  color: var(--text-primary);
  margin-top: var(--sp-5);
}

.lead-success-caption {
  font-size: var(--fs-body);
  color: var(--text-secondary);
  margin-top: var(--sp-3);
}

.lead-error {
  background: var(--danger-quiet);
  border: 1px solid color-mix(in oklab, var(--danger) 35%, transparent);
  color: var(--danger);
  border-radius: var(--r-md);
  padding: var(--sp-4) var(--sp-5);
  margin: var(--sp-2) var(--sp-4) var(--sp-3);
  font-size: var(--fs-body);
  font-weight: var(--fw-medium);
  text-align: center;
}
</style>
