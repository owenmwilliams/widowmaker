<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import { useQuasar } from 'quasar';
import axios from 'axios';
import type { InventoryItem } from '../data/inventoryItems';
import { inventoryStore } from '../stores/InventoryStore';

const $q = useQuasar();
const store = inventoryStore();

// To adjust url based on whether in prod or not
const core_url = import.meta.env.MODE == 'development' ? 'http://localhost:3050' : 'https://movetrack-api-7hwn7ggbiq-uc.a.run.app';

const emit = defineEmits<{
  (e: 'item-added', item: InventoryItem): void;
  (e: 'close'): void;
}>();

// Vision provider (passed from parent or defaults to current backend setting)
const props = defineProps<{
  visionProvider?: string;
  user?: string;
  autoOpen?: boolean;
  defaultCaptureMode?: 'single' | 'multi';
}>();

// Camera/Photo state
const showCamera = ref(false);
const capturedImage = ref<string | null>(null);
const isProcessing = ref(false);

// Capture mode: 'single' or 'multi'
const captureMode = ref<'single' | 'multi'>('single');
const showModeSelection = ref(true);

const applyDefaultCaptureMode = (mode?: 'single' | 'multi') => {
  if (mode) {
    captureMode.value = mode;
    showModeSelection.value = false;
  } else {
    captureMode.value = 'single';
    showModeSelection.value = true;
  }
};

watch(
  () => props.defaultCaptureMode,
  (mode) => {
    applyDefaultCaptureMode(mode);
  },
  { immediate: true }
);

// Multi-item state
interface DetectedItem {
  id: number;
  name: string;
  boundingBox: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  confidence: number;
}

const detectedItems = ref<DetectedItem[]>([]);
const selectedItemIndex = ref<number | null>(null);
const imageNaturalDimensions = ref({ width: 0, height: 0 });

// Loading overlay state
const loadingMessage = ref('');
const loadingMessageInterval = ref<number | null>(null);

// Fun loading messages
const loadingMessages = [
  'Analyzing your treasure...',
  'Counting pixels...',
  'Consulting the AI oracle...',
  'Identifying mysterious objects...',
  'Channeling digital intuition...',
  'Teaching robots to see...',
  'Decoding visual mysteries...',
  'Summoning computer vision...',
  'Reading the item tea leaves...',
  'Activating neural networks...',
  'Examining every detail...',
  'Making educated guesses...',
  'Putting on AI glasses...',
  'Detecting object essence...',
  'Unleashing image recognition...'
];

// Item editing state
const newItem = ref<Partial<InventoryItem>>({
  name: '',
  qty: 1,
  size: '',
  weight: '',
  material: '',
  primaryColor: '',
  description: '',
  tags: []
});

const editDimensions = ref({ length: 0, width: 0, height: 0 });
const editWeight = ref(0);
const editFragile = ref(false);
const duplicateThreshold = 0.4;
const activeCollectionId = computed<number | null>(() => {
  const refValue = store.activeCollection?.value as { value: number } | undefined;
  return refValue?.value ?? null;
});
const analyzeItemBlob = async (blob: Blob) => {
  const sessionToken = localStorage.getItem('session_token');
  if (!sessionToken) {
    throw new Error('Please log in to analyze items');
  }

  const formData = new FormData();
  formData.append('image', blob, 'item.jpg');
  const providerParam = props.visionProvider ? `?provider=${props.visionProvider}` : '';

  const response = await axios.post(`${core_url}/vision/analyze-item${providerParam}`, formData, {
    headers: {
      'Content-Type': 'multipart/form-data',
      Authorization: `Bearer ${sessionToken}`
    }
  });

  if (response.data?.success) {
    return response.data.data;
  }

  throw new Error(response.data?.error || 'Vision analysis failed');
};

const tokenize = (value?: string | null) => {
  if (!value) return [];
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
};

const similarityScore = (aTokens: string[], bTokens: string[]) => {
  if (!aTokens.length || !bTokens.length) return 0;
  const setA = new Set(aTokens);
  const setB = new Set(bTokens);
  const intersection = [...setA].filter(token => setB.has(token));
  return intersection.length / Math.min(setA.size, setB.size);
};

