<script setup lang="ts">
    import { ref, defineEmits } from 'vue';
    import axios from 'axios';
    import { useQuasar } from 'quasar';

    const $q = useQuasar();

    // To adjust url based on whether in prod or not
    const core_url = import.meta.env.MODE == 'development' ? 'http://localhost:3050' : 'https://movetrack-api-7hwn7ggbiq-uc.a.run.app'

    // Setting up loading emits
    const emits = defineEmits<{
        (e: 'app:loading', id: boolean): void
    }>()

    const email = ref('');
    const emailError = ref(false);
    const emailErrorMessage = ref('');
    const isSubmitting = ref(false);
    const emailSent = ref(false);

    const slide = ref(1);

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

    const imageUrls = [
        { url: 'https://storage.googleapis.com/take-stock-design-assets/Home/MateGourd.PNG', label: 'Mate gourd', qty: '1', size: '6"×4"×4"', weight: '0.9 lbs' },
        { url: 'https://storage.googleapis.com/take-stock-design-assets/Home/CopperBowl.PNG', label: 'Copper bowl', qty: '1', size: '3.5"×5.5"×5.5"', weight: '0.8 lbs' },
        { url: 'https://storage.googleapis.com/take-stock-design-assets/Home/ChinaCup.PNG', label: 'China cup', qty: '1', size: '4"×4.5"×4.5"', weight: '0.7 lbs' },
        { url: 'https://storage.googleapis.com/take-stock-design-assets/Home/PlayingCards.PNG', label: 'Playing cards', qty: '1', size: '3.5"×2.5"×0.75"', weight: '0.4 lbs' },
        { url: 'https://storage.googleapis.com/take-stock-design-assets/Home/BeltBuckle.PNG', label: 'Belt buckle', qty: '1', size: '2"×3"×0.5"', weight: '0.3 lbs' },
        { url: 'https://storage.googleapis.com/take-stock-design-assets/Home/MintJulepCups.PNG', label: 'Mint julep cups', qty: '2', size: '4.5"×3.5"×3.5"', weight: '0.9 lbs' },
        { url: 'https://storage.googleapis.com/take-stock-design-assets/Home/NutDish.PNG', label: 'Nut dish', qty: '1', size: '6"×9"×4"', weight: '1.6 lbs' },
        { url: 'https://storage.googleapis.com/take-stock-design-assets/Home/ShotGlasses.PNG', label: 'Shot glasses', qty: '3', size: '2.5"×2"×2"', weight: '0.4 lbs' },
        { url: 'https://storage.googleapis.com/take-stock-design-assets/Home/VeuveHat.PNG', label: 'Veuve Clicquot hat', qty: '1', size: '5"×8"×8"', weight: '0.3 lbs' },
        { url: 'https://storage.googleapis.com/take-stock-design-assets/Home/ChinaTeaCup.PNG', label: 'Tea cup with saucer', qty: '1', size: '3"×5.5"×5.5"', weight: '0.9 lbs' },
        { url: 'https://storage.googleapis.com/take-stock-design-assets/Home/MetalFlute.PNG', label: 'Metal vase', qty: '1', size: '10"×3"×3"', weight: '1.3 lbs' },
        { url: 'https://storage.googleapis.com/take-stock-design-assets/Home/BlueFlute.PNG', label: 'Glass vase (blue)', qty: '1', size: '12"×4"×4"', weight: '1.4 lbs' },
        { url: 'https://storage.googleapis.com/take-stock-design-assets/Home/MiniSteins.PNG', label: 'Mini steins', qty: '2', size: '5"×3"×3"', weight: '1.2 lbs' },
        { url: 'https://storage.googleapis.com/take-stock-design-assets/Home/PepperGrinder.PNG', label: 'Pepper grinder', qty: '1', size: '5"×2.5"×2.5"', weight: '0.8 lbs' },
        { url: 'https://storage.googleapis.com/take-stock-design-assets/Home/FlowerVase.PNG', label: 'Flower vase', qty: '1', size: '8"×4"×3"', weight: '1.5 lbs' }
    ];
</script>

