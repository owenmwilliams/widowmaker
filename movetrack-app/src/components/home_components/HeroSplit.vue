<script setup lang="ts">
import { ref, computed } from 'vue';
import { useQuasar } from 'quasar';
import axios from 'axios';
import { inventoryItems } from '../../data/inventoryItems';
import InventorySidebar from './InventorySidebar.vue';
import type { InventoryItem } from '../../data/inventoryItems';

const $q = useQuasar();

// To adjust url based on whether in prod or not
const core_url = import.meta.env.MODE == 'development' ? 'http://localhost:3050' : 'https://movetrack-api-7hwn7ggbiq-uc.a.run.app';

// Email signup state
const email = ref('');
const emailError = ref(false);
const emailErrorMessage = ref('');
const isSubmitting = ref(false);
const emailSent = ref(false);

// Selected item for hero display
const selectedItemId = ref<number>(inventoryItems[0].id);

const selectedItem = computed(() => {
  return inventoryItems.find(item => item.id === selectedItemId.value) || inventoryItems[0];
});

// Packing estimate popover
const showPackingEstimate = ref(false);

const packingEstimate = computed(() => {
  const totalWeight = inventoryItems.reduce((sum, item) => {
    const weight = parseFloat(item.weight.replace(' lbs', ''));
    return sum + (weight * item.qty);
  }, 0);

  const totalVolume = inventoryItems.reduce((sum, item) => {
    // Parse size string like "6×4×4" to calculate cubic inches
    const dimensions = item.size.replace(/"/g, '').split('×').map(d => parseFloat(d));
    if (dimensions.length === 3) {
      const cubicInches = dimensions[0] * dimensions[1] * dimensions[2];
      return sum + (cubicInches * item.qty);
    }
    return sum;
  }, 0);

  const cubicFeet = (totalVolume / 1728).toFixed(1); // 1728 cubic inches = 1 cubic foot

  return {
    totalWeight: totalWeight.toFixed(1),
    totalVolume: cubicFeet,
    estimatedBoxes: Math.ceil(parseFloat(cubicFeet) / 2), // Rough estimate: 2 cubic feet per box
    totalItems: inventoryItems.reduce((sum, item) => sum + item.qty, 0)
  };
});

// Mobile drawer
const isMobile = computed(() => {
  const minWidth = 768;
  return window.innerWidth < minWidth;
});

const drawerOpen = ref(false);

const validateEmail = () => {
  if (!email.value) {
    emailError.value = true;
    emailErrorMessage.value = 'Email is required';
    return false;
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email.value)) {
    emailError.value = true;
    emailErrorMessage.value = 'Invalid email format';
    return false;
  }

  emailError.value = false;
  emailErrorMessage.value = '';
  return true;
};

const requestMagicLink = async () => {
  if (!validateEmail()) {
    return;
  }

  isSubmitting.value = true;

  try {
    const response = await axios.post(`${core_url}/auth/request-magic-link`, {
      email: email.value
    });

    if (response.data.success) {
      emailSent.value = true;
      $q.notify({
        type: 'positive',
        message: 'Check your email for the login link!',
        caption: 'The link will expire in 15 minutes'
      });
    } else {
      $q.notify({
        type: 'negative',
        message: response.data.error || 'Failed to send magic link'
      });
    }
  } catch (error: any) {
    console.error('Error requesting magic link:', error);
    $q.notify({
      type: 'negative',
      message: error.response?.data?.error || 'Failed to send magic link'
    });
  } finally {
    isSubmitting.value = false;
  }
};

const handleSelectItem = (itemId: number) => {
  selectedItemId.value = itemId;
  if (isMobile.value) {
    drawerOpen.value = false;
  }
};

const handleUpdateItem = (itemId: number, updates: Partial<InventoryItem>) => {
  // Placeholder for future functionality
  console.log('Update item:', itemId, updates);
};
</script>