const potentialMatches = computed(() => {
  const targetTokens = tokenize(newItem.value.name);
  if (!targetTokens.length) return [];

  return store.items
    .map(item => {
      const tokens = tokenize(item.label);
      const score = similarityScore(targetTokens, tokens);
      const isExact = newItem.value?.name?.trim().toLowerCase() === item.label?.trim().toLowerCase();
      const sameCollection = !!activeCollectionId.value && item.collection === activeCollectionId.value;
      return {
        id: item.value,
        name: item.label,
        collection: store.collections.find(c => c.value === item.collection)?.label || 'Unassigned',
        container: store.containers.find(c => c.value === item.container)?.label || 'No container',
        score: isExact ? 1 : score,
        sameCollection
      };
    })
    .filter(match => match.score >= duplicateThreshold || match.sameCollection)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
});

const handleUseExistingItem = (itemId: number) => {
  if (!props.user) {
    $q.notify({
      type: 'warning',
      message: 'Please log in again to edit existing items.'
    });
    return;
  }
  store.openItemDetailsModal(itemId, props.user);
  emit('close');
  $q.notify({
    type: 'info',
    message: 'Opening existing item for review',
    position: 'bottom'
  });
};

// File input ref
const fileInput = ref<HTMLInputElement | null>(null);

const isMobile = computed(() => {
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
});

// Start loading message rotation
const startLoadingMessages = () => {
  // Set initial message
  loadingMessage.value = loadingMessages[Math.floor(Math.random() * loadingMessages.length)];

  // Rotate messages every 2.5 seconds
  loadingMessageInterval.value = window.setInterval(() => {
    loadingMessage.value = loadingMessages[Math.floor(Math.random() * loadingMessages.length)];
  }, 2500);
};

// Stop loading message rotation
const stopLoadingMessages = () => {
  if (loadingMessageInterval.value) {
    clearInterval(loadingMessageInterval.value);
    loadingMessageInterval.value = null;
  }
  loadingMessage.value = '';
};

// Crop image based on bounding box
const cropImageFromBoundingBox = async (
  imageDataUrl: string,
  boundingBox: { x: number; y: number; width: number; height: number },
  naturalDimensions: { width: number; height: number }
): Promise<Blob> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      // Create canvas for cropping
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');

      if (!ctx) {
        reject(new Error('Failed to get canvas context'));
        return;
      }

      // Calculate actual pixel coordinates from normalized values
      const cropX = boundingBox.x * naturalDimensions.width;
      const cropY = boundingBox.y * naturalDimensions.height;
      const cropWidth = boundingBox.width * naturalDimensions.width;
      const cropHeight = boundingBox.height * naturalDimensions.height;

      // Set canvas size to crop dimensions
      canvas.width = cropWidth;
      canvas.height = cropHeight;

      // Draw the cropped portion
      ctx.drawImage(
        img,
        cropX, cropY, cropWidth, cropHeight,  // Source rectangle
        0, 0, cropWidth, cropHeight            // Destination rectangle
      );

      // Convert canvas to blob
      canvas.toBlob((blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error('Failed to create blob from canvas'));
        }
      }, 'image/jpeg', 0.9);
    };

    img.onerror = () => {
      reject(new Error('Failed to load image'));
    };

    img.src = imageDataUrl;
  });
};

// Open camera or file picker
const openCamera = () => {
  showModeSelection.value = false;
  if (fileInput.value) {
    fileInput.value.click();
  }
};

// Select capture mode
const selectMode = (mode: 'single' | 'multi') => {
  captureMode.value = mode;
  openCamera();
};

// Handle photo capture
const handlePhotoCapture = async (event: Event) => {
  const target = event.target as HTMLInputElement;
  const file = target.files?.[0];

  if (!file) return;

  isProcessing.value = true;

  // Create image preview
  const reader = new FileReader();
  reader.onload = (e) => {
    capturedImage.value = e.target?.result as string;

    // For multi-item mode, also get image dimensions
    if (captureMode.value === 'multi') {
      const img = new Image();
      img.onload = () => {
        imageNaturalDimensions.value = { width: img.naturalWidth, height: img.naturalHeight };
      };
      img.src = e.target?.result as string;
    }
  };
  reader.readAsDataURL(file);

  // Branch based on capture mode
  if (captureMode.value === 'single') {
    await handleSingleItemCapture(file);
  } else {
    await handleMultiItemCapture(file);
  }
};

