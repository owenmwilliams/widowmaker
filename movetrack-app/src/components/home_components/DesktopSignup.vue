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

    const email = ref('');

    const slide = ref(1);

    const imageUrls = [
        // { url: 'https://storage.googleapis.com/take-stock-design-assets/Home/Antiques.png', label: '...piece for the corner of your room.' },
        // { url: 'https://storage.googleapis.com/take-stock-design-assets/Home/Art.png', label: '...expression of your taste.' },
        // { url: 'https://storage.googleapis.com/take-stock-design-assets/Home/Books.png', label: '...addition to your library.' },
        // { url: 'https://storage.googleapis.com/take-stock-design-assets/Home/Ceramics.png', label: '...display piece for the china cabinet.' },
        // { url: 'https://storage.googleapis.com/take-stock-design-assets/Home/Coins.png', label: '...gem in your numismatic journey.' },
        // { url: 'https://storage.googleapis.com/take-stock-design-assets/Home/Collectible%20Cards.png', label: '...perfect card for your deck.' },
        // { url: 'https://storage.googleapis.com/take-stock-design-assets/Home/Figurines.png', label: '...member to the league.' },
        // { url: 'https://storage.googleapis.com/take-stock-design-assets/Home/Hats.png', label: '...unique cap to crown your collection.' },
        // { url: 'https://storage.googleapis.com/take-stock-design-assets/Home/Jewelry.png', label: '...sparkling touch to wear and pass down.' },
        // { url: 'https://storage.googleapis.com/take-stock-design-assets/Home/Playing%20Cards.png', label: '...deck to ante up on.' },
        // { url: 'https://storage.googleapis.com/take-stock-design-assets/Home/Records.png', label: '...vinyl to set just the right mood.' },
        // { url: 'https://storage.googleapis.com/take-stock-design-assets/Home/Shoes.png', label: '...fresh pair of kicks.' },
        // { url: 'https://storage.googleapis.com/take-stock-design-assets/Home/Sports%20Memorabilia.png', label: '...game worn jersey.' },
        // { url: 'https://storage.googleapis.com/take-stock-design-assets/Home/Stamps.png', label: '...colorful mark of history.' },
        // { url: 'https://storage.googleapis.com/take-stock-design-assets/Home/Textiles.png', label: '...tapestry that tells a tale.' },
        // { url: 'https://storage.googleapis.com/take-stock-design-assets/Home/Watches.png', label: '...timeless piece and family heirloom.' },
        // { url: 'https://storage.googleapis.com/take-stock-design-assets/Home/Wine.png', label: '...bottle for your cellar.'},

        { url: 'https://storage.googleapis.com/take-stock-design-assets/Home/MateGourd.PNG', label: '...mate gourd.' },
        { url: 'https://storage.googleapis.com/take-stock-design-assets/Home/CopperBowl.PNG', label: '...copper bowl.' },
        { url: 'https://storage.googleapis.com/take-stock-design-assets/Home/ChinaCup.PNG', label: '...china cup.' },
        { url: 'https://storage.googleapis.com/take-stock-design-assets/Home/PlayingCards.PNG', label: '...playing cards.' },
        { url: 'https://storage.googleapis.com/take-stock-design-assets/Home/BeltBuckle.PNG', label: '...belt buckle.' },
        { url: 'https://storage.googleapis.com/take-stock-design-assets/Home/MintJulepCups.PNG', label: '...mint julep cups.' },
        { url: 'https://storage.googleapis.com/take-stock-design-assets/Home/NutDish.PNG', label: '...nut dish.' },
        { url: 'https://storage.googleapis.com/take-stock-design-assets/Home/ShotGlasses.PNG', label: '...pair of shot glasses.' },
        { url: 'https://storage.googleapis.com/take-stock-design-assets/Home/VeuveHat.PNG', label: '...yellow hat.' },
        { url: 'https://storage.googleapis.com/take-stock-design-assets/Home/ChinaTeaCup.PNG', label: '...tea cup.' },
        { url: 'https://storage.googleapis.com/take-stock-design-assets/Home/MetalFlute.PNG', label: '...metal flute.' },
        { url: 'https://storage.googleapis.com/take-stock-design-assets/Home/BlueFlute.PNG', label: '...glass vase.' },
        { url: 'https://storage.googleapis.com/take-stock-design-assets/Home/MiniSteins.PNG', label: '...set of mini steins.' },
        { url: 'https://storage.googleapis.com/take-stock-design-assets/Home/PepperGrinder.PNG', label: '...pepper grinder.' },
        { url: 'https://storage.googleapis.com/take-stock-design-assets/Home/FlowerVase.PNG', label: '...flower vase.' }
    ];
</script>

<template>

    <div class="banner row q-pa-md">
        <div stack class="col-5">
            <h3 class="my_font_class q-pa-none">Your collection.</h3>
            <h3 class="my_font_class q-pa-none">Your marketplace.</h3>
            <h2 class="text-weight-medium text-accent my_font_class">Your place to find the next...</h2>
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
        </div>

        <div class="col-7" style="max-width: 100%;">
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
            <q-carousel-slide v-for="(img, index) in imageUrls" :name="index+1">
                <div class="text-h5 text-weight-medium flex flex-center q-pb-lg">{{ img.label }}</div>  
                <q-img :src="img.url" style="height: 60vh;" fit="contain" />
            </q-carousel-slide>

            </q-carousel>
        </div>

    </div>
</template>

<style scoped>
.my_font_class {
    font-family: 'Exo 2';
    color: white;
    font-weight: 800;
}
.card-colors {
    background-color: #f5f9e9;
}
.carousel {
    background-color: rgba(255, 255, 255, 0);
    margin-left: auto;
}
.banner {
    /* Using gradientmagic.com */
    background-image: linear-gradient(44deg, rgba(243, 243, 243, 0.05) 0%, rgba(243, 243, 243, 0.05) 33.333%,rgba(79, 79, 79, 0.05) 33.333%, rgba(79, 79, 79, 0.05) 66.666%,rgba(9, 9, 9, 0.05) 66.666%, rgba(9, 9, 9, 0.05) 99.999%),linear-gradient(97deg, rgba(150, 150, 150, 0.05) 0%, rgba(150, 150, 150, 0.05) 33.333%,rgba(34, 34, 34, 0.05) 33.333%, rgba(34, 34, 34, 0.05) 66.666%,rgba(40, 40, 40, 0.05) 66.666%, rgba(40, 40, 40, 0.05) 99.999%),linear-gradient(29deg, rgba(56, 56, 56, 0.05) 0%, rgba(56, 56, 56, 0.05) 33.333%,rgba(226, 226, 226, 0.05) 33.333%, rgba(226, 226, 226, 0.05) 66.666%,rgba(221, 221, 221, 0.05) 66.666%, rgba(221, 221, 221, 0.05) 99.999%),linear-gradient(90deg, rgb(70,117,153),rgb(238,132,52));
    color: white;
    align-items: center;
    justify-content: center;
    height: 90vh;
}

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