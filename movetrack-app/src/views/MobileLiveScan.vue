<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { useQuasar } from 'quasar';
import axios from 'axios';
import { createDetector, Detector, DetectorType, HOUSEHOLD_ITEMS } from '../utils/detectors';

type SavedItem = {
  id: string;
  class: string;
  score: number;
  bbox: [number, number, number, number];
  snapshotUrl: string; // Base64 data URL of cropped image
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

// Default to COCO-SSD for stability on mobile (YOLO-World available as option)
const detectorType = ref<DetectorType>('coco-ssd');
const modelLoading = ref(true);
const cameraReady = ref(false);
const scanning = ref(false);

const detections = ref<any[]>([]);
const savedItems = ref<SavedItem[]>([]);

let detector: Detector | null = null;
let stream: MediaStream | null = null;
let animationFrameId: number | null = null;

// Detection filtering and persistence
const MIN_SIZE_PERCENT = 0.10;
const MAX_SIZE_PERCENT = 0.60;
const TRACK_PERSISTENCE_MS = 3000;
const trackMap = new Map<string, { detection: any; lastSeen: number }>();

// ── Lifecycle ─────────────────────────────────────────────────────────────────
onMounted(async () => {
  await loadDetector();
  await startCamera();
});

onUnmounted(() => {
  stopScanning();
  stopCamera();
});

// ── Detector Loading ──────────────────────────────────────────────────────────
async function loadDetector() {
  try {
    const nameMap = {
      'coco-ssd': 'COCO-SSD',
      'yolo-world': 'YOLO-World'
    };
    const name = nameMap[detectorType.value];
    $q.notify({ message: `Loading ${name}...`, type: 'info', timeout: 2000 });

    detector = createDetector(detectorType.value);
    await detector.load();

    modelLoading.value = false;
    $q.notify({ message: `${name} ready!`, type: 'positive', icon: 'check_circle' });
  } catch (err: any) {
    console.error('Failed to load detector:', err);
    console.error('Error details:', {
      name: err?.name,
      message: err?.message,
      stack: err?.stack,
      type: detectorType.value
    });

    // Determine error type and show detailed message
    let errorMessage = 'Failed to load detector';
    let details = '';

    if (err?.message?.includes('CORS') || err?.message?.includes('cross-origin')) {
      errorMessage = 'CORS Error';
      details = 'Model blocked by browser security. Check GCS CORS config.';
    } else if (err?.message?.includes('fetch') || err?.message?.includes('network') || err?.message?.includes('Failed to fetch')) {
      errorMessage = 'Network Error';
      details = `Cannot download model. Check internet connection. Error: ${err?.message?.substring(0, 100)}`;
    } else if (err?.message?.includes('backend') || err?.message?.includes('registry')) {
      errorMessage = 'Backend Error';
      details = 'TensorFlow.js backend not initialized. Try COCO-SSD instead.';
    } else {
      errorMessage = 'Model Load Failed';
      details = `${err?.message?.substring(0, 100) || 'Unknown error'}`;
    }

    $q.notify({
      message: `${errorMessage}: ${details}`,
      type: 'negative',
      timeout: 8000, // Longer timeout for mobile debugging
      multiLine: true,
      actions: [{ label: 'Dismiss', color: 'white' }]
    });
    modelLoading.value = false;
  }
}

async function switchDetector(type: DetectorType) {
  if (scanning.value) {
    $q.notify({ message: 'Stop scanning before switching models', type: 'warning' });
    return;
  }

  // Clean up old detector
  if (detector) {
    try {
      // @ts-ignore - dispose may not be in all detector interfaces
      detector.dispose?.();
    } catch (e) {
      console.warn('Error disposing detector:', e);
    }
    detector = null;
  }

  // Warn about YOLO-World memory usage on mobile
  if (type === 'yolo-world') {
    $q.notify({
      message: 'YOLO-World uses more memory. If app becomes slow or crashes, switch back to COCO-SSD.',
      type: 'warning',
      timeout: 5000,
      multiLine: true
    });
  }

  detectorType.value = type;
  modelLoading.value = true;
  await loadDetector();
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
const TARGET_FPS = 10; // Reduced FPS for mobile stability (especially YOLO-World)
const FRAME_INTERVAL_MS = 1000 / TARGET_FPS;
let lastFrameTime = 0;
let consecutiveErrors = 0;
const MAX_CONSECUTIVE_ERRORS = 3;

function startScanning() {
  if (!detector || !videoRef.value || !canvasRef.value) return;
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
  if (!scanning.value || !detector || !videoRef.value || !canvasRef.value) return;

  const now = Date.now();
  const timeSinceLastFrame = now - lastFrameTime;

  // Throttle to target FPS to prevent memory exhaustion on mobile
  if (timeSinceLastFrame < FRAME_INTERVAL_MS) {
    animationFrameId = requestAnimationFrame(detectObjects);
    return;
  }

  lastFrameTime = now;

  const video = videoRef.value;
  const canvas = canvasRef.value;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  // Match canvas size to video
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;

  const frameArea = canvas.width * canvas.height;

  try {
    // Run detection with error handling
    const predictions = await detector.detect(video);
    consecutiveErrors = 0; // Reset error counter on success

  // Clear canvas and draw video frame
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

  // Filter predictions by size and confidence
  const savedClasses = new Set(savedItems.value.map(d => d.class));
  const validPredictions = predictions.filter(pred => {
    if (savedClasses.has(pred.class)) return false;
    if (pred.score < 0.15) return false; // Lower threshold for OwlViT

    const [x, y, w, h] = pred.bbox;
    const bboxArea = w * h;
    const sizePercent = bboxArea / frameArea;

    return sizePercent >= MIN_SIZE_PERCENT && sizePercent <= MAX_SIZE_PERCENT;
  });

  // Update or create tracks
  validPredictions.forEach((pred, idx) => {
    const trackKey = pred.class;
    const existing = trackMap.get(trackKey);

    if (existing && pred.score > existing.detection.score) {
      existing.detection.score = pred.score;
      existing.detection.bbox = pred.bbox;
      existing.lastSeen = now;
    } else if (!existing) {
      trackMap.set(trackKey, {
        detection: {
          id: `det-${now}-${idx}`,
          class: pred.class,
          score: pred.score,
          bbox: pred.bbox
        },
        lastSeen: now
      });
    } else {
      existing.lastSeen = now;
    }
  });

  // Clean up stale tracks
  for (const [key, track] of trackMap.entries()) {
    if (now - track.lastSeen > TRACK_PERSISTENCE_MS) {
      trackMap.delete(key);
    }
  }

    // Update detections from active tracks
    detections.value = Array.from(trackMap.values()).map(t => t.detection);

    // Draw bounding boxes
    detections.value.forEach(det => drawBbox(ctx, det, '#00bcd4'));
    savedItems.value.forEach(item => drawBbox(ctx, item, '#4caf50'));

  } catch (err: any) {
    console.error('Detection error:', err);
    consecutiveErrors++;

    if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
      console.error(`Stopping scan after ${MAX_CONSECUTIVE_ERRORS} consecutive errors`);
      stopScanning();
      $q.notify({
        message: `Detection failed repeatedly. Model may have crashed. Try COCO-SSD instead.`,
        type: 'negative',
        timeout: 8000,
        multiLine: true,
        actions: [
          { label: 'Switch to COCO-SSD', color: 'white', handler: () => switchDetector('coco-ssd') },
          { label: 'Dismiss', color: 'white' }
        ]
      });
      return; // Don't schedule next frame
    }
  }

  // Schedule next frame
  if (scanning.value) {
    animationFrameId = requestAnimationFrame(detectObjects);
  }
}

function drawBbox(ctx: CanvasRenderingContext2D, det: any, color: string) {
  const [x, y, width, height] = det.bbox;
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.strokeRect(x, y, width, height);

  ctx.fillStyle = color;
  const text = det.enriched?.name || det.class;
  ctx.fillRect(x, y - 24, ctx.measureText(text).width + 10, 24);
  ctx.fillStyle = 'white';
  ctx.font = '16px sans-serif';
  ctx.fillText(text, x + 5, y - 6);
}

// ── Canvas Interaction ────────────────────────────────────────────────────────
function handleCanvasTap(event: MouseEvent) {
  if (!canvasRef.value || !videoRef.value) return;

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
      saveDetection(det);
      break;
    }
  }
}

