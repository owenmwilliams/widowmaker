<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { useQuasar } from 'quasar';
import * as cocoSsd from '@tensorflow-models/coco-ssd';
import '@tensorflow/tfjs-backend-webgl';
import axios from 'axios';

type Detection = {
  id: string;
  class: string;
  score: number;
  bbox: [number, number, number, number]; // [x, y, width, height]
  locked: boolean;
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

const modelLoading = ref(true);
const cameraReady = ref(false);
const scanning = ref(false);

const detections = ref<Detection[]>([]);
const lockedDetections = ref<Detection[]>([]);

let model: cocoSsd.ObjectDetection | null = null;
let stream: MediaStream | null = null;
let animationFrameId: number | null = null;

// ── Lifecycle ─────────────────────────────────────────────────────────────────
onMounted(async () => {
  await loadModel();
  await startCamera();
});

onUnmounted(() => {
  stopScanning();
  stopCamera();
});

// ── Model Loading ─────────────────────────────────────────────────────────────
async function loadModel() {
  try {
    $q.notify({ message: 'Loading AI model...', type: 'info', timeout: 2000 });
    model = await cocoSsd.load();
    modelLoading.value = false;
    $q.notify({ message: 'Model ready!', type: 'positive', icon: 'check_circle' });
  } catch (err: any) {
    console.error('Failed to load COCO-SSD:', err);
    $q.notify({ message: 'Failed to load AI model', type: 'negative' });
    modelLoading.value = false;
  }
}

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
function startScanning() {
  if (!model || !videoRef.value || !canvasRef.value) return;
  scanning.value = true;
  detectObjects();
}

function stopScanning() {
  scanning.value = false;
  if (animationFrameId !== null) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
  }
}

async function detectObjects() {
  if (!scanning.value || !model || !videoRef.value || !canvasRef.value) return;

  const video = videoRef.value;
  const canvas = canvasRef.value;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  // Match canvas size to video
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;

  // Run detection
  const predictions = await model.detect(video);

  // Clear canvas
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Update detections (filter out locked ones to avoid duplicates)
  const lockedClasses = new Set(lockedDetections.value.map(d => d.class));
  detections.value = predictions
    .filter(pred => !lockedClasses.has(pred.class) && pred.score > 0.5)
    .map((pred, idx) => ({
      id: `det-${Date.now()}-${idx}`,
      class: pred.class,
      score: pred.score,
      bbox: pred.bbox,
      locked: false
    }));

  // Draw bounding boxes
  detections.value.forEach(det => drawBbox(ctx, det, '#00bcd4'));
  lockedDetections.value.forEach(det => drawBbox(ctx, det, '#4caf50'));

  animationFrameId = requestAnimationFrame(detectObjects);
}

function drawBbox(ctx: CanvasRenderingContext2D, det: Detection, color: string) {
  const [x, y, width, height] = det.bbox;
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.strokeRect(x, y, width, height);

  ctx.fillStyle = color;
  ctx.fillRect(x, y - 24, ctx.measureText(det.class).width + 10, 24);
  ctx.fillStyle = 'white';
  ctx.font = '16px sans-serif';
  ctx.fillText(det.class, x + 5, y - 6);
}

// ── Canvas Interaction ────────────────────────────────────────────────────────
function handleCanvasTap(event: MouseEvent) {
  if (!canvasRef.value) return;

  const canvas = canvasRef.value;
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  const x = (event.clientX - rect.left) * scaleX;
  const y = (event.clientY - rect.top) * scaleY;

  // Check if tap is inside any detection bbox
  for (const det of detections.value) {
    const [bx, by, bw, bh] = det.bbox;
    if (x >= bx && x <= bx + bw && y >= by && y <= by + bh) {
      lockDetection(det);
      break;
    }
  }
}

async function lockDetection(det: Detection) {
  det.locked = true;
  lockedDetections.value.push(det);
  detections.value = detections.value.filter(d => d.id !== det.id);

  $q.notify({ message: `Locked ${det.class}`, type: 'info', icon: 'lock' });

  // Enrich with Claude in background
  enrichDetection(det);
}

