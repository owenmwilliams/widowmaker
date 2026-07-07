<script setup lang="ts">
import { ref, computed } from 'vue';
import { useDialogPluginComponent } from 'quasar';
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
    ],
    theme: {
      // Card styling
      cardBackground: 'linear-gradient(135deg, #ffffff 0%, #eeeeee 100%)',
      cardBorder: '#111111',
      cardShadow: 'none',

      // Pricing section
      tierNameColor: '#444444',
      priceColor: '#444444',
      standardPriceColor: '#444444',

      // Pro pricing (when applicable)
      proPriceBackground: 'transparent',
      proPriceLabelGradient: '#666666',
      proPriceLabelColor: '#555555',
      proPriceColor: '#555555',
      savingsCalloutBackground: '#666666',
      savingsCalloutColor: 'white',

      // Feature callout
      featureCalloutBackground: '#555555',
      featureCalloutIconColor: '#ffffff',
      featureCalloutTitleColor: '#ffffff',
      featureCalloutSubtitleColor: '#ffffff',

      // Features list
      featureTextColor: '#4b5563',

      // Button
      
      buttonBackground: '#555555',
      buttonTextColor: '#ffffff',
    }
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
    ],
    theme: {
      // Card styling
      cardBackground: 'linear-gradient(135deg, #ffffff 0%, #dad2fc 100%)',
      cardBorder: '#7c3aed',
      cardShadow: '0 8px 30px rgba(124, 58, 237, 0.25)',

      // Pricing section
      tierNameColor: '#1f2937',
      priceColor: '#1f2937',
      standardPriceColor: '#6b7280',

      // Pro pricing (when applicable)
      proPriceBackground: 'transparent',
      proPriceLabelGradient: '#2e1e6f',
      proPriceLabelColor: '#7c3aed',
      proPriceColor: '#1e1b4b',
      savingsCalloutBackground: 'linear-gradient(135deg, #7c3aed, #6d28d9)',
      savingsCalloutColor: 'white',

      // Feature callout
      featureCalloutBackground: '#2e1e6f',
      featureCalloutIconColor: '#ffffff',
      featureCalloutTitleColor: '#ffffff',
      featureCalloutSubtitleColor: '#ffffff',

      // Features list
      featureTextColor: '#4b5563',

      // Button
      buttonColor: '#1f2937',
      buttonBackground: '#2e1e6f',
      buttonTextColor: '#ffffff',
    }
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
    ],
    theme: {
      // Card styling
      cardBackground: '#2e1e6f',
      cardBorder: '#2e1e6f',
      cardShadow: 'none',

      // Pricing section
      tierNameColor: 'white',
      priceColor: 'linear-gradient(135deg, #BF953F 0%, #FCF6BA 25%, #B38728 50%, #FBF5B7 75%, #AA771C 100%)',
      standardPriceColor: 'white',

      // Pro pricing (when applicable)
      proPriceBackground: 'transparent',
      proPriceLabelGradient: 'linear-gradient(135deg, #BF953F 0%, #FCF6BA 25%, #B38728 50%, #FBF5B7 75%, #AA771C 100%)',
      proPriceLabelColor: 'linear-gradient(135deg, #BF953F 0%, #FCF6BA 25%, #B38728 50%, #FBF5B7 75%, #AA771C 100%)',
      proPriceColor: 'linear-gradient(135deg, #BF953F 0%, #FCF6BA 25%, #B38728 50%, #FBF5B7 75%, #AA771C 100%)',
      savingsCalloutBackground: 'linear-gradient(135deg, #BF953F 0%, #FCF6BA 25%, #B38728 50%, #FBF5B7 75%, #AA771C 100%)',
      savingsCalloutColor: '#5C4010',

      // Feature callout
      featureCalloutBackground: 'linear-gradient(135deg, #BF953F 0%, #FCF6BA 25%, #B38728 50%, #FBF5B7 75%, #AA771C 100%)',
      featureCalloutIconColor: '#5C4010',
      featureCalloutTitleColor: '#5C4010',
      featureCalloutSubtitleColor: '#5C4010',

      // Features list
      featureTextColor: '#FCF6BA',

      // Button
      buttonColor: '#5C4010',
      buttonBackground: 'linear-gradient(135deg, #BF953F 0%, #FCF6BA 25%, #B38728 50%, #FBF5B7 75%, #AA771C 100%)',
      buttonTextColor: '#5C4010',
      buttonBorder: 'transparent',
      buttonShadow: 'inset 0 1px 0 rgba(255, 255, 255, 0.5), 0 4px 12px rgba(255, 215, 0, 0.35), 0 0 20px rgba(255, 215, 0, 0.25)'
    }
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
    <q-card style="width: 80vw; max-width: 80vw; max-height: 70vh; display: flex; flex-direction: column;">
      <!-- <q-card-section class="row items-center q-pb-none">
        <div class="text-h5">Get Quotes ASAP</div>
        <q-space />
        <q-btn icon="close" flat round dense @click="onDialogCancel" />
      </q-card-section> -->

      <!-- Success state (#90): the lead landed — no payment, brokered manually -->
      <q-card-section v-if="submitted" class="lead-success">
        <q-icon name="check_circle" color="positive" size="48px" />
        <div class="lead-success-title">Request received — we'll be in touch within 1 business day.</div>
        <div class="lead-success-caption">
          Your {{ selectedTier?.tier }} quote request has been submitted. This service is free while we're in launch — no payment required.
        </div>
        <q-btn unelevated color="primary" label="Done" class="q-mt-md" @click="onDialogCancel" />
      </q-card-section>

      <q-card-section v-else class="q-pt-sm" style="flex: 1; overflow-y: auto;">

        <div v-if="submitError" class="lead-error">
          {{ submitError }}
        </div>

        <div class="pricing-tiers">
          <div
            v-for="tier in serviceTiers"
            :key="tier.name"
            class="pricing-tier"
            :class="{ 'pricing-tier--recommended': tier.recommended }"
            :style="{
              background: tier.theme.cardBackground,
              borderColor: tier.theme.cardBorder,
              boxShadow: tier.theme.cardShadow
            }"
            @click="selectTier(tier)"
          >
            <div class="tier-header">
              <!-- Pro Member Price Stack -->
              <div
                v-if="isPro && tier.price < tier.originalPrice"
                class="pricing-container"
                :style="{ background: tier.theme.proPriceBackground }"
              >
                <div class="tier-name-large" :style="{ background: tier.theme.tierNameColor, 'background-clip': 'text', '-webkit-background-clip': 'text', '-webkit-text-fill-color': 'transparent', color: tier.theme.tierNameColor }">{{ tier.name }}</div>
                <div class="standard-price-line" :style="{ color: tier.theme.standardPriceColor }">
                  Standard: <span class="standard-price-amount">${{ tier.originalPrice }}</span>
                </div>
                <div class="pro-price-label" :style="{ background: tier.theme.proPriceLabelGradient, 'background-clip': 'text', '-webkit-background-clip': 'text', '-webkit-text-fill-color': 'transparent', color: tier.theme.proPriceLabelColor }">PRO PRICE</div>
                <div class="pro-price" :style="{ background: tier.theme.proPriceColor, 'background-clip': 'text', '-webkit-background-clip': 'text', '-webkit-text-fill-color': 'transparent', color: tier.theme.proPriceColor }">${{ tier.price }}</div>
                <div
                  class="savings-callout"
                  :style="{
                    background: tier.theme.savingsCalloutBackground,
                    color: tier.theme.savingsCalloutColor
                  }"
                >
                  SAVE ${{ tier.originalPrice - tier.price }}
                </div>
              </div>

              <!-- Standard Price (non-Pro users) -->
              <div v-else class="standard-pricing-container">
                <div class="tier-name-large" :style="{ background: tier.theme.tierNameColor, 'background-clip': 'text', '-webkit-background-clip': 'text', '-webkit-text-fill-color': 'transparent', color: tier.theme.tierNameColor }">{{ tier.name }}</div>
                <div class="standard-price-line-basic" :style="{ color: tier.theme.standardPriceColor }">
                  Standard: ${{ tier.price }}
                </div>
                <div class="tier-price" :style="{ background: tier.theme.priceColor, 'background-clip': 'text', '-webkit-background-clip': 'text', '-webkit-text-fill-color': 'transparent', color: tier.theme.priceColor }">
                  ${{ tier.price }}
                </div>
              </div>
            </div>

            <div class="tier-body">
              <!-- Feature Callout Box -->
              <div
                class="feature-callout"
                :style="{ background: tier.theme.featureCalloutBackground }"
              >
                <div class="feature-callout-icon" :style="{ color: tier.theme.featureCalloutIconColor }">
                  <q-icon v-if="tier.name === 'Basic'" name="mail" size="20px" />
                  <q-icon v-else-if="tier.name === 'Premium'" name="bolt" size="20px" />
                  <q-icon v-else name="workspace_premium" size="20px" />
                </div>
                <div class="feature-callout-text">
                  <div
                    class="feature-callout-title"
                    :style="{ color: tier.theme.featureCalloutTitleColor }"
                  >
                    <span v-if="tier.name === 'Basic'">Standard Email Support</span>
                    <span v-else-if="tier.name === 'Premium'">Priority Support</span>
                    <span v-else>Dedicated Concierge</span>
                  </div>

                  <div
                    class="feature-callout-subtitle"
                    :style="{ color: tier.theme.featureCalloutSubtitleColor }"
                  >
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
                :color="tier.theme.buttonBackground ? undefined : tier.theme.buttonColor"
                :label="`Choose ${tier.name}`"
                :loading="submitting && selectedTier?.tier === tier.name.toLowerCase()"
                :disable="submitting"
                class="tier-cta-button"
                :style="tier.theme.buttonBackground ? {
                  background: tier.theme.buttonBackground + ' !important',
                  backgroundColor: tier.theme.buttonBackground + ' !important',
                  color: tier.theme.buttonTextColor + ' !important',
                  border: tier.theme.buttonBorder,
                  boxShadow: tier.theme.buttonShadow,
                  fontWeight: '700'
                } : {}"
                @click.stop="selectTier(tier)"
              />
            </div>
          </div>
        </div>

        <!-- <div class="text-caption text-grey-6 text-center q-mt-md">
          <strong>How it works:</strong> After payment, we create a detailed RFQ from your inventory and send it to our network of vetted moving companies. Quotes arrive in your inbox within the turnaround time—no calls, no hassle.
        </div> -->
      </q-card-section>
    </q-card>
  </q-dialog>