<template>
  <div class="banner row q-pa-none" style="width: 100%;">
            <q-carousel
            class="carousel"
            animated
            autoplay
            v-model="slide"
            infinite
            style="height: 65%; width: 100%;"
            >
            <q-carousel-slide class="q-pa-none carousel-slide" v-for="(img, index) in imageUrls" :name="index+1">
                <q-card class="card-colors" square>
                        <q-img :src="img.url" style="width: 100%;">
                          <div class="logbook-overlay-mobile">
                            <div class="logbook-entry">
                              <span class="entry-label">Item:</span>
                              <span class="entry-value">{{ img.label }}</span>
                            </div>
                            <div class="logbook-entry">
                              <span class="entry-label">Qty:</span>
                              <span class="entry-value">{{ img.qty }}</span>
                            </div>
                            <div class="logbook-entry">
                              <span class="entry-label">Size:</span>
                              <span class="entry-value">{{ img.size }}</span>
                            </div>
                            <div class="logbook-entry">
                              <span class="entry-label">Weight:</span>
                              <span class="entry-value">{{ img.weight }}</span>
                            </div>
                          </div>
                        </q-img>
                </q-card>
            </q-carousel-slide>
            </q-carousel>
        </div>

<div class="banner row q-pa-md flex flex-center">
  <div class="tagline-mobile q-pa-md text-center">
    <h2>Moving made manageable.</h2>
    <h3>Log it. Store it. Ship it.</h3>
    <p class="subtitle-mobile">Track your inventory and organize your move with ease.</p>
  </div>

  <div v-if="!emailSent" class="email-signup-form-mobile q-pa-md">
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
      class="q-mb-md"
    >
      <template v-slot:prepend>
        <q-icon name="mail" />
      </template>
    </q-input>
    <q-btn
      color="white"
      text-color="dark"
      :loading="isSubmitting"
      :disable="isSubmitting"
      class="action-button-mobile full-width"
      @click="requestMagicLink"
    >
      Get Started
    </q-btn>
  </div>
  <div v-else class="success-message-mobile q-pa-md text-center">
    <q-icon name="check_circle" size="48px" color="white" />
    <p class="q-mt-md text-h6">Check your email!</p>
    <p class="text-body2">We've sent a login link to {{ email }}</p>
  </div>
</div>

</template>

<style scoped>
.carousel-slide {
  position: relative;
}

.logbook-overlay-mobile {
  position: absolute;
  bottom: 15px;
  left: 50%;
  transform: translateX(-50%);
  background-color: rgba(245, 245, 220, 0.95);
  border: 2px solid #8b7355;
  border-radius: 4px;
  padding: 10px 20px;
  font-family: 'Courier New', monospace;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
  min-width: 180px;
  max-width: 80%;
}

.logbook-entry {
  display: flex;
  gap: 6px;
  align-items: baseline;
  flex-wrap: wrap;
  margin-bottom: 3px;
}

.logbook-entry:last-child {
  margin-bottom: 0;
}

.entry-label {
  font-weight: bold;
  color: #4a4a4a;
  font-size: 12px;
}

.entry-value {
  color: #2c2c2c;
  font-size: 14px;
  font-style: italic;
}

.tagline-mobile h2 {
  font-weight: 800;
  color: white;
  margin: 0 0 0.5rem 0;
  line-height: 1.2;
  font-size: 2rem;
}

.tagline-mobile h3 {
  font-weight: 600;
  color: white;
  margin: 0;
  line-height: 1.3;
  font-size: 1.4rem;
}

.subtitle-mobile {
  font-size: 0.95rem;
  color: rgba(255, 255, 255, 0.9);
  font-weight: 300;
  margin-top: 12px;
}

.email-signup-form-mobile {
  width: 100%;
  max-width: 400px;
}

.action-button-mobile {
  font-weight: 600;
  padding: 16px 40px;
  border-radius: 8px;
  font-size: 1.1rem;
  min-height: 52px;
}

.success-message-mobile {
  color: white;
}

.banner {
  background: linear-gradient(135deg, #2c5f7c 0%, #3a7ca5 50%, #4a90c4 100%);
  position: relative;
}
.banner::before {
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
</style>