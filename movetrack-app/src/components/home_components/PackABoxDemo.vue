<script setup lang="ts">
import { ref, computed } from 'vue';
import { useQuasar } from 'quasar';
import axios from 'axios';
import { inventoryItems } from '../../data/inventoryItems';
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

// State machine: 'picking' | 'labeling' | 'result'
type DemoState = 'picking' | 'labeling' | 'result';
const currentState = ref<DemoState>('picking');

// Selected items for Box A
const selectedItems = ref<InventoryItem[]>([]);

// Label info
const boxLabel = ref({
  room: 'Kitchen',
  isFragile: false,
  notes: ''
});

// Carousel for review slide
const reviewCarouselIndex = ref(0);

// Get first 6 items for demo grid
const demoItems = inventoryItems.slice(0, 6);

// Computed totals
const boxTotals = computed(() => {
  const totalQty = selectedItems.value.reduce((sum, item) => sum + item.qty, 0);
  const totalWeight = selectedItems.value.reduce((sum, item) => {
    const weight = parseFloat(item.weight.replace(' lbs', ''));
    return sum + (weight * item.qty);
  }, 0);

  const totalVolume = selectedItems.value.reduce((sum, item) => {
    const dimensions = item.size.replace(/"/g, '').split('×').map(d => parseFloat(d));
    if (dimensions.length === 3) {
      const cubicInches = dimensions[0] * dimensions[1] * dimensions[2];
      return sum + (cubicInches * item.qty);
    }
    return sum;
  }, 0);

  return {
    qty: totalQty,
    weight: totalWeight.toFixed(1),
    volume: (totalVolume / 1728).toFixed(2) // cubic feet
  };
});

// Weight meter color
const weightMeterColor = computed(() => {
  const weight = parseFloat(boxTotals.value.weight);
  if (weight === 0) return 'grey-4';
  if (weight > 35) return 'amber';
  return 'primary';
});

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

// Item selection
const toggleItem = (item: InventoryItem) => {
  const index = selectedItems.value.findIndex(i => i.id === item.id);
  if (index > -1) {
    selectedItems.value.splice(index, 1);
    announceToScreenReader(`Removed ${item.name} from box`);
  } else {
    selectedItems.value.push(item);
    announceToScreenReader(`Added ${item.name} to box. Total weight now ${boxTotals.value.weight} pounds`);
  }
};

const isItemSelected = (item: InventoryItem) => {
  return selectedItems.value.some(i => i.id === item.id);
};

// Randomize demo
const randomizeDemo = () => {
  // Select 3-4 random items
  const count = Math.floor(Math.random() * 2) + 3; // 3 or 4 items
  selectedItems.value = [];

  const shuffled = [...inventoryItems].sort(() => 0.5 - Math.random());
  selectedItems.value = shuffled.slice(0, count);

  announceToScreenReader(`Box randomized with ${count} items. Total weight ${boxTotals.value.weight} pounds`);
};

// Navigation
const goToLabeling = () => {
  if (selectedItems.value.length === 0) {
    $q.notify({
      type: 'warning',
      message: 'Please add at least one item to your box'
    });
    return;
  }
  currentState.value = 'labeling';
  reviewCarouselIndex.value = 0;
};

const goToResult = () => {
  currentState.value = 'result';
};

const resetDemo = () => {
  selectedItems.value = [];
  boxLabel.value = {
    room: 'Kitchen',
    isFragile: false,
    notes: ''
  };
  currentState.value = 'picking';
  reviewCarouselIndex.value = 0;
};

// Accessibility
const announceToScreenReader = (message: string) => {
  const announcement = document.createElement('div');
  announcement.setAttribute('role', 'status');
  announcement.setAttribute('aria-live', 'polite');
  announcement.className = 'sr-only';
  announcement.textContent = message;
  document.body.appendChild(announcement);

  setTimeout(() => {
    document.body.removeChild(announcement);
  }, 1000);
};

// Keyboard handlers
const handleItemKeydown = (event: KeyboardEvent, item: InventoryItem) => {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    toggleItem(item);
  }
};

const handleTrayItemKeydown = (event: KeyboardEvent, item: InventoryItem) => {
  if (event.key === 'Delete' || event.key === 'Backspace') {
    event.preventDefault();
    toggleItem(item);
  }
};

