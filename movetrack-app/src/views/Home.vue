<script setup lang="ts">
  import { computed, ref } from 'vue';

  import DesktopSignup from '../components/home_components/DesktopSignup.vue';
  import MobileSignup from '../components/home_components/MobileSignup.vue';
  import HeroLedger from '../components/home_components/HeroLedger.vue';
  import HeroSplit from '../components/home_components/HeroSplit.vue';
  import PackABoxDemo from '../components/home_components/PackABoxDemo.vue';
  import InteractiveDemo from '../components/home_components/InteractiveDemo.vue';

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
  const showAbout = ref(false);

  // Toggle to switch between different homepage designs
  // Interactive Demo with two experiences (inventory + packing)
  const useInteractiveDemo = ref(true);
  // HOMEPAGE 3: Pack-a-Box Mini Demo (PROMPT 3)
  const useHomepage3 = ref(false);
  // HOMEPAGE 2: Split Hero with Live Inventory Sidebar (PROMPT 2)
  const useHomepage2 = ref(false);
  // HOMEPAGE 1: HeroLedger design (FIRST PROMPT)
  const useNewHero = ref(false);

</script>

<template>

  <q-dialog v-model="showAbout" transition-show="rotate" transition-hide="rotate">
    <q-card style="max-width: 600px;">
      <q-card-section>
        <div class="text-h6">About MoveTrack</div>
      </q-card-section>
      <q-card-section class="q-pt-none">
        <p class="q-mb-md">
          I've moved on average every 2.5 years throughout my life. Each time, I faced the same frustrations: lost items, damaged belongings, inaccurate moving quotes, and the overwhelming stress of not knowing if everything arrived safely.
        </p>
        <p class="q-mb-md">
          After my last move, I decided there had to be a better way. That's when MoveTrack was born.
        </p>
        <p class="q-mb-md">
          MoveTrack is your trusted partner in managing and organizing your belongings during life's transitions. Whether you're moving to a new home, downsizing, or simply organizing your space, we make it easy to track every item with:
        </p>
        <ul class="q-mb-md">
          <li>Simple cataloging with photos and detailed descriptions</li>
          <li>Accurate dimensions and weights for precise moving quotes</li>
          <li>The ability to share your inventory with moving companies</li>
          <li>Peace of mind knowing exactly what you have and where it's going</li>
        </ul>
        <p>
          I built MoveTrack because I'm passionate about making moving easier for everyone who, like me, has experienced the chaos of relocation. With reliability and trust at our core, MoveTrack is here to make your next move your best move.
        </p>
      </q-card-section>
      <q-card-actions align="right">
        <q-btn flat label="Close" color="primary" v-close-popup />
      </q-card-actions>
    </q-card>
  </q-dialog>

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
          <div class="logo-text" :class="{ 'mobile': isMobile }">
            MoveTrack
          </div>
        </q-toolbar-title>
      </q-toolbar>
    </q-header>

    <q-page-container>
      <q-page class="landing-page">
        <!-- Interactive Demo with two experiences (inventory + packing) -->
        <InteractiveDemo v-if="useInteractiveDemo" />

        <!-- HOMEPAGE 3: Pack-a-Box Mini Demo (PROMPT 3) -->
        <PackABoxDemo v-else-if="useHomepage3" />

        <!-- HOMEPAGE 2: Split Hero with Live Inventory Sidebar (PROMPT 2) -->
        <HeroSplit v-else-if="useHomepage2" />

        <!-- HOMEPAGE 1: HeroLedger design (FIRST PROMPT) -->
        <HeroLedger v-else-if="useNewHero" />

        <!-- Original hero designs -->
        <template v-else>
          <DesktopSignup v-if="!isMobile" />
          <MobileSignup v-else />
        </template>

        <!-- How It Works Section -->
        <div class="how-it-works-section q-py-xl">
          <div class="text-center q-mb-xl">
            <h2 class="section-title">How It Works</h2>
            <p class="section-subtitle">Three simple steps to organize your move</p>
          </div>

          <div class="row q-col-gutter-xl q-px-xl">
            <div class="col-12 col-md-4 text-center">
              <q-icon name="inventory_2" size="64px" color="primary" />
              <h4>1. Build Your Inventory</h4>
              <p>Catalog your belongings with photos, descriptions, and dimensions. Our AI helps you log items quickly and accurately.</p>
            </div>
            <div class="col-12 col-md-4 text-center">
              <q-icon name="share" size="64px" color="primary" />
              <h4>2. Share with Movers</h4>
              <p>Send your inventory to moving companies for accurate quotes. No more surprises on moving day.</p>
            </div>
            <div class="col-12 col-md-4 text-center">
              <q-icon name="local_shipping" size="64px" color="primary" />
              <h4>3. Get a Quote</h4>
              <p>Receive competitive quotes from verified movers, or get a direct quote from us for a seamless experience.</p>
            </div>
          </div>

          <!-- Reviews Section -->
          <div class="reviews-section q-mt-xl q-px-xl">
            <h3 class="text-center q-mb-lg">What Our Customers Say</h3>
            <div class="row q-col-gutter-md">
              <div class="col-12 col-md-4">
                <q-card class="review-card">
                  <q-card-section>
                    <div class="row items-center q-mb-md">
                      <q-avatar size="48px" color="primary" text-color="white">SJ</q-avatar>
                      <div class="q-ml-md">
                        <div class="text-weight-bold">Sarah Johnson</div>
                        <div class="text-caption text-grey">Seattle, WA</div>
                      </div>
                    </div>
                    <div class="q-mb-sm">
                      <q-icon name="star" color="amber" size="20px" v-for="n in 5" :key="n" />
                    </div>
                    <p class="review-text">"MoveTrack made my cross-country move so much easier. Having everything cataloged meant I could verify all my items arrived safely. Highly recommend!"</p>
                  </q-card-section>
                </q-card>
              </div>
              <div class="col-12 col-md-4">
                <q-card class="review-card">
                  <q-card-section>
                    <div class="row items-center q-mb-md">
                      <q-avatar size="48px" color="primary" text-color="white">MC</q-avatar>
                      <div class="q-ml-md">
                        <div class="text-weight-bold">Michael Chen</div>
                        <div class="text-caption text-grey">Austin, TX</div>
                      </div>
                    </div>
                    <div class="q-mb-sm">
                      <q-icon name="star" color="amber" size="20px" v-for="n in 5" :key="n" />
                    </div>
                    <p class="review-text">"As someone who moves frequently for work, this is a game-changer. I can update my inventory between moves and always know exactly what I have."</p>
                  </q-card-section>
                </q-card>
              </div>
              <div class="col-12 col-md-4">
                <q-card class="review-card">
                  <q-card-section>
                    <div class="row items-center q-mb-md">
                      <q-avatar size="48px" color="primary" text-color="white">EP</q-avatar>
                      <div class="q-ml-md">
                        <div class="text-weight-bold">Emily Parker</div>
                        <div class="text-caption text-grey">Boston, MA</div>
                      </div>
                    </div>
                    <div class="q-mb-sm">
                      <q-icon name="star" color="amber" size="20px" v-for="n in 5" :key="n" />
                    </div>
                    <p class="review-text">"The ability to get quotes from multiple movers based on my actual inventory saved me hundreds of dollars. No hidden fees or surprises!"</p>
                  </q-card-section>
                </q-card>
              </div>
            </div>
          </div>
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
        <q-btn flat no-caps @click="showAbout = true" label="About" class="q-px-sm text-weight-thin" />
        <q-btn flat no-caps @click="showTermsOfService = true" label="Terms of Service" class="q-px-sm text-weight-thin" />
        <q-btn flat no-caps @click="showPrivacyPolicy = true" label="Privacy Policy" class="q-px-sm text-weight-thin" />
      </div>
      <div class="row">
        <q-btn disable flat no-caps label="&copy; 2025 MoveTrack" class="q-px-sm text-weight-thin" />
      </div>
    </q-footer>
  </q-layout>
</template>

<style scoped>
.header {
  background-color: #f5f9e9;
}
  .logo-text {
    font-size: 2rem;
    font-weight: 600;
    color: #2c3e50;
    letter-spacing: -0.5px;
    margin-left: 40px;
  }
  .logo-text.mobile {
    font-size: 1.5rem;
    margin-left: 0;
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
  .how-it-works-section {
    background-color: #f8f9fa;
  }
  .section-title {
    font-size: 2.5rem;
    font-weight: 700;
    color: #2c3e50;
    margin: 0;
  }
  .section-subtitle {
    font-size: 1.2rem;
    color: #6c757d;
    margin-top: 0.5rem;
  }
  .reviews-section {
    max-width: 1200px;
    margin: 0 auto;
  }
  .review-card {
    height: 100%;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  }
  .review-text {
    font-style: italic;
    color: #495057;
    line-height: 1.6;
  }
</style>