<template>
  <div class="hero-split">
    <!-- Desktop Layout -->
    <div v-if="!isMobile" class="hero-content-desktop">
      <!-- Column 1: Headline & CTA -->
      <div class="hero-column col-headline">
        <h1 class="hero-title">Moving made manageable.</h1>
        <h2 class="hero-subtitle">Log it. Store it. Ship it.</h2>
        <p class="hero-description">
          See exactly what you're moving. Track every item with photos and precise measurements for accurate quotes.
        </p>

        <div v-if="!emailSent" class="email-capture">
          <q-input
            v-model="email"
            label="Enter your email"
            type="email"
            outlined
            :error="emailError"
            :error-message="emailErrorMessage"
            @update:model-value="emailError = false"
            @keyup.enter="requestMagicLink"
            class="email-input"
            aria-label="Email address"
          >
            <template v-slot:prepend>
              <q-icon name="mail" />
            </template>
          </q-input>
          <q-btn
            unelevated
            color="primary"
            :loading="isSubmitting"
            :disable="isSubmitting"
            class="cta-button"
            @click="requestMagicLink"
          >
            Try the Demo
          </q-btn>
        </div>
        <div v-else class="success-message">
          <q-icon name="check_circle" size="48px" color="positive" />
          <p class="success-text">Check your email!</p>
          <p class="success-caption">We've sent a login link to {{ email }}</p>
        </div>
      </div>

      <!-- Column 2: Hero Image Stage -->
      <div class="hero-column col-image">
        <div class="image-stage">
          <transition name="fade" mode="out-in">
            <q-img
              :key="selectedItem.id"
              :src="selectedItem.image"
              :alt="`${selectedItem.name}, ${selectedItem.material}, ${selectedItem.primaryColor}`"
              fit="contain"
              class="hero-image"
            >
              <template v-slot:loading>
                <q-skeleton class="full-width full-height" />
              </template>
            </q-img>
          </transition>

          <!-- Item Info Overlay -->
          <div class="image-info-overlay">
            <div class="info-card">
              <h3 class="item-title">{{ selectedItem.name }}</h3>
              <div class="item-specs">
                <div class="spec-row">
                  <q-icon name="straighten" size="18px" />
                  <span>{{ selectedItem.size }}</span>
                </div>
                <div class="spec-row">
                  <q-icon name="scale" size="18px" />
                  <span>{{ selectedItem.weight }}</span>
                </div>
                <div class="spec-row">
                  <q-icon name="inventory_2" size="18px" />
                  <span>Qty: {{ selectedItem.qty }}</span>
                </div>
              </div>
            </div>
          </div>

          <!-- Packing Estimate Button -->
          <div class="packing-estimate-trigger">
            <q-btn
              outline
              color="primary"
              label="See packing estimate"
              icon="calculate"
              @click="showPackingEstimate = true"
              class="estimate-button"
            />
          </div>
        </div>
      </div>

      <!-- Column 3: Inventory Sidebar -->
      <div class="hero-column col-sidebar">
        <InventorySidebar
          :items="inventoryItems"
          :selected-item-id="selectedItemId"
          @select-item="handleSelectItem"
          @update-item="handleUpdateItem"
        />
      </div>
    </div>

    <!-- Mobile Layout -->
    <div v-else class="hero-content-mobile">
      <!-- Top Section: Headline & Image -->
      <div class="mobile-top">
        <div class="mobile-headline">
          <h1 class="hero-title-mobile">Moving made manageable.</h1>
          <h2 class="hero-subtitle-mobile">Log it. Store it. Ship it.</h2>
        </div>

        <div class="mobile-image-stage">
          <transition name="fade" mode="out-in">
            <q-img
              :key="selectedItem.id"
              :src="selectedItem.image"
              :alt="selectedItem.name"
              fit="contain"
              class="mobile-hero-image"
              :ratio="1"
            />
          </transition>
        </div>

        <!-- Email Capture -->
        <div class="mobile-email-section">
          <div v-if="!emailSent" class="email-capture-mobile">
            <q-input
              v-model="email"
              label="Enter your email"
              type="email"
              outlined
              :error="emailError"
              :error-message="emailErrorMessage"
              @update:model-value="emailError = false"
              @keyup.enter="requestMagicLink"
              class="email-input-mobile"
            >
              <template v-slot:prepend>
                <q-icon name="mail" />
              </template>
            </q-input>
            <q-btn
              unelevated
              color="primary"
              :loading="isSubmitting"
              :disable="isSubmitting"
              class="cta-button-mobile full-width"
              @click="requestMagicLink"
            >
              Try the Demo
            </q-btn>
          </div>
        </div>

        <!-- Show Inventory Button -->
        <q-btn
          unelevated
          color="grey-8"
          icon="inventory"
          label="View Inventory"
          class="show-inventory-btn full-width"
          @click="drawerOpen = true"
        />
      </div>
    </div>

    <!-- Packing Estimate Popover -->
    <q-dialog v-model="showPackingEstimate">
      <q-card class="packing-estimate-card">
        <q-card-section>
          <div class="text-h6">Packing Estimate</div>
        </q-card-section>

        <q-card-section class="estimate-content">
          <div class="estimate-row">
            <q-icon name="inventory_2" size="24px" color="primary" />
            <div class="estimate-info">
              <div class="estimate-label">Total Items</div>
              <div class="estimate-value">{{ packingEstimate.totalItems }}</div>
            </div>
          </div>

          <div class="estimate-row">
            <q-icon name="scale" size="24px" color="primary" />
            <div class="estimate-info">
              <div class="estimate-label">Total Weight</div>
              <div class="estimate-value">{{ packingEstimate.totalWeight }} lbs</div>
            </div>
          </div>

          <div class="estimate-row">
            <q-icon name="view_in_ar" size="24px" color="primary" />
            <div class="estimate-info">
              <div class="estimate-label">Estimated Volume</div>
              <div class="estimate-value">{{ packingEstimate.totalVolume }} ft³</div>
            </div>
          </div>

          <div class="estimate-row">
            <q-icon name="inventory" size="24px" color="primary" />
            <div class="estimate-info">
              <div class="estimate-label">Boxes Needed</div>
              <div class="estimate-value">~{{ packingEstimate.estimatedBoxes }}</div>
            </div>
          </div>
        </q-card-section>

        <q-card-actions align="right">
          <q-btn flat label="Close" color="primary" v-close-popup />
        </q-card-actions>
      </q-card>
    </q-dialog>

    <!-- Mobile Drawer (using dialog instead of drawer to avoid layout issues) -->
    <q-dialog
      v-model="drawerOpen"
      position="bottom"
      full-width
      class="mobile-inventory-dialog"
    >
      <q-card class="mobile-inventory-card">
        <q-card-section class="row items-center q-pb-none">
          <div class="text-h6">Your Inventory</div>
          <q-space />
          <q-btn icon="close" flat round dense v-close-popup />
        </q-card-section>
        <q-card-section class="mobile-inventory-content">
          <InventorySidebar
            :items="inventoryItems"
            :selected-item-id="selectedItemId"
            @select-item="handleSelectItem"
            @update-item="handleUpdateItem"
          />
        </q-card-section>
      </q-card>
    </q-dialog>
  </div>
