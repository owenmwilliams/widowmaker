<script setup lang="ts">
import { ref, onMounted, computed } from "vue";
import { useRouter } from "vue-router";
import { useQuasar } from "quasar";
import { onboardingStore } from "../../stores/OnboardingStore";
import { storeToRefs } from "pinia";

const emit = defineEmits<{ "app:loading": (value: boolean) => void }>();
emit("app:loading", false);

const router = useRouter();
const $q = useQuasar();
const store = onboardingStore();
const { uploadProgress } = storeToRefs(store);
const importSummary = ref<any | null>(null);
const captureSummary = ref<any | null>(null);
const isSubmitting = ref(false);

// Computed button label based on upload state
const completeButtonLabel = computed(() => {
  if (!isSubmitting.value) {
    return 'Create your inventory';
  }

  if (uploadProgress.value.percentage === 100) {
    return 'Complete!';
  }

  // During upload, only show percentage
  return `${uploadProgress.value.percentage}%`;
});

// Show icon only when idle or complete
const completeButtonIcon = computed(() => {
  if (!isSubmitting.value || uploadProgress.value.percentage === 100) {
    return 'arrow_forward';
  }
  return undefined;
});

onMounted(() => {
  if (typeof window === "undefined") return;
  const raw = sessionStorage.getItem("onboarding_import_summary");
  if (raw) {
    try {
      importSummary.value = JSON.parse(raw);
    } catch (error) {
      console.warn("[OnboardingNext] Failed to parse import summary", error);
    }
    sessionStorage.removeItem("onboarding_import_summary");
  }

  const captureRaw = sessionStorage.getItem("onboarding_capture_summary");
  if (captureRaw) {
    try {
      captureSummary.value = JSON.parse(captureRaw);
    } catch (error) {
      console.warn("[OnboardingNext] Failed to parse capture summary", error);
    }
    sessionStorage.removeItem("onboarding_capture_summary");
  }
});

const isMobilePlatform = () => typeof window !== "undefined" && /Mobi|Android/i.test(navigator.userAgent);

const finalizeAndNavigate = async (navigate: () => void) => {
  if (isSubmitting.value) return;
  isSubmitting.value = true;
  try {
    await store.finalizeOnboarding();
    navigate();
  } catch (error: any) {
    console.error("[OnboardingNext] Finalization failed", error);
    const message = error?.response?.data?.error || "Unable to finish onboarding";
    $q.notify({ type: "negative", message });
  } finally {
    isSubmitting.value = false;
  }
};

const goAddLocation = () => {
  finalizeAndNavigate(() => {
    if (isMobilePlatform()) {
      router.push({ name: "mobile-settings" });
    } else {
      if (typeof window !== "undefined") {
        localStorage.setItem("desktop_onboarding_target", "settings");
      }
      router.push({ name: "items" });
    }
  });
};

const launchCapture = (mode: "single" | "multi") => {
  if (typeof window !== "undefined") {
    localStorage.setItem("launch_capture_mode", mode);
    localStorage.setItem("launch_capture_auto", "true");
  }
  if (isMobilePlatform()) {
    router.push({ name: "mobile-locations" });
  } else {
    router.push({ name: "items" });
  }
};

const goAddItem = () => {
  finalizeAndNavigate(() => launchCapture("single"));
};

const goAddMultiple = () => {
  finalizeAndNavigate(() => launchCapture("multi"));
};

const handleComplete = async () => {
  if (isSubmitting.value) return;

  isSubmitting.value = true;
  try {
    await store.finalizeOnboarding();

    // Add 750ms delay at 100% to reinforce completion
    if (uploadProgress.value.percentage === 100) {
      await new Promise(resolve => setTimeout(resolve, 750));
    }

    router.push({ name: isMobilePlatform() ? "mobile-locations" : "items" });
  } catch (error: any) {
    console.error("[OnboardingNext] Finalization failed", error);
    const message = error?.response?.data?.error || "Unable to finish onboarding";
    $q.notify({ type: "negative", message });
    isSubmitting.value = false;
  }
};
</script>

