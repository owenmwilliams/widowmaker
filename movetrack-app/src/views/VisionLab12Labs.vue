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

type SessionStatus =
  | 'idle'
  | 'created'
  | 'uploading'
  | 'indexing'
  | 'ready'
  | 'analyzing'
  | 'done'
  | 'failed';

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
const sessionId = ref<string | null>(null);
const sessionStatus = ref<SessionStatus>('idle');
const videoId = ref<string | null>(null);

const selectedFile = ref<File | null>(null);
const uploadProgress = ref(0);
const uploadError = ref<string | null>(null);

const indexingElapsed = ref(0);
const indexingError = ref<string | null>(null);

const prompt = ref('');
const promptLoading = ref(false);
const analyzing = ref(false);
const analyzeError = ref<string | null>(null);

const items = ref<InventoryItem[]>([]);
const visibleItemCount = ref(0);
const rawAnalysis = ref<string | null>(null);
const parseError = ref<string | null>(null);
const showRaw = ref(false);

const scanningMessages = [
  'Analyzing video content...',
  'Detecting objects in living spaces...',
  'Identifying furniture and belongings...',
  'Processing room layouts...',
  'Cataloging household items...'
];
const currentScanMessage = ref(scanningMessages[0]);
let scanMessageInterval: ReturnType<typeof setInterval> | null = null;

let pollInterval: ReturnType<typeof setInterval> | null = null;
let elapsedTimer: ReturnType<typeof setInterval> | null = null;

// ── Computed ──────────────────────────────────────────────────────────────────
const isUploading = computed(() => sessionStatus.value === 'uploading');
const isIndexing = computed(() => sessionStatus.value === 'indexing');
const isReady = computed(() => sessionStatus.value === 'ready' || sessionStatus.value === 'done');
const isDone = computed(() => sessionStatus.value === 'done');
const isFailed = computed(() => sessionStatus.value === 'failed');

const indexingElapsedLabel = computed(() => {
  const m = Math.floor(indexingElapsed.value / 60);
  const s = indexingElapsed.value % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
});

const step = computed<1 | 2 | 3>(() => {
  if (sessionStatus.value === 'idle' || sessionStatus.value === 'created' || sessionStatus.value === 'uploading') return 1;
  if (sessionStatus.value === 'indexing') return 2;
  return 3;
});

const totalQty = computed(() => items.value.reduce((sum, i) => sum + (i.quantity || 1), 0));

// ── Lifecycle ─────────────────────────────────────────────────────────────────
onMounted(loadDefaultPrompt);
onUnmounted(stopPolling);

async function loadDefaultPrompt() {
  promptLoading.value = true;
  try {
    const res = await axios.get(`${API_BASE}/video-12labs/prompt`, { headers: buildHeaders() });
    prompt.value = res.data.prompt || '';
  } catch {
    // Non-fatal — user can type a prompt manually
  } finally {
    promptLoading.value = false;
  }
}

// ── Step 1: Upload ────────────────────────────────────────────────────────────
function handleFileChange(event: Event) {
  const input = event.target as HTMLInputElement;
  if (input.files?.[0]) {
    selectedFile.value = input.files[0];
    uploadError.value = null;
  }
}

async function startUpload() {
  if (!selectedFile.value) return;
  uploadError.value = null;
  uploadProgress.value = 0;

  try {
    // Create session
    const sessionRes = await axios.post(
      `${API_BASE}/video-12labs/sessions`,
      {},
      { headers: buildHeaders() }
    );
    sessionId.value = sessionRes.data.session_id;
    sessionStatus.value = 'uploading';

    // Upload video
    const formData = new FormData();
    formData.append('video', selectedFile.value);

    await axios.post(
      `${API_BASE}/video-12labs/sessions/${sessionId.value}/upload`,
      formData,
      {
        headers: { ...buildHeaders(), 'Content-Type': 'multipart/form-data' },
        onUploadProgress: (evt) => {
          if (evt.total) {
            uploadProgress.value = Math.round((evt.loaded / evt.total) * 100);
          }
        }
      }
    );

    sessionStatus.value = 'indexing';
    indexingElapsed.value = 0;
    startPolling();
    startElapsedTimer();
  } catch (err: any) {
    uploadError.value = err?.response?.data?.error || err?.message || 'Upload failed';
    sessionStatus.value = 'idle';
    sessionId.value = null;
  }
}