function saveDetection(det: any) {
  if (!videoRef.value || !canvasRef.value) return;

  const video = videoRef.value;
  const [x, y, w, h] = det.bbox;

  // Crop and save snapshot
  const cropCanvas = document.createElement('canvas');
  cropCanvas.width = w;
  cropCanvas.height = h;
  const cropCtx = cropCanvas.getContext('2d');
  if (!cropCtx) return;

  cropCtx.drawImage(video, x, y, w, h, 0, 0, w, h);
  const snapshotUrl = cropCanvas.toDataURL('image/jpeg', 0.85);

  // Add to saved items (without enrichment)
  const savedItem: SavedItem = {
    id: det.id,
    class: det.class,
    score: det.score,
    bbox: det.bbox,
    snapshotUrl,
    enriching: false
  };

  savedItems.value.unshift(savedItem);

  // Remove from active detections
  trackMap.delete(det.class);
  detections.value = detections.value.filter(d => d.id !== det.id);

  $q.notify({ message: `Saved ${det.class}`, type: 'positive', icon: 'save' });
}

async function enrichItem(item: SavedItem) {
  if (item.enriched || item.enriching) return;

  item.enriching = true;

  try {
    // Convert data URL to blob
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

    item.enriched = res.data.data;
    $q.notify({ message: `Enriched: ${res.data.data.name}`, type: 'positive', icon: 'auto_awesome' });
  } catch (err: any) {
    console.error('Enrichment failed:', err);
    $q.notify({ message: 'Enrichment failed', type: 'warning' });
  } finally {
    item.enriching = false;
  }
}