const getTagColor = (tag: string): string => {
  const colorMap: Record<string, string> = {
    'Fragile': 'orange',
    'Heavy': 'deep-orange',
    'Glass': 'light-blue',
    'Metal': 'grey',
    'Ceramic': 'brown',
    'China': 'pink',
    'Silver': 'blue-grey',
    'Set': 'teal',
    'Collectible': 'purple',
    'Decorative': 'indigo',
    'Antique': 'amber',
    'Wood': 'brown-7',
    'Textile': 'cyan',
    'Paper': 'grey-5',
    'Branded': 'deep-purple',
    'Small': 'green',
    'Functional': 'blue'
  };
  return colorMap[tag] || 'primary';
};
</script>

<template>
  <div class="pack-a-box-demo">
    <div class="demo-container">
      <!-- Slide 1: Pick Items -->
      <div v-if="currentState === 'picking'" class="demo-slide picking-slide">
        <div class="slide-content">
          <!-- Left: Instructions & Email -->
          <div class="slide-left">
            <h1 class="demo-title">Pack a Box in 15 Seconds</h1>
            <h2 class="demo-subtitle">See how MoveTrack helps you pack, weigh, and label</h2>
            <p class="demo-description">
              Tap items to add them to Box A. Watch the weight meter fill up. When you're ready, we'll help you label it.
            </p>

            <div class="demo-actions">
              <q-btn
                outline
                color="white"
                label="Randomize Demo"
                icon="shuffle"
                @click="randomizeDemo"
                class="randomize-btn"
              />
            </div>

            <!-- Email Capture -->
            <div v-if="!emailSent" class="email-capture">
              <q-input
                v-model="email"
                label="Enter your email"
                type="email"
                outlined
                dark
                standout="bg-white text-dark"
                :error="emailError"
                :error-message="emailErrorMessage"
                @update:model-value="emailError = false"
                @keyup.enter="requestMagicLink"
                class="email-input"
              >
                <template v-slot:prepend>
                  <q-icon name="mail" />
                </template>
              </q-input>
              <q-btn
                unelevated
                color="white"
                text-color="dark"
                :loading="isSubmitting"
                :disable="isSubmitting"
                class="cta-button"
                @click="requestMagicLink"
              >
                Get Started Free
              </q-btn>
            </div>
            <div v-else class="success-message">
              <q-icon name="check_circle" size="48px" color="white" />
              <p class="success-text">Check your email!</p>
              <p class="success-caption">We've sent a login link to {{ email }}</p>
            </div>
          </div>

          <!-- Right: Item Grid + Tray -->
          <div class="slide-right">
            <!-- Item Grid -->
            <div class="items-grid">
              <div
                v-for="item in demoItems"
                :key="item.id"
                :class="['item-card', { selected: isItemSelected(item) }]"
                @click="toggleItem(item)"
                @keydown="handleItemKeydown($event, item)"
                tabindex="0"
                role="button"
                :aria-pressed="isItemSelected(item)"
                :aria-label="`${item.name}, ${item.weight}, ${item.size}`"
              >
                <div class="item-card-image">
                  <q-img
                    :src="item.image"
                    :alt="item.name"
                    fit="contain"
                    loading="lazy"
                    class="card-img"
                  >
                    <template v-slot:loading>
                      <q-skeleton class="full-width full-height" />
                    </template>
                  </q-img>
                  <div v-if="isItemSelected(item)" class="selected-overlay">
                    <q-icon name="check_circle" size="32px" color="white" />
                  </div>
                </div>
                <div class="item-card-info">
                  <div class="item-card-name">{{ item.name }}</div>
                  <div class="item-card-specs">
                    <span>{{ item.size }}</span>
                    <span>{{ item.weight }}</span>
                  </div>
                </div>
              </div>
            </div>

            <!-- Box A Tray -->
            <div class="box-tray">
              <div class="tray-header">
                <div class="tray-title">
                  <q-icon name="inventory" size="24px" />
                  <span>Box A</span>
                </div>
                <div class="tray-totals">
                  <q-badge :color="weightMeterColor" text-color="white" class="totals-badge">
                    {{ boxTotals.qty }} items · {{ boxTotals.weight }} lbs
                  </q-badge>
                </div>
              </div>

              <!-- Weight Meter -->
              <div class="weight-meter">
                <q-linear-progress
                  :value="parseFloat(boxTotals.weight) / 50"
                  :color="weightMeterColor"
                  size="20px"
                  rounded
                  class="meter-bar"
                  :aria-label="`Weight: ${boxTotals.weight} pounds out of 50 pound limit`"
                />
                <div class="meter-label">
                  {{ boxTotals.weight }} / 50 lbs
                  <span v-if="parseFloat(boxTotals.weight) > 35" class="warning-text">(Heavy!)</span>
                </div>
              </div>

              <!-- Tray Items -->
              <div class="tray-items">
                <div
                  v-for="item in selectedItems"
                  :key="item.id"
                  class="tray-item"
                  @click="toggleItem(item)"
                  @keydown="handleTrayItemKeydown($event, item)"
                  tabindex="0"
                  role="button"
                  :aria-label="`Remove ${item.name} from box`"
                >
                  <q-img :src="item.image" :alt="item.name" fit="contain" class="tray-item-img" />
                  <div class="tray-item-name">{{ item.name }}</div>
                  <q-btn
                    flat
                    round
                    dense
                    icon="close"
                    size="sm"
                    class="remove-btn"
                    @click.stop="toggleItem(item)"
                  />
                </div>
              </div>

              <!-- Next Button -->
              <q-btn
                unelevated
                color="primary"
                label="Label This Box"
                icon-right="arrow_forward"
                class="next-btn full-width"
                @click="goToLabeling"
                :disable="selectedItems.length === 0"
              />
            </div>
          </div>
        </div>
      </div>

      <!-- Slide 2: Review & Label -->
      <div v-if="currentState === 'labeling'" class="demo-slide labeling-slide">
        <div class="slide-content">
          <!-- Left: Carousel -->
          <div class="slide-left labeling-left">
            <h2 class="slide-header">Review Your Items</h2>
            <q-carousel
              v-model="reviewCarouselIndex"
              animated
              control-color="primary"
              navigation
              arrows
              class="review-carousel"
            >
              <q-carousel-slide
                v-for="(item, index) in selectedItems"
                :key="item.id"
                :name="index"
                class="carousel-slide"
              >
                <q-img
                  :src="item.image"
                  :alt="item.name"
                  fit="contain"
                  class="carousel-image"
                />
                <div class="carousel-caption">
                  <div class="caption-name">{{ item.name }}</div>
                  <div class="caption-specs">{{ item.size }} · {{ item.weight }}</div>
                </div>
              </q-carousel-slide>
            </q-carousel>
          </div>

          <!-- Right: Label Panel -->
          <div class="slide-right labeling-right">
            <div class="label-panel">
              <h3 class="panel-title">Box Label</h3>

              <q-select
                v-model="boxLabel.room"
                :options="['Kitchen', 'Bedroom', 'Living Room', 'Bathroom', 'Office', 'Garage']"
                label="Room"
                outlined
                class="label-input"
              />

              <q-toggle
                v-model="boxLabel.isFragile"
                label="Mark as Fragile"
                color="orange"
                class="fragile-toggle"
                left-label
              />

              <q-input
                v-model="boxLabel.notes"
                label="Notes (optional)"
                type="textarea"
                outlined
                rows="3"
                class="label-input"
                placeholder="e.g., Handle with care, top shelf items..."
              />

              <div class="label-preview">
                <div class="preview-title">Label Preview</div>
                <div class="preview-card">
                  <div class="preview-header">
                    <q-icon name="qr_code" size="48px" color="grey-8" />
                    <div class="preview-info">
                      <div class="preview-room">{{ boxLabel.room }}</div>
                      <div class="preview-stats">
                        {{ boxTotals.qty }} items · {{ boxTotals.weight }} lbs
                      </div>
                    </div>
                  </div>
                  <div v-if="boxLabel.isFragile" class="fragile-banner">
                    <q-icon name="warning" size="20px" />
                    FRAGILE
                  </div>
                </div>
              </div>

              <div class="panel-actions">
                <q-btn
                  flat
                  label="Back"
                  icon="arrow_back"
                  @click="currentState = 'picking'"
                  class="back-btn"
                />
                <q-btn
                  unelevated
                  color="primary"
                  label="Generate Label"
                  icon-right="label"
                  @click="goToResult"
                  class="generate-btn"
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Slide 3: Result -->
      <div v-if="currentState === 'result'" class="demo-slide result-slide">
        <div class="slide-content">
          <div class="result-content">
            <h2 class="result-title">Your Box Label is Ready!</h2>
            <p class="result-description">
              Here's what your professional moving label looks like. Print it, stick it on your box, and you're ready to move.
            </p>

            <!-- Mock Box Label -->
            <div class="box-label-mockup">
              <div class="label-tape tape-top-left"></div>
              <div class="label-tape tape-top-right"></div>

              <div class="label-content">
                <div class="label-qr-section">
                  <div class="qr-code">
                    <q-icon name="qr_code" size="120px" color="grey-9" />
                  </div>
                  <div class="qr-caption">Scan to view contents</div>
                </div>

                <div class="label-info-section">
                  <div class="label-room-badge">{{ boxLabel.room }}</div>

                  <div class="label-stats">
                    <div class="stat-item">
                      <q-icon name="inventory" size="24px" />
                      <span>{{ boxTotals.qty }} items</span>
                    </div>
                    <div class="stat-item">
                      <q-icon name="scale" size="24px" />
                      <span>{{ boxTotals.weight }} lbs</span>
                    </div>
                    <div class="stat-item">
                      <q-icon name="view_in_ar" size="24px" />
                      <span>{{ boxTotals.volume }} ft³</span>
                    </div>
                  </div>

                  <div v-if="boxLabel.isFragile" class="label-fragile">
                    <q-icon name="warning" size="32px" color="orange" />
                    <span>FRAGILE - HANDLE WITH CARE</span>
                  </div>

                  <div class="label-items-list">
                    <div class="items-list-title">Contents:</div>
                    <div class="items-list-items">
                      <div v-for="item in selectedItems" :key="item.id" class="list-item">
                        • {{ item.name }} ({{ item.qty }})
                      </div>
                    </div>
                  </div>

                  <div v-if="boxLabel.notes" class="label-notes">
                    <strong>Notes:</strong> {{ boxLabel.notes }}
                  </div>
                </div>
              </div>

              <div class="label-tape tape-bottom-left"></div>
              <div class="label-tape tape-bottom-right"></div>
            </div>

            <!-- CTA -->
            <div class="result-actions">
              <q-btn
                outline
                color="primary"
                label="Start Over"
                icon="refresh"
                @click="resetDemo"
                class="restart-btn"
              />
              <q-btn
                unelevated
                color="primary"
                label="Plan My Move"
                icon-right="arrow_forward"
                @click="requestMagicLink"
                class="plan-btn"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.pack-a-box-demo {
  background: linear-gradient(135deg, #2c5f7c 0%, #3a7ca5 50%, #4a90c4 100%);
  min-height: 90vh;
  position: relative;
}

.pack-a-box-demo::before {
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

.demo-container {
  position: relative;
  z-index: 2;
  padding: 60px 40px;
  max-width: 1600px;
  margin: 0 auto;
}

.demo-slide {
  min-height: 80vh;
}

.slide-content {
  display: grid;
  grid-template-columns: 1fr 1.5fr;
  gap: 60px;
  align-items: start;
}

/* Slide 1: Picking */
.slide-left {
  color: white;
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.demo-title {
  font-family: 'Exo 2', sans-serif;
  font-size: 3rem;
  font-weight: 800;
  line-height: 1.1;
  margin: 0;
}

.demo-subtitle {
  font-family: 'Exo 2', sans-serif;
  font-size: 1.5rem;
  font-weight: 600;
  line-height: 1.3;
  margin: 0;
  opacity: 0.95;
}

.demo-description {
  font-size: 1.1rem;
  line-height: 1.6;
  opacity: 0.9;
  max-width: 500px;
}

.demo-actions {
  display: flex;
  gap: 12px;
}

.randomize-btn {
  font-weight: 600;
}

.email-capture {
  display: flex;
  flex-direction: column;
  gap: 12px;
  max-width: 450px;
  margin-top: 24px;
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
  margin-top: 24px;
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

/* Item Grid */
.slide-right {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.items-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16px;
}

.item-card {
  background: white;
  border-radius: 12px;
  padding: 12px;
  cursor: pointer;
  transition: all 0.2s;
  border: 3px solid transparent;
}

.item-card:hover {
  transform: translateY(-4px);
  box-shadow: 0 8px 20px rgba(0, 0, 0, 0.15);
}

.item-card:focus {
  outline: 3px solid white;
  outline-offset: 2px;
}

.item-card.selected {
  border-color: #1976d2;
  background-color: #e3f2fd;
}

.item-card-image {
  position: relative;
  aspect-ratio: 1;
  border-radius: 8px;
  overflow: hidden;
  background: #f5f5f5;
  margin-bottom: 12px;
}

.card-img {
  width: 100%;
  height: 100%;
}

.selected-overlay {
  position: absolute;
  inset: 0;
  background: rgba(25, 118, 210, 0.8);
  display: flex;
  align-items: center;
  justify-content: center;
}

.item-card-info {
  text-align: center;
}

.item-card-name {
  font-weight: 600;
  color: #212121;
  margin-bottom: 4px;
  font-size: 0.9375rem;
}

.item-card-specs {
  font-size: 0.8125rem;
  color: #616161;
  display: flex;
  justify-content: center;
  gap: 8px;
}

/* Box Tray */
.box-tray {
  background: white;
  border-radius: 16px;
  padding: 20px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
}

.tray-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}

.tray-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 1.25rem;
  font-weight: 700;
  color: #212121;
}

.totals-badge {
  padding: 8px 16px;
  font-size: 0.9375rem;
  font-weight: 600;
}

.weight-meter {
  margin-bottom: 16px;
}

.meter-bar {
  margin-bottom: 8px;
}

.meter-label {
  text-align: center;
  font-size: 0.875rem;
  font-weight: 600;
  color: #424242;
}

.warning-text {
  color: #f57c00;
  margin-left: 8px;
}

.tray-items {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-bottom: 16px;
  min-height: 100px;
}

.tray-item {
  position: relative;
  width: 80px;
  padding: 8px;
  background: #f5f5f5;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s;
}

.tray-item:hover {
  background: #e0e0e0;
}

.tray-item:focus {
  outline: 2px solid #1976d2;
  outline-offset: 2px;
}

.tray-item-img {
  width: 64px;
  height: 64px;
  margin-bottom: 4px;
}

.tray-item-name {
  font-size: 0.75rem;
  color: #424242;
  text-align: center;
  line-height: 1.2;
}

.remove-btn {
  position: absolute;
  top: 4px;
  right: 4px;
  background: rgba(255, 255, 255, 0.9);
}

.next-btn {
  font-weight: 600;
  padding: 16px;
  font-size: 1rem;
  min-height: 52px;
}

/* Slide 2: Labeling */
.labeling-slide .slide-content {
  grid-template-columns: 1.2fr 1fr;
}

.slide-header {
  color: white;
  font-size: 2rem;
  font-weight: 700;
  margin: 0 0 24px 0;
}

.review-carousel {
  background: white;
  border-radius: 16px;
  height: 500px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
}

.carousel-slide {
  padding: 40px;
}

.carousel-image {
  max-height: 350px;
  margin-bottom: 20px;
}

.carousel-caption {
  text-align: center;
}

.caption-name {
  font-size: 1.25rem;
  font-weight: 700;
  color: #212121;
  margin-bottom: 8px;
}

.caption-specs {
  font-size: 1rem;
  color: #616161;
}

.label-panel {
  background: white;
  border-radius: 16px;
  padding: 32px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
}

.panel-title {
  font-size: 1.5rem;
  font-weight: 700;
  color: #212121;
  margin: 0 0 24px 0;
}

.label-input {
  margin-bottom: 20px;
}

.fragile-toggle {
  margin-bottom: 20px;
  font-weight: 600;
}

.label-preview {
  margin-top: 32px;
  margin-bottom: 24px;
}

.preview-title {
  font-size: 0.875rem;
  font-weight: 600;
  color: #616161;
  margin-bottom: 12px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.preview-card {
  background: #f5f5f5;
  border: 2px dashed #bdbdbd;
  border-radius: 8px;
  padding: 16px;
}

.preview-header {
  display: flex;
  gap: 16px;
  align-items: center;
}

.preview-info {
  flex: 1;
}

.preview-room {
  font-size: 1.25rem;
  font-weight: 700;
  color: #212121;
  margin-bottom: 4px;
}

.preview-stats {
  font-size: 0.875rem;
  color: #616161;
}

.fragile-banner {
  margin-top: 12px;
  padding: 8px;
  background: #fff3e0;
  border: 2px solid #f57c00;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: #e65100;
  font-weight: 700;
  font-size: 0.875rem;
}

.panel-actions {
  display: flex;
  gap: 12px;
  justify-content: space-between;
}

.back-btn {
  color: #616161;
}

.generate-btn {
  flex: 1;
  font-weight: 600;
  padding: 16px;
  font-size: 1rem;
  min-height: 52px;
}

/* Slide 3: Result */
.result-slide .slide-content {
  grid-template-columns: 1fr;
}

.result-content {
  max-width: 900px;
  margin: 0 auto;
  text-align: center;
}

.result-title {
  color: white;
  font-size: 2.5rem;
  font-weight: 800;
  margin: 0 0 16px 0;
}

.result-description {
  color: white;
  font-size: 1.2rem;
  line-height: 1.6;
  opacity: 0.9;
  margin-bottom: 48px;
}

/* Box Label Mockup */
.box-label-mockup {
  position: relative;
  background: white;
  border-radius: 12px;
  padding: 48px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.15);
  margin-bottom: 48px;
}

.label-tape {
  position: absolute;
  width: 80px;
  height: 30px;
  background: repeating-linear-gradient(
    45deg,
    rgba(255, 193, 7, 0.3),
    rgba(255, 193, 7, 0.3) 10px,
    rgba(255, 193, 7, 0.5) 10px,
    rgba(255, 193, 7, 0.5) 20px
  );
  border: 1px solid rgba(255, 193, 7, 0.6);
}

.tape-top-left {
  top: -15px;
  left: 40px;
  transform: rotate(-5deg);
}

.tape-top-right {
  top: -15px;
  right: 40px;
  transform: rotate(5deg);
}

.tape-bottom-left {
  bottom: -15px;
  left: 40px;
  transform: rotate(5deg);
}

.tape-bottom-right {
  bottom: -15px;
  right: 40px;
  transform: rotate(-5deg);
}

.label-content {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 32px;
  text-align: left;
}

.label-qr-section {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
}

.qr-code {
  background: white;
  padding: 16px;
  border: 2px solid #e0e0e0;
  border-radius: 8px;
}

.qr-caption {
  font-size: 0.75rem;
  color: #757575;
  text-align: center;
}

.label-room-badge {
  display: inline-block;
  background: #1976d2;
  color: white;
  padding: 8px 24px;
  border-radius: 24px;
  font-size: 1.5rem;
  font-weight: 700;
  margin-bottom: 24px;
}

.label-stats {
  display: flex;
  gap: 24px;
  margin-bottom: 24px;
}

.stat-item {
  display: flex;
  align-items: center;
  gap: 8px;
  color: #424242;
  font-size: 1rem;
  font-weight: 600;
}

.label-fragile {
  background: #fff3e0;
  border: 3px solid #f57c00;
  border-radius: 8px;
  padding: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  color: #e65100;
  font-weight: 700;
  font-size: 1rem;
  margin-bottom: 24px;
}

.label-items-list {
  background: #f5f5f5;
  border-radius: 8px;
  padding: 16px;
  margin-bottom: 16px;
}

.items-list-title {
  font-weight: 700;
  color: #424242;
  margin-bottom: 8px;
}

.items-list-items {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 6px;
  font-size: 0.875rem;
  color: #616161;
}

.label-notes {
  font-size: 0.875rem;
  color: #616161;
  font-style: italic;
  padding: 12px;
  background: #fafafa;
  border-left: 3px solid #1976d2;
  border-radius: 4px;
}

.result-actions {
  display: flex;
  gap: 16px;
  justify-content: center;
}

.restart-btn,
.plan-btn {
  font-weight: 600;
  padding: 16px 48px;
  font-size: 1.1rem;
  min-height: 52px;
}

/* Screen reader only */
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border-width: 0;
}

/* Responsive */
@media (max-width: 1200px) {
  .slide-content {
    grid-template-columns: 1fr;
    gap: 40px;
  }

  .items-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}

@media (max-width: 768px) {
  .demo-container {
    padding: 40px 20px;
  }

  .demo-title {
    font-size: 2rem;
  }

  .demo-subtitle {
    font-size: 1.25rem;
  }

  .items-grid {
    grid-template-columns: repeat(2, 1fr);
    gap: 12px;
  }

  .label-content {
    grid-template-columns: 1fr;
  }

  .label-stats {
    flex-direction: column;
    gap: 12px;
  }

  .items-list-items {
    grid-template-columns: 1fr;
  }
}
</style>