// ── Step 2: Poll indexing status ──────────────────────────────────────────────
function startPolling() {
  stopPolling();
  pollInterval = setInterval(checkStatus, 5000);
  startScanningMessages();
}

function stopPolling() {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }
  stopScanningMessages();
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

async function checkStatus() {
  if (!sessionId.value) return;
  try {
    const res = await axios.get(
      `${API_BASE}/video-12labs/sessions/${sessionId.value}/status`,
      { headers: buildHeaders() }
    );
    const { status, video_id } = res.data;

    if (status === 'ready' || status === 'done') {
      sessionStatus.value = 'ready';
      videoId.value = video_id;
      stopPolling();
      stopElapsedTimer();
      $q.notify({ type: 'positive', message: 'Video indexed! Ready to analyze.' });
    } else if (status === 'failed') {
      sessionStatus.value = 'failed';
      indexingError.value = 'Twelve Labs indexing failed. Please try a different video.';
      stopPolling();
      stopElapsedTimer();
    }
    // Otherwise still indexing — keep polling
  } catch (err: any) {
    indexingError.value = err?.response?.data?.error || err?.message || 'Status check failed';
    stopPolling();
    stopElapsedTimer();
    sessionStatus.value = 'failed';
  }
}

// ── Step 3: Analyze ───────────────────────────────────────────────────────────
async function runAnalysis() {
  if (!sessionId.value || !isReady.value) return;
  analyzing.value = true;
  analyzeError.value = null;
  parseError.value = null;
  items.value = [];
  visibleItemCount.value = 0;
  rawAnalysis.value = null;

  try {
    const res = await axios.post(
      `${API_BASE}/video-12labs/sessions/${sessionId.value}/analyze`,
      { prompt: prompt.value },
      { headers: buildHeaders() }
    );
    const allItems = res.data.items || [];
    rawAnalysis.value = res.data.raw_analysis || null;
    parseError.value = res.data.parse_error || null;
    sessionStatus.value = 'done';

    // Progressive reveal: load items but show them one by one with animation
    items.value = allItems;
    progressivelyRevealItems(allItems.length);
  } catch (err: any) {
    analyzeError.value = err?.response?.data?.error || err?.message || 'Analysis failed';
  } finally {
    analyzing.value = false;
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

// ── Reset ─────────────────────────────────────────────────────────────────────
function reset() {
  stopPolling();
  stopElapsedTimer();
  stopScanningMessages();
  sessionId.value = null;
  sessionStatus.value = 'idle';
  videoId.value = null;
  selectedFile.value = null;
  uploadProgress.value = 0;
  uploadError.value = null;
  indexingElapsed.value = 0;
  indexingError.value = null;
  analyzing.value = false;
  analyzeError.value = null;
  items.value = [];
  visibleItemCount.value = 0;
  rawAnalysis.value = null;
  parseError.value = null;
  showRaw.value = false;
  currentScanMessage.value = scanningMessages[0];
  // Reset file input
  const input = document.getElementById('video-file-input') as HTMLInputElement;
  if (input) input.value = '';
}
</script>

<template>
  <div class="q-pa-md" style="max-width: 900px; margin: 0 auto;">

    <!-- Dev warning banner -->
    <q-banner class="bg-amber-2 text-amber-10 q-mb-md rounded-borders" dense>
      <template #avatar>
        <q-icon name="warning" color="amber-9" />
      </template>
      Dev sandbox only — Twelve Labs video analysis pipeline
    </q-banner>

    <!-- Header -->
    <div class="row items-center q-mb-lg">
      <div class="col">
        <div class="text-h5 text-weight-bold">Vision Lab · Twelve Labs</div>
        <div class="text-caption text-grey-7">Upload a home walkthrough video → Pegasus AI generates an inventory list</div>
      </div>
      <div class="col-auto" v-if="sessionStatus !== 'idle'">
        <q-btn flat dense label="Start over" icon="refresh" color="grey-7" @click="reset" />
      </div>
    </div>

    <!-- Step indicator -->
    <div class="row q-mb-lg q-gutter-x-sm">
      <q-chip
        v-for="(label, i) in ['1. Upload & Index', '2. Indexing', '3. Analyze']"
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

        <!-- Size warning -->
        <q-banner v-if="selectedFile && selectedFile.size > 500 * 1024 * 1024" class="bg-red-1 text-red-9 q-mt-sm" dense>
          File exceeds 500 MB limit. Please use a shorter clip.
        </q-banner>

        <!-- Upload progress -->
        <div v-if="isUploading" class="q-mt-md">
          <div class="text-caption text-grey-7 q-mb-xs">Uploading to Twelve Labs… {{ uploadProgress }}%</div>
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
          label="Upload & Index"
          icon="upload"
          :disable="!selectedFile || isUploading || (!!selectedFile && selectedFile.size > 500 * 1024 * 1024)"
          :loading="isUploading"
          @click="startUpload"
        />
      </q-card-actions>
    </q-card>

    <!-- ── STEP 2: Indexing ───────────────────────────────────────────────── -->
    <q-card v-if="step === 2" flat bordered class="q-mb-md">
      <q-card-section>
        <div class="row items-center q-gutter-md q-mb-md">
          <q-spinner-dots color="primary" size="2rem" />
          <div>
            <div class="text-subtitle1 text-weight-medium">Indexing with Twelve Labs</div>
            <div class="text-caption text-grey-7">
              Pegasus is analyzing the video content. This usually takes 1–3 minutes.
              Elapsed: <strong>{{ indexingElapsedLabel }}</strong>
            </div>
          </div>
        </div>

        <!-- Scanning animation with progressive messages -->
        <div class="scanning-container q-mb-sm">
          <div class="scanning-bar"></div>
          <div class="text-body2 text-primary text-weight-medium q-mt-xs" style="min-height: 24px;">
            <q-icon name="radar" class="q-mr-xs" />
            {{ currentScanMessage }}
          </div>
        </div>

        <div v-if="selectedFile" class="text-caption text-grey-6 q-mt-sm">
          File: {{ selectedFile.name }}
        </div>

        <q-banner v-if="indexingError" class="bg-red-1 text-red-9 q-mt-md" dense icon="error">
          {{ indexingError }}
          <template #action>
            <q-btn flat label="Try again" @click="reset" />
          </template>
        </q-banner>
      </q-card-section>
    </q-card>

    <!-- ── STEP 3: Analyze ───────────────────────────────────────────────── -->
    <template v-if="step === 3">
      <q-card flat bordered class="q-mb-md">
        <q-card-section>
          <div class="row items-center justify-between q-mb-sm">
            <div class="text-subtitle1 text-weight-medium">Inventory prompt</div>
            <q-spinner v-if="promptLoading" size="1rem" color="grey-6" />
          </div>
          <div class="text-caption text-grey-7 q-mb-sm">
            Edit the prompt to customise what Pegasus looks for. Keep the JSON array instruction.
          </div>
          <q-input
            v-model="prompt"
            type="textarea"
            outlined
            dense
            autogrow
            :rows="6"
            :disable="analyzing"
            style="font-family: monospace; font-size: 12px;"
          />

          <q-banner v-if="analyzeError" class="bg-red-1 text-red-9 q-mt-sm" dense icon="error">
            {{ analyzeError }}
          </q-banner>
        </q-card-section>

        <q-card-actions class="q-px-md q-pb-md">
          <q-btn
            color="primary"
            label="Generate inventory"
            icon="auto_awesome"
            :loading="analyzing"
            :disable="!prompt.trim() || analyzing"
            @click="runAnalysis"
          />
          <q-chip v-if="videoId" dense color="grey-3" text-color="grey-8" icon="videocam" class="q-ml-sm">
            Video ID: {{ videoId?.substring(0, 12) }}…
          </q-chip>
        </q-card-actions>
      </q-card>

      <!-- Results -->
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

          <!-- Parse warning -->
          <q-banner v-if="parseError" class="bg-amber-1 text-amber-9 q-mb-md" dense icon="warning">
            JSON parse warning: {{ parseError }}. Raw text is shown below.
          </q-banner>

          <!-- Items table with progressive reveal -->
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
              <transition-group name="item-reveal">
                <tr v-for="(item, idx) in items.slice(0, visibleItemCount)" :key="`item-${idx}`" class="item-row">
                  <td class="text-body2">{{ item.name }}</td>
                  <td class="text-center text-body2">{{ item.quantity }}</td>
                  <td class="text-caption text-grey-8">{{ item.room }}</td>
                  <td class="text-caption text-grey-7">{{ item.notes || '—' }}</td>
                </tr>
              </transition-group>
            </tbody>
          </q-markup-table>

          <div v-else class="text-grey-6 text-body2 q-py-md text-center">
            No items were extracted. Try running again or editing the prompt.
          </div>

          <!-- Raw JSON -->
          <q-slide-transition>
            <div v-if="showRaw" class="q-mt-md">
              <div class="text-caption text-grey-6 q-mb-xs">Raw Pegasus response</div>
              <pre
                class="bg-grey-2 rounded-borders q-pa-sm"
                style="font-size: 11px; white-space: pre-wrap; word-break: break-word; max-height: 400px; overflow-y: auto;"
              >{{ rawAnalysis }}</pre>
            </div>
          </q-slide-transition>
        </q-card-section>

        <q-card-actions class="q-px-md q-pb-md">
          <q-btn outline color="primary" label="Analyze again" icon="refresh" @click="runAnalysis" :loading="analyzing" />
          <q-btn flat color="grey-7" label="Start over with new video" icon="video_file" @click="reset" />
        </q-card-actions>
      </q-card>
    </template>

    <!-- Failed state -->
    <q-card v-if="isFailed" flat bordered class="bg-red-1">
      <q-card-section>
        <div class="row items-center q-gutter-sm">
          <q-icon name="error_outline" color="red-7" size="2rem" />
          <div>
            <div class="text-subtitle1 text-weight-medium text-red-8">Something went wrong</div>
            <div class="text-caption text-grey-7">Check the console for details, or start over with a different video.</div>
          </div>
        </div>
      </q-card-section>
      <q-card-actions class="q-px-md q-pb-md">
        <q-btn color="red-7" label="Start over" icon="refresh" @click="reset" />
      </q-card-actions>
    </q-card>

  </div>
</template>

<style scoped>
/* Scanning animation */
.scanning-container {
  position: relative;
  width: 100%;
  height: 4px;
  background: #e0e0e0;
  border-radius: 2px;
  overflow: hidden;
}

.scanning-bar {
  position: absolute;
  top: 0;
  left: 0;
  height: 100%;
  width: 30%;
  background: linear-gradient(90deg,
    transparent,
    rgba(25, 118, 210, 0.6),
    rgba(25, 118, 210, 1),
    rgba(25, 118, 210, 0.6),
    transparent
  );
  animation: scanning 2s ease-in-out infinite;
}

@keyframes scanning {
  0% {
    transform: translateX(-100%);
  }
  100% {
    transform: translateX(400%);
  }
}

/* Item reveal animations */
.item-reveal-enter-active {
  transition: all 0.4s ease;
}

.item-reveal-enter-from {
  opacity: 0;
  transform: translateY(-10px);
}

.item-reveal-enter-to {
  opacity: 1;
  transform: translateY(0);
}

.item-row {
  background-color: white;
}
</style>
