<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { useQuasar } from 'quasar';
import axios from 'axios';

type InventoryItem = {
  name: string;
  quantity: number;
  room: string;
  notes: string;
};

type SessionStatus = 'idle' | 'uploading' | 'indexing' | 'done' | 'failed';

const $q = useQuasar();

const API_BASE =
  import.meta.env.MODE === 'development'
    ? 'http://localhost:3050'
    : 'https://movetrack-api-7hwn7ggbiq-uc.a.run.app';

const buildHeaders = () => {
  const token = localStorage.getItem('session_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
};

// ── State ──────────────────────────────────────────────────────────────────────
const sessionStatus = ref<SessionStatus>('idle');
const selectedFile = ref<File | null>(null);
const uploadProgress = ref(0);
const uploadError = ref<string | null>(null);
const indexingElapsed = ref(0);

const prompt = ref('');
const promptLoading = ref(false);

const items = ref<InventoryItem[]>([]);
const visibleItemCount = ref(0);
const rawAnalysis = ref<string | null>(null);
const parseError = ref<string | null>(null);
const showRaw = ref(false);

const scanningMessages = [
  'Analyzing video content with Gemini...',
  'Detecting objects in living spaces...',
  'Identifying furniture and belongings...',
  'Processing room layouts...',
  'Generating inventory summary...'
];
const currentScanMessage = ref(scanningMessages[0]);
let scanMessageInterval: ReturnType<typeof setInterval> | null = null;
let elapsedTimer: ReturnType<typeof setInterval> | null = null;

// ── Computed ──────────────────────────────────────────────────────────────────
const isUploading = computed(() => sessionStatus.value === 'uploading');
const isIndexing = computed(() => sessionStatus.value === 'indexing');
const isDone = computed(() => sessionStatus.value === 'done');
const isFailed = computed(() => sessionStatus.value === 'failed');

const step = computed<1 | 2 | 3>(() => {
  if (sessionStatus.value === 'idle' || sessionStatus.value === 'uploading') return 1;
  if (sessionStatus.value === 'indexing') return 2;
  return 3;
});

const indexingElapsedLabel = computed(() => {
  const m = Math.floor(indexingElapsed.value / 60);
  const s = indexingElapsed.value % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
});

const totalQty = computed(() => items.value.reduce((sum, i) => sum + (i.quantity || 1), 0));

// ── Lifecycle ─────────────────────────────────────────────────────────────────
onMounted(loadDefaultPrompt);
onUnmounted(() => {
  stopScanningMessages();
  stopElapsedTimer();
});

async function loadDefaultPrompt() {
  promptLoading.value = true;
  try {
    const res = await axios.get(`${API_BASE}/api/vision/video/prompt`, { headers: buildHeaders() });
    prompt.value = res.data.prompt || '';
  } catch {
    // Non-fatal — user can type a prompt manually
  } finally {
    promptLoading.value = false;
  }
}

// ── Upload + Analyze ──────────────────────────────────────────────────────────
function handleFileChange(event: Event) {
  const input = event.target as HTMLInputElement;
  if (input.files?.[0]) {
    selectedFile.value = input.files[0];
    uploadError.value = null;
  }
}

function startScanningMessages() {
  stopScanningMessages();
  let idx = 0;
  currentScanMessage.value = scanningMessages[idx];
  scanMessageInterval = setInterval(() => {
    idx = (idx + 1) % scanningMessages.length;
    currentScanMessage.value = scanningMessages[idx];
  }, 3000);
}

function stopScanningMessages() {
  if (scanMessageInterval) {
    clearInterval(scanMessageInterval);
    scanMessageInterval = null;
  }
}

function startElapsedTimer() {
  if (elapsedTimer) clearInterval(elapsedTimer);
  indexingElapsed.value = 0;
  elapsedTimer = setInterval(() => {
    indexingElapsed.value++;
  }, 1000);
}

function stopElapsedTimer() {
  if (elapsedTimer) {
    clearInterval(elapsedTimer);
    elapsedTimer = null;
  }
}

function markIndexing() {
  if (sessionStatus.value === 'indexing') return;
  sessionStatus.value = 'indexing';
  startElapsedTimer();
  startScanningMessages();
}

async function startUpload() {
  if (!selectedFile.value) return;
  uploadError.value = null;
  parseError.value = null;
  items.value = [];
  visibleItemCount.value = 0;
  rawAnalysis.value = null;
  showRaw.value = false;
  uploadProgress.value = 0;
  sessionStatus.value = 'uploading';

  try {
    const formData = new FormData();
    formData.append('video', selectedFile.value);
    if (prompt.value.trim()) {
      formData.append('prompt', prompt.value.trim());
    }

    const res = await axios.post(
      `${API_BASE}/api/vision/video/upload`,
      formData,
      {
        headers: { ...buildHeaders(), 'Content-Type': 'multipart/form-data' },
        timeout: 10 * 60 * 1000,
        onUploadProgress: (evt) => {
          if (evt.total) {
            uploadProgress.value = Math.round((evt.loaded / evt.total) * 100);
            if (evt.loaded >= evt.total) {
              markIndexing();
            }
          }
        }
      }
    );

    stopElapsedTimer();
    stopScanningMessages();

    const allItems = res.data.items || [];
    rawAnalysis.value = res.data.raw_analysis || null;
    parseError.value = res.data.parse_error || null;
    sessionStatus.value = 'done';

    items.value = allItems;
    progressivelyRevealItems(allItems.length);
  } catch (err: any) {
    stopElapsedTimer();
    stopScanningMessages();
    uploadError.value = err?.response?.data?.error || err?.message || 'Upload failed';
    sessionStatus.value = 'failed';
  }
}

function progressivelyRevealItems(totalCount: number) {
  visibleItemCount.value = 0;
  if (totalCount === 0) return;

  const interval = Math.min(150, 2000 / totalCount); // Max 2 seconds total
  const timer = setInterval(() => {
    visibleItemCount.value++;
    if (visibleItemCount.value >= totalCount) {
      clearInterval(timer);
    }
  }, interval);
}

function triggerFileInput() {
  const input = document.getElementById('video-file-input') as HTMLInputElement;
  input?.click();
}

function reset() {
  stopElapsedTimer();
  stopScanningMessages();
  sessionStatus.value = 'idle';
  selectedFile.value = null;
  uploadProgress.value = 0;
  uploadError.value = null;
  indexingElapsed.value = 0;
  items.value = [];
  visibleItemCount.value = 0;
  rawAnalysis.value = null;
  parseError.value = null;
  showRaw.value = false;
  currentScanMessage.value = scanningMessages[0];
  const input = document.getElementById('video-file-input') as HTMLInputElement;
  if (input) input.value = '';
}
</script>

<template>
  <div class="q-pa-md" style="max-width: 900px; margin: 0 auto;">

    <q-banner class="bg-blue-1 text-blue-9 q-mb-md rounded-borders" dense>
      <template #avatar>
        <q-icon name="auto_awesome" color="blue-9" />
      </template>
      Gemini video capture (beta) — upload a walkthrough and get an inventory summary.
    </q-banner>

    <!-- Header -->
    <div class="row items-center q-mb-lg">
      <div class="col">
        <div class="text-h5 text-weight-bold">Gemini Video Capture</div>
        <div class="text-caption text-grey-7">Upload a home walkthrough video → Gemini generates an inventory list</div>
      </div>
      <div class="col-auto" v-if="sessionStatus !== 'idle'">
        <q-btn flat dense label="Start over" icon="refresh" color="grey-7" @click="reset" />
      </div>
    </div>

    <!-- Step indicator -->
    <div class="row q-mb-lg q-gutter-x-sm">
      <q-chip
        v-for="(label, i) in ['1. Upload', '2. Analyze', '3. Results']"
        :key="i"
        :color="step === i + 1 ? 'primary' : step > i + 1 ? 'positive' : 'grey-4'"
        :text-color="step >= i + 1 ? 'white' : 'grey-7'"
        :icon="step > i + 1 ? 'check' : undefined"
        dense
      >
        {{ label }}
      </q-chip>
    </div>

    <!-- ── STEP 1: Upload ─────────────────────────────────────────────────── -->
    <q-card v-if="step === 1" flat bordered class="q-mb-md">
      <q-card-section>
        <div class="text-subtitle1 text-weight-medium q-mb-sm">Select a video file</div>
        <div class="text-caption text-grey-7 q-mb-md">
          Walk through a room slowly for best results. Max 500 MB. Supported: MP4, MOV, AVI, WebM.
        </div>

        <input
          id="video-file-input"
          type="file"
          accept="video/*"
          style="display: none"
          @change="handleFileChange"
        />
        <div class="row items-center q-gutter-sm">
          <q-btn
            outline
            color="primary"
            icon="video_file"
            label="Choose video"
            @click="triggerFileInput"
            :disable="isUploading"
          />
          <div class="text-body2 text-grey-8" v-if="selectedFile">
            {{ selectedFile.name }}
            <span class="text-caption text-grey-6 q-ml-xs">
              ({{ (selectedFile.size / 1024 / 1024).toFixed(1) }} MB)
            </span>
          </div>
        </div>

        <q-banner v-if="selectedFile && selectedFile.size > 500 * 1024 * 1024" class="bg-red-1 text-red-9 q-mt-sm" dense>
          File exceeds 500 MB limit. Please use a shorter clip.
        </q-banner>

        <div class="q-mt-lg">
          <div class="row items-center justify-between q-mb-sm">
            <div class="text-subtitle2 text-weight-medium">Inventory prompt (optional)</div>
            <q-spinner v-if="promptLoading" size="1rem" color="grey-6" />
          </div>
          <q-input
            v-model="prompt"
            type="textarea"
            outlined
            dense
            autogrow
            :rows="6"
            :disable="isUploading"
            style="font-family: monospace; font-size: 12px;"
          />
        </div>

        <!-- Upload progress -->
        <div v-if="isUploading" class="q-mt-md">
          <div class="text-caption text-grey-7 q-mb-xs">Uploading… {{ uploadProgress }}%</div>
          <q-linear-progress :value="uploadProgress / 100" color="primary" rounded style="height: 8px" />
        </div>

        <!-- Error -->
        <q-banner v-if="uploadError" class="bg-red-1 text-red-9 q-mt-sm" dense icon="error">
          {{ uploadError }}
        </q-banner>
      </q-card-section>

      <q-card-actions class="q-px-md q-pb-md">
        <q-btn
          color="primary"
          label="Upload & Analyze"
          icon="upload"
          :disable="!selectedFile || isUploading || (!!selectedFile && selectedFile.size > 500 * 1024 * 1024)"
          :loading="isUploading"
          @click="startUpload"
        />
      </q-card-actions>
    </q-card>

    <!-- ── STEP 2: Analyze ───────────────────────────────────────────────── -->
    <q-card v-if="step === 2" flat bordered class="q-mb-md">
      <q-card-section>
        <div class="row items-center q-gutter-md q-mb-md">
          <q-spinner-dots color="primary" size="2rem" />
          <div>
            <div class="text-subtitle1 text-weight-medium">Analyzing with Gemini</div>
            <div class="text-caption text-grey-7">
              This usually takes 1–3 minutes depending on video size.
              Elapsed: <strong>{{ indexingElapsedLabel }}</strong>
            </div>
          </div>
        </div>

        <div class="scanning-container q-mb-sm">
          <div class="scanning-bar"></div>
          <div class="text-body2 text-primary text-weight-medium q-mt-xs" style="min-height: 24px;">
            <q-icon name="radar" class="q-mr-xs" />
            {{ currentScanMessage }}
          </div>
        </div>
      </q-card-section>
    </q-card>

    <!-- ── STEP 3: Results ───────────────────────────────────────────────── -->
    <q-card v-if="isDone" flat bordered>
      <q-card-section>
        <div class="row items-center justify-between q-mb-md">
          <div>
            <div class="text-subtitle1 text-weight-medium">Results</div>
            <div class="text-caption text-grey-7">
              {{ items.length }} distinct item{{ items.length !== 1 ? 's' : '' }} ·
              {{ totalQty }} total unit{{ totalQty !== 1 ? 's' : '' }}
            </div>
          </div>
          <q-btn
            flat dense
            :label="showRaw ? 'Hide raw JSON' : 'Show raw JSON'"
            icon="data_object"
            color="grey-7"
            size="sm"
            @click="showRaw = !showRaw"
          />
        </div>

        <q-banner v-if="parseError" class="bg-amber-1 text-amber-9 q-mb-md" dense icon="warning">
          JSON parse warning: {{ parseError }}. Raw text is shown below.
        </q-banner>

        <q-markup-table v-if="items.length > 0" flat dense bordered separator="cell">
          <thead>
            <tr class="bg-grey-2">
              <th class="text-left">Item</th>
              <th class="text-center" style="width: 60px">Qty</th>
              <th class="text-left" style="width: 160px">Room</th>
              <th class="text-left">Notes</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(item, idx) in items.slice(0, visibleItemCount)" :key="`item-${idx}`" class="item-row">
              <td>{{ item.name }}</td>
              <td class="text-center">{{ item.quantity || 1 }}</td>
              <td>{{ item.room || '—' }}</td>
              <td>{{ item.notes || '—' }}</td>
            </tr>
          </tbody>
        </q-markup-table>

        <div v-if="items.length === 0" class="text-caption text-grey-6">No items detected.</div>

        <q-slide-transition>
          <div v-if="showRaw" class="q-mt-md">
            <div class="text-caption text-grey-7 q-mb-xs">Raw JSON</div>
            <pre class="raw-json">{{ rawAnalysis }}</pre>
          </div>
        </q-slide-transition>
      </q-card-section>
    </q-card>

    <q-banner v-if="isFailed" class="bg-red-1 text-red-9 q-mt-md" dense icon="error">
      {{ uploadError || 'Video analysis failed. Please try again.' }}
    </q-banner>
  </div>
</template>

<style scoped>
.scanning-container {
  position: relative;
  height: 12px;
  background: #e0f2f1;
  border-radius: 6px;
  overflow: hidden;
}

.scanning-bar {
  position: absolute;
  height: 100%;
  width: 35%;
  background: linear-gradient(90deg, transparent, #26a69a, transparent);
  animation: scan 1.6s infinite;
}

@keyframes scan {
  0% { transform: translateX(-100%); }
  100% { transform: translateX(300%); }
}

.item-row {
  transition: background 0.3s ease;
}

.raw-json {
  background: #f5f5f5;
  padding: 12px;
  border-radius: 6px;
  font-size: 12px;
  overflow-x: auto;
}
</style>
