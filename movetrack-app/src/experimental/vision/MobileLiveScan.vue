<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import { useQuasar } from 'quasar';
import axios from 'axios';
import { ObjectDetector, FilesetResolver } from '@mediapipe/tasks-vision';

const $q = useQuasar();
const router = useRouter();

const API_BASE =
  import.meta.env.MODE === 'development'
    ? 'http://localhost:3050'
    : 'https://movetrack-api-7hwn7ggbiq-uc.a.run.app';

const buildHeaders = (): Record<string, string> => {
  const token = localStorage.getItem('session_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
};

type ItemCategory = 'large_furniture' | 'appliance' | 'fragile_high_value' | 'special_handling' | 'boxable_items' | 'storage_container' | 'unknown';

type CapturedItem = {
  id: string;
  cropUrl: string;
  bbox: { x: number; y: number; width: number; height: number };
  detectedLabel: string;
  category: ItemCategory;
  selected: boolean;
  classifying: boolean;
  classified?: {
    name: string;
    description: string;
    estimatedWeight: number;
    fragile: boolean;
  };
  timestamp: number;
};

const CATEGORY_MAP: Record<string, ItemCategory> = {
  'couch': 'large_furniture',
  'chair': 'large_furniture',
  'dining table': 'large_furniture',
  'bed': 'large_furniture',
  'desk': 'large_furniture',
  'bench': 'large_furniture',
  'tv': 'appliance',
  'laptop': 'appliance',
  'microwave': 'appliance',
  'oven': 'appliance',
  'toaster': 'appliance',
  'refrigerator': 'appliance',
  'sink': 'appliance',
  'vase': 'fragile_high_value',
  'wine glass': 'fragile_high_value',
  'cup': 'fragile_high_value',
  'clock': 'fragile_high_value',
  'potted plant': 'special_handling',
  'book': 'boxable_items',
  'cell phone': 'boxable_items',
  'remote': 'boxable_items',
  'keyboard': 'boxable_items',
  'mouse': 'boxable_items',
  'bottle': 'boxable_items',
  'bowl': 'boxable_items',
  'suitcase': 'storage_container',
  'handbag': 'storage_container',
  'backpack': 'storage_container',
};

function getCategoryFromLabel(label: string): ItemCategory {
  return CATEGORY_MAP[label.toLowerCase()] || 'unknown';
}

// State
const videoRef = ref<HTMLVideoElement | null>(null);
const canvasRef = ref<HTMLCanvasElement | null>(null);
const cameraReady = ref(false);
const scanning = ref(false);
const detectorReady = ref(false);
const detections = ref<any[]>([]);
const capturedItems = ref<CapturedItem[]>([]);
const debugLogs = ref<Array<{ time: string; level: string; message: string }>>([]);
const showDebug = ref(false);
const showItemsDrawer = ref(false);

// Flash animation state
const flashEffect = ref<{ x: number; y: number; width: number; height: number; alpha: number } | null>(null);
let flashAnimId: number | null = null;

// Derived: bboxes of all captured items for overlap detection
const capturedBboxes = computed(() => capturedItems.value.map(item => item.bbox));

// Compute IoU between a stored bbox and a MediaPipe detection bbox
function computeIoU(
  a: { x: number; y: number; width: number; height: number },
  b: { originX: number; originY: number; width: number; height: number },
) {
  const ax2 = a.x + a.width, ay2 = a.y + a.height;
  const bx2 = b.originX + b.width, by2 = b.originY + b.height;
  const ix1 = Math.max(a.x, b.originX), iy1 = Math.max(a.y, b.originY);
  const ix2 = Math.min(ax2, bx2), iy2 = Math.min(ay2, by2);
  if (ix2 <= ix1 || iy2 <= iy1) return 0;
  const inter = (ix2 - ix1) * (iy2 - iy1);
  const union = a.width * a.height + b.width * b.height - inter;
  return union <= 0 ? 0 : inter / union;
}

function isAlreadyCaptured(detBbox: any): boolean {
  return capturedBboxes.value.some(c => computeIoU(c, detBbox) > 0.35);
}

function clampBoxToVideo(box: any, video: HTMLVideoElement) {
  const maxX = Math.max(1, video.videoWidth || 1);
  const maxY = Math.max(1, video.videoHeight || 1);
  const originX = Math.max(0, Math.min(box.originX || 0, maxX - 1));
  const originY = Math.max(0, Math.min(box.originY || 0, maxY - 1));
  const width = Math.max(1, Math.min(box.width || 0, maxX - originX));
  const height = Math.max(1, Math.min(box.height || 0, maxY - originY));
  return { ...box, originX, originY, width, height };
}

// Brief white flash on capture
function triggerCaptureFlash(box: any) {
  if (flashAnimId !== null) cancelAnimationFrame(flashAnimId);
  flashEffect.value = { x: box.originX, y: box.originY, width: box.width, height: box.height, alpha: 1.0 };
  const start = performance.now();
  const duration = 500;
  function animate(t: number) {
    const progress = Math.min((t - start) / duration, 1);
    if (flashEffect.value) flashEffect.value.alpha = 1 - progress * progress;
    if (progress < 1) {
      flashAnimId = requestAnimationFrame(animate);
    } else {
      flashEffect.value = null;
      flashAnimId = null;
    }
  }
  flashAnimId = requestAnimationFrame(animate);
}

function addDebugLog(level: 'info' | 'error' | 'success', message: string) {
  const time = new Date().toLocaleTimeString();
  debugLogs.value.unshift({ time, level, message });
  if (debugLogs.value.length > 50) debugLogs.value = debugLogs.value.slice(0, 50);
  if (!message.includes('Debug console')) originalConsoleLog?.(`[${level.toUpperCase()}] ${message}`);
}

const originalConsoleLog = console.log;
const originalConsoleError = console.error;
const originalConsoleWarn = console.warn;

let stream: MediaStream | null = null;
let animationFrameId: number | null = null;
let objectDetector: ObjectDetector | null = null;

onMounted(async () => {
  console.error = (...args: any[]) => {
    addDebugLog('error', args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' '));
    originalConsoleError.apply(console, args);
  };
  console.warn = (...args: any[]) => {
    addDebugLog('error', `WARN: ${args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ')}`);
    originalConsoleWarn.apply(console, args);
  };
  addDebugLog('info', 'Debug console initialized');
  await loadDetector();
  await startCamera();
});