</template>

<style scoped>
.pricing-tiers {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  /* gap: 16px; */
  margin: 0 -16px;
}

.pricing-tier {
  display: flex;
  flex-direction: column;
  min-height: 420px;
  transition: all 0.2s ease;
  cursor: pointer;
  margin: 10px;
  border-radius: 12px;
  border: 2px solid;
}

.pricing-tier:hover {
  transform: translateY(-2px);
}

.pricing-tier--recommended {
  position: relative;
}

.tier-header {
  text-align: center;
  padding-bottom: 12px;
}

.tier-name-large {
  font-size: 1.75rem;
  font-weight: 700;
  margin-bottom: 8px;
}

/* Pro Member Price Stack */
.pricing-container {
  padding: 20px;
  margin: 12px 0;
  text-align: center;
}

/* Standard Pricing (non-Pro) */
.standard-pricing-container {
  text-align: center;
  margin: 12px 0;
  padding: 20px 0;
}

.standard-price-line {
  font-size: 0.875rem;
  font-weight: 400;
  margin-bottom: 12px;
}

.standard-price-line-basic {
  font-size: 0.875rem;
  font-weight: 400;
  margin-bottom: 16px;
}

.standard-price-amount {
  text-decoration: line-through;
}

.pro-price-label {
  font-size: 1.125rem;
  font-weight: 800;
  font-style: italic;
  text-transform: uppercase;
  letter-spacing: 1.5px;
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
  margin-bottom: 12px;
  color: blue;
}

