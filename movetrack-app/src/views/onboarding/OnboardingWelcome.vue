<script setup lang="ts">
import { useRouter } from "vue-router";
import { useQuasar } from "quasar";

const emit = defineEmits<{ "app:loading": (value: boolean) => void }>();
emit("app:loading", false);

const router = useRouter();
const $q = useQuasar();
const isMobile = $q.platform.is.mobile === true;

const handleStart = () => {
  router.push({ name: "onboarding-profile" });
};
</script>

<template>
  <q-layout view="lHh Lpr lFf">
    <q-page-container>
      <q-page :class="['onboarding-page', { 'onboarding-page--mobile': isMobile }]">
        <div :class="['onboarding-card', { 'onboarding-card--mobile': isMobile }]">          <div class="hero">
            <div class="hero-text">
          <div class="eyebrow">Welcome to Nexus Moves</div>
          <h1>Catalog your entire home in minutes.</h1>
          <p>
            Use AI-powered capture, QR-ready boxes, and real-time move coordination to keep
            every item accounted for.
          </p>
          <q-btn
            color="primary"
            label="Get Started"
            class="q-mt-lg"
            unelevated
            size="lg"
            @click="handleStart"
          />
            </div>
          </div>
        </div>
      </q-page>
    </q-page-container>
  </q-layout>
</template>

<style scoped>
.onboarding-page {
  min-height: calc(100vh - 56px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 40px 16px;
  background: linear-gradient(135deg, #eef2ff, #fdf4ff);
}

.onboarding-page--mobile {
  align-items: flex-start;
  padding: 24px 16px;
}


.onboarding-card {
  width: min(60vw, 900px);
  max-width: 900px;
  background: white;
  border-radius: 24px;
  padding: 28px 32px;
  box-shadow: 0 20px 60px rgba(15, 23, 42, 0.08);
  display: flex;
  flex-direction: column;
  margin: 24px auto;
}

.onboarding-card--mobile {
  width: 100%;
  border-radius: 0;
  box-shadow: none;
  background: transparent;
  padding: 16px;
}

.hero {
  width: 100%;
  text-align: left;
}

.hero-text h1 {
  font-size: clamp(1.6rem, 4vw, 2.6rem);
  margin: 4px 0 12px;
  line-height: 1.2;
  color: #122044;
}

.hero-text p {
  font-size: 1.05rem;
  color: #4c5674;
}

.eyebrow {
  text-transform: uppercase;
  letter-spacing: 0.3em;
  font-size: 0.75rem;
  color: #7b89c1;
}
</style>