// Handle single-item capture (original behavior)
const handleSingleItemCapture = async (file: File) => {
  // Start rotating loading messages
  startLoadingMessages();

  try {
    // Get session token for authentication
    const sessionToken = localStorage.getItem('session_token');

    if (!sessionToken) {
      throw new Error('Please log in to use AI-powered photo analysis');
    }

    // Call vision API
    const formData = new FormData();
    formData.append('image', file);

    const providerParam = props.visionProvider ? `?provider=${props.visionProvider}` : '';
    const response = await axios.post(`${core_url}/vision/analyze-item${providerParam}`, formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
        'Authorization': `Bearer ${sessionToken}`
      }
    });

    if (response.data.success) {
      const aiData = response.data.data;

      // Safely extract dimensions with fallback values
      const dimensions = aiData.estimatedDimensions || { length: 6, width: 4, height: 4 };
      const weight = aiData.estimatedWeight || 1.0;

      // Map AI response to item format
      newItem.value = {
        name: aiData.name || detectItemName(file.name),
        qty: 1,
        size: `${dimensions.length}"×${dimensions.width}"×${dimensions.height}"`,
        weight: `${weight} lbs`,
        material: aiData.material || '',
        primaryColor: aiData.color || '',
        description: aiData.reasoning || 'Item detected from photo',
        tags: Array.isArray(aiData.tags) ? aiData.tags : [],
        image: capturedImage.value || ''
      };

      editDimensions.value = {
        length: dimensions.length || 0,
        width: dimensions.width || 0,
        height: dimensions.height || 0
      };
      editWeight.value = weight;
      editFragile.value = aiData.fragile || false;

      const providerName = response.data.provider || 'AI';
      const confidencePercent = aiData.confidence ? Math.round(aiData.confidence * 100) : 80;

      $q.notify({
        type: 'positive',
        message: `Item detected! (${providerName}, ${confidencePercent}% confidence)`,
        caption: 'Review and confirm details below',
        position: 'bottom',
        timeout: 3000
      });
    } else {
      throw new Error(response.data.error || 'Failed to analyze image');
    }
  } catch (error: any) {
    console.error('Vision API error:', error);

    // Fallback to basic detection
    newItem.value = {
      name: detectItemName(file.name),
      qty: 1,
      size: '6"×4"×4"',
      weight: '1.0 lbs',
      material: '',
      primaryColor: '',
      description: 'Please update item details manually',
      tags: [],
      image: capturedImage.value || ''
    };

    editDimensions.value = { length: 6, width: 4, height: 4 };
    editWeight.value = 1.0;
    editFragile.value = false;

    $q.notify({
      type: 'warning',
      message: 'Could not analyze image automatically',
      caption: error.response?.data?.error || error.message || 'Please enter details manually',
      position: 'bottom',
      timeout: 3000
    });
  } finally {
    isProcessing.value = false;
    showCamera.value = false;
    stopLoadingMessages();
  }
};

// Handle multi-item capture (new feature)
const handleMultiItemCapture = async (file: File) => {
  // Start rotating loading messages
  startLoadingMessages();

  try {
    // Get session token for authentication
    const sessionToken = localStorage.getItem('session_token');

    if (!sessionToken) {
      throw new Error('Please log in to use AI-powered photo analysis');
    }

    // Call multi-item vision API
    const formData = new FormData();
    formData.append('image', file);

    const providerParam = props.visionProvider ? `?provider=${props.visionProvider}` : '';
    const response = await axios.post(`${core_url}/vision/analyze-multi-item${providerParam}`, formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
        'Authorization': `Bearer ${sessionToken}`
      }
    });

    if (response.data.success) {
      const aiData = response.data.data;

      // Store detected items
      detectedItems.value = aiData.items || [];

      const providerName = response.data.provider || 'AI';
      const itemCount = aiData.itemCount || detectedItems.value.length;

      $q.notify({
        type: 'positive',
        message: `${itemCount} items detected! (${providerName})`,
        caption: 'Click on an item to add it to inventory',
        position: 'bottom',
        timeout: 3000
      });
    } else {
      throw new Error(response.data.error || 'Failed to analyze image');
    }
  } catch (error: any) {
    console.error('Multi-item Vision API error:', error);

    $q.notify({
      type: 'warning',
      message: 'Could not detect multiple items',
      caption: error.response?.data?.error || error.message || 'Try single-item mode instead',
      position: 'bottom',
      timeout: 3000
    });

    // Reset to mode selection
    resetForm();
    showModeSelection.value = true;
  } finally {
    isProcessing.value = false;
    showCamera.value = false;
    stopLoadingMessages();
  }
};

