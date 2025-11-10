<script setup lang="ts">
import { ref, computed } from 'vue';
import { useQuasar } from 'quasar';
import axios from 'axios';
import { inventoryItems } from '../../data/inventoryItems';
import { useCarouselState } from '../../composables/useCarouselState';
import ItemModal from '../ItemModal.vue';
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

// Carousel state
const carousel = useCarouselState(inventoryItems, 4000);

// Modal state
const showItemModal = ref(false);

// Loupe zoom state
const showLoupe = ref(false);
const loupePosition = ref({ x: 0, y: 0 });
const imageRef = ref<HTMLElement | null>(null);

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

const handleMouseMove = (event: MouseEvent) => {
  if (!imageRef.value) return;

  const rect = imageRef.value.getBoundingClientRect();
  loupePosition.value = {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top
  };
};

const handleMouseEnter = () => {
  showLoupe.value = true;
  carousel.pause();
};

const handleMouseLeave = () => {
  showLoupe.value = false;
  carousel.resume();
};

const handleCardClick = () => {
  showItemModal.value = true;
};

const handleAddToInventory = (item: InventoryItem) => {
  // Placeholder for future functionality
  console.log('Adding to inventory:', item);
};

const handleSeeAllItems = () => {
  // Placeholder for navigation to grid view
  console.log('Navigate to all items grid');
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

const progressPercentage = computed(() => {
  return ((carousel.currentIndex.value + 1) / inventoryItems.length) * 100;
});
</script>

<template>
  <div class="hero-ledger">
    <div class="hero-content">
      <!-- Left Column: Headlines & Email Capture -->
      <div class="hero-left">
        <h1 class="hero-title">Moving made manageable.</h1>
        <h2 class="hero-subtitle">Log it. Store it. Ship it.</h2>
        <p class="hero-description">
          We automatically log item details from photos. Track your inventory with precision.
        </p>

        <div v-if="!emailSent" class="email-capture">
          <q-input
            v-model="email"
            label="Enter your email"
            type="email"
            outlined
            standout="bg-white text-dark"
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
            Get Started Free
          </q-btn>
        </div>
        <div v-else class="success-message">
          <q-icon name="check_circle" size="48px" color="positive" />
          <p class="success-text">Check your email!</p>
          <p class="success-caption">We've sent a login link to {{ email }}</p>
        </div>
      </div>

      <!-- Right Column: Ledger Frame with Carousel -->
      <div class="hero-right">
        <div
          class="ledger-frame"
          @mouseenter="carousel.pause"
          @mouseleave="carousel.resume"
          @keydown="carousel.handleKeyboard"
          tabindex="0"
          role="region"
          aria-label="Inventory carousel"
          aria-live="polite"
        >
          <!-- Carousel Container -->
          <div class="carousel-container">
            <transition name="slide-fade" mode="out-in">
              <div
                :key="carousel.currentIndex.value"
                class="carousel-slide"
                ref="imageRef"
                @mouseenter="handleMouseEnter"
                @mouseleave="handleMouseLeave"
                @mousemove="handleMouseMove"
              >
                <q-img
                  v-if="carousel.currentItem.value"
                  :src="carousel.currentItem.value.image"
                  :alt="`${carousel.currentItem.value.name}, ${carousel.currentItem.value.material}, ${carousel.currentItem.value.primaryColor}`"
                  class="carousel-image"
                  fit="contain"
                  :ratio="16/13"
                >
                  <template v-slot:loading>
                    <q-skeleton class="full-width full-height" />
                  </template>
                </q-img>

                <!-- Loupe Zoom Effect -->
                <div
                  v-if="showLoupe && carousel.currentItem.value"
                  class="loupe"
                  :style="{
                    left: `${loupePosition.x}px`,
                    top: `${loupePosition.y}px`,
                    backgroundImage: `url(${carousel.currentItem.value.image})`,
                    backgroundPosition: `-${loupePosition.x * 2}px -${loupePosition.y * 2}px`,
                    backgroundSize: '400%'
                  }"
                />
              </div>
            </transition>
          </div>

          <!-- Sticky Spec Card Overlay -->
          <div
            v-if="carousel.currentItem.value"
            class="spec-card"
            @click="handleCardClick"
            role="button"
            tabindex="0"
            @keydown.enter="handleCardClick"
            @keydown.space.prevent="handleCardClick"
            aria-label="View item details"
          >
            <div class="spec-header">Item Specifications</div>
            <div class="spec-row">
              <span class="spec-label">Item:</span>
              <span class="spec-value">{{ carousel.currentItem.value.name }}</span>
            </div>
            <div class="spec-row">
              <span class="spec-label">Qty:</span>
              <span class="spec-value">{{ carousel.currentItem.value.qty }}</span>
            </div>
            <div class="spec-row">
              <span class="spec-label">Size:</span>
              <span class="spec-value">{{ carousel.currentItem.value.size }}</span>
            </div>
            <div class="spec-row">
              <span class="spec-label">Weight:</span>
              <span class="spec-value">{{ carousel.currentItem.value.weight }}</span>
            </div>
            <div class="spec-tags">
              <q-chip
                v-for="tag in carousel.currentItem.value.tags"
                :key="tag"
                :color="getTagColor(tag)"
                text-color="white"
                dense
                class="spec-tag-chip"
              >
                {{ tag }}
              </q-chip>
            </div>
            <div class="spec-hint">Click to see details</div>
          </div>
        </div>
      </div>
    </div>

    <!-- Item Detail Modal -->
    <ItemModal
      v-model="showItemModal"
      :item="carousel.currentItem.value"
      @add-to-inventory="handleAddToInventory"
      @see-all-items="handleSeeAllItems"
    />
  </div>
