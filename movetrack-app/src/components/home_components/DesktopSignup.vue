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

    <div class="banner row q-pa-md">
        <div stack class="col-5 content-left-align">
            <h1 class="my_font_class q-pa-none main-tagline">Moving made manageable.</h1>
            <h2 class="my_font_class q-pa-none tagline">Log it. Store it. Ship it.</h2>
            <p class="subtitle q-mt-md">Track your inventory and organize your move with ease.</p>

            <div v-if="!emailSent" class="email-signup-form q-mt-lg">
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
                    color="white"
                    text-color="dark"
                    :loading="isSubmitting"
                    :disable="isSubmitting"
                    class="q-mt-md action-button"
                    @click="requestMagicLink"
                >
                    Get Started
                </q-btn>
            </div>
            <div v-else class="success-message q-mt-lg">
                <q-icon name="check_circle" size="48px" color="white" />
                <p class="q-mt-md text-h6">Check your email!</p>
                <p class="text-body2">We've sent a login link to {{ email }}</p>
            </div>
        </div>

        <div class="col-7" style="max-width: 100%;">
            <div class="inventory-book-frame">
            <q-carousel
            class="carousel"
            animated
            v-model="slide"
            infinite
            autoplay
            animation="1000"

            style="max-width: 85%;
            height: 65%;"
            >
            <q-carousel-slide v-for="(img, index) in imageUrls" :name="index+1" class="carousel-slide">
                <div class="image-container">
                    <q-img :src="img.url" style="height: 60vh;" fit="contain" />
                    <div class="logbook-overlay">
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
                </div>
            </q-carousel-slide>

            </q-carousel>
            </div>
        </div>

    </div>
</template>

<style scoped>
.my_font_class {
    font-family: 'Exo 2';
    color: white;
    font-weight: 800;
}
.content-left-align {
    padding-left: 40px;
}
.main-tagline {
    font-size: 3rem;
    line-height: 1.2;
    margin: 0 0 0.5rem 0;
    font-weight: 800;
}
.tagline {
    font-size: 1.8rem;
    line-height: 1.3;
    margin: 0;
    font-weight: 600;
}
.subtitle {
    font-size: 1.1rem;
    color: rgba(255, 255, 255, 0.9);
    font-weight: 300;
}
.email-signup-form {
    max-width: 400px;
    width: 100%;
}
.email-input {
    border-radius: 8px;
}
.email-input .q-field__control {
    background-color: rgba(255, 255, 255, 0.95);
}
.action-button {
    font-weight: 600;
    padding: 16px 48px;
    border-radius: 8px;
    font-size: 1.1rem;
    min-height: 52px;
}
.success-message {
    text-align: left;
}
.card-colors {
    background-color: #f5f9e9;
}
.inventory-book-frame {
    background: linear-gradient(to right, #8b7355 0%, #a0826d 3%, #c9b8a0 5%, #e8dcc8 8%, #f5f0e8 10%, #f5f0e8 90%, #e8dcc8 92%, #c9b8a0 95%, #a0826d 97%, #8b7355 100%);
    padding: 30px 25px;
    border-radius: 8px;
    box-shadow:
        0 10px 30px rgba(0, 0, 0, 0.3),
        inset 0 0 0 2px #6d5844,
        inset 3px 0 8px rgba(0, 0, 0, 0.2);
    position: relative;
    margin-left: auto;
    max-width: 85%;
}

.inventory-book-frame::before {
    content: "";
    position: absolute;
    left: 20px;
    top: 10px;
    bottom: 10px;
    width: 3px;
    background: linear-gradient(to bottom,
        transparent 0%,
        rgba(109, 88, 68, 0.3) 5%,
        rgba(109, 88, 68, 0.5) 50%,
        rgba(109, 88, 68, 0.3) 95%,
        transparent 100%);
    border-radius: 1px;
}

.inventory-book-frame::after {
    content: "INVENTORY LEDGER";
    position: absolute;
    top: 8px;
    left: 50%;
    transform: translateX(-50%);
    font-family: 'Courier New', monospace;
    font-size: 11px;
    font-weight: bold;
    color: #6d5844;
    letter-spacing: 3px;
    opacity: 0.6;
}

.carousel {
    background-color: rgba(255, 255, 255, 0);
    margin-left: 0;
}
.carousel-slide {
    position: relative;
}
.image-container {
    position: relative;
    width: 100%;
    height: 100%;
}
.logbook-overlay {
    position: absolute;
    bottom: 20px;
    left: 50%;
    transform: translateX(-50%);
    background-color: rgba(245, 245, 220, 0.95);
    border: 2px solid #8b7355;
    border-radius: 4px;
    padding: 12px 20px;
    font-family: 'Courier New', monospace;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
    min-width: 220px;
    max-width: 280px;
}
.logbook-entry {
    display: flex;
    gap: 8px;
    align-items: baseline;
    margin-bottom: 4px;
}
.logbook-entry:last-child {
    margin-bottom: 0;
}
.entry-label {
    font-weight: bold;
    color: #4a4a4a;
    font-size: 12px;
    min-width: 55px;
}
.entry-value {
    color: #2c2c2c;
    font-size: 13px;
    font-style: italic;
}
.banner {
    /* Professional, trustworthy moving company aesthetic */
    background: linear-gradient(135deg, #2c5f7c 0%, #3a7ca5 50%, #4a90c4 100%);
    color: white;
    align-items: center;
    justify-content: center;
    height: 90vh;
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