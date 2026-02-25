<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import { useQuasar } from 'quasar';
import axios from 'axios';
import { useDetectorStore } from '../stores/DetectorStore';

type SavedItem = {
  id: string;
  class: string;
  score: number;
  bbox: [number, number, number, number];
  snapshotUrl: string;
  enriching: boolean;
  enriched?: {
    name: string;
    material: string;
    color: string;
    estimatedWeight: number;
    fragile: boolean;
    confidence: number;
  };
};

const $q = useQuasar();
const router = useRouter();
const detectorStore = useDetectorStore();

const API_BASE =
  import.meta.env.MODE === 'development'
    ? 'http://localhost:3050'
    : 'https://movetrack-api-7hwn7ggbiq-uc.a.run.app';

const buildHeaders = () => {
  const token = localStorage.getItem('session_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
};

// ── State ──────────────────────────────────────────────────────────────────────
const videoRef = ref<HTMLVideoElement | null>(null);
const canvasRef = ref<HTMLCanvasElement | null>(null);

const cameraReady = ref(false);
const scanning = ref(false);

const detections = ref<any[]>([]);
const savedItems = ref<SavedItem[]>([]);

let stream: MediaStream | null = null;
let animationFrameId: number | null = null;

// Detection filtering and persistence
const MIN_SIZE_PERCENT = 0.10;
const MAX_SIZE_PERCENT = 0.60;
const TRACK_PERSISTENCE_MS = 3000;
const trackMap = new Map<string, { detection: any; lastSeen: number }>();

// ── Computed ───────────────────────────────────────────────────────────────────
const canScan = computed(() => cameraReady.value && detectorStore.detectorLoaded);
const enrichedCount = computed(() => savedItems.value.filter(i => i.enriched).length);
const detectorName = computed(() => detectorStore.detector?.getName() || 'Unknown');
const detectorDesc = computed(() => detectorStore.detector?.getDescription() || '');

// ── Lifecycle ─────────────────────────────────────────────────────────────────
onMounted(async () => {
  // Check if detector is loaded
  if (!detectorStore.detectorLoaded || !detectorStore.detector) {
    $q.notify({
      message: 'No model loaded. Please select a model first.',
      type: 'warning',
      timeout: 3000
    });
    router.push('/model-selection');
    return;
  }

  await startCamera();
});

onUnmounted(() => {
  stopScanning();
  stopCamera();
});

// ── Camera ────────────────────────────────────────────────────────────────────
async function startCamera() {
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: 1280, height: 720 }
    });
    if (videoRef.value) {
      videoRef.value.srcObject = stream;
      videoRef.value.onloadedmetadata = () => {
        videoRef.value?.play();
        cameraReady.value = true;
      };
    }
  } catch (err: any) {
    console.error('Camera access denied:', err);
    $q.notify({ message: 'Camera access required', type: 'negative' });
  }
}

function stopCamera() {
  if (stream) {
    stream.getTracks().forEach(track => track.stop());
    stream = null;
  }
  cameraReady.value = false;
}

// ── Scanning Loop ─────────────────────────────────────────────────────────────
const TARGET_FPS = 15;
const FRAME_INTERVAL_MS = 1000 / TARGET_FPS;
let lastFrameTime = 0;
let consecutiveErrors = 0;
const MAX_CONSECUTIVE_ERRORS = 3;

function startScanning() {
  if (!detectorStore.detector || !videoRef.value || !canvasRef.value) return;
  scanning.value = true;
  consecutiveErrors = 0;
  lastFrameTime = 0;
  detectObjects();
}

function stopScanning() {
  scanning.value = false;
  if (animationFrameId !== null) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
  }
  trackMap.clear();
  detections.value = [];
  lastFrameTime = 0;
  consecutiveErrors = 0;
}