</template>

<style scoped>
.hero-ledger {
  background: linear-gradient(135deg, #2c5f7c 0%, #3a7ca5 50%, #4a90c4 100%);
  min-height: 90vh;
  padding: 60px 40px;
  position: relative;
}

.hero-ledger::before {
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
}

.hero-content {
  display: grid;
  grid-template-columns: 1fr 1.2fr;
  gap: 60px;
  max-width: 1400px;
  margin: 0 auto;
  position: relative;
  z-index: 1;
}

/* Left Column */
.hero-left {
  display: flex;
  flex-direction: column;
  justify-content: center;
  color: white;
}

.hero-title {
  font-family: 'Exo 2', sans-serif;
  font-size: 3.5rem;
  font-weight: 800;
  line-height: 1.1;
  margin: 0 0 0.5rem 0;
  color: white;
}

.hero-subtitle {
  font-family: 'Exo 2', sans-serif;
  font-size: 2rem;
  font-weight: 600;
  line-height: 1.3;
  margin: 0 0 1.5rem 0;
  color: rgba(255, 255, 255, 0.95);
}

.hero-description {
  font-size: 1.2rem;
  line-height: 1.6;
  color: rgba(255, 255, 255, 0.9);
  margin-bottom: 2rem;
  max-width: 500px;
}

.email-capture {
  display: flex;
  flex-direction: column;
  gap: 16px;
  max-width: 450px;
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

/* Right Column - Ledger Frame */
.hero-right {
  display: flex;
  align-items: center;
  justify-content: center;
}

.ledger-frame {
  position: relative;
  width: 100%;
  max-width: 700px;
}

.ledger-frame:focus {
  outline: 3px solid #fff;
  outline-offset: 4px;
}

/* Carousel */
.carousel-container {
  position: relative;
  background-color: transparent;
  border-radius: 8px;
  overflow: hidden;
  aspect-ratio: 16 / 13;
}

.carousel-slide {
  position: relative;
  width: 100%;
  height: 100%;
  cursor: zoom-in;
}

.carousel-image {
  width: 100%;
  height: 100%;
}

/* Loupe Zoom */
.loupe {
  position: absolute;
  width: 150px;
  height: 150px;
  border: 3px solid #fff;
  border-radius: 50%;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
  pointer-events: none;
  transform: translate(-50%, -50%);
  z-index: 10;
  background-repeat: no-repeat;
}

/* Spec Card */
.spec-card {
  position: absolute;
  bottom: 24px;
  right: 24px;
  background-color: rgba(255, 248, 220, 0.98);
  border: 2px solid #8b7355;
  border-radius: 6px;
  padding: 16px;
  font-family: 'Courier New', monospace;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  min-width: 240px;
  max-width: 300px;
  cursor: pointer;
  transition: transform 0.2s, box-shadow 0.2s;
  z-index: 6;
}

.spec-card:hover {
  transform: translateY(-4px);
  box-shadow: 0 8px 20px rgba(0, 0, 0, 0.4);
}

.spec-card:focus {
  outline: 3px solid #2c5f7c;
  outline-offset: 2px;
}

.spec-header {
  font-size: 11px;
  font-weight: bold;
  color: #6d5844;
  text-transform: uppercase;
  letter-spacing: 1px;
  margin-bottom: 12px;
  border-bottom: 1px solid #d4c5a0;
  padding-bottom: 6px;
}

.spec-row {
  display: flex;
  gap: 8px;
  margin-bottom: 6px;
  align-items: baseline;
}

.spec-label {
  font-weight: bold;
  color: #4a4a4a;
  font-size: 12px;
  min-width: 60px;
}

.spec-value {
  color: #2c2c2c;
  font-size: 13px;
  font-style: italic;
}

.spec-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 12px;
  padding-top: 8px;
  border-top: 1px solid #d4c5a0;
}

.spec-tag-chip {
  font-size: 0.75rem;
  padding: 2px 8px;
}

.spec-hint {
  margin-top: 12px;
  font-size: 10px;
  color: #8b7355;
  text-align: center;
  font-style: italic;
}

/* Animations */
.slide-fade-enter-active,
.slide-fade-leave-active {
  transition: all 0.4s ease;
}

.slide-fade-enter-from {
  opacity: 0;
  transform: translateX(30px);
}

.slide-fade-leave-to {
  opacity: 0;
  transform: translateX(-30px);
}

/* Mobile Responsive */
@media (max-width: 1024px) {
  .hero-content {
    grid-template-columns: 1fr;
    gap: 40px;
  }

  .hero-left {
    text-align: center;
    align-items: center;
  }

  .hero-title {
    font-size: 2.5rem;
  }

  .hero-subtitle {
    font-size: 1.5rem;
  }

  .email-capture {
    width: 100%;
  }

  .spec-card {
    position: static;
    margin-top: 16px;
    width: 100%;
    max-width: none;
  }
}

@media (max-width: 768px) {
  .hero-ledger {
    padding: 40px 20px;
  }

  .hero-title {
    font-size: 2rem;
  }

  .hero-subtitle {
    font-size: 1.3rem;
  }

  .hero-description {
    font-size: 1rem;
  }

  .ledger-frame {
    padding: 20px;
  }

  .nav-button {
    width: 36px;
    height: 36px;
  }

  .progress-text {
    font-size: 10px;
  }

  .loupe {
    display: none; /* Disable loupe on mobile */
  }
}
</style>
