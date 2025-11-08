<script setup lang="ts">
  import { computed, ref } from 'vue';
  import router from '../router';

  import DesktopSignup from '../components/home_components/DesktopSignup.vue';
  import MobileSignup from '../components/home_components/MobileSignup.vue';

  import DesktopCards from '../components/home_components/DesktopCards.vue';
  import MobileCards from '../components/home_components/MobileCards.vue';

  import DesktopHighlight from '../components/home_components/DesktopHighlight.vue';
  import MobileHighlight from '../components/home_components/MobileHighlight.vue';

  import DesktopEmail from '../components/home_components/DesktopEmail.vue';

  import PrivacyPolicy from './PrivacyPolicy.vue';
  import TermsOfService from './TermsAndConditions.vue';
  // import Contracts from './Contracts.vue'



  const isMobile = computed(() => {
    const minWidth = 768; // Minimum width for desktop devices
    return window.innerWidth < minWidth || screen.width < minWidth;
  });


  const showPrivacyPolicy = ref(false);
  const showTermsOfService = ref(false);
  const showContracts = ref(false);

  // Login function - redirect to login page
  function login() {
    router.push('/login');
  }

  const highlights = [
    {
      id: 0,
      image_url: 'https://storage.googleapis.com/take-stock-design-assets/roy_location', 
      title: 'Locations',
      description: 'Locations are the basic unit of organization - everything we own should have a place to call home.'
    },
    {
      id: 1,
      image_url: 'https://storage.googleapis.com/take-stock-design-assets/roy_room', 
      title: 'Rooms',
      description: 'How we organize our lives at the highest level - all our items belong to the right room.'
    },
    {
      id: 2,
      image_url: 'https://storage.googleapis.com/take-stock-design-assets/roy_container', 
      title: 'Containers',
      description: 'The basic building block of organization - with containers we can start grouping like items.'
    },
    {
      id: 3,
      image_url: 'https://storage.googleapis.com/take-stock-design-assets/roy_item', 
      title: 'Items',
      description: 'What needs to be organized - these are our things, everything that brings us joy everyday.'
    },
    // Add more highlights as needed
  ]

  const cardsTrack = [
    {
      id: 0,
      icon: 'https://storage.cloud.google.com/take-stock-design-assets/ValueProp/ai_photo.png',
      title: 'LOG',
      description: 'Quickly build your collections with AI-powered logging tools. By reading text and leveraging image and object detection, we take the tedium out of cataloging your collection.',
    },
    {
      id: 1,
      icon: 'https://storage.cloud.google.com/take-stock-design-assets/ValueProp/desktop_mobile.png',
      title: 'ORGANIZE',
      description: 'Manage your possesions on the go or see your whole home inventory in one place. Easily add new items or organize the ones you have. Update your descriptions all from one place.',
    },
    {
      id: 2,
      icon: 'https://storage.cloud.google.com/take-stock-design-assets/ValueProp/search.png',
      title: 'FIND',
      description: 'Everything is always in the last place you look. Spend less time looking and more time finding when searching through your inventory.',
    },
    // Add more cards as needed
  ]

  const cardsShare = [
    {
      id: 0,
      icon: 'https://storage.cloud.google.com/take-stock-design-assets/ValueProp/buy.png',
      title: 'BUY',
      description: 'Looking for the next piece? We have got you covered. When you make an offer, it is securely withdrawn from your account and held safely until the transaction is complete.',
    },
    {
      id: 1,
      icon: 'https://storage.cloud.google.com/take-stock-design-assets/ValueProp/share.png',
      title: 'SHARE',
      description: 'Listing an item? We transform your product into a unique digital token, ensuring the authenticity of your item. When an item gets sold, this token gets transfered.',
    },
    {
      id: 2,
      icon: 'https://storage.cloud.google.com/take-stock-design-assets/ValueProp/sell.png',
      title: 'SELL',
      description: 'Ready to let go? Feel at ease as each offer on your item is securely held in escrow, guaranteeing a smooth transaction until your buyer is delighted.',
    },
    // Add more cards as needed
  ]
</script>