onUnmounted(() => {
  console.error = originalConsoleError;
  console.warn = originalConsoleWarn;
  stopScanning();
  stopCamera();
  if (objectDetector) objectDetector.close();
  if (flashAnimId !== null) cancelAnimationFrame(flashAnimId);
});

async function loadDetector() {
  let dismiss: any = null;
  try {
    dismiss = $q.notify({ message: 'Loading object detector...', type: 'info', spinner: true, timeout: 0 });
    const vision = await FilesetResolver.forVisionTasks(
      'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.0/wasm'
    );
    objectDetector = await ObjectDetector.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/float16/1/efficientdet_lite0.tflite',
        delegate: 'GPU'
      },
      scoreThreshold: 0.3,
      maxResults: 10,
      runningMode: 'VIDEO'
    });
    detectorReady.value = true;
    if (dismiss) dismiss();
    $q.notify({ message: 'Detector ready!', type: 'positive', icon: 'check_circle', timeout: 1500 });
  } catch (err: any) {
    console.error('Failed to load detector:', err);
    if (dismiss) dismiss();
    $q.notify({ message: `Failed to load detector: ${err.message}`, type: 'negative' });
  }
}

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
  if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
  cameraReady.value = false;
}

let lastFrameTime = 0;
const FRAME_INTERVAL_MS = 100;

function startScanning() {
  if (!detectorReady.value || !objectDetector) {
    $q.notify({ message: 'Detector not ready', type: 'warning' });
    return;
  }
  scanning.value = true;
  detectObjects();
}

function stopScanning() {
  scanning.value = false;
  if (animationFrameId !== null) { cancelAnimationFrame(animationFrameId); animationFrameId = null; }
  detections.value = [];
}