async function detectObjects() {
  if (!scanning.value || !detectorStore.detector || !videoRef.value || !canvasRef.value) return;

  const now = Date.now();
  const timeSinceLastFrame = now - lastFrameTime;

  if (timeSinceLastFrame < FRAME_INTERVAL_MS) {
    animationFrameId = requestAnimationFrame(detectObjects);
    return;
  }

  lastFrameTime = now;

  try {
    const predictions = await detectorStore.detector.detect(videoRef.value);
    consecutiveErrors = 0;

    const video = videoRef.value;
    const videoWidth = video.videoWidth;
    const videoHeight = video.videoHeight;

    // Filter detections
    const filtered = predictions
      .filter(pred => {
        const [x, y, w, h] = pred.bbox;
        const boxArea = (w * h) / (videoWidth * videoHeight);
        return boxArea >= MIN_SIZE_PERCENT && boxArea <= MAX_SIZE_PERCENT;
      })
      .map(pred => ({
        ...pred,
        id: `${pred.class}-${Math.round(pred.bbox[0])}-${Math.round(pred.bbox[1])}`,
        bbox: pred.bbox
      }));

    // Update trackMap
    const currentTime = Date.now();
    filtered.forEach(det => {
      trackMap.set(det.class, { detection: det, lastSeen: currentTime });
    });

    // Remove stale tracks
    for (const [key, value] of trackMap.entries()) {
      if (currentTime - value.lastSeen > TRACK_PERSISTENCE_MS) {
        trackMap.delete(key);
      }
    }

    detections.value = Array.from(trackMap.values()).map(t => t.detection);

    // Render
    renderDetections();
  } catch (err: any) {
    console.error('Detection error:', err);
    consecutiveErrors++;

    if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
      stopScanning();
      $q.notify({
        message: `Detection failed ${MAX_CONSECUTIVE_ERRORS} times. Try reloading the model.`,
        type: 'negative',
        timeout: 5000,
        actions: [
          { label: 'Select Model', color: 'white', handler: () => router.push('/model-selection') },
          { label: 'Dismiss', color: 'white' }
        ]
      });
      return;
    }
  }

  if (scanning.value) {
    animationFrameId = requestAnimationFrame(detectObjects);
  }
}

function renderDetections() {
  const canvas = canvasRef.value;
  const video = videoRef.value;
  if (!canvas || !video) return;

  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;

  ctx.drawImage(video, 0, 0);

  detections.value.forEach(det => {
    const [x, y, w, h] = det.bbox;

    ctx.strokeStyle = '#00ff00';
    ctx.lineWidth = 3;
    ctx.strokeRect(x, y, w, h);

    ctx.fillStyle = 'rgba(0, 255, 0, 0.3)';
    ctx.fillRect(x, y, w, h);

    ctx.fillStyle = '#00ff00';
    ctx.font = 'bold 16px Arial';
    const label = `${det.class} ${Math.round(det.score * 100)}%`;
    const textMetrics = ctx.measureText(label);
    ctx.fillRect(x, y - 24, textMetrics.width + 10, 24);

    ctx.fillStyle = '#000';
    ctx.fillText(label, x + 5, y - 6);
  });
}

// ── Item Capture ──────────────────────────────────────────────────────────────
function handleCanvasTap(event: MouseEvent) {
  if (!scanning.value || detections.value.length === 0) return;

  const canvas = canvasRef.value;
  if (!canvas) return;

  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  const clickX = (event.clientX - rect.left) * scaleX;
  const clickY = (event.clientY - rect.top) * scaleY;

  for (const det of detections.value) {
    const [x, y, w, h] = det.bbox;
    if (clickX >= x && clickX <= x + w && clickY >= y && clickY <= y + h) {
      captureItem(det);
      break;
    }
  }
}

function captureItem(det: any) {
  const video = videoRef.value;
  if (!video) return;

  const [x, y, w, h] = det.bbox;

  const cropCanvas = document.createElement('canvas');
  cropCanvas.width = w;
  cropCanvas.height = h;
  const cropCtx = cropCanvas.getContext('2d');
  if (!cropCtx) return;

  cropCtx.drawImage(video, x, y, w, h, 0, 0, w, h);
  const snapshotUrl = cropCanvas.toDataURL('image/jpeg', 0.85);

  const savedItem: SavedItem = {
    id: det.id,
    class: det.class,
    score: det.score,
    bbox: det.bbox,
    snapshotUrl,
    enriching: false
  };

  savedItems.value.unshift(savedItem);

  trackMap.delete(det.class);
  detections.value = detections.value.filter(d => d.id !== det.id);

  $q.notify({ message: `Saved ${det.class}`, type: 'positive', icon: 'save' });
}