// Simple name detection from filename
const detectItemName = (filename: string): string => {
  return filename
    .replace(/\.[^/.]+$/, '') // Remove extension
    .replace(/[_-]/g, ' ') // Replace underscores/hyphens with spaces
    .replace(/\b\w/g, l => l.toUpperCase()); // Capitalize
};

// Save item
const saveItem = async () => {
  if (!newItem.value.name) {
    $q.notify({
      type: 'warning',
      message: 'Please enter an item name',
      position: 'bottom'
    });
    return;
  }

  // Check if we have an active collection (required for items)
  if (!store.activeCollection?.value) {
    $q.notify({
      type: 'warning',
      message: 'Please select a collection first',
      caption: 'Items must be added to a collection',
      position: 'bottom'
    });
    return;
  }

  // Check if user is provided
  if (!props.user) {
    $q.notify({
      type: 'negative',
      message: 'User not found. Please log in again.',
      position: 'bottom'
    });
    return;
  }

  try {
    // Show loading
    $q.loading.show({
      message: 'Saving item to inventory...'
    });

    // Construct dimensions string
    const dimensions = `${editDimensions.value.length}"×${editDimensions.value.width}"×${editDimensions.value.height}"`;

    // Convert base64 image to blob if available
    let imageBlob: Blob | undefined;
    if (capturedImage.value) {
      const response = await fetch(capturedImage.value);
      imageBlob = await response.blob();
    }

    // Call the inventory store's createItem function
    await store.createItem(
      props.user,
      newItem.value.name,
      newItem.value.description || '',
      newItem.value.qty || 1,
      store.activeCollection.value,
      store.activeContainer?.value,
      imageBlob,
      null, // estimatedValue
      editFragile.value,
      undefined, // priority
      editWeight.value,
      dimensions,
      editDimensions.value.length || null,
      editDimensions.value.width || null,
      editDimensions.value.height || null,
      `Material: ${newItem.value.material || 'N/A'}, Color: ${newItem.value.primaryColor || 'N/A'}`,
      newItem.value.material || undefined,
      newItem.value.primaryColor || undefined,
      newItem.value.tags || []
    );

    // Reload inventory to show new item
    await store.loadInventory(props.user);

    $q.notify({
      type: 'positive',
      message: `${newItem.value.name} added to inventory!`,
      position: 'bottom',
      timeout: 2000
    });

    resetForm();
    emit('close');
  } catch (error: any) {
    console.error('Error saving item:', error);

    // Check if it's a 401 authentication error
    if (error.response?.status === 401) {
      $q.notify({
        type: 'negative',
        message: 'Session Expired',
        caption: 'Please log out and log back in to continue',
        position: 'bottom',
        timeout: 5000,
        actions: [
          { label: 'Dismiss', color: 'white' }
        ]
      });
    } else {
      $q.notify({
        type: 'negative',
        message: 'Failed to save item',
        caption: error.message || 'Please try again',
        position: 'bottom'
      });
    }
  } finally {
    $q.loading.hide();
  }
};

// Quick confirm (uses AI-detected values as-is)
const quickConfirm = () => {
  saveItem();
};