function detectObjects() {
  if (!scanning.value || !objectDetector || !videoRef.value || !canvasRef.value) return;
  const now = performance.now();
  if (now - lastFrameTime < FRAME_INTERVAL_MS) {
    animationFrameId = requestAnimationFrame(detectObjects);
    return;
  }
  lastFrameTime = now;
  try {
    const result = objectDetector.detectForVideo(videoRef.value, now);
    detections.value = result.detections.map(det => ({
      category: det.categories[0]?.categoryName || 'unknown',
      score: det.categories[0]?.score || 0,
      bbox: det.boundingBox
    }));
    renderDetections();
  } catch (err) {
    console.error('Detection error:', err);
  }
  if (scanning.value) animationFrameId = requestAnimationFrame(detectObjects);
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
    const box = det.bbox;
    const captured = isAlreadyCaptured(box);

    ctx.save();
    if (captured) {
      // Already in queue: dashed blue, subtle fill
      ctx.strokeStyle = '#64b5f6';
      ctx.lineWidth = 2;
      ctx.setLineDash([8, 6]);
      ctx.strokeRect(box.originX, box.originY, box.width, box.height);
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(33, 150, 243, 0.08)';
      ctx.fillRect(box.originX, box.originY, box.width, box.height);

      ctx.font = 'bold 14px Arial';
      const label = `✓ ${det.category}`;
      const tw = ctx.measureText(label).width;
      ctx.fillStyle = 'rgba(33, 150, 243, 0.85)';
      ctx.fillRect(box.originX, box.originY - 22, tw + 10, 22);
      ctx.fillStyle = '#fff';
      ctx.fillText(label, box.originX + 5, box.originY - 5);
    } else {
      // Active detection: bright green
      ctx.strokeStyle = '#00e676';
      ctx.lineWidth = 3;
      ctx.strokeRect(box.originX, box.originY, box.width, box.height);
      ctx.fillStyle = 'rgba(0, 230, 118, 0.18)';
      ctx.fillRect(box.originX, box.originY, box.width, box.height);

      ctx.font = 'bold 16px Arial';
      const label = `${det.category} ${Math.round(det.score * 100)}%`;
      const tw = ctx.measureText(label).width;
      ctx.fillStyle = '#00e676';
      ctx.fillRect(box.originX, box.originY - 24, tw + 10, 24);
      ctx.fillStyle = '#000';
      ctx.fillText(label, box.originX + 5, box.originY - 6);
    }
    ctx.restore();
  });

  // Flash effect (capture animation)
  if (flashEffect.value) {
    const f = flashEffect.value;
    ctx.save();
    ctx.strokeStyle = `rgba(255, 255, 255, ${f.alpha})`;
    ctx.lineWidth = 8;
    ctx.strokeRect(f.x, f.y, f.width, f.height);
    ctx.fillStyle = `rgba(255, 255, 255, ${f.alpha * 0.35})`;
    ctx.fillRect(f.x, f.y, f.width, f.height);
    ctx.restore();
  }
}

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
    const box = det.bbox;
    if (clickX >= box.originX && clickX <= box.originX + box.width &&
        clickY >= box.originY && clickY <= box.originY + box.height) {
      captureItem(det);
      break;
    }
  }
}

function captureItem(det: any) {
  const video = videoRef.value;
  if (!video) return;
  const box = clampBoxToVideo(det.bbox, video);
  const detectedLabel = det.category;
  const category = getCategoryFromLabel(detectedLabel);

  const cropCanvas = document.createElement('canvas');
  cropCanvas.width = box.width;
  cropCanvas.height = box.height;
  const cropCtx = cropCanvas.getContext('2d');
  if (!cropCtx) return;
  cropCtx.drawImage(video, box.originX, box.originY, box.width, box.height, 0, 0, box.width, box.height);
  const cropUrl = cropCanvas.toDataURL('image/jpeg', 0.85);

  const item: CapturedItem = {
    id: `item-${Date.now()}`,
    cropUrl,
    bbox: { x: box.originX, y: box.originY, width: box.width, height: box.height },
    detectedLabel,
    category,
    selected: false,
    classifying: false,
    timestamp: Date.now()
  };

  capturedItems.value.unshift(item);
  triggerCaptureFlash(box);
  addDebugLog('info', `Captured ${detectedLabel} (${category})`);
}