<template>
  <q-layout view="lHh Lpr lFf">
    <q-page-container>
      <q-page :class="['onboarding-page', { 'onboarding-page--mobile': isMobilePlatform() }]">
        <div :class="['onboarding-card', { 'onboarding-card--mobile': isMobilePlatform() }]">
        <div class="eyebrow">Step 4 of 4</div>
      <h2>You’re ready to build</h2>
      <p class="lede">
        Choose the next thing you’d like to tackle. You can always return to this checklist from Settings → Onboarding.
      </p>

      <div v-if="captureSummary?.length" class="capture-card q-mb-lg">
        <div class="capture-header">
          <q-icon name="check_circle" color="positive" size="32px" />
          <div>
            <div class="capture-title">Item captured</div>
            <div class="capture-sub">Saved for onboarding</div>
          </div>
        </div>
        <div class="capture-details">
          <div
            v-for="(summary, index) in captureSummary"
            :key="index"
            class="detail-block"
          >
            <div class="detail-label">Name</div>
            <div class="detail-value">{{ summary.name || "Untitled item" }}</div>
            <div class="detail-label q-mt-xs" v-if="summary.room">Room</div>
            <div class="detail-value" v-if="summary.room">
              {{ summary.room }}
            </div>
            <q-separator v-if="index < captureSummary.length - 1" spaced />
          </div>
        </div>
      </div>

      <div v-if="importSummary" class="success-card q-mb-lg">
        <div class="success-title">Import queued</div>
        <div class="success-grid">
          <div>
            <div class="metric">{{ importSummary.summary?.created_items ?? 0 }}</div>
            <div class="metric-label">Items added</div>
          </div>
          <div>
            <div class="metric">{{ importSummary.summary?.created_collections ?? 0 }}</div>
            <div class="metric-label">Collections created</div>
          </div>
          <div>
            <div class="metric">{{ importSummary.summary?.created_containers ?? 0 }}</div>
            <div class="metric-label">Containers created</div>
          </div>
        </div>
        <div class="success-note">
          These items will be created when you finish onboarding. Pick your next step below.
        </div>
      </div>

      <div class="actions actions--primary">
        <q-btn
          class="fab-button fab-pill progress-btn"
          :class="{ 'progress-btn--complete': uploadProgress.percentage === 100 }"
          unelevated
          :disable="isSubmitting"
          :style="{
            '--progress-percentage': `${uploadProgress.percentage}%`
          }"
          @click="handleComplete"
        >
          <div class="button-content">
            <span class="button-label">{{ completeButtonLabel }}</span>
            <q-icon v-if="completeButtonIcon" :name="completeButtonIcon" size="20px" />
          </div>
        </q-btn>
      </div>

      <div class="action-grid">
        <q-card
          class="action-card"
          :class="{ 'action-card--disabled': isSubmitting }"
          :clickable="!isSubmitting"
          @click="goAddLocation"
        >
          <q-icon name="place" size="32px" color="primary" />
          <div class="action-title">Add another location</div>
          <div class="action-subtext">Need a storage unit or second home? Set it up next.</div>
        </q-card>

        <q-card
          class="action-card"
          :class="{ 'action-card--disabled': isSubmitting }"
          :clickable="!isSubmitting"
          @click="goAddItem"
        >
          <q-icon name="add_a_photo" size="32px" color="primary" />
          <div class="action-title">Snap a photo to add another item</div>
          <div class="action-subtext">Launch the camera for a single-item capture.</div>
        </q-card>

        <q-card
          class="action-card"
          :class="{ 'action-card--disabled': isSubmitting }"
          :clickable="!isSubmitting"
          @click="goAddMultiple"
        >
          <q-icon name="collections" size="32px" color="primary" />
          <div class="action-title">Or add multiple items at once</div>
          <div class="action-subtext">Use multi-item capture to process a batch.</div>
        </q-card>
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
  background: #f1f5f9;
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
}

.action-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 16px;
  margin-top: 48px;
}