.pro-price {
  font-size: 2.5rem;
  font-weight: 800;
  line-height: 1;
  margin-bottom: 16px;
  letter-spacing: -2px;
}

.savings-callout {
  font-size: 0.875rem;
  font-weight: 700;
  border-radius: 20px;
  padding: 8px 20px;
  display: inline-block;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

/* Standard Price (non-Pro) */
.tier-price {
  font-size: 2rem;
  font-weight: 700;
  margin-bottom: 8px;
  letter-spacing: -1px;
}

.tier-description {
  color: #6b7280;
  font-size: 0.8rem;
  margin-top: 4px;
  line-height: 1.3;
}

.tier-body {
  flex: 1;
  display: flex;
  flex-direction: column;
}

/* Feature Callout Box */
.feature-callout {
  border-radius: 12px;
  padding: 16px;
  margin: 16px;
  display: flex;
  align-items: center;
  gap: 12px;
}

.feature-callout-icon {
  flex-shrink: 0;
}

.feature-callout-text {
  flex: 1;
}

.feature-callout-title {
  font-size: 0.875rem;
  font-weight: 700;
  line-height: 1.2;
}

.feature-callout-subtitle {
  font-size: 0.75rem;
  margin-top: 2px;
}

.tier-features {
  list-style: none;
  padding: 0;
  margin: 0;
  flex: 1;
}

.tier-features li {
  padding: 6px 0;
  font-size: 0.8125rem;
  line-height: 1.5;
}

.tier-actions {
  padding: 0;
  margin: 16px;
}

.tier-cta-button {
  width: 100%;
  border-radius: 12px;
}

/* Lead submission states (#90) */
.lead-success {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 48px 32px;
}

.lead-success-title {
  font-size: 1.25rem;
  font-weight: 700;
  margin-top: 16px;
}

.lead-success-caption {
  font-size: 0.875rem;
  color: #6b7280;
  margin-top: 8px;
}

.lead-error {
  background: #fef2f2;
  border: 1px solid #fecaca;
  color: #991b1b;
  border-radius: 8px;
  padding: 10px 14px;
  margin: 4px 10px 8px;
  font-size: 0.875rem;
  text-align: center;
}
</style>
