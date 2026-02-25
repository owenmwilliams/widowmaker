<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { useQuasar } from 'quasar';
import { useDetectorStore } from '../stores/DetectorStore';
import { DetectorType } from '../utils/detectors';

const $q = useQuasar();
const router = useRouter();
const detectorStore = useDetectorStore();

const loading = ref(false);
const customUrl = ref('');
const showCustomInput = ref(false);
const isDevelopment = import.meta.env.MODE === 'development';

interface ModelOption {
  type: DetectorType;
  name: string;
  description: string;
  icon: string;
  color: string;
}

const models: ModelOption[] = [
  {
    type: 'yolo-world-v2',
    name: 'YOLO-World V2 (Recommended)',
    description: '20 items, 320px, INT8 quantized - Fast & optimized for mobile',
    icon: 'bolt',
    color: 'positive'
  },
  {
    type: 'yolo-world-v1',
    name: 'YOLO-World V1',
    description: '100 items, 640px - More items, slower performance',
    icon: 'inventory_2',
    color: 'primary'
  },
  {
    type: 'coco-ssd',
    name: 'COCO-SSD (Fallback)',
    description: '80 common objects - Fast but generic',
    icon: 'speed',
    color: 'grey'
  }
];

async function selectModel(type: DetectorType) {
  loading.value = true;

  try {
    await detectorStore.loadDetector(type);

    $q.notify({
      message: 'Model loaded successfully!',
      type: 'positive',
      icon: 'check_circle',
      timeout: 1500
    });

    // Navigate to scanning page
    router.push('/mobile-live-scan');
  } catch (error: any) {
    console.error('Failed to load model:', error);

    $q.notify({
      message: `Failed to load model: ${error.message}`,
      type: 'negative',
      timeout: 5000,
      actions: [{ label: 'Dismiss', color: 'white' }]
    });
  } finally {
    loading.value = false;
  }
}

async function loadCustomModel() {
  if (!customUrl.value.trim()) {
    $q.notify({
      message: 'Please enter a model URL',
      type: 'warning'
    });
    return;
  }

  loading.value = true;

  try {
    // Determine type based on URL or default to V2
    const type: DetectorType = customUrl.value.includes('v1')
      ? 'yolo-world-v1'
      : 'yolo-world-v2';

    await detectorStore.loadDetector(type, customUrl.value);

    $q.notify({
      message: 'Custom model loaded successfully!',
      type: 'positive',
      icon: 'check_circle',
      timeout: 1500
    });

    router.push('/mobile-live-scan');
  } catch (error: any) {
    console.error('Failed to load custom model:', error);

    $q.notify({
      message: `Failed to load model: ${error.message}`,
      type: 'negative',
      timeout: 5000,
      actions: [{ label: 'Dismiss', color: 'white' }]
    });
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <q-page class="model-selection-page">
    <!-- Header -->
    <div class="header q-pa-md bg-primary text-white">
      <q-btn
        flat
        dense
        round
        icon="arrow_back"
        @click="router.push('/')"
        class="q-mr-sm"
      />
      <div class="text-h5">Select Detection Model</div>
      <div class="text-caption q-mt-xs">Choose a model to start scanning</div>
    </div>

    <!-- Content -->
    <div class="content q-pa-md">
      <!-- Predefined Models -->
      <div class="q-mb-lg">
        <div class="text-subtitle1 text-weight-medium q-mb-md">Production Models</div>

        <q-list bordered separator>
          <q-item
            v-for="model in models"
            :key="model.type"
            clickable
            @click="selectModel(model.type)"
            :disable="loading"
            class="model-item"
          >
            <q-item-section avatar>
              <q-avatar :color="model.color" text-color="white" :icon="model.icon" />
            </q-item-section>

            <q-item-section>
              <q-item-label>{{ model.name }}</q-item-label>
              <q-item-label caption lines="2">{{ model.description }}</q-item-label>
            </q-item-section>

            <q-item-section side>
              <q-icon name="chevron_right" />
            </q-item-section>
          </q-item>
        </q-list>
      </div>

      <!-- Custom Model (Dev Only) -->
      <div v-if="isDevelopment">
        <div class="text-subtitle1 text-weight-medium q-mb-md">
          Custom Model (Development)
        </div>

        <q-card flat bordered>
          <q-card-section>
            <div class="text-caption text-grey-7 q-mb-md">
              Load a custom YOLO-World model from Google Cloud Storage for testing
            </div>

            <q-input
              v-model="customUrl"
              label="Model URL"
              placeholder="https://storage.googleapis.com/..."
              outlined
              dense
              :disable="loading"
            >
              <template v-slot:prepend>
                <q-icon name="link" />
              </template>
            </q-input>

            <div class="q-mt-md">
              <q-btn
                color="primary"
                label="Load Custom Model"
                @click="loadCustomModel"
                :disable="!customUrl.trim() || loading"
                :loading="loading"
                class="full-width"
              />
            </div>

            <!-- Quick Links -->
            <div class="q-mt-md">
              <div class="text-caption text-grey-7 q-mb-xs">Quick Links:</div>
              <q-btn
                flat
                dense
                size="sm"
                label="V2 INT8"
                @click="customUrl = 'https://storage.googleapis.com/widowmaker-site-images/models/yolo_world_household_v2_int8.onnx'"
                class="q-mr-xs"
              />
              <q-btn
                flat
                dense
                size="sm"
                label="V1 Original"
                @click="customUrl = 'https://storage.googleapis.com/widowmaker-site-images/models/yolo_world_household.onnx'"
              />
            </div>
          </q-card-section>
        </q-card>
      </div>
    </div>

    <!-- Loading Overlay -->
    <q-inner-loading :showing="loading">
      <div class="text-center">
        <q-spinner-dots size="3rem" color="primary" />
        <div class="text-h6 q-mt-md">Loading model...</div>
        <div class="text-caption text-grey-7">This may take 5-15 seconds</div>
      </div>
    </q-inner-loading>
  </q-page>
</template>

<style scoped>
.model-selection-page {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: #f5f5f5;
}

.header {
  flex-shrink: 0;
}

.content {
  flex: 1;
  overflow-y: auto;
}

.model-item {
  background: white;
}

.model-item:hover {
  background: #f5f5f5;
}
</style>