// Handle adding a multi-item detection result
const handleMultiItemAdd = async (item: DetectedItem, index: number) => {
  // Check if we have an active collection (required for items)
  if (!store.activeCollection?.value) {
    $q.notify({
      type: 'warning',
      message: 'Please select a collection first',
      caption: 'Items must be added to a collection',
      position: 'bottom'
    });
    return;
  }

  // Check if user is provided
  if (!props.user) {
    $q.notify({
      type: 'negative',
      message: 'User not found. Please log in again.',
      position: 'bottom'
    });
    return;
  }

  try {
    // Show loading
    $q.loading.show({
      message: `Analyzing ${item.name}...`
    });

    // Crop the image based on bounding box
    let imageBlob: Blob | undefined;
    if (capturedImage.value) {
      try {
        imageBlob = await cropImageFromBoundingBox(
          capturedImage.value,
          item.boundingBox,
          imageNaturalDimensions.value
        );
      } catch (error) {
        console.error('Failed to crop image, using full image instead:', error);
        // Fallback to full image if cropping fails
        const response = await fetch(capturedImage.value);
        imageBlob = await response.blob();
      }
    }

    let aiDetails: any = null;
    if (imageBlob) {
      try {
        aiDetails = await analyzeItemBlob(imageBlob);
      } catch (analysisError) {
        console.warn('Unable to fetch AI details for multi-item capture', analysisError);
      }
    }

    const dimensions = aiDetails?.estimatedDimensions;
    const weightEstimate = aiDetails?.estimatedWeight;
    const description = aiDetails?.reasoning || 'Detected from multi-item photo';
    const tags = Array.isArray(aiDetails?.tags) ? aiDetails.tags : [];
    const material = aiDetails?.material ?? '';
    const color = aiDetails?.color ?? '';

    const dimensionString = dimensions
      ? `${dimensions.length}"×${dimensions.width}"×${dimensions.height}"`
      : '';

    const lengthIn = dimensions?.length ?? null;
    const widthIn = dimensions?.width ?? null;
    const heightIn = dimensions?.height ?? null;

    // Call the inventory store's createItem function with minimal details
    await store.createItem(
      props.user,
      item.name,
      description,
      1, // quantity
      store.activeCollection.value,
      store.activeContainer?.value,
      imageBlob,
      null, // estimatedValue
      aiDetails?.fragile ?? false,
      undefined, // priority
      weightEstimate ?? null,
      dimensionString,
      lengthIn,
      widthIn,
      heightIn,
      `Material: ${material || 'N/A'}, Color: ${color || 'N/A'}`,
      material || undefined,
      color || undefined,
      tags
    );

    // Reload inventory to show new item
    await store.loadInventory(props.user);

    $q.notify({
      type: 'positive',
      message: aiDetails ? `${item.name} added with AI details!` : `${item.name} added!`,
      position: 'bottom',
      timeout: 2000
    });

    // Remove the item from the detected items list
    detectedItems.value.splice(index, 1);

    // If no more items, close and reset
    if (detectedItems.value.length === 0) {
      $q.notify({
        type: 'info',
        message: 'All items added!',
        position: 'bottom',
        timeout: 2000
      });
      resetForm();
      emit('close');
    }
  } catch (error: any) {
    console.error('Error adding multi-item:', error);

    $q.notify({
      type: 'negative',
      message: 'Failed to add item',
      caption: error.message || 'Please try again',
      position: 'bottom'
    });
  } finally {
    $q.loading.hide();
  }
};

// Reset form
const resetForm = () => {
  capturedImage.value = null;
  detectedItems.value = [];
  selectedItemIndex.value = null;
  newItem.value = {
    name: '',
    qty: 1,
    size: '',
    weight: '',
    material: '',
    primaryColor: '',
    description: '',
    tags: []
  };
  editDimensions.value = { length: 0, width: 0, height: 0 };
  editWeight.value = 0;
  editFragile.value = false;
};

// Cancel and close
const cancel = () => {
  resetForm();
  emit('close');
};

// Auto-open camera if prop is set
onMounted(() => {
  if (props.autoOpen) {
    openCamera();
  }
});
</script>

