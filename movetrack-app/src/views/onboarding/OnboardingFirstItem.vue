<script setup lang="ts">
import { computed } from "vue";
import { useQuasar } from "quasar";
import { useRouter } from "vue-router";

const emit = defineEmits<{ "app:loading": (value: boolean) => void }>();
emit("app:loading", false);

const $q = useQuasar();
const router = useRouter();

const isMobile = $q.platform.is.mobile === true;

const primaryLabel = computed(() =>
  isMobile ? "Start single item capture" : "Upload inventory file",
);
const primaryIcon = computed(() => (isMobile ? "photo_camera" : "cloud_upload"));

const handlePrimary = () => {
  if (isMobile) {
    router.push({ name: "onboarding-capture-mobile" });
    return;
  }
  router.push({ name: "onboarding-import" });
};

const goNext = () => {
  router.push({ name: "onboarding-next" });
};
</script>

<template>
  <q-layout view="lHh Lpr lFf">
    <q-page-container>
      <q-page :class="['onboarding-page', { 'onboarding-page--mobile': isMobile }]">
        <div :class="['onboarding-card', { 'onboarding-card--mobile': isMobile }]">
          <div class="eyebrow">Step 3 of 4</div>
          <h2>{{ isMobile ? "Log your first item" : "Already have an inventory?" }}</h2>
          <p class="lede" v-if="isMobile">
            Tap below to launch single-item capture. Snap a photo, let AI describe it, and save within seconds.
          </p>
          <p class="lede" v-else>
            Upload your spreadsheet and we’ll map the fields (Name, Quantity, Room, Notes, Box ID) so you can skip manual entry.
          </p>

          <div class="tips" v-if="isMobile">
            <div>• Use natural light for best photos.</div>
            <div>• We auto-suggest room + box.</div>
          </div>
          <div class="tips" v-else>
            <div>• Supported: CSV or XLSX.</div>
            <div>• We’ll walk you through field matching.</div>
          </div>

          <div class="cta-wrap">
            <div :class="['cta-pill', { 'cta-pill--mobile': isMobile }]">
              <q-btn
                :class="[isMobile ? 'fab-button fab-pill' : 'cta-btn-desktop']"
                :color="isMobile ? undefined : 'primary'"
                :label="primaryLabel"
                :icon="primaryIcon"
                size="lg"
                unelevated
                @click="handlePrimary"
              />
            </div>
          </div>

          <div class="actions actions--skip">
            <q-btn flat color="grey-7" label="I'll do this later" @click="goNext" />
          </div>
        </div>
      </q-page>
    </q-page-container>
  </q-layout>
</template>

<style scoped>
.onboarding-page {
  min-height: calc(100vh - 56px);
  padding: 32px 16px;
  background: #f8f9fd;
  display: flex;
  justify-content: center;
  align-items: center;
}

.onboarding-page--mobile {
  align-items: flex-start;
  padding: 16px;
}

.onboarding-card {
  width: min(60vw, 900px);
  min-height: 70vh;
  max-height: 85vh;
  background: white;
  border-radius: 24px;
  padding: 28px 32px;
  box-shadow: 0 20px 60px rgba(15, 23, 42, 0.08);
  display: flex;
  flex-direction: column;
}

.onboarding-card--mobile {
  width: 100%;
  min-height: calc(100vh - 56px);
  max-height: none;
  border-radius: 0;
  box-shadow: none;
  background: transparent;
  padding: 16px;
}

.onboarding-card h2 {
  font-size: 1.75rem;
  margin: 4px 0 12px;
}

.eyebrow {
  text-transform: uppercase;
  letter-spacing: 0.3em;
  font-size: 0.7rem;
  color: #94a3b8;
}

.lede {
  margin-top: 8px;
  color: #475569;
  max-width: 640px;
}

.tips {
  margin-top: 16px;
  color: #475569;
  line-height: 1.45;
}

.cta-wrap {
  margin-top: 32px;
}

.cta-pill {
  border-radius: 999px;
  padding: 6px;
  background: linear-gradient(135deg, rgba(59, 83, 255, 0.08), rgba(238, 242, 255, 0.8));
  display: inline-flex;
}

.cta-pill--mobile {
  display: inline-flex;
}

.cta-btn-desktop {
  width: 100%;
  border-radius: 16px;
  padding: 14px;
  font-weight: 600;
  box-shadow: 0 12px 28px rgba(39, 70, 144, 0.14);
}

.actions {
  margin-top: auto;
  display: flex;
  justify-content: flex-end;
}

.actions--skip :deep(.q-btn) {
  font-weight: 600;
}

.fab-button {
  box-shadow: 0 10px 24px rgba(39, 70, 144, 0.28);
  transition:
    transform 0.2s ease,
    box-shadow 0.2s ease;
  background: linear-gradient(135deg, #274690, #1ca1c1, #7dd3fc);
  background-size: 240% 240%;
  animation: fabShimmer 2.8s ease-in-out infinite;
  position: relative;
  overflow: hidden;
}

.fab-pill {
  border-radius: 999px;
  padding: 14px 28px;
  font-weight: 700;
  letter-spacing: 0.5px;
  text-transform: uppercase;
  color: white;
}

.fab-button :deep(.q-btn__content) {
  gap: 10px;
  font-size: 1rem;
}

.fab-button:hover {
  transform: scale(1.05);
  box-shadow: 0 12px 28px rgba(39, 70, 144, 0.32);
}

.fab-button:active {
  transform: scale(0.96);
  box-shadow: 0 8px 18px rgba(39, 70, 144, 0.25);
}

@keyframes fabShimmer {
  0% {
    background-position: 0% 50%;
  }
  50% {
    background-position: 100% 50%;
    box-shadow: 0 12px 28px rgba(39, 70, 144, 0.34);
  }
  100% {
    background-position: 0% 50%;
  }
}

.fab-button::after {
  content: "";
  position: absolute;
  inset: -12%;
  background:
    radial-gradient(
      10px 10px at 20% 30%,
      rgba(255, 255, 255, 0.6),
      transparent
    ),
    radial-gradient(
      6px 6px at 60% 40%,
      rgba(255, 255, 255, 0.4),
      transparent
    );
  opacity: 0.6;
  pointer-events: none;
}
</style>