function removeItem(item: CapturedItem) {
  capturedItems.value = capturedItems.value.filter(i => i.id !== item.id);
}

function toggleSelection(item: CapturedItem) {
  item.selected = !item.selected;
}

function selectAll() {
  capturedItems.value.forEach(item => { if (item.category === 'large_furniture') item.selected = true; });
}

function deselectAll() {
  capturedItems.value.forEach(item => item.selected = false);
}

const selectedFurnitureCount = computed(() =>
  capturedItems.value.filter(i => i.selected && i.category === 'large_furniture').length
);

async function processSelectedItems() {
  const selectedItems = capturedItems.value.filter(
    item => item.selected && item.category === 'large_furniture' && !item.classified
  );
  addDebugLog('info', `Starting batch: ${selectedItems.length} furniture items`);
  if (selectedItems.length === 0) {
    $q.notify({ message: 'No large furniture items selected', type: 'warning' });
    return;
  }

  const processingNotif = $q.notify({
    message: `Processing ${selectedItems.length} item${selectedItems.length > 1 ? 's' : ''}...`,
    type: 'info', spinner: true, timeout: 0
  });

  selectedItems.forEach(item => { item.classifying = true; });

  try {
    const images = selectedItems.map(item => item.cropUrl);
    addDebugLog('info', `Sending ${images.length} images to API`);

    const res = await axios.post(
      `${API_BASE}/api/vision/analyze-batch`,
      { images, category: 'large_furniture' },
      { headers: buildHeaders() }
    );

    addDebugLog('success', `API: ${res.data.summary?.successful}/${res.data.summary?.total} succeeded`);

    if (res.data.success && Array.isArray(res.data.results)) {
      res.data.results.forEach((result: any, index: number) => {
        const item = selectedItems[index];
        if (!item) return;
        item.classifying = false;
        if (result.success && result.data) {
          item.classified = result.data;
        } else {
          console.error(`Failed to classify item ${index}:`, result.error);
        }
      });
      if (processingNotif) processingNotif();
      $q.notify({ message: `Processed ${res.data.summary.successful}/${res.data.summary.total} items`, type: 'positive', icon: 'check_circle' });
    } else {
      throw new Error('Invalid response from batch endpoint');
    }
  } catch (err: any) {
    const errorMsg = err.response?.data?.error || err.message || 'Unknown error';
    addDebugLog('error', `Batch failed: ${err.response?.status || 'No status'} - ${errorMsg}`);
    console.error('[BATCH] Full error:', err);
    selectedItems.forEach(item => { item.classifying = false; });
    if (processingNotif) processingNotif();
    $q.notify({ message: `Batch failed: ${errorMsg}`, type: 'negative', caption: err.response?.status ? `HTTP ${err.response.status}` : undefined });
  }
}
</script>