<template>
  <div class="photo-capture-container">
    <!-- Hidden file input -->
    <input
      ref="fileInput"
      type="file"
      accept="image/*"
      capture="environment"
      style="display: none"
      @change="handlePhotoCapture"
    />

    <!-- Full-screen loading overlay with image and rotating messages -->
    <div v-if="isProcessing && capturedImage" class="loading-overlay">
      <img :src="capturedImage || undefined" alt="Processing" class="loading-overlay-image" />
      <div class="loading-overlay-content">
        <q-spinner-dots color="white" size="60px" />
        <div class="loading-message">{{ loadingMessage }}</div>
      </div>
    </div>

    <!-- No photo captured - show mode selection or camera button -->
    <div v-if="!capturedImage && !detectedItems.length" class="camera-prompt">
      <!-- Mode selection -->
      <div v-if="showModeSelection">
        <q-icon name="photo_camera" size="80px" color="primary" class="camera-icon" />
        <h3 class="prompt-title">Photograph Items</h3>
        <p class="prompt-text">Choose how many items to detect in your photo:</p>

        <div class="mode-selection">
          <q-btn
            unelevated
            color="primary"
            size="lg"
            icon="filter_1"
            label="Single Item"
            class="mode-btn"
            @click="selectMode('single')"
          />

          <q-btn
            unelevated
            color="secondary"
            size="lg"
            icon="filter_9_plus"
            label="Multiple Items"
            class="mode-btn q-mt-sm"
            @click="selectMode('multi')"
          />
        </div>

        <q-btn
          flat
          color="grey-7"
          label="Cancel"
          class="q-mt-md"
          @click="cancel"
        />
      </div>

      <!-- Direct camera button (when mode already selected) -->
      <div v-else>
        <q-icon name="photo_camera" size="80px" color="primary" class="camera-icon" />
        <h3 class="prompt-title">Photograph an Item</h3>
        <p class="prompt-text">Tap below to take a photo. Our AI will automatically detect item details.</p>

        <q-btn
          unelevated
          color="primary"
          size="lg"
          icon="photo_camera"
          label="Take Photo"
          class="camera-btn"
          :loading="isProcessing"
          @click="openCamera"
        />

        <q-btn
          flat
          color="grey-7"
          label="Cancel"
          class="q-mt-md"
          @click="cancel"
        />
      </div>
    </div>

    <!-- Multi-item detection results - show bounding boxes -->
    <div v-else-if="detectedItems.length > 0" class="multi-item-container">
      <div class="image-preview">
        <img :src="capturedImage || undefined" ref="multiItemImage" alt="Captured items" class="preview-img" />
        <q-btn
          round
          flat
          icon="close"
          color="white"
          class="retake-btn"
          @click="resetForm"
        />

        <!-- Bounding boxes -->
        <div
          v-for="(item, index) in detectedItems"
          :key="item.id"
          class="bounding-box"
          :class="{ 'selected': selectedItemIndex === index }"
          :style="{
            left: `${item.boundingBox.x * 100}%`,
            top: `${item.boundingBox.y * 100}%`,
            width: `${item.boundingBox.width * 100}%`,
            height: `${item.boundingBox.height * 100}%`
          }"
          @click="selectedItemIndex = index"
        >
          <div class="item-label">{{ item.name }}</div>
        </div>
      </div>

      <div class="multi-item-info">
        <h4 class="form-title">{{ detectedItems.length }} Items Detected</h4>
        <p class="info-text">Tap an item below to add it to your inventory.</p>

        <q-list bordered separator class="detected-items-list">
          <q-item
            v-for="(item, index) in detectedItems"
            :key="item.id"
            clickable
            :active="selectedItemIndex === index"
            @click="handleMultiItemAdd(item, index)"
          >
            <q-item-section>
              <q-item-label>{{ item.name }}</q-item-label>
            </q-item-section>
            <q-item-section side>
              <q-icon name="add_circle" color="primary" />
            </q-item-section>
          </q-item>
        </q-list>

        <q-btn
          flat
          color="grey-7"
          label="Start Over"
          class="q-mt-md"
          @click="resetForm(); showModeSelection = true"
        />
      </div>
    </div>

    <!-- Photo captured - show quick edit -->
    <div v-else class="photo-preview-container">
      <!-- Image preview -->
      <div class="image-preview">
        <img :src="capturedImage || undefined" alt="Captured item" class="preview-img" />
        <q-btn
          round
          flat
          icon="close"
          color="white"
          class="retake-btn"
          @click="resetForm"
        />
      </div>

      <!-- Quick edit form -->
      <div class="quick-edit-form">
        <h4 class="form-title">Review Item Details</h4>

        <q-input
          v-model="newItem.name"
          label="Item Name *"
          outlined
          dense
          class="form-field"
        />

        <div class="dimensions-row">
          <q-input
            v-model.number="editDimensions.length"
            label="L (in)"
            type="number"
            outlined
            dense
            class="dimension-input"
          />
          <q-input
            v-model.number="editDimensions.width"
            label="W (in)"
            type="number"
            outlined
            dense
            class="dimension-input"
          />
          <q-input
            v-model.number="editDimensions.height"
            label="H (in)"
            type="number"
            outlined
            dense
            class="dimension-input"
          />
        </div>

        <q-input
          v-model.number="editWeight"
          label="Weight"
          type="number"
          suffix="lbs"
          outlined
          dense
          class="form-field"
        />

        <div class="expandable-fields">
          <q-expansion-item
            label="More Details (Optional)"
            icon="tune"
            dense
            header-class="text-grey-7"
          >
            <div class="q-pa-md">
              <q-input
                v-model="newItem.material"
                label="Material"
                outlined
                dense
                class="form-field"
              />

              <q-input
                v-model="newItem.primaryColor"
                label="Color"
                outlined
                dense
                class="form-field"
              />

              <q-input
                v-model.number="newItem.qty"
                label="Quantity"
                type="number"
                outlined
                dense
                class="form-field"
              />

              <q-toggle
                v-model="editFragile"
                label="Fragile"
                color="orange"
                class="q-mt-sm"
              />

              <q-input
                v-model="newItem.description"
                label="Notes"
                type="textarea"
                outlined
                rows="2"
                dense
                class="form-field"
              />
            </div>
          </q-expansion-item>
        </div>

        <div v-if="potentialMatches.length" class="duplicate-alert">
          <q-banner dense rounded class="bg-warning text-dark duplicate-banner">
            Possible duplicate{{ potentialMatches.length > 1 ? 's' : '' }} detected. Review before saving to avoid double entries.
          </q-banner>
          <q-list dense class="duplicate-list">
            <q-item
              v-for="match in potentialMatches"
              :key="match.id"
              class="duplicate-item"
            >
              <q-item-section>
                <q-item-label class="text-weight-medium">{{ match.name }}</q-item-label>
                <q-item-label caption>
                  {{ match.collection }} • {{ match.container }}
                </q-item-label>
              </q-item-section>
              <q-item-section side class="duplicate-actions">
                <q-chip dense :color="match.score === 1 ? 'primary' : 'secondary'" text-color="white">
                  {{ match.score === 1 ? 'Exact' : `${Math.round(match.score * 100)}%` }}
                </q-chip>
                <q-btn
                  dense
                  flat
                  color="primary"
                  icon="visibility"
                  label="Review"
                  @click="handleUseExistingItem(match.id)"
                />
              </q-item-section>
            </q-item>
          </q-list>
        </div>

        <!-- Action buttons -->
        <div class="action-buttons">
          <q-btn
            unelevated
            color="positive"
            icon="check"
            label="Save to Inventory"
            class="confirm-btn"
            @click="saveItem"
          />
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.photo-capture-container {
  min-height: 60vh;
  display: flex;
  flex-direction: column;
  background: white;
}