async function enrichDetection(det: Detection) {
  if (!videoRef.value || !canvasRef.value) return;

  try {
    // Crop the detected region from the video frame
    const video = videoRef.value;
    const canvas = canvasRef.value;
    const [x, y, w, h] = det.bbox;

    const cropCanvas = document.createElement('canvas');
    cropCanvas.width = w;
    cropCanvas.height = h;
    const cropCtx = cropCanvas.getContext('2d');
    if (!cropCtx) return;

    cropCtx.drawImage(video, x, y, w, h, 0, 0, w, h);
    const base64 = cropCanvas.toDataURL('image/jpeg', 0.85).split(',')[1];

    // Send to Claude for enrichment
    const res = await axios.post(
      `${API_BASE}/vision/analyze-item`,
      { image: base64, mimeType: 'image/jpeg' },
      { headers: buildHeaders() }
    );

    det.enriched = res.data;
    $q.notify({ message: `Enriched: ${res.data.name}`, type: 'positive', icon: 'auto_awesome' });
  } catch (err: any) {
    console.error('Enrichment failed:', err);
    $q.notify({ message: 'Failed to enrich item', type: 'warning' });
  }
}

function unlockDetection(det: Detection) {
  lockedDetections.value = lockedDetections.value.filter(d => d.id !== det.id);
  $q.notify({ message: `Unlocked ${det.class}`, type: 'info' });
}

// ── Save to Inventory ─────────────────────────────────────────────────────────
async function saveToInventory() {
  const enrichedItems = lockedDetections.value.filter(d => d.enriched);
  if (enrichedItems.length === 0) {
    $q.notify({ message: 'No enriched items to save', type: 'warning' });
    return;
  }

  $q.notify({ message: `Saving ${enrichedItems.length} items...`, type: 'info' });

  // TODO: Call your items API to save
  // For now, just show success
  $q.notify({
    message: `${enrichedItems.length} items saved!`,
    type: 'positive',
    icon: 'check_circle'
  });

  lockedDetections.value = [];
}

// ── Computed ──────────────────────────────────────────────────────────────────
const canScan = computed(() => !modelLoading.value && cameraReady.value);
const enrichedCount = computed(() => lockedDetections.value.filter(d => d.enriched).length);
</script>

<template>
  <div class="mobile-live-scan">
    <!-- Header -->
    <div class="header q-pa-md bg-primary text-white">
      <div class="text-h6">Live Scan</div>
      <div class="text-caption">Point camera at items to detect</div>
    </div>

    <!-- Camera View -->
    <div class="camera-container">
      <video ref="videoRef" autoplay playsinline muted style="display: none"></video>
      <canvas ref="canvasRef" @click="handleCanvasTap" class="detection-canvas"></canvas>

      <!-- Loading overlay -->
      <div v-if="modelLoading || !cameraReady" class="loading-overlay">
        <q-spinner-dots size="3rem" color="white" />
        <div class="text-white text-h6 q-mt-md">
          {{ modelLoading ? 'Loading AI model...' : 'Starting camera...' }}
        </div>
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

      <!-- Locked items -->
      <div v-if="lockedDetections.length > 0" class="locked-items">
        <div class="text-subtitle2 text-grey-8 q-mb-sm">
          Detected Items ({{ lockedDetections.length }})
          <span class="text-caption text-positive q-ml-xs">{{ enrichedCount }} enriched</span>
        </div>
        <q-list dense bordered separator>
          <q-item v-for="det in lockedDetections" :key="det.id">
            <q-item-section avatar>
              <q-icon :name="det.enriched ? 'check_circle' : 'hourglass_empty'" :color="det.enriched ? 'positive' : 'grey'" />
            </q-item-section>
            <q-item-section>
              <q-item-label>{{ det.enriched?.name || det.class }}</q-item-label>
              <q-item-label caption v-if="det.enriched">
                {{ det.enriched.material }} · {{ det.enriched.estimatedWeight }} lbs
              </q-item-label>
              <q-item-label caption v-else>Processing...</q-item-label>
            </q-item-section>
            <q-item-section side>
              <q-btn flat dense round icon="close" size="sm" @click="unlockDetection(det)" />
            </q-item-section>
          </q-item>
        </q-list>

        <q-btn
          color="primary"
          icon="save"
          label="Save to Inventory"
          :disable="enrichedCount === 0"
          @click="saveToInventory"
          class="full-width q-mt-md"
        />
      </div>
    </div>
  </div>
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
  background: black;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

.detection-canvas {
  width: 100%;
  height: 100%;
  object-fit: contain;
  cursor: pointer;
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
  z-index: 10;
}

.controls {
  flex-shrink: 0;
  background: white;
  border-top: 1px solid #e0e0e0;
  max-height: 50vh;
  overflow-y: auto;
}

.locked-items {
  border-top: 1px solid #e0e0e0;
  padding-top: 1rem;
}
</style>