</template>

<style scoped>
.hero-split {
  background: linear-gradient(135deg, #2c5f7c 0%, #3a7ca5 50%, #4a90c4 100%);
  min-height: 90vh;
  position: relative;
}

.hero-split::before {
  content: "";
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-image:
    repeating-linear-gradient(90deg, rgba(255,255,255,0.03) 0px, transparent 1px, transparent 40px, rgba(255,255,255,0.03) 41px),
    repeating-linear-gradient(0deg, rgba(255,255,255,0.03) 0px, transparent 1px, transparent 40px, rgba(255,255,255,0.03) 41px);
  pointer-events: none;
  z-index: 1;
}

/* Desktop Layout */
.hero-content-desktop {
  display: grid;
  grid-template-columns: 1fr 1.2fr 400px;
  gap: 0;
  max-width: 1600px;
  margin: 0 auto;
  position: relative;
  z-index: 2;
  min-height: 90vh;
}

.hero-column {
  display: flex;
  flex-direction: column;
}

/* Column 1: Headline */
.col-headline {
  padding: 60px 40px;
  justify-content: center;
  color: white;
}

.hero-title {
  font-family: 'Exo 2', sans-serif;
  font-size: 3rem;
  font-weight: 800;
  line-height: 1.1;
  margin: 0 0 0.5rem 0;
}

.hero-subtitle {
  font-family: 'Exo 2', sans-serif;
  font-size: 1.8rem;
  font-weight: 600;
  line-height: 1.3;
  margin: 0 0 1.5rem 0;
  opacity: 0.95;
}

.hero-description {
  font-size: 1.1rem;
  line-height: 1.6;
  opacity: 0.9;
  margin-bottom: 2rem;
  max-width: 400px;
}

.email-capture {
  display: flex;
  flex-direction: column;
  gap: 12px;
  max-width: 400px;
}

.email-input {
  background-color: rgba(255, 255, 255, 0.95);
  border-radius: 8px;
}

.cta-button {
  font-weight: 600;
  padding: 16px 48px;
  border-radius: 8px;
  font-size: 1.1rem;
  min-height: 52px;
}

.success-message {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
}

.success-text {
  font-size: 1.5rem;
  font-weight: 600;
  margin: 12px 0 4px 0;
}

.success-caption {
  font-size: 1rem;
  opacity: 0.9;
}

/* Column 2: Image Stage */
.col-image {
  padding: 60px 40px;
  justify-content: center;
  align-items: center;
}

.image-stage {
  position: relative;
  width: 100%;
  max-width: 600px;
  aspect-ratio: 1;
}

.hero-image {
  width: 100%;
  height: 100%;
  border-radius: 16px;
  background-color: rgba(255, 255, 255, 0.1);
}

.image-info-overlay {
  position: absolute;
  bottom: 20px;
  left: 20px;
  right: 20px;
}

.info-card {
  background-color: rgba(255, 255, 255, 0.95);
  border-radius: 12px;
  padding: 16px 20px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
}

.item-title {
  font-size: 1.25rem;
  font-weight: 700;
  color: #212121;
  margin: 0 0 12px 0;
}

.item-specs {
  display: flex;
  gap: 16px;
  flex-wrap: wrap;
}

.spec-row {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.9375rem;
  color: #424242;
}

.packing-estimate-trigger {
  position: absolute;
  bottom: -60px;
  left: 50%;
  transform: translateX(-50%);
}

.estimate-button {
  font-weight: 600;
}

/* Column 3: Sidebar */
.col-sidebar {
  height: 90vh;
  position: sticky;
  top: 0;
}

/* Transitions */
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.3s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

/* Packing Estimate Dialog */
.packing-estimate-card {
  min-width: 350px;
}

.estimate-content {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.estimate-row {
  display: flex;
  align-items: center;
  gap: 16px;
}

.estimate-info {
  flex: 1;
}

.estimate-label {
  font-size: 0.875rem;
  color: #616161;
  margin-bottom: 4px;
}

.estimate-value {
  font-size: 1.25rem;
  font-weight: 700;
  color: #212121;
}

/* Mobile Layout */
.hero-content-mobile {
  padding: 40px 20px;
  position: relative;
  z-index: 2;
}

.mobile-top {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.mobile-headline {
  text-align: center;
  color: white;
}

.hero-title-mobile {
  font-family: 'Exo 2', sans-serif;
  font-size: 2rem;
  font-weight: 800;
  margin: 0 0 0.5rem 0;
}

.hero-subtitle-mobile {
  font-family: 'Exo 2', sans-serif;
  font-size: 1.4rem;
  font-weight: 600;
  margin: 0;
  opacity: 0.95;
}

.mobile-image-stage {
  background-color: rgba(255, 255, 255, 0.1);
  border-radius: 16px;
  overflow: hidden;
}

.mobile-hero-image {
  width: 100%;
}

.mobile-email-section {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.email-capture-mobile {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.email-input-mobile {
  background-color: rgba(255, 255, 255, 0.95);
  border-radius: 8px;
}

.cta-button-mobile {
  font-weight: 600;
  padding: 16px 40px;
  border-radius: 8px;
  font-size: 1.1rem;
  min-height: 52px;
}

.show-inventory-btn {
  margin-top: 16px;
  font-weight: 600;
}

/* Mobile Dialog */
.mobile-inventory-card {
  max-height: 70vh;
  border-top-left-radius: 16px;
  border-top-right-radius: 16px;
}

.mobile-inventory-content {
  max-height: 60vh;
  overflow-y: auto;
  padding: 0;
}

@media (max-width: 1200px) {
  .hero-content-desktop {
    grid-template-columns: 1fr 1fr 350px;
  }
}

@media (max-width: 1024px) {
  .hero-content-desktop {
    grid-template-columns: 1fr;
    min-height: auto;
  }

  .col-sidebar {
    display: none;
  }

  .col-headline,
  .col-image {
    padding: 40px 20px;
  }
}
</style>
