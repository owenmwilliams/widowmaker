<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
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

const buildHeaders = () => {
  const token = localStorage.getItem('session_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
};

type CapturedItem = {
  id: string;
  cropUrl: string;
  bbox: { x: number; y: number; width: number; height: number };
  classifying: boolean;
  classified?: {
    name: string;
    description: string;
    estimatedWeight: number;
    fragile: boolean;
  };
  timestamp: number;
};

// State
const videoRef = ref<HTMLVideoElement | null>(null);
const canvasRef = ref<HTMLCanvasElement | null>(null);
const cameraReady = ref(false);
const scanning = ref(false);
const detectorReady = ref(false);
const detections = ref<any[]>([]);
const capturedItems = ref<CapturedItem[]>([]);

let stream: MediaStream | null = null;
let animationFrameId: number | null = null;
let objectDetector: ObjectDetector | null = null;

// Lifecycle
onMounted(async () => {
  await loadDetector();
  await startCamera();
});

onUnmounted(() => {
  stopScanning();
  stopCamera();
  if (objectDetector) {
    objectDetector.close();
  }
});

// Load MediaPipe ObjectDetector
async function loadDetector() {
  let loadingNotif: any = null;
  try {
    loadingNotif = $q.notify({
      message: 'Loading object detector...',
      type: 'info',
      spinner: true,
      timeout: 0
    });

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

    // Dismiss loading notification
    if (loadingNotif) {
      loadingNotif();
    }

    $q.notify({
      message: 'Detector ready!',
      type: 'positive',
      icon: 'check_circle',
      timeout: 1500
    });
  } catch (err: any) {
    console.error('Failed to load detector:', err);

    // Dismiss loading notification on error
    if (loadingNotif) {
      loadingNotif();
    }

    $q.notify({
      message: `Failed to load detector: ${err.message}`,
      type: 'negative'
    });
  }
}

// Camera
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

// Scanning
let lastFrameTime = 0;
const FRAME_INTERVAL_MS = 100; // 10 FPS

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
  if (animationFrameId !== null) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
  }
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
    const box = det.bbox;

    ctx.strokeStyle = '#00ff00';
    ctx.lineWidth = 3;
    ctx.strokeRect(box.originX, box.originY, box.width, box.height);

    ctx.fillStyle = 'rgba(0, 255, 0, 0.3)';
    ctx.fillRect(box.originX, box.originY, box.width, box.height);

    ctx.fillStyle = '#00ff00';
    ctx.font = 'bold 16px Arial';
    const label = `${det.category} ${Math.round(det.score * 100)}%`;
    const textMetrics = ctx.measureText(label);
    ctx.fillRect(box.originX, box.originY - 24, textMetrics.width + 10, 24);

    ctx.fillStyle = '#000';
    ctx.fillText(label, box.originX + 5, box.originY - 6);
  });
}

// Capture item on tap
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
    if (
      clickX >= box.originX &&
      clickX <= box.originX + box.width &&
      clickY >= box.originY &&
      clickY <= box.originY + box.height
    ) {
      captureItem(det);
      break;
    }
  }
}

function captureItem(det: any) {
  const video = videoRef.value;
  if (!video) return;

  const box = det.bbox;

  // Create crop
  const cropCanvas = document.createElement('canvas');
  cropCanvas.width = box.width;
  cropCanvas.height = box.height;
  const cropCtx = cropCanvas.getContext('2d');
  if (!cropCtx) return;

  cropCtx.drawImage(
    video,
    box.originX,
    box.originY,
    box.width,
    box.height,
    0,
    0,
    box.width,
    box.height
  );
  const cropUrl = cropCanvas.toDataURL('image/jpeg', 0.85);

  const item: CapturedItem = {
    id: `item-${Date.now()}`,
    cropUrl,
    bbox: { x: box.originX, y: box.originY, width: box.width, height: box.height },
    classifying: false,
    timestamp: Date.now()
  };

  capturedItems.value.unshift(item);

  $q.notify({
    message: `Captured ${det.category}`,
    type: 'positive',
    icon: 'photo_camera'
  });

  // Auto-classify
  classifyItem(item);
}

async function classifyItem(item: CapturedItem) {
  if (item.classified || item.classifying) return;

  item.classifying = true;

  try {
    const response = await fetch(item.cropUrl);
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

    // API returns { success: true, data: { name, description, ... } }
    if (res.data.success && res.data.data) {
      item.classified = res.data.data;
      item.classifying = false;

      $q.notify({
        message: `Classified: ${item.classified?.name || 'Unknown'}`,
        type: 'positive',
        icon: 'auto_awesome'
      });
    } else {
      throw new Error(res.data.error || 'Classification failed');
    }
  } catch (err: any) {
    console.error('Classification failed:', err);
    item.classifying = false;
    $q.notify({
      message: `Classification failed: ${err.message || 'Unknown error'}`,
      type: 'negative'
    });
  }
}

function removeItem(item: CapturedItem) {
  capturedItems.value = capturedItems.value.filter(i => i.id !== item.id);
}
</script>

<template>
  <div class="mobile-live-scan">
    <!-- Header -->
    <div class="header q-pa-md bg-primary text-white">
      <div class="row items-center justify-between">
        <div class="row items-center">
          <q-btn
            flat
            dense
            round
            icon="arrow_back"
            @click="router.push('/')"
            class="q-mr-sm"
          />
          <div>
            <div class="text-h6">Live Scan</div>
            <div class="text-caption">MediaPipe Object Detection</div>
          </div>
        </div>
      </div>
    </div>

    <!-- Camera View -->
    <div class="camera-container">
      <video ref="videoRef" autoplay playsinline muted style="display: none"></video>
      <canvas ref="canvasRef" @click="handleCanvasTap" class="detection-canvas"></canvas>

      <!-- Loading overlay -->
      <div v-if="!cameraReady || !detectorReady" class="loading-overlay">
        <q-spinner-dots size="3rem" color="white" />
        <div class="text-white text-h6 q-mt-md">
          {{ !cameraReady ? 'Starting camera...' : 'Loading detector...' }}
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
          :disable="!cameraReady || !detectorReady"
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

      <!-- Captured items -->
      <div v-if="capturedItems.length > 0" class="captured-items">
        <div class="text-subtitle2 text-grey-8 q-mb-sm">
          Captured Items ({{ capturedItems.length }})
          <span class="text-caption text-positive q-ml-xs">
            {{ capturedItems.filter(i => i.classified).length }} classified
          </span>
        </div>

        <div class="items-grid">
          <q-card
            v-for="item in capturedItems"
            :key="item.id"
            flat
            bordered
            class="item-card"
          >
            <img :src="item.cropUrl" class="item-image" />

            <q-card-section class="q-pa-sm">
              <div class="text-subtitle2">
                {{ item.classified?.name || 'Classifying...' }}
              </div>

              <div v-if="item.classified" class="q-mt-xs text-caption">
                <div>{{ item.classified.description }}</div>
                <div>Weight: ~{{ item.classified.estimatedWeight }}lbs</div>
                <div v-if="item.classified.fragile" class="text-warning">⚠️ Fragile</div>
              </div>

              <div v-else-if="item.classifying" class="q-mt-xs">
                <q-spinner-dots size="sm" color="primary" />
              </div>
            </q-card-section>

            <q-card-actions align="right" class="q-pa-sm">
              <q-btn
                v-if="!item.classified && !item.classifying"
                flat
                dense
                size="sm"
                color="primary"
                icon="auto_awesome"
                label="Classify"
                @click="classifyItem(item)"
              />
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

.captured-items {
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