<template>
  <div class="scan-root">
    <!-- Hidden video source -->
    <video ref="videoRef" autoplay playsinline muted class="hidden-video" />

    <!-- Full-screen canvas -->
    <canvas ref="canvasRef" @click="handleCanvasTap" class="fullscreen-canvas" />

    <!-- Top overlay bar -->
    <div class="top-overlay">
      <q-btn round flat dense icon="arrow_back" color="white" size="sm" @click="router.push('/')" />

      <div class="scan-indicator" v-if="detectorReady">
        <div :class="['scan-dot', { 'scan-dot--active': scanning }]" />
        <span class="scan-label">{{ scanning ? 'Scanning' : 'Ready' }}</span>
      </div>
      <div class="scan-indicator" v-else>
        <q-spinner size="14px" color="white" />
        <span class="scan-label">Loading...</span>
      </div>

      <q-btn round flat dense icon="bug_report" color="orange" size="sm" @click="showDebug = !showDebug">
        <q-badge v-if="debugLogs.length > 0" color="red" floating>{{ debugLogs.length }}</q-badge>
      </q-btn>
    </div>

    <!-- Loading overlay -->
    <div v-if="!cameraReady || !detectorReady" class="loading-overlay">
      <q-spinner-dots size="3rem" color="white" />
      <div class="text-white text-h6 q-mt-md">
        {{ !cameraReady ? 'Starting camera...' : 'Loading detector...' }}
      </div>
    </div>

    <!-- Bottom controls overlay -->
    <div class="bottom-overlay">
      <!-- Captured items count chip - tappable -->
      <div
        v-if="capturedItems.length > 0"
        class="items-count-chip"
        @click="showItemsDrawer = true"
      >
        <q-icon name="inventory_2" size="16px" />
        <span>{{ capturedItems.length }} captured</span>
        <q-icon name="expand_less" size="16px" />
      </div>

      <!-- Scan toggle button -->
      <div class="scan-btn-wrap">
        <q-btn
          round
          unelevated
          size="xl"
          :color="scanning ? 'warning' : 'positive'"
          :icon="scanning ? 'pause' : 'videocam'"
          :disable="!cameraReady || !detectorReady"
          @click="scanning ? stopScanning() : startScanning()"
          class="scan-btn"
        />
        <div class="scan-btn-label">{{ scanning ? 'Tap to pause' : 'Tap to scan' }}</div>
      </div>
    </div>

    <!-- Items bottom sheet -->
    <q-dialog v-model="showItemsDrawer" position="bottom" seamless>
      <q-card class="items-sheet">
        <div class="sheet-handle" />

        <div class="q-px-md q-pb-md">
          <!-- Sheet header -->
          <div class="row items-center justify-between q-mb-sm q-pt-sm">
            <div class="text-subtitle1 text-weight-bold">
              {{ capturedItems.length }} Captured
              <span class="text-caption text-grey-6 q-ml-xs">({{ capturedItems.filter(i => i.classified).length }} processed)</span>
            </div>
            <div class="row q-gutter-xs items-center">
              <q-btn flat dense size="sm" label="Select Furniture" @click="selectAll" />
              <q-btn flat dense size="sm" label="Clear" @click="deselectAll" />
              <q-btn flat round dense icon="close" size="sm" @click="showItemsDrawer = false" />
            </div>
          </div>

          <!-- Process button -->
          <q-btn
            v-if="selectedFurnitureCount > 0"
            color="primary"
            icon="auto_awesome"
            :label="`Process ${selectedFurnitureCount} Furniture Item${selectedFurnitureCount !== 1 ? 's' : ''}`"
            @click="processSelectedItems"
            class="full-width q-mb-md"
            unelevated
          />

          <!-- Items grid -->
          <div class="items-grid">
            <q-card
              v-for="item in capturedItems"
              :key="item.id"
              flat
              bordered
              :class="['item-card', { selected: item.selected }]"
              @click="toggleSelection(item)"
            >
              <div class="selection-indicator">
                <q-checkbox :model-value="item.selected" @click.stop="toggleSelection(item)" dense />
              </div>

              <img :src="item.cropUrl" class="item-image" />

              <q-card-section class="q-pa-xs">
                <q-badge
                  :color="item.category === 'large_furniture' ? 'primary' : 'grey-6'"
                  :label="item.detectedLabel"
                  class="q-mb-xs"
                />

                <div v-if="item.classified" class="text-caption">
                  <div class="text-weight-bold">{{ item.classified.name }}</div>
                  <div>~{{ item.classified.estimatedWeight }}lbs</div>
                  <div v-if="item.classified.fragile" class="text-warning">⚠️ Fragile</div>
                </div>
                <div v-else-if="item.classifying" class="q-mt-xs">
                  <q-spinner-dots size="sm" color="primary" />
                </div>
                <div v-else class="text-caption text-grey-6">
                  {{ item.category === 'large_furniture' ? 'Ready' : item.category }}
                </div>
              </q-card-section>

              <q-card-actions align="right" class="q-pa-xs">
                <q-btn flat dense size="sm" color="negative" icon="delete" @click.stop="removeItem(item)" />
              </q-card-actions>
            </q-card>
          </div>
        </div>
      </q-card>
    </q-dialog>

    <!-- Debug drawer -->
    <q-drawer v-model="showDebug" side="right" overlay elevated :width="300" behavior="mobile">
      <div class="q-pa-md">
        <div class="row items-center justify-between q-mb-md">
          <div class="text-h6">Debug Logs</div>
          <q-btn flat dense round icon="close" @click="showDebug = false" />
        </div>
        <q-btn flat dense size="sm" label="Clear" color="negative" @click="debugLogs = []" class="full-width q-mb-sm" />
        <div class="debug-logs">
          <div
            v-for="(log, index) in debugLogs"
            :key="index"
            :class="['debug-log', `log-${log.level}`]"
          >
            <div class="log-time">{{ log.time }}</div>
            <div class="log-message">{{ log.message }}</div>
          </div>
          <div v-if="debugLogs.length === 0" class="text-grey-6 text-center q-pa-md">No logs yet</div>
        </div>
      </div>
    </q-drawer>
  </div>
