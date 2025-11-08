<script setup lang="ts">
    import { ref, defineEmits } from 'vue';
    import router from '../../router';

    // To adjust url based on whether in prod or not
    const core_url = import.meta.env.MODE == 'development' ? 'http://localhost:3050' : 'https://movetrack-api-7hwn7ggbiq-uc.a.run.app'

    // Setting up loading emits
    const emits = defineEmits<{
        (e: 'app:loading', id: boolean): void
    }>()

    // Login function - redirect to login page
    function login(provider: string) {
        router.push('/login');
    }

    const slide = ref(1);

    const imageUrls = [
        { url: 'https://storage.googleapis.com/take-stock-design-assets/Home/Antiques.png', label: 'Antiques' },
        { url: 'https://storage.googleapis.com/take-stock-design-assets/Home/Art.png', label: 'Art' },
        { url: 'https://storage.googleapis.com/take-stock-design-assets/Home/Books.png', label: 'Books' },
        { url: 'https://storage.googleapis.com/take-stock-design-assets/Home/Ceramics.png', label: 'Ceramics' },
        { url: 'https://storage.googleapis.com/take-stock-design-assets/Home/Coins.png', label: 'Coins' },
        { url: 'https://storage.googleapis.com/take-stock-design-assets/Home/Collectible%20Cards.png', label: 'Collectible Cards' },
        { url: 'https://storage.googleapis.com/take-stock-design-assets/Home/Figurines.png', label: 'Figurines' },
        { url: 'https://storage.googleapis.com/take-stock-design-assets/Home/Hats.png', label: 'Hats' },
        { url: 'https://storage.googleapis.com/take-stock-design-assets/Home/Jewelry.png', label: 'Jewelry' },
        { url: 'https://storage.googleapis.com/take-stock-design-assets/Home/Playing%20Cards.png', label: 'Playing Cards' },
        { url: 'https://storage.googleapis.com/take-stock-design-assets/Home/Records.png', label: 'Records' },
        { url: 'https://storage.googleapis.com/take-stock-design-assets/Home/Shoes.png', label: 'Shoes' },
        { url: 'https://storage.googleapis.com/take-stock-design-assets/Home/Sports%20Memorabilia.png', label: 'Memorabilia' },
        { url: 'https://storage.googleapis.com/take-stock-design-assets/Home/Stamps.png', label: 'Stamps' },
        { url: 'https://storage.googleapis.com/take-stock-design-assets/Home/Textiles.png', label: 'Textiles' },
        { url: 'https://storage.googleapis.com/take-stock-design-assets/Home/Watches.png', label: 'Watches' },
        { url: 'https://storage.googleapis.com/take-stock-design-assets/Home/Wine.png', label: 'Wine'}
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
            <q-carousel-slide class="q-pa-none" v-for="(img, index) in imageUrls" :name="index+1">
                <q-card class="card-colors" square>
                        <q-img :src="img.url" style="width: 100%;">
                          <div class="absolute-bottom text-subtitle1 text-center">
                            {{ img.label }}
                          </div>
                        </q-img>
                </q-card>
            </q-carousel-slide>
            </q-carousel>
        </div>

<div class="banner row q-pa-md flex flex-center">
  <div class="q-pa-md text-body1 flex flex-center">
    Sign up now to browse, buy, sell, and share your collection on the #1 web3 powered auction platform.
  </div>
            <button @click="login('google')" class="gsi-material-button">
                <div class="gsi-material-button-state"></div>
                <div class="gsi-material-button-content-wrapper">
                    <div class="gsi-material-button-icon">
                    <svg version="1.1" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" xmlns:xlink="http://www.w3.org/1999/xlink" style="display: block;">
                        <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"></path>
                        <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"></path>
                        <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"></path>
                        <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"></path>
                        <path fill="none" d="M0 0h48v48H0z"></path>
                    </svg>
                    </div>
                    <span class="gsi-material-button-contents">Continue with Google</span>
                    <span style="display: none;">Continue with Google</span>
                </div>
            </button>
            <q-btn flat dense standout lowercase size="md" class="thin-italic-button row" @click="login('email')">Or sign up with email</q-btn>
        <!-- </div> -->

        <!-- <div class="col-8" style="max-width: 100%;"> -->
        

    </div>

</template>

<style scoped>

.gsi-material-button {
  background-color: WHITE;
  background-image: none;
  border: 1px solid #747775;
  -webkit-border-radius: 4px;
  border-radius: 4px;
  -webkit-box-sizing: border-box;
  box-sizing: border-box;
  color: #1f1f1f;
  cursor: pointer;
  font-family: 'Roboto', arial, sans-serif;
  font-size: 14px;
  height: 40px;
  letter-spacing: 0.25px;
  outline: none;
  overflow: hidden;
  padding: 0 12px;
  position: relative;
  text-align: center;
  -webkit-transition: background-color .218s, border-color .218s, box-shadow .218s;
  transition: background-color .218s, border-color .218s, box-shadow .218s;
  vertical-align: middle;
  white-space: nowrap;
  width: auto;
  max-width: 400px;
  min-width: min-content;
}

.gsi-material-button .gsi-material-button-icon {
  height: 20px;
  margin-right: 12px;
  min-width: 20px;
  width: 20px;
}

.gsi-material-button .gsi-material-button-content-wrapper {
  -webkit-align-items: center;
  align-items: center;
  display: flex;
  -webkit-flex-direction: row;
  flex-direction: row;
  -webkit-flex-wrap: nowrap;
  flex-wrap: nowrap;
  height: 100%;
  justify-content: space-between;
  position: relative;
  width: 100%;
}

.gsi-material-button .gsi-material-button-contents {
  -webkit-flex-grow: 1;
  flex-grow: 1;
  font-family: 'Roboto', arial, sans-serif;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  vertical-align: top;
}

.gsi-material-button .gsi-material-button-state {
  -webkit-transition: opacity .218s;
  transition: opacity .218s;
  bottom: 0;
  left: 0;
  opacity: 0;
  position: absolute;
  right: 0;
  top: 0;
}

.gsi-material-button:disabled {
  cursor: default;
  background-color: #ffffff61;
  border-color: #1f1f1f1f;
}

.gsi-material-button:disabled .gsi-material-button-contents {
  opacity: 38%;
}

.gsi-material-button:disabled .gsi-material-button-icon {
  opacity: 38%;
}

.gsi-material-button:not(:disabled):active .gsi-material-button-state, 
.gsi-material-button:not(:disabled):focus .gsi-material-button-state {
  background-color: #303030;
  opacity: 12%;
}

.gsi-material-button:not(:disabled):hover {
  -webkit-box-shadow: 0 1px 2px 0 rgba(60, 64, 67, .30), 0 1px 3px 1px rgba(60, 64, 67, .15);
  box-shadow: 0 1px 2px 0 rgba(60, 64, 67, .30), 0 1px 3px 1px rgba(60, 64, 67, .15);
}

.gsi-material-button:not(:disabled):hover .gsi-material-button-state {
  background-color: #303030;
  opacity: 8%;
}

    .video-div {
        padding: 0.75vw;
    }
    .form-container {
        background-image: url('https://storage.googleapis.com/take-stock-design-assets/roy_background_1');
        background-size: cover;
        background-position: center;
        border-radius: 20px;
        padding: 20px;
        position: relative;
        top: 25%;
        height: 50%;
        display: flex;
        justify-content: center;
        align-items: center;
        width: 90%;
        left: 5%;
    }
    .form-container::before {
        content: "";
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background-color: rgba(0, 0, 0, 0.8);
        border-radius: 20px;
    }
    .signup-div {
        z-index: 1;
        width: 100%;
    }
    .form-class {
        height: 100%;
        padding: 0.75vw;
        display: flex;
    }
    .thin-italic-button {
        font-size: 12px; /* Customize the font size */
        font-weight: 100; /* Customize the font weight */
        font-style: italic; /* Apply italic style */
        text-transform: lowercase;
        padding-left: 20px;
        padding-right: 20px;
    }
</style>