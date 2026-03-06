<script setup lang="ts">
import { ref, computed, onUnmounted } from 'vue';
import { useQuasar } from 'quasar';
import axios from 'axios';
import { inventoryStore } from '../stores/InventoryStore';

const props = defineProps<{
  user: string;
  effectivePlan: 'basic' | 'pro';
  visionProvider?: string;
}>();

const emit = defineEmits<{
  close: [];
  'items-added': [];
}>();

const $q = useQuasar();
const store = inventoryStore();

const API_BASE =
  import.meta.env.MODE === 'development'
    ? 'http://localhost:3050'
    : 'https://movetrack-api-7hwn7ggbiq-uc.a.run.app';

const buildHeaders = (): Record<string, string> => {
  const token = localStorage.getItem('session_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
};

// ── Step machine ──────────────────────────────────────────────────────────────
type Step = 'guide' | 'record' | 'processing' | 'review';
const step = ref<Step>('guide');

// ── Step 2: Record ────────────────────────────────────────────────────────────
const selectedFile = ref<File | null>(null);
const videoObjectUrl = ref<string | null>(null);
const uploadError = ref<string | null>(null);

// ── Step 3: Processing ────────────────────────────────────────────────────────
const uploadProgress = ref(0);
const processingMessage = ref('');
const processingError = ref<string | null>(null);

const scanMessages = [
  'Uploading video...',
  'Scanning for household items...',
  'Identifying furniture and belongings...',
  'Cataloging items room by room...',
  'Building your inventory list...',
  'Almost there...',
];

let messageTimer: ReturnType<typeof setInterval> | null = null;

// ── Step 4: Review ────────────────────────────────────────────────────────────
type DetectedItem = {
  id: number;
  name: string;
  quantity: number;
  room: string;
  notes: string;
  include: boolean;
  collectionId: string;
  thumbnailUrl?: string | null;
};

const detectedItems = ref<DetectedItem[]>([]);
const videoGcsUrl = ref<string | null>(null);

// ── Confirm ───────────────────────────────────────────────────────────────────
const confirming = ref(false);
const confirmProgress = ref(0);
const confirmTotal = ref(0);
const confirmDone = ref(false);

// ── Computed ──────────────────────────────────────────────────────────────────
const collections = computed(() => store.collections);

const includedDetectedItems = computed(() => detectedItems.value.filter((i) => i.include));

const totalToAdd = computed(() => includedDetectedItems.value.length);


// ── File selection ────────────────────────────────────────────────────────────
const handleFileChange = (event: Event) => {
  const input = event.target as HTMLInputElement;
  if (input.files?.[0]) {
    selectedFile.value = input.files[0];
    uploadError.value = null;
    if (videoObjectUrl.value) URL.revokeObjectURL(videoObjectUrl.value);
    videoObjectUrl.value = URL.createObjectURL(input.files[0]);
  }
};

const triggerFileInput = () => {
  const input = document.getElementById('video-scan-input') as HTMLInputElement;
  input?.click();
};

// ── Processing flow ───────────────────────────────────────────────────────────
// Single request: upload → GCS → Gemini analysis → thumbnails → response.
const startProcessing = async () => {
  if (!selectedFile.value) return;
  step.value = 'processing';
  processingError.value = null;
  uploadProgress.value = 0;

  let msgIdx = 0;
  processingMessage.value = scanMessages[msgIdx];
  messageTimer = setInterval(() => {
    msgIdx = (msgIdx + 1) % scanMessages.length;
    processingMessage.value = scanMessages[msgIdx];
  }, 3000);

  try {
    const formData = new FormData();
    formData.append('video', selectedFile.value);

    const res = await axios.post(
      `${API_BASE}/video-12labs/upload`,
      formData,
      {
        headers: { ...buildHeaders(), 'Content-Type': 'multipart/form-data' },
        timeout: 10 * 60 * 1000, // 10 min to match Cloud Run timeout
        onUploadProgress: (evt) => {
          if (evt.total) uploadProgress.value = Math.round((evt.loaded / evt.total) * 100);
        },
      },
    );

    stopTimers();

    const items: any[] = res.data.items || [];
    videoGcsUrl.value = res.data.video_signed_url || null;

    if (res.data.thumbnail_debug) {
      console.log('[VideoInventoryScan] Thumbnail debug:', JSON.stringify(res.data.thumbnail_debug, null, 2));
    }
    const thumbCount = items.filter((i: any) => i.thumbnailUrl).length;
    console.log(`[VideoInventoryScan] ${thumbCount}/${items.length} items have thumbnailUrl`);

    detectedItems.value = items.map((item, idx) => {
      const roomLower = (item.room || '').trim().toLowerCase();
      const matchedCol = collections.value.find(
        (c) =>
          c.label.toLowerCase().includes(roomLower) ||
          roomLower.includes(c.label.toLowerCase()),
      );
      return {
        id: idx,
        name: item.name || 'Unknown item',
        quantity: item.quantity || 1,
        room: item.room || '',
        notes: item.notes || '',
        include: true,
        collectionId: matchedCol?.value || collections.value[0]?.value || '',
        thumbnailUrl: item.thumbnailUrl || null,
      };
    });

    step.value = 'review';
  } catch (err: any) {
    stopTimers();
    processingError.value = err?.response?.data?.error || err?.message || 'Analysis failed';
  }
};

const stopTimers = () => {
  if (messageTimer) {
    clearInterval(messageTimer);
    messageTimer = null;
  }
};

const retryProcessing = () => {
  processingError.value = null;
  step.value = 'record';
  uploadProgress.value = 0;
};

// ── Review helpers ────────────────────────────────────────────────────────────
const incrementQty = (item: DetectedItem) => {
  item.quantity = Math.min(99, item.quantity + 1);
};
const decrementQty = (item: DetectedItem) => {
  item.quantity = Math.max(1, item.quantity - 1);
};

// ── Confirm ───────────────────────────────────────────────────────────────────
const confirmItems = async () => {
  if (totalToAdd.value === 0) return;
  confirming.value = true;
  confirmProgress.value = 0;
  confirmTotal.value = totalToAdd.value;

  const allItems = includedDetectedItems.value.map((i) => ({
    name: i.name,
    notes: i.notes,
    quantity: i.quantity,
    collection: i.collectionId,
  }));

  for (const item of allItems) {
    try {
      await store.createItem(
        props.user,
        item.name,
        '',
        item.quantity,
        item.collection,
        undefined,
        undefined,
        null,
        false,
        undefined,
        null,
        null,
        null,
        null,
        item.notes || undefined,
        undefined,
        undefined,
        [],
        { skipRedirect: true },
      );
    } catch (err) {
      console.error('[VideoInventoryScan] Failed to create item:', err);
    }
    confirmProgress.value++;
  }

  await store.loadInventory(props.user);
  confirming.value = false;
  confirmDone.value = true;

  $q.notify({
    type: 'positive',
    message: `${totalToAdd.value} item${totalToAdd.value !== 1 ? 's' : ''} added to your inventory!`,
    position: 'bottom',
  });

  emit('items-added');
};

onUnmounted(() => {
  stopTimers();
  if (videoObjectUrl.value) URL.revokeObjectURL(videoObjectUrl.value);
});
</script>

<template>
  <div class="video-scan-wrap">

    <!-- ── STEP 1: Guide ──────────────────────────────────────────────────────── -->
    <div v-if="step === 'guide'" class="step-container">
      <div class="step-eyebrow">Video Scan</div>
      <h2 class="step-heading">How to get the best results</h2>
      <p class="step-subheading">Follow these tips before you start recording.</p>

      <div class="tip-list">
        <div class="tip-card">
          <div class="tip-icon-wrap">
            <q-icon name="crop_free" size="28px" color="primary" />
          </div>
          <div class="tip-body">
            <div class="tip-title">One area at a time</div>
            <div class="tip-desc">Focus each video on a single area: one wall, one closet, one set of shelves. 10–15 seconds per area works best.</div>
          </div>
        </div>

        <div class="tip-card">
          <div class="tip-icon-wrap">
            <q-icon name="replay" size="28px" color="primary" />
          </div>
          <div class="tip-body">
            <div class="tip-title">Dense spaces need multiple scans</div>
            <div class="tip-desc">Closets, shelves, and packed cabinets need their own dedicated video. Plan on 2–3 scans per room.</div>
          </div>
        </div>

        <div class="tip-card">
          <div class="tip-icon-wrap">
            <q-icon name="center_focus_strong" size="28px" color="primary" />
          </div>
          <div class="tip-body">
            <div class="tip-title">Move slowly and pause</div>
            <div class="tip-desc">Walk slowly and hold the camera still on each item for 1–2 seconds. Blurry or fast movement will be missed.</div>
          </div>
        </div>
      </div>

      <div class="step-actions">
        <q-btn
          class="fab-button fab-pill"
          label="Got it — Start Recording"
          icon-right="arrow_forward"
          unelevated
          @click="step = 'record'"
        />
        <q-btn flat color="grey-6" label="Cancel" @click="emit('close')" />
      </div>
    </div>

    <!-- ── STEP 2: Record ─────────────────────────────────────────────────────── -->
    <div v-else-if="step === 'record'" class="step-container">
      <div class="step-eyebrow">Step 1 of 2</div>
      <h2 class="step-heading">Select your video</h2>
      <p class="step-subheading">Record a video or choose one from your library.</p>

      <input
        id="video-scan-input"
        type="file"
        accept="video/*"
        capture="environment"
        style="display: none"
        @change="handleFileChange"
      />

      <div
        class="drop-zone"
        :class="{ 'drop-zone--has-file': !!selectedFile }"
        @click="triggerFileInput"
      >
        <template v-if="!selectedFile">
          <q-icon name="videocam" size="52px" color="primary" class="q-mb-sm" />
          <div class="drop-label">Tap to record or choose a video</div>
          <div class="drop-sub">MP4, MOV, or AVI · Max 500 MB</div>
        </template>
        <template v-else>
          <video
            v-if="videoObjectUrl"
            :src="videoObjectUrl"
            class="video-preview"
            muted
            playsinline
            preload="metadata"
          />
          <div class="file-info">
            <q-icon name="check_circle" color="positive" size="20px" class="q-mr-xs" />
            <span class="file-name">{{ selectedFile.name }}</span>
            <span class="file-size q-ml-xs text-grey-6">
              ({{ (selectedFile.size / 1024 / 1024).toFixed(1) }} MB)
            </span>
          </div>
        </template>
      </div>

      <q-banner v-if="selectedFile && selectedFile.size > 500 * 1024 * 1024" class="bg-red-1 text-red-9 q-mt-sm" dense>
        File exceeds 500 MB. Please use a shorter clip.
      </q-banner>

      <q-banner v-if="uploadError" class="bg-red-1 text-red-9 q-mt-sm" dense icon="error">
        {{ uploadError }}
      </q-banner>

      <div class="step-actions">
        <q-btn
          class="fab-button fab-pill"
          label="Upload & Analyze"
          icon-right="auto_awesome"
          unelevated
          :disable="!selectedFile || (!!selectedFile && selectedFile.size > 500 * 1024 * 1024)"
          @click="startProcessing"
        />
        <q-btn flat color="grey-6" label="Back" icon="arrow_back" @click="step = 'guide'" />
      </div>
    </div>

    <!-- ── STEP 3: Processing ─────────────────────────────────────────────────── -->
    <div v-else-if="step === 'processing'" class="step-container step-container--centered">
      <template v-if="!processingError">
        <q-icon name="smart_toy" size="48px" color="primary" class="q-mb-md" />
        <h2 class="step-heading">Analyzing your video</h2>
        <p class="step-subheading">
          AI is cataloging every item it sees. This usually takes 30–60 seconds.
        </p>

        <div v-if="uploadProgress < 100" class="q-mb-md upload-progress-wrap">
          <div class="text-caption text-grey-6 q-mb-xs">Uploading… {{ uploadProgress }}%</div>
          <q-linear-progress :value="uploadProgress / 100" color="primary" rounded style="height: 6px" />
        </div>

        <div v-else class="scanning-wrap q-mb-md">
          <div class="scanning-bar"></div>
        </div>

        <div class="scan-message text-primary text-weight-medium q-mb-xs">
          <q-icon name="radar" class="q-mr-xs" />
          {{ processingMessage }}
        </div>
      </template>

      <template v-else>
        <q-icon name="error_outline" size="48px" color="negative" class="q-mb-md" />
        <h2 class="step-heading">Something went wrong</h2>
        <p class="step-subheading text-red-7">{{ processingError }}</p>
        <q-btn
          class="fab-button fab-pill q-mt-md"
          label="Try Again"
          icon="refresh"
          unelevated
          @click="retryProcessing"
        />
      </template>
    </div>

    <!-- ── STEP 4: Review ─────────────────────────────────────────────────────── -->
    <div v-else-if="step === 'review'" class="step-container step-container--review">
      <div class="step-eyebrow">Step 2 of 2</div>
      <h2 class="step-heading">Review detected items</h2>
      <p class="step-subheading">
        {{ detectedItems.length }} item{{ detectedItems.length !== 1 ? 's' : '' }} found.
        Uncheck anything that shouldn't be added, then confirm.
      </p>

      <!-- Detected items list -->
      <div class="items-list q-mb-md">
        <div
          v-for="item in detectedItems"
          :key="item.id"
          class="item-row"
          :class="{ 'item-row--excluded': !item.include }"
        >
          <q-checkbox v-model="item.include" color="primary" dense class="q-mr-sm" />

          <div class="item-thumbnail q-mr-sm">
            <img
              v-if="item.thumbnailUrl"
              :src="item.thumbnailUrl"
              class="thumbnail-img"
              alt=""
            />
            <div v-else class="thumbnail-placeholder">
              <q-icon name="videocam" size="20px" color="grey-4" />
            </div>
          </div>

          <div class="item-fields">
            <q-input
              v-model="item.name"
              dense
              borderless
              :disable="!item.include"
              class="item-name-input"
            />

            <div class="item-meta">
              <div class="qty-control">
                <q-btn
                  flat dense round icon="remove" size="xs" color="grey-6"
                  :disable="!item.include || item.quantity <= 1"
                  @click="decrementQty(item)"
                />
                <span class="qty-value">{{ item.quantity }}</span>
                <q-btn
                  flat dense round icon="add" size="xs" color="grey-6"
                  :disable="!item.include"
                  @click="incrementQty(item)"
                />
              </div>

              <q-select
                v-model="item.collectionId"
                :options="collections"
                option-value="value"
                option-label="label"
                emit-value
                map-options
                dense
                borderless
                :disable="!item.include"
                class="item-collection-select"
              />
            </div>
          </div>
        </div>

        <div v-if="detectedItems.length === 0" class="no-items-msg">
          No items were detected. Try adding items manually below.
        </div>
      </div>

      <!-- Post-confirm GCS video link -->
      <div v-if="confirmDone && videoGcsUrl" class="gcs-video-link q-mb-sm">
        <q-icon name="videocam" size="16px" color="primary" class="q-mr-xs" />
        <a :href="videoGcsUrl" target="_blank" rel="noopener" class="gcs-link">View room scan video</a>
      </div>

      <!-- Confirm progress -->
      <div v-if="confirming" class="confirm-progress q-mb-md">
        <div class="text-caption text-grey-7 q-mb-xs">
          Adding items… {{ confirmProgress }} / {{ confirmTotal }}
        </div>
        <q-linear-progress
          :value="confirmTotal > 0 ? confirmProgress / confirmTotal : 0"
          color="primary"
          rounded
          style="height: 8px"
        />
      </div>

      <div class="step-actions">
        <q-btn
          class="fab-button fab-pill"
          :label="totalToAdd > 0 ? `Confirm & Add ${totalToAdd} item${totalToAdd !== 1 ? 's' : ''}` : 'Nothing selected'"
          icon-right="check"
          unelevated
          :disable="totalToAdd === 0 || confirming"
          :loading="confirming"
          @click="confirmItems"
        />
        <q-btn flat color="grey-6" label="Cancel" @click="emit('close')" />
      </div>
    </div>

  </div>
</template>

<style scoped>
.video-scan-wrap {
  width: 100%;
  max-width: 680px;
  height: 100vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* ── Step containers ─────────────────────────────────────────────────────────── */
.step-container {
  flex: 1;
  padding: 24px 20px 16px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-height: 0;
}

.step-container--centered {
  align-items: center;
  text-align: center;
}

.step-container--review {
  /* items-list scrolls, actions stay pinned */
}

.step-eyebrow {
  text-transform: uppercase;
  letter-spacing: 0.3em;
  font-size: 0.68rem;
  color: #94a3b8;
  margin-bottom: 4px;
}

.step-heading {
  font-size: 1.5rem;
  font-weight: 700;
  color: #0f172a;
  margin: 0 0 6px;
}

.step-subheading {
  font-size: 0.9rem;
  color: #64748b;
  margin: 0 0 24px;
  line-height: 1.5;
}

/* ── Tips ────────────────────────────────────────────────────────────────────── */
.tip-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-bottom: 28px;
}

.tip-card {
  display: flex;
  align-items: flex-start;
  gap: 16px;
  background: #f8faff;
  border: 1px solid #e0e7ff;
  border-radius: 12px;
  padding: 16px;
}

.tip-icon-wrap {
  flex-shrink: 0;
  width: 48px;
  height: 48px;
  background: #eff2ff;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.tip-title {
  font-weight: 700;
  font-size: 0.95rem;
  color: #1e293b;
  margin-bottom: 2px;
}

.tip-desc {
  font-size: 0.85rem;
  color: #64748b;
  line-height: 1.45;
}

/* ── Drop zone ───────────────────────────────────────────────────────────────── */
.drop-zone {
  border: 2px dashed #c7d2fe;
  border-radius: 16px;
  background: #f8f9ff;
  min-height: 180px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: border-color 0.2s, background 0.2s;
  padding: 24px;
  margin-bottom: 20px;
  gap: 6px;
}

.drop-zone:hover {
  border-color: #6366f1;
  background: #eff0ff;
}

.drop-zone--has-file {
  border-color: #6366f1;
  background: #f0fdf4;
  border-style: solid;
}

.drop-label {
  font-weight: 600;
  font-size: 1rem;
  color: #334155;
}

.drop-sub {
  font-size: 0.8rem;
  color: #94a3b8;
}

.video-preview {
  width: 100%;
  max-height: 160px;
  object-fit: contain;
  border-radius: 8px;
  margin-bottom: 10px;
  background: #000;
}

.file-info {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  justify-content: center;
}

.file-name {
  font-weight: 600;
  font-size: 0.875rem;
  color: #1e293b;
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.file-size {
  font-size: 0.8rem;
}

/* ── Scanning animation ──────────────────────────────────────────────────────── */
.scanning-wrap {
  width: 100%;
  max-width: 380px;
  height: 4px;
  background: #e2e8f0;
  border-radius: 2px;
  overflow: hidden;
  position: relative;
}

.scanning-bar {
  position: absolute;
  top: 0;
  left: 0;
  height: 100%;
  width: 30%;
  background: linear-gradient(
    90deg,
    transparent,
    rgba(99, 102, 241, 0.5),
    #6366f1,
    rgba(99, 102, 241, 0.5),
    transparent
  );
  animation: scanning 2s ease-in-out infinite;
}

@keyframes scanning {
  0% { transform: translateX(-200%); }
  100% { transform: translateX(500%); }
}

.scan-message {
  font-size: 0.875rem;
  min-height: 22px;
}

.upload-progress-wrap {
  width: 100%;
  max-width: 380px;
}

/* ── Review items list ───────────────────────────────────────────────────────── */
.items-list {
  flex: 1;
  min-height: 0;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
}

.item-row {
  display: flex;
  align-items: center;
  padding: 10px 14px;
  border-bottom: 1px solid #f1f5f9;
  transition: background 0.15s;
}

.item-row:last-child {
  border-bottom: none;
}

.item-row--excluded {
  opacity: 0.4;
}

.item-fields {
  flex: 1;
  min-width: 0;
}

.item-name-input {
  font-weight: 600;
  font-size: 0.9rem;
  color: #1e293b;
}

.item-name-input :deep(.q-field__native) {
  padding: 0;
}

.item-meta {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-top: 2px;
}

.qty-control {
  display: flex;
  align-items: center;
  gap: 4px;
}

.qty-value {
  font-size: 0.85rem;
  font-weight: 700;
  color: #334155;
  min-width: 20px;
  text-align: center;
}

.item-collection-select {
  min-width: 140px;
}

.item-collection-select :deep(.q-field__native) {
  font-size: 0.8rem;
  color: #64748b;
  padding: 0;
}

.no-items-msg {
  padding: 24px;
  text-align: center;
  color: #94a3b8;
  font-size: 0.875rem;
}

/* ── Additional items ────────────────────────────────────────────────────────── */
.section-label {
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: #94a3b8;
  margin-bottom: 8px;
}

.additional-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.additional-item {
  display: flex;
  align-items: center;
  background: #f0fdf4;
  border: 1px solid #bbf7d0;
  border-radius: 999px;
  padding: 4px 12px;
  font-size: 0.85rem;
  color: #166534;
  font-weight: 500;
}

.add-photo-btn {
  align-self: flex-start;
  font-size: 0.875rem;
}

/* ── Actions bar ─────────────────────────────────────────────────────────────── */
.step-actions {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 8px;
  padding-top: 12px;
  margin-top: auto;
}

.step-actions .fab-button {
  width: 100%;
}

/* ── FAB button (matches app-wide style) ─────────────────────────────────────── */
.fab-button {
  box-shadow: 0 10px 24px rgba(39, 70, 144, 0.28);
  transition: transform 0.2s ease, box-shadow 0.2s ease;
  background: linear-gradient(135deg, #274690, #1ca1c1, #7dd3fc);
  background-size: 240% 240%;
  animation: fabShimmer 2.8s ease-in-out infinite;
  position: relative;
  overflow: hidden;
}

.fab-pill {
  border-radius: 999px;
  padding: 10px 24px;
  font-weight: 700;
  letter-spacing: 0.5px;
  text-transform: uppercase;
  color: white;
}

.fab-button :deep(.q-btn__content) {
  gap: 10px;
  font-size: 0.9rem;
}

.fab-button:hover {
  transform: scale(1.04);
  box-shadow: 0 12px 28px rgba(39, 70, 144, 0.32);
}

.fab-button:active {
  transform: scale(0.96);
}

@keyframes fabShimmer {
  0% { background-position: 0% 50%; }
  50% { background-position: 100% 50%; box-shadow: 0 12px 28px rgba(39, 70, 144, 0.34); }
  100% { background-position: 0% 50%; }
}

.fab-button::after {
  content: "";
  position: absolute;
  inset: -12%;
  background:
    radial-gradient(10px 10px at 20% 30%, rgba(255, 255, 255, 0.6), transparent),
    radial-gradient(6px 6px at 60% 40%, rgba(255, 255, 255, 0.4), transparent);
  opacity: 0.6;
  pointer-events: none;
}

/* ── Item thumbnail ──────────────────────────────────────────────────────────── */
.item-thumbnail {
  flex-shrink: 0;
}

.thumbnail-img {
  width: 48px;
  height: 48px;
  border-radius: 8px;
  object-fit: cover;
  display: block;
}

.thumbnail-placeholder {
  width: 48px;
  height: 48px;
  border-radius: 8px;
  background: #f1f5f9;
  display: flex;
  align-items: center;
  justify-content: center;
}

/* ── GCS video link ──────────────────────────────────────────────────────────── */
.gcs-video-link {
  display: flex;
  align-items: center;
  font-size: 0.85rem;
}

.gcs-link {
  color: #6366f1;
  text-decoration: none;
  font-weight: 500;
}

.gcs-link:hover {
  text-decoration: underline;
}

.confirm-progress {
  width: 100%;
}
</style>
