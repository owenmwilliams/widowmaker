<script setup lang="ts">
import { ref, onMounted } from "vue";
import { useRouter } from "vue-router";
import { useQuasar } from "quasar";
import PhotoCapture from "../../components/capture/PhotoCapture.vue";
import { onboardingStore } from "../../stores/OnboardingStore";

const emit = defineEmits<{ "app:loading": (value: boolean) => void }>();
emit("app:loading", false);

const router = useRouter();
const $q = useQuasar();
const store = onboardingStore();
const showCapture = ref(true);
const isPrimaryReady = ref(false);
const userId = ref<string | null>(null);

const queueCapturedItem = (item: any) => {
  const items = Array.isArray(store.importDraft?.items)
    ? [...(store.importDraft.items as any[])]
    : [];

  const itemName = item.label || item.name || "Untitled item";

  items.push({
    name: itemName,
    room: item.collection_label || item.collection || store.selectedRooms[0] || "",
    description: item.description || "",
    notes: item.notes || "",
    quantity: item.qty || 1,
    picture_url: item.picture_url || null,
    material: item.material || "",
    primary_color: item.primaryColor || item.primary_color || "",
  });

  store.setImportDraft({
    source: "capture",
    items,
    created_at: new Date().toISOString(),
  });

  try {
    const summary = {
      name: itemName,
      room: item.collection_label || item.collection || "",
    };
    const summaries = JSON.parse(
      sessionStorage.getItem("onboarding_capture_summary") || "[]",
    );
    summaries.push(summary);
    sessionStorage.setItem("onboarding_capture_summary", JSON.stringify(summaries));
  } catch (error) {
    console.warn("[OnboardingCapture] Failed to persist summary", error);
    sessionStorage.setItem(
      "onboarding_capture_summary",
      JSON.stringify([summary]),
    );
  }
};

const handleItemAdded = (item: any) => {
  queueCapturedItem(item);
  $q.notify({
    type: "positive",
    message: "Item queued. Finish onboarding to save it.",
  });
  router.push({ name: "onboarding-next" });
};

const handleCaptureClose = () => {
  showCapture.value = false;
  router.push({ name: "onboarding-next" });
};

const startOver = () => {
  showCapture.value = true;
};

onMounted(() => {
  if (typeof window !== "undefined") {
    try {
      const raw = localStorage.getItem("user_data");
      if (raw) {
        const parsed = JSON.parse(raw);
        userId.value = parsed?.user_id || parsed?.userId || null;
      }
    } catch (error) {
      console.warn("[OnboardingCapture] Failed to read user_data", error);
    }
  }

  if (!userId.value) {
    $q.notify({ type: "negative", message: "Session expired. Please log in again." });
    router.push({ name: "login" });
    return;
  }

  isPrimaryReady.value = true;
});
</script>

<template>
  <q-layout view="lHh Lpr lFf" class="mobile-capture-layout">
    <q-page-container>
      <q-page class="onboarding-page onboarding-page--mobile">
        <div class="onboarding-card onboarding-card--mobile">

          <div v-if="showCapture && isPrimaryReady" class="capture-frame">
            <PhotoCapture
              :auto-open="true"
              default-capture-mode="single"
              :user="userId || undefined"
              :create-in-inventory="false"
              :collection-options="store.selectedRooms.map((room) => ({ label: room, value: room }))"
              :default-collection-id="store.selectedRooms[0] || null"
              :suppress-direct-prompt="true"
              @item-added="handleItemAdded"
              @close="handleCaptureClose"
            />
          </div>

          <div v-else class="capture-placeholder">
            <q-spinner color="primary" size="42px" />
            <div class="text-caption q-mt-sm">Preparing camera...</div>
          </div>
        </div>
      </q-page>
    </q-page-container>
  </q-layout>
</template>

<style scoped>
.mobile-capture-layout {
  background: #f8f9fd;
}

.capture-frame {
  margin-top: 24px;
  border-radius: 24px;
  overflow: hidden;
  box-shadow: 0 18px 40px rgba(15, 23, 42, 0.15);
  border: 1px solid rgba(148, 163, 184, 0.4);
}

.confirm-card {
  margin-top: 24px;
  padding: 16px;
  border-radius: 18px;
  background: rgba(46, 189, 133, 0.1);
  border: 1px solid rgba(46, 189, 133, 0.3);
}

.confirm-header {
  text-align: center;
  margin-bottom: 16px;
}

.confirm-title {
  font-size: 1.1rem;
  font-weight: 600;
  margin-top: 8px;
}

.confirm-sub {
  font-size: 0.9rem;
  color: #065f46;
}

.confirm-details {
  margin-top: 12px;
}

.confirm-row {
  display: flex;
  justify-content: space-between;
  padding: 8px 0;
  border-bottom: 1px solid rgba(46, 189, 133, 0.2);
}

.confirm-row:last-child {
  border-bottom: none;
}

.label {
  font-weight: 600;
  color: #065f46;
}

.value {
  color: #0f172a;
  font-weight: 500;
  text-align: right;
}

.confirm-actions {
  margin-top: 16px;
  display: flex;
  justify-content: space-between;
}

.capture-placeholder {
  margin-top: 32px;
  padding: 24px;
  display: flex;
  flex-direction: column;
  align-items: center;
  border-radius: 16px;
  border: 1px dashed rgba(148, 163, 184, 0.5);
  color: #475569;
}

.eyebrow {
  text-transform: uppercase;
  letter-spacing: 0.3em;
  font-size: 0.7rem;
  color: #94a3b8;
}

.onboarding-page--mobile {
  padding: 16px;
}
</style>