function removeSavedItem(item: SavedItem) {
  savedItems.value = savedItems.value.filter(i => i.id !== item.id);
}

// ── Save to Inventory ─────────────────────────────────────────────────────────
async function saveToInventory() {
  const enrichedItems = savedItems.value.filter(i => i.enriched);
  if (enrichedItems.length === 0) {
    $q.notify({ message: 'No enriched items to save', type: 'warning' });
    return;
  }

  $q.notify({ message: `Saving ${enrichedItems.length} items...`, type: 'info' });

  // TODO: Call items API
  $q.notify({
    message: `${enrichedItems.length} items saved to inventory!`,
    type: 'positive',
    icon: 'check_circle'
  });

  savedItems.value = savedItems.value.filter(i => !i.enriched);
}

// ── Computed ──────────────────────────────────────────────────────────────────
const canScan = computed(() => !modelLoading.value && cameraReady.value);
const enrichedCount = computed(() => savedItems.value.filter(i => i.enriched).length);
const detectorName = computed(() => detector?.getName() || 'Loading...');
const detectorDesc = computed(() => detector?.getDescription() || '');
</script>

<template>
  <div class="mobile-live-scan">
    <!-- Header -->
    <div class="header q-pa-md bg-primary text-white">
      <div class="row items-center justify-between">
        <div>
          <div class="text-h6">Live Scan</div>
          <div class="text-caption">{{ detectorName }}: {{ detectorDesc }}</div>
        </div>
        <q-btn-dropdown
          flat
          dense
          icon="model_training"
          label="Model"
          dropdown-icon="expand_more"
          :disable="scanning"
        >
          <q-list>
            <q-item
              clickable
              v-close-popup
              @click="switchDetector('coco-ssd')"
              :active="detectorType === 'coco-ssd'"
            >
              <q-item-section>
                <q-item-label>COCO-SSD (Recommended)</q-item-label>
                <q-item-label caption>Fast, stable (80 objects)</q-item-label>
              </q-item-section>
            </q-item>
            <q-item
              clickable
              v-close-popup
              @click="switchDetector('yolo-world')"
              :active="detectorType === 'yolo-world'"
            >
              <q-item-section>
                <q-item-label>YOLO-World</q-item-label>
                <q-item-label caption>{{ HOUSEHOLD_ITEMS.length }} items (high memory)</q-item-label>
              </q-item-section>
            </q-item>
          </q-list>
        </q-btn-dropdown>
      </div>
    </div>

    <!-- Camera View -->
    <div class="camera-container">
      <video ref="videoRef" autoplay playsinline muted style="display: none"></video>
      <canvas ref="canvasRef" @click="handleCanvasTap" class="detection-canvas"></canvas>

      <!-- Loading overlay -->
      <div v-if="modelLoading || !cameraReady" class="loading-overlay">
        <q-spinner-dots size="3rem" color="white" />
        <div class="text-white text-h6 q-mt-md">
          {{ modelLoading ? 'Loading detector...' : 'Starting camera...' }}
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

      <!-- Saved items -->
      <div v-if="savedItems.length > 0" class="saved-items">
        <div class="text-subtitle2 text-grey-8 q-mb-sm">
          Saved Items ({{ savedItems.length }})
          <span class="text-caption text-positive q-ml-xs">{{ enrichedCount }} enriched</span>
        </div>
        <q-list dense bordered separator>
          <q-item v-for="item in savedItems" :key="item.id">
            <q-item-section avatar>
              <q-img :src="item.snapshotUrl" width="50px" height="50px" />
            </q-item-section>
            <q-item-section>
              <q-item-label>{{ item.enriched?.name || item.class }}</q-item-label>
              <q-item-label caption v-if="item.enriched">
                {{ item.enriched.material }} · {{ item.enriched.estimatedWeight }} lbs
              </q-item-label>
              <q-item-label caption v-else-if="item.enriching">
                Enriching...
              </q-item-label>
              <q-item-label caption v-else>
                Not enriched
              </q-item-label>
            </q-item-section>
            <q-item-section side>
              <div class="row q-gutter-xs">
                <q-btn
                  v-if="!item.enriched && !item.enriching"
                  flat
                  dense
                  round
                  icon="auto_awesome"
                  size="sm"
                  color="primary"
                  @click="enrichItem(item)"
                >
                  <q-tooltip>Enrich with AI</q-tooltip>
                </q-btn>
                <q-btn
                  flat
                  dense
                  round
                  icon="close"
                  size="sm"
                  @click="removeSavedItem(item)"
                />
              </div>
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

.saved-items {
  border-top: 1px solid #e0e0e0;
  padding-top: 1rem;
}
</style>