async function enrichItem(item: SavedItem) {
  if (item.enriched || item.enriching) return;

  item.enriching = true;

  try {
    const response = await fetch(item.snapshotUrl);
    const blob = await response.blob();

    const formData = new FormData();
    formData.append('image', blob, 'item.jpg');

    const res = await axios.post(
      `${API_BASE}/vision/analyze-item`,
      formData,
      {
        headers: {
          ...buildHeaders(),
          'Content-Type': 'multipart/form-data'
        }
      }
    );

    item.enriched = res.data;
    item.enriching = false;

    $q.notify({
      message: `Enriched: ${item.enriched?.name || item.class}`,
      type: 'positive',
      icon: 'auto_awesome'
    });
  } catch (err) {
    console.error('Enrichment failed:', err);
    item.enriching = false;
    $q.notify({
      message: 'Enrichment failed',
      type: 'negative'
    });
  }
}

function removeItem(item: SavedItem) {
  savedItems.value = savedItems.value.filter(i => i.id !== item.id);
}
</script>

<template>
  <q-page class="mobile-live-scan">
    <!-- Header -->
    <div class="header q-pa-md bg-primary text-white">
      <div class="row items-center justify-between">
        <div class="row items-center">
          <q-btn
            flat
            dense
            round
            icon="arrow_back"
            @click="router.push('/model-selection')"
            class="q-mr-sm"
          />
          <div>
            <div class="text-h6">Live Scan</div>
            <div class="text-caption">{{ detectorName }}: {{ detectorDesc }}</div>
          </div>
        </div>
      </div>
    </div>

    <!-- Camera View -->
    <div class="camera-container">
      <video ref="videoRef" autoplay playsinline muted style="display: none"></video>
      <canvas ref="canvasRef" @click="handleCanvasTap" class="detection-canvas"></canvas>

      <!-- Loading overlay -->
      <div v-if="!cameraReady" class="loading-overlay">
        <q-spinner-dots size="3rem" color="white" />
        <div class="text-white text-h6 q-mt-md">Starting camera...</div>
      </div>
    </div>

    <!-- Controls -->
    <div class="controls q-pa-md">
      <div class="row q-gutter-sm q-mb-md">
        <q-btn
          v-if="!scanning"
          color="positive"
          icon="play_arrow"
          label="Start Scanning"
          :disable="!canScan"
          @click="startScanning"
          class="col"
        />
        <q-btn
          v-else
          color="warning"
          icon="pause"
          label="Pause"
          @click="stopScanning"
          class="col"
        />
      </div>

      <!-- Saved items -->
      <div v-if="savedItems.length > 0" class="saved-items">
        <div class="text-subtitle2 text-grey-8 q-mb-sm">
          Saved Items ({{ savedItems.length }})
          <span class="text-caption text-positive q-ml-xs">{{ enrichedCount}} enriched</span>
        </div>

        <div class="items-grid">
          <q-card
            v-for="item in savedItems"
            :key="item.id"
            flat
            bordered
            class="item-card"
          >
            <img :src="item.snapshotUrl" class="item-image" />

            <q-card-section class="q-pa-sm">
              <div class="text-subtitle2">{{ item.enriched?.name || item.class }}</div>
              <div class="text-caption text-grey-7">
                Confidence: {{ Math.round(item.score * 100) }}%
              </div>

              <div v-if="item.enriched" class="q-mt-xs text-caption">
                <div>Material: {{ item.enriched.material }}</div>
                <div>Weight: ~{{ item.enriched.estimatedWeight }}lbs</div>
              </div>
            </q-card-section>

            <q-card-actions align="right" class="q-pa-sm">
              <q-btn
                v-if="!item.enriched && !item.enriching"
                flat
                dense
                size="sm"
                color="primary"
                icon="auto_awesome"
                label="Enrich"
                @click="enrichItem(item)"
              />
              <q-spinner-dots v-if="item.enriching" size="sm" color="primary" />
              <q-btn
                flat
                dense
                size="sm"
                color="negative"
                icon="delete"
                @click="removeItem(item)"
              />
            </q-card-actions>
          </q-card>
        </div>
      </div>
    </div>
  </q-page>
</template>

<style scoped>
.mobile-live-scan {
  display: flex;
  flex-direction: column;
  height: 100vh;
  overflow: hidden;
}

.header {
  flex-shrink: 0;
}

.camera-container {
  position: relative;
  flex: 1;
  overflow: hidden;
  background: #000;
}

.detection-canvas {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.loading-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.7);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}

.controls {
  flex-shrink: 0;
  background: white;
  max-height: 50vh;
  overflow-y: auto;
}

.saved-items {
  margin-top: 1rem;
}

.items-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 0.5rem;
}

.item-card {
  overflow: hidden;
}

.item-image {
  width: 100%;
  height: 120px;
  object-fit: cover;
}
</style>
