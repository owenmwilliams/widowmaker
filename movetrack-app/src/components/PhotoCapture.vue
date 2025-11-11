<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
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
}>();

// Camera/Photo state
const showCamera = ref(false);
const capturedImage = ref<string | null>(null);
const isProcessing = ref(false);

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

// File input ref
const fileInput = ref<HTMLInputElement | null>(null);

const isMobile = computed(() => {
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
});

// Open camera or file picker
const openCamera = () => {
  if (fileInput.value) {
    fileInput.value.click();
  }
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
  };
  reader.readAsDataURL(file);

  // Show loading indicator
  $q.loading.show({
    message: 'Analyzing photo with AI...',
    spinnerColor: 'primary',
    messageColor: 'primary'
  });

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
        position: 'top',
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
      position: 'top',
      timeout: 3000
    });
  } finally {
    isProcessing.value = false;
    showCamera.value = false;
    $q.loading.hide();
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
      position: 'top'
    });
    return;
  }

  // Check if we have an active collection (required for items)
  if (!store.activeCollection?.value) {
    $q.notify({
      type: 'warning',
      message: 'Please select a collection first',
      caption: 'Items must be added to a collection',
      position: 'top'
    });
    return;
  }

  // Check if user is provided
  if (!props.user) {
    $q.notify({
      type: 'negative',
      message: 'User not found. Please log in again.',
      position: 'top'
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
      undefined, // location
      imageBlob,
      null, // estimatedValue
      editFragile.value,
      undefined, // priority
      editWeight.value,
      dimensions,
      `Material: ${newItem.value.material || 'N/A'}, Color: ${newItem.value.primaryColor || 'N/A'}`
    );

    // Reload inventory to show new item
    await store.loadInventory(props.user);

    $q.notify({
      type: 'positive',
      message: `${newItem.value.name} added to inventory!`,
      position: 'top',
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

// Reset form
const resetForm = () => {
  capturedImage.value = null;
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

    <!-- No photo captured - show camera button -->
    <div v-if="!capturedImage" class="camera-prompt">
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

    <!-- Photo captured - show quick edit -->
    <div v-else class="photo-preview-container">
      <!-- Image preview -->
      <div class="image-preview">
        <img :src="capturedImage" alt="Captured item" class="preview-img" />
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
}
</style>