.action-card {
  padding: 20px;
  border-radius: 16px;
  border: 1px solid rgba(99, 102, 241, 0.15);
  cursor: pointer;
}

.action-card--disabled {
  opacity: 0.6;
  pointer-events: none;
}

.action-title {
  font-weight: 600;
  margin-top: 12px;
}

.action-subtext {
  color: #64748b;
  margin-top: 4px;
}

.success-card {
  border-radius: 16px;
  padding: 16px;
  background: rgba(46, 189, 133, 0.12);
  border: 1px solid rgba(46, 189, 133, 0.3);
}

.success-title {
  font-weight: 600;
  margin-bottom: 12px;
  color: #065f46;
}

.success-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 24px;
}

.metric {
  font-size: 1.6rem;
  font-weight: 700;
  color: #047857;
}

.metric-label {
  text-transform: uppercase;
  letter-spacing: 0.08em;
  font-size: 0.75rem;
  color: #047857;
}

.success-note {
  margin-top: 12px;
  color: #065f46;
  font-weight: 500;
}

.capture-card {
  border-radius: 16px;
  padding: 16px;
  border: 1px solid rgba(59, 83, 255, 0.25);
  background: rgba(59, 83, 255, 0.08);
}

.capture-header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
}

.capture-title {
  font-weight: 600;
  color: #1f2a44;
}

.capture-sub {
  font-size: 0.85rem;
  color: #475569;
}

.capture-details {
  border-top: 1px solid rgba(71, 85, 105, 0.2);
  padding-top: 12px;
}

.detail-block + .detail-block {
  margin-top: 12px;
}

.detail-label {
  font-size: 0.85rem;
  text-transform: uppercase;
  color: #475569;
}

.detail-value {
  font-size: 1rem;
  font-weight: 600;
  color: #111827;
}

.actions {
  display: flex;
  justify-content: flex-end;
  margin-top: 40px;
}

.actions--primary {
  justify-content: center;
  margin-top: 24px;
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
  overflow: visible;
}

.fab-pill {
  border-radius: 999px;
  padding: 14px 28px;
  font-weight: 700;
  letter-spacing: 0.5px;
  text-transform: uppercase;
  color: white;
  /* Fixed size to prevent layout shift */
  min-width: 400px;
  min-height: 56px;
}

.fab-button :deep(.q-btn__content) {
  gap: 10px;
  font-size: 1rem;
}

/* Custom button content layout */
.button-content {
  display: flex;
  align-items: center;
  gap: 12px;
  justify-content: center;
  width: 100%;
}

.button-label {
  flex: 0 0 auto;
  white-space: nowrap;
  /* Large font for percentage during upload */
  font-size: 1.2rem;
}

.fab-button:hover {
  transform: scale(1.05);
  box-shadow: 0 12px 28px rgba(39, 70, 144, 0.32);
}

.fab-button:active {
  transform: scale(0.96);
  box-shadow: 0 8px 18px rgba(39, 70, 144, 0.25);
}

/* Progress border animation */
.progress-btn {
  --progress-percentage: 0%;
  transition: background 0.5s ease;
}

.progress-btn::after {
  content: '';
  position: absolute;
  inset: -4px;
  border-radius: inherit;
  background: conic-gradient(
    from 0deg at 50% 50%,
    #1ca1c1 0%,
    #1ca1c1 var(--progress-percentage),
    transparent var(--progress-percentage),
    transparent 100%
  );
  -webkit-mask: linear-gradient(#fff 0 0) content-box,
               linear-gradient(#fff 0 0);
  -webkit-mask-composite: xor;
  mask-composite: exclude;
  padding: 4px;
  opacity: 0;
  transition: opacity 0.2s ease, background 0.5s ease;
  pointer-events: none;
  z-index: -1;
}

.progress-btn[style*="--progress-percentage"]:not([style*="--progress-percentage: 0%"])::after {
  opacity: 1;
}

/* Complete state - teal button and border */
.progress-btn--complete {
  background: #1ca1c1 !important;
  animation: none !important;
}

.progress-btn--complete::after {
  background: #1ca1c1 !important;
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