</template>

<style scoped>
.scan-root {
  position: fixed;
  inset: 0;
  background: #000;
  overflow: hidden;
}

.hidden-video {
  display: none;
}

.fullscreen-canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: contain;
  cursor: crosshair;
}

/* ── Top overlay ── */
.top-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  padding-top: max(12px, env(safe-area-inset-top));
  background: linear-gradient(to bottom, rgba(0, 0, 0, 0.6) 0%, transparent 100%);
  z-index: 10;
  pointer-events: none;
}

.top-overlay > * {
  pointer-events: auto;
}

.scan-indicator {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 12px;
  background: rgba(0, 0, 0, 0.45);
  backdrop-filter: blur(8px);
  border-radius: 999px;
  color: white;
  font-size: 0.75rem;
  font-weight: 500;
}

.scan-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #888;
  flex-shrink: 0;
}

.scan-dot--active {
  background: #00e676;
  animation: dot-pulse 1.5s ease-in-out infinite;
}

@keyframes dot-pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.5; transform: scale(0.8); }
}

/* ── Bottom overlay ── */
.bottom-overlay {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 20px 16px;
  padding-bottom: max(24px, env(safe-area-inset-bottom));
  background: linear-gradient(to top, rgba(0, 0, 0, 0.6) 0%, transparent 100%);
  z-index: 10;
}

.items-count-chip {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 18px;
  background: rgba(255, 255, 255, 0.15);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border: 1px solid rgba(255, 255, 255, 0.3);
  border-radius: 999px;
  color: white;
  font-size: 0.875rem;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.2s;
  user-select: none;
}

.items-count-chip:active {
  background: rgba(255, 255, 255, 0.25);
}

.scan-btn-wrap {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
}

.scan-btn {
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
}

.scan-btn-label {
  color: rgba(255, 255, 255, 0.75);
  font-size: 0.72rem;
  letter-spacing: 0.3px;
}

/* ── Loading overlay ── */
.loading-overlay {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.7);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  z-index: 5;
}

/* ── Items bottom sheet ── */
.items-sheet {
  border-radius: 20px 20px 0 0;
  max-height: 72vh;
  overflow-y: auto;
}

.sheet-handle {
  width: 40px;
  height: 4px;
  background: #ddd;
  border-radius: 2px;
  margin: 12px auto 4px;
}

.items-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 8px;
}

.item-card {
  overflow: hidden;
  position: relative;
  cursor: pointer;
  transition: border-color 0.15s, box-shadow 0.15s;
}

.item-card.selected {
  border: 2px solid var(--q-primary);
  box-shadow: 0 0 8px rgba(25, 118, 210, 0.3);
}

.selection-indicator {
  position: absolute;
  top: 6px;
  left: 6px;
  z-index: 10;
  background: white;
  border-radius: 4px;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
}

.item-image {
  width: 100%;
  height: 110px;
  object-fit: cover;
}

/* ── Debug drawer ── */
.debug-logs {
  max-height: calc(100vh - 150px);
  overflow-y: auto;
}

.debug-log {
  padding: 8px;
  margin-bottom: 6px;
  border-radius: 4px;
  font-size: 12px;
  border-left: 3px solid;
}

.log-info { background: #e3f2fd; border-color: #2196f3; }
.log-error { background: #ffebee; border-color: #f44336; }
.log-success { background: #e8f5e9; border-color: #4caf50; }

.log-time { font-weight: bold; margin-bottom: 2px; opacity: 0.7; }
.log-message { word-break: break-word; }
</style>