<template>

  <q-dialog v-model="showTermsOfService" transition-show="rotate" transition-hide="rotate">
    <q-card>
      <q-card-section>
        <div class="text-h6">Terms of Agreement</div>
      </q-card-section>
      <q-card-section class="q-pt-none">
        <TermsOfService />
      </q-card-section>
    </q-card>
  </q-dialog>

  <q-dialog v-model="showPrivacyPolicy" transition-show="rotate" transition-hide="rotate">
    <q-card>
      <q-card-section>
        <div class="text-h6">Privacy Policy</div>
      </q-card-section>
      <q-card-section class="q-pt-none">
        <PrivacyPolicy />
      </q-card-section>
    </q-card>
  </q-dialog>

  <q-dialog v-model="showContracts" transition-show="rotate" transition-hide="rotate">
    <q-card>
      <q-card-section>
        <div class="text-h6">Contracts</div>
      </q-card-section>
      <q-card-section class="q-pt-none">
        <Contracts />
      </q-card-section>
    </q-card>
  </q-dialog>

  <q-layout view="hHh lpR fff">
    <q-header bordered class="header">
      <q-toolbar>
        <q-toolbar-title>
          <q-img
            class="q-mx-lg"
            v-if="!isMobile"
            src="https://storage.googleapis.com/take-stock-design-assets/Logos/skwurlit_core_color_logo.png"
            spinner-color="white"
            width="10%"
          />
          <q-img
            v-else
            src="https://storage.googleapis.com/take-stock-design-assets/Logos/skwurlit_core_color_logo.png"
            spinner-color="white"
            width="40%"
          />
        </q-toolbar-title>
        <q-btn color="dark" dense flat no-caps right class="q-mx-md" label="Login" @click="login" />
      </q-toolbar>
    </q-header>

    <q-page-container>
      <q-page class="landing-page">
        <DesktopSignup v-if="!isMobile" />
          <MobileSignup v-else />
        <div class="text-center">
          <h3 v-if="!isMobile">How it works</h3>
          <h4 v-else>How it works</h4>
        </div>
        <DesktopCards v-if="!isMobile" :cardsTrack="cardsTrack" :cardsShare="cardsShare" />
        <div v-else>
          <h6 class="flex flex-center text-weight-light">Build your collection with web2</h6>
          <MobileCards :cards="cardsTrack" />
          <h6 class="flex flex-center text-weight-light">Share with others on web3</h6>
          <MobileCards :cards="cardsShare" />
        </div>
        <div class="text-center">
          <h3 v-if="!isMobile">Get in touch</h3>
          <h4 v-else>Get in touch</h4>
        </div>
        <DesktopEmail class="q-mx-xl" :isMobile="isMobile" />

      </q-page>
    </q-page-container>
    <q-footer class="q-pb-xl bg-transparent text-grey flex flex-center">
      <div class="row">
        
        <q-btn flat no-caps @click="showTermsOfService = true" label="Terms of Service" class="q-px-sm text-weight-thin" />
        <q-btn flat no-caps @click="showPrivacyPolicy = true" label="Privacy Policy" class="q-px-sm text-weight-thin" />
        <q-btn flat no-caps @click="router.push('learn')" label="Learn more" class="q-px-sm text-weight-thin" />
      </div>
      <div class="row">
        <q-btn disable flat no-caps label="&copy; 2024 We3Kings d/b/a Sqwurlit" class="q-px-sm text-weight-thin" />
      </div>
    </q-footer>
  </q-layout>
</template>

<style scoped>
.header {
  background-color: #f5f9e9;
}
  .text-center {
    padding-top: 25px;
    padding-left: 10px;
    padding-right: 10px;
  }
  .text-center h3 {
    margin-top: 20px;
    margin-bottom: 20px;
    font-weight: 500;
    width: 70%;
    position: relative;
    left: 15%;
  }
  .separator {
    margin-top: 25px;
    margin-bottom: 25px;
  }
  /* .footer {
    padding: 0;
  } */
  .landing-page {
    padding: 0;
  }
  .footer-links {
    padding: 5px;
  }
</style>