/* Loading overlay */
.loading-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #000;
}

.loading-overlay-image {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  object-fit: contain;
  opacity: 0.4;
}

.loading-overlay-content {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 24px;
}

.loading-message {
  color: white;
  font-size: 1.25rem;
  font-weight: 500;
  text-align: center;
  padding: 16px 32px;
  background: rgba(0, 0, 0, 0.7);
  border-radius: 12px;
  min-width: 250px;
  animation: fadeIn 0.5s ease-in-out;
}

@keyframes fadeIn {
  from {
    opacity: 0;
    transform: translateY(-10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* Camera prompt */
.camera-prompt {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 32px 24px;
  text-align: center;
}

.camera-icon {
  margin-bottom: 16px;
  opacity: 0.7;
}

.prompt-title {
  font-size: 1.5rem;
  font-weight: 600;
  color: #212121;
  margin: 0 0 8px 0;
}

.prompt-text {
  font-size: 0.95rem;
  color: #616161;
  margin: 0 0 32px 0;
  max-width: 300px;
}

.camera-btn {
  min-width: 200px;
  padding: 16px 32px;
  font-size: 1.1rem;
}

/* Photo preview */
.photo-preview-container {
  display: flex;
  flex-direction: column;
  max-height: 80vh;
  overflow: hidden;
}

.image-preview {
  position: relative;
  width: 100%;
  max-height: 300px;
  background: #000;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
}

.preview-img {
  max-width: 100%;
  max-height: 300px;
  width: auto;
  height: auto;
  object-fit: contain;
}

.retake-btn {
  position: absolute;
  top: 8px;
  right: 8px;
  background: rgba(0, 0, 0, 0.5);
}

/* Quick edit form */
.quick-edit-form {
  flex: 1;
  padding: 20px;
  overflow-y: auto;
}

.form-title {
  font-size: 1.2rem;
  font-weight: 600;
  color: #212121;
  margin: 0 0 16px 0;
}

.form-field {
  margin-bottom: 12px;
}

.dimensions-row {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
  margin-bottom: 12px;
}

.dimension-input {
  margin-bottom: 0;
}

.expandable-fields {
  margin: 16px 0;
}

/* Action buttons */
.action-buttons {
  display: flex;
  margin-top: 24px;
  padding-top: 16px;
  border-top: 1px solid #e0e0e0;
}

.confirm-btn {
  width: 100%;
  padding: 14px;
  font-weight: 600;
  font-size: 1.05rem;
}

.duplicate-alert {
  margin-top: 24px;
  padding: 16px;
  border-radius: 12px;
  border: 1px solid #f4e0a1;
  background: #fff9e6;
}

.duplicate-banner {
  margin-bottom: 12px;
}

.duplicate-list {
  border-radius: 10px;
  background: white;
  border: 1px solid #f0f0f0;
}

.duplicate-item + .duplicate-item {
  border-top: 1px solid #f5f5f5;
}

.duplicate-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

/* Mode selection */
.mode-selection {
  display: flex;
  flex-direction: column;
  width: 100%;
  max-width: 300px;
  margin: 0 auto 24px;
}

.mode-btn {
  min-width: 250px;
  padding: 16px 32px;
  font-size: 1.05rem;
}

/* Multi-item detection */
.multi-item-container {
  display: flex;
  flex-direction: column;
  height: 100vh;
  overflow: hidden;
}

.multi-item-container .image-preview {
  flex: 0 0 50vh; /* Fixed 50% of viewport height */
  max-height: 50vh;
  min-height: 50vh;
}

.multi-item-container .preview-img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  max-width: 100%;
  max-height: 50vh;
}

.multi-item-info {
  flex: 1;
  padding: 20px;
  overflow-y: auto;
  max-height: 50vh; /* Fixed 50% of viewport height with scroll */
}

.info-text {
  font-size: 0.95rem;
  color: #616161;
  margin: 0 0 16px 0;
}

.detected-items-list {
  margin-top: 16px;
  border-radius: 8px;
  overflow: hidden;
}

/* Bounding boxes */
.bounding-box {
  position: absolute;
  border: 2px solid #1976D2;
  background: rgba(25, 118, 210, 0.1);
  cursor: pointer;
  transition: all 0.2s ease;
  display: flex;
  align-items: flex-start;
  padding: 4px;
}

.bounding-box:hover {
  background: rgba(25, 118, 210, 0.2);
  border-width: 3px;
}

.bounding-box.selected {
  border-color: #FF9800;
  background: rgba(255, 152, 0, 0.2);
  border-width: 3px;
}

.item-label {
  background: rgba(0, 0, 0, 0.7);
  color: white;
  padding: 4px 8px;
  border-radius: 4px;
  font-size: 0.75rem;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
}

/* Mobile optimizations */
@media (max-width: 600px) {
  .photo-preview-container {
    max-height: 100vh;
  }

  .image-preview {
    max-height: 250px;
  }

  .quick-edit-form {
    padding: 16px;
  }

  .multi-item-info {
    padding: 16px;
  }

  .mode-btn {
    min-width: 200px;
    font-size: 1rem;
  }
}
</style>
