<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { useQuasar } from 'quasar';
import axios from 'axios';
import { inventoryItems as baseItems } from '../../data/inventoryItems';
import type { InventoryItem } from '../../data/inventoryItems';
// Photo capture removed from public demo - now only available to authenticated users

const $q = useQuasar();

// To adjust url based on whether in prod or not
const core_url = import.meta.env.MODE == 'development' ? 'http://localhost:3050' : 'https://movetrack-api-7hwn7ggbiq-uc.a.run.app';

// Email form
const email = ref('');
const isSubmitting = ref(false);
const submitSuccess = ref(false);

// Clone items to allow editing
const demoItems = ref<InventoryItem[]>(baseItems.map(item => ({ ...item })));

// Experience toggle
type ExperienceMode = 'inventory' | 'packing';
const currentExperience = ref<ExperienceMode>('inventory');

// Experience 1: Inventory Management
type FilterType = 'All' | 'Fragile' | 'Glass' | 'Metal';
const activeFilter = ref<FilterType>('All');
const selectedItemForDetails = ref<InventoryItem | null>(null);
const showItemDetails = ref(false);
const editingItem = ref<InventoryItem | null>(null);
const editDimensions = ref({ length: 0, width: 0, height: 0 });
const editWeight = ref(0);
const editFragile = ref(false);

// Experience 2: Box Packing
interface Box {
  id: string;
  name: string;
  items: InventoryItem[];
  maxWeight: number; // lbs
  maxVolume: number; // cubic inches
  dimensions: { width: number; height: number; depth: number }; // inches
}

const currentBox = ref<Box>({
  id: 'box-1',
  name: 'Box A',
  items: [],
  maxWeight: 10,
  maxVolume: 12 * 12 * 6, // 864 cubic inches
  dimensions: { width: 12, height: 12, depth: 6 }
});

const draggedItem = ref<InventoryItem | null>(null);
const showBoxLabel = ref(false);
const boxLabelData = ref({
  room: 'Kitchen',
  isFragile: false,
  notes: ''
});

// Gamification removed

// Computed: Filtered items for Experience 1
const filteredItems = computed(() => {
  if (activeFilter.value === 'All') {
    return demoItems.value;
  }
  return demoItems.value.filter(item => item.tags.includes(activeFilter.value));
});

// Computed: Available items for packing (not in box yet)
const availableItems = computed(() => {
  const packedIds = currentBox.value.items.map(i => i.id);
  return demoItems.value.filter(item => !packedIds.includes(item.id));
});

// Computed: Box stats
const boxStats = computed(() => {
  const totalWeight = currentBox.value.items.reduce((sum, item) => {
    const weight = parseFloat(item.weight.replace(' lbs', ''));
    return sum + (weight * item.qty);
  }, 0);

  const totalVolume = currentBox.value.items.reduce((sum, item) => {
    const dimensions = item.size.replace(/"/g, '').split('×').map(d => parseFloat(d));
    if (dimensions.length === 3) {
      const cubicInches = dimensions[0] * dimensions[1] * dimensions[2];
      return sum + (cubicInches * item.qty);
    }
    return sum;
  }, 0);

  return {
    weight: totalWeight,
    volume: totalVolume,
    weightPercent: (totalWeight / currentBox.value.maxWeight) * 100,
    volumePercent: (totalVolume / currentBox.value.maxVolume) * 100,
    itemCount: currentBox.value.items.length,
    isOverWeight: totalWeight > currentBox.value.maxWeight,
    isOverVolume: totalVolume > currentBox.value.maxVolume
  };
});

// Functions: Experience 1
const viewItemDetails = (item: InventoryItem) => {
  selectedItemForDetails.value = item;
  showItemDetails.value = true;
};

const startEditingItem = (item: InventoryItem) => {
  editingItem.value = { ...item };
  // Parse dimensions from size string (format: "H×W×D")
  const dimMatch = item.size.match(/(\d+\.?\d*)"×(\d+\.?\d*)"×(\d+\.?\d*)"/);
  if (dimMatch) {
    editDimensions.value = {
      length: parseFloat(dimMatch[1]),
      width: parseFloat(dimMatch[2]),
      height: parseFloat(dimMatch[3])
    };
  }
  // Parse weight from weight string (format: "X.X lbs")
  const weightMatch = item.weight.match(/(\d+\.?\d*)/);
  if (weightMatch) {
    editWeight.value = parseFloat(weightMatch[1]);
  }
  // Check if item is fragile
  editFragile.value = item.tags.includes('Fragile');
};

const saveItemEdits = () => {
  if (!editingItem.value) return;

  // Update size from individual dimensions
  editingItem.value.size = `${editDimensions.value.length}"×${editDimensions.value.width}"×${editDimensions.value.height}"`;

  // Update weight with lbs suffix
  editingItem.value.weight = `${editWeight.value} lbs`;

  // Update fragile tag
  const fragileIndex = editingItem.value.tags.indexOf('Fragile');
  if (editFragile.value && fragileIndex === -1) {
    // Add Fragile tag
    editingItem.value.tags.push('Fragile');
  } else if (!editFragile.value && fragileIndex > -1) {
    // Remove Fragile tag
    editingItem.value.tags.splice(fragileIndex, 1);
  }

  const index = demoItems.value.findIndex(i => i.id === editingItem.value!.id);
  if (index > -1) {
    demoItems.value[index] = { ...editingItem.value };
    $q.notify({
      type: 'positive',
      message: 'Item updated!',
      position: 'bottom',
      timeout: 1500
    });
  }
  editingItem.value = null;
};

const cancelEdit = () => {
  editingItem.value = null;
};

// Functions: Experience 2
const handleDragStart = (item: InventoryItem) => {
  draggedItem.value = item;
};

const handleDragEnd = () => {
  draggedItem.value = null;
};

const handleDragOver = (event: DragEvent) => {
  event.preventDefault();
};

const handleDrop = (event: DragEvent) => {
  event.preventDefault();
  if (!draggedItem.value) return;

  const item = draggedItem.value;

  // Check if item is already in box
  if (currentBox.value.items.some(i => i.id === item.id)) {
    $q.notify({
      type: 'warning',
      message: 'Item already in box!',
      position: 'bottom',
      timeout: 1500
    });
    draggedItem.value = null;
    return;
  }

  // Check weight capacity
  const itemWeight = parseFloat(item.weight.replace(' lbs', '')) * item.qty;
  const newWeight = boxStats.value.weight + itemWeight;

  if (newWeight > currentBox.value.maxWeight) {
    $q.notify({
      type: 'negative',
      message: 'Box would be too heavy!',
      caption: `Max weight: ${currentBox.value.maxWeight} lbs`,
      position: 'bottom',
      timeout: 1500
    });
    draggedItem.value = null;
    return;
  }

  // Check volume capacity
  const dimensions = item.size.replace(/"/g, '').split('×').map(d => parseFloat(d));
  if (dimensions.length === 3) {
    const itemVolume = dimensions[0] * dimensions[1] * dimensions[2] * item.qty;
    const newVolume = boxStats.value.volume + itemVolume;

    if (newVolume > currentBox.value.maxVolume) {
      $q.notify({
        type: 'negative',
        message: 'Item won\'t fit in box!',
        caption: `Box size: ${currentBox.value.dimensions.width}×${currentBox.value.dimensions.height}×${currentBox.value.dimensions.depth}"`,
        position: 'bottom',
        timeout: 1500
      });
      draggedItem.value = null;
      return;
    }
  }

  // Add item to box
  currentBox.value.items.push(item);

  $q.notify({
    type: 'positive',
    message: `${item.name} added to box!`,
    position: 'bottom',
    timeout: 1500
  });

  draggedItem.value = null;
};

const removeItemFromBox = (item: InventoryItem) => {
  const index = currentBox.value.items.findIndex(i => i.id === item.id);
  if (index > -1) {
    currentBox.value.items.splice(index, 1);
    $q.notify({
      message: `${item.name} removed from box`,
      position: 'bottom',
      timeout: 1500
    });
  }
};

const addItemToBox = (item: InventoryItem) => {
  // Same validation as drag & drop
  if (currentBox.value.items.some(i => i.id === item.id)) {
    $q.notify({
      type: 'warning',
      message: 'Item already in box!',
      position: 'bottom',
      timeout: 1500
    });
    return;
  }

  const itemWeight = parseFloat(item.weight.replace(' lbs', '')) * item.qty;
  const newWeight = boxStats.value.weight + itemWeight;

  if (newWeight > currentBox.value.maxWeight) {
    $q.notify({
      type: 'negative',
      message: 'Box would be too heavy!',
      caption: `Max weight: ${currentBox.value.maxWeight} lbs`,
      position: 'bottom',
      timeout: 1500
    });
    return;
  }

  const dimensions = item.size.replace(/"/g, '').split('×').map(d => parseFloat(d));
  if (dimensions.length === 3) {
    const itemVolume = dimensions[0] * dimensions[1] * dimensions[2] * item.qty;
    const newVolume = boxStats.value.volume + itemVolume;

    if (newVolume > currentBox.value.maxVolume) {
      $q.notify({
        type: 'negative',
        message: 'Item won\'t fit in box!',
        caption: `Box size: ${currentBox.value.dimensions.width}×${currentBox.value.dimensions.height}×${currentBox.value.dimensions.depth}"`,
        position: 'bottom',
        timeout: 1500
      });
      return;
    }
  }

  currentBox.value.items.push(item);

  $q.notify({
    type: 'positive',
    message: `${item.name} added to box!`,
    position: 'bottom',
    timeout: 1500
  });
};

const labelBox = () => {
  if (currentBox.value.items.length === 0) {
    $q.notify({
      type: 'warning',
      message: 'Add items to the box first!',
      position: 'bottom',
      timeout: 1500
    });
    return;
  }

  // Check if any fragile items
  const hasFragile = currentBox.value.items.some(item =>
    item.tags.includes('Fragile') || item.tags.includes('Glass')
  );
  boxLabelData.value.isFragile = hasFragile;

  showBoxLabel.value = true;
};

const closeBoxLabel = () => {
  showBoxLabel.value = false;
  // Reset for next box
  currentBox.value.items = [];
  boxLabelData.value = {
    room: 'Kitchen',
    isFragile: false,
    notes: ''
  };
};

const getTagColor = (tag: string): string => {
  const colorMap: Record<string, string> = {
    'Fragile': 'orange',
    'Heavy': 'deep-orange',
    'Glass': 'light-blue',
    'Metal': 'grey',
    'Ceramic': 'brown',
    'China': 'pink',
    'Silver': 'blue-grey',
    'Set': 'teal',
    'Collectible': 'purple',
    'Decorative': 'indigo',
    'Antique': 'amber',
    'Wood': 'brown-7',
    'Textile': 'cyan',
    'Paper': 'grey-5',
    'Branded': 'deep-purple',
    'Small': 'green',
    'Functional': 'blue'
  };
  return colorMap[tag] || 'primary';
};

// Watchers removed

// Magic link request
const requestMagicLink = async () => {
  if (!email.value || !email.value.includes('@')) {
    $q.notify({
      type: 'warning',
      message: 'Please enter a valid email address'
    });
    return;
  }

  isSubmitting.value = true;

  try {
    const response = await axios.post(`${core_url}/auth/request-magic-link`, {
      email: email.value
    });

    if (response.data.success) {
      submitSuccess.value = true;
      $q.notify({
        type: 'positive',
        message: 'Check your email!',
        caption: `We've sent a login link to ${email.value}`
      });
    }
  } catch (error: any) {
    console.error('Error requesting magic link:', error);
    $q.notify({
      type: 'negative',
      message: 'Failed to send magic link',
      caption: error.response?.data?.error || 'Please try again'
    });
  } finally {
    isSubmitting.value = false;
  }
};
</script>

<template>
  <div class="interactive-demo-section">
    <div class="demo-wrapper">
      <div class="split-layout">
        <!-- Left Column: Taglines & Login -->
        <div class="col-left">
          <h1 class="main-headline">Moving made manageable.</h1>
          <h2 class="sub-headline">Log it. Store it. Ship it.</h2>
          <p class="description">
            Experience how MoveTrack makes inventory management and packing effortless. Try our interactive demo below!
          </p>

          <!-- Email Capture -->
          <div v-if="!submitSuccess" class="email-form">
            <q-input
              v-model="email"
              type="email"
              placeholder="Enter your email"
              outlined
              dense
              class="email-input"
              @keyup.enter="requestMagicLink"
            >
              <template v-slot:prepend>
                <q-icon name="mail" size="18px" />
              </template>
            </q-input>
            <q-btn
              unelevated
              color="primary"
              :loading="isSubmitting"
              :disable="isSubmitting"
              class="cta-button"
              @click="requestMagicLink"
            >
              Get Started Free
            </q-btn>
          </div>
          <div v-else class="success-message">
            <q-icon name="check_circle" size="36px" color="positive" />
            <p class="success-text">Check your email for the magic link!</p>
          </div>

        </div>

        <!-- Right Column: Demo Box -->
        <div class="col-right">
      <div class="demo-box">
        <!-- Experience 1: Inventory Management -->
        <div v-if="currentExperience === 'inventory'" class="experience inventory-experience">
          <div class="experience-header">
            <h2 class="experience-title">
              <q-icon name="inventory_2" size="32px" />
              Inventory Management
            </h2>
            <p class="experience-subtitle">
              Explore and manage your items. Click on any item to view details and make edits.
            </p>
          </div>

          <div class="experience-content">
            <!-- Filters -->
            <div class="filters-bar">
              <q-chip
                v-for="filter in ['All', 'Fragile', 'Glass', 'Metal']"
                :key="filter"
                :selected="activeFilter === filter"
                clickable
                @click="activeFilter = filter as FilterType"
                :color="activeFilter === filter ? 'primary' : 'grey-3'"
                :text-color="activeFilter === filter ? 'white' : 'dark'"
                class="filter-chip"
              >
                {{ filter }}
              </q-chip>
            </div>

            <!-- Items Grid -->
            <div class="items-grid">
              <div
                v-for="item in filteredItems"
                :key="item.id"
                class="inventory-item-card"
                @click="viewItemDetails(item)"
                tabindex="0"
                @keydown.enter="viewItemDetails(item)"
              >
                <div class="item-image">
                  <q-img
                    :src="item.image"
                    :alt="item.name"
                    fit="contain"
                    loading="lazy"
                  >
                    <template v-slot:loading>
                      <q-skeleton class="full-width full-height" />
                    </template>
                  </q-img>
                </div>
                <div class="item-info">
                  <div class="item-name">{{ item.name }}</div>
                  <div class="item-specs">
                    <span>{{ item.size }}</span>
                    <span>{{ item.weight }}</span>
                  </div>
                  <div v-if="item.tags.length > 0" class="item-tags">
                    <q-chip
                      v-for="tag in item.tags.slice(0, 2)"
                      :key="tag"
                      dense
                      :color="getTagColor(tag)"
                      text-color="white"
                      class="tag-chip"
                    >
                      {{ tag }}
                    </q-chip>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Experience 2: Box Packing -->
        <div v-if="currentExperience === 'packing'" class="experience packing-experience">
          <div class="experience-header">
            <h2 class="experience-title">
              <q-icon name="widgets" size="32px" />
              Pack Your Box
            </h2>
            <p class="experience-subtitle">
              Drag items into the box below. Watch the weight and space limits!
            </p>
          </div>

          <div class="experience-content packing-content">
            <!-- Available Items -->
            <div class="available-items-panel">
              <h3 class="panel-title">Available Items</h3>
              <div class="items-list">
                <div
                  v-for="item in availableItems"
                  :key="item.id"
                  class="draggable-item"
                  draggable="true"
                  @dragstart="handleDragStart(item)"
                  @dragend="handleDragEnd"
                  @click="addItemToBox(item)"
                >
                  <q-img :src="item.image" :alt="item.name" fit="contain" class="item-thumb" />
                  <div class="item-details">
                    <div class="item-name-sm">{{ item.name }}</div>
                    <div class="item-specs-sm">
                      <span>{{ item.size }}</span>
                      <span>{{ item.weight }}</span>
                    </div>
                  </div>
                  <q-icon name="drag_indicator" color="grey-6" />
                </div>
              </div>
            </div>

            <!-- Box Drop Zone -->
            <div class="box-panel">
              <div class="box-header">
                <h3 class="panel-title">{{ currentBox.name }}</h3>
                <div class="box-capacity">
                  <span>12×12×12"</span>
                  <span>Max: 20 lbs</span>
                </div>
              </div>

              <!-- Capacity Meters -->
              <div class="capacity-meters">
                <div class="meter-group">
                  <div class="meter-label">
                    <q-icon name="scale" />
                    <span>Weight: {{ boxStats.weight.toFixed(1) }} / {{ currentBox.maxWeight }} lbs</span>
                  </div>
                  <q-linear-progress
                    :value="boxStats.weightPercent / 100"
                    :color="boxStats.isOverWeight ? 'negative' : boxStats.weightPercent > 80 ? 'warning' : 'positive'"
                    size="12px"
                    rounded
                  />
                </div>
                <div class="meter-group">
                  <div class="meter-label">
                    <q-icon name="view_in_ar" />
                    <span>Space: {{ boxStats.volumePercent.toFixed(0) }}%</span>
                  </div>
                  <q-linear-progress
                    :value="boxStats.volumePercent / 100"
                    :color="boxStats.isOverVolume ? 'negative' : boxStats.volumePercent > 80 ? 'warning' : 'positive'"
                    size="12px"
                    rounded
                  />
                </div>
              </div>

              <!-- Drop Zone -->
              <div
                class="drop-zone"
                :class="{ 'drag-over': draggedItem !== null, 'has-items': currentBox.items.length > 0 }"
                @dragover="handleDragOver"
                @drop="handleDrop"
              >
                <div v-if="currentBox.items.length === 0" class="drop-placeholder">
                  <q-icon name="add_box" size="64px" color="grey-5" />
                  <p>Drag items here or tap to add</p>
                </div>
                <div v-else class="box-items">
                  <div
                    v-for="item in currentBox.items"
                    :key="item.id"
                    class="box-item"
                  >
                    <q-img :src="item.image" :alt="item.name" fit="contain" class="box-item-img" />
                    <q-tooltip>{{ item.name }}</q-tooltip>
                    <q-btn
                      flat
                      round
                      dense
                      icon="close"
                      size="sm"
                      color="negative"
                      class="remove-btn"
                      @click="removeItemFromBox(item)"
                    />
                  </div>
                </div>
              </div>

              <!-- Label Button -->
              <q-btn
                unelevated
                color="primary"
                label="Label This Box"
                icon-right="label"
                class="label-btn full-width"
                :disable="currentBox.items.length === 0 || boxStats.isOverWeight || boxStats.isOverVolume"
                @click="labelBox"
              />
            </div>
          </div>
        </div>

        <!-- Experience Toggle -->
        <div class="experience-toggle">
          <q-btn-toggle
            v-model="currentExperience"
            spread
            unelevated
            toggle-color="primary"
            :options="[
              { label: 'Manage Inventory', value: 'inventory', icon: 'inventory_2' },
              { label: 'Pack Boxes', value: 'packing', icon: 'widgets' }
            ]"
            class="toggle-buttons"
          />
        </div>
      </div>
        </div>
      </div>
    </div>

    <!-- Item Details Modal -->
    <q-dialog v-model="showItemDetails">
      <q-card class="item-details-modal">
        <q-card-section class="row items-center q-pb-none">
          <div class="text-h6">Item Details</div>
          <q-space />
          <q-btn icon="close" flat round dense v-close-popup />
        </q-card-section>

        <q-card-section v-if="selectedItemForDetails">
          <div class="modal-content">
            <q-img
              :src="selectedItemForDetails.image"
              :alt="selectedItemForDetails.name"
              fit="contain"
              class="modal-image"
            />

            <div v-if="editingItem && editingItem.id === selectedItemForDetails.id" class="edit-form">
              <q-input
                v-model="editingItem.name"
                label="Name"
                outlined
                class="form-input"
              />
              <div class="dimensions-row">
                <q-input
                  v-model.number="editDimensions.length"
                  label="L (inches)"
                  type="number"
                  outlined
                  class="form-input dimension-input"
                />
                <q-input
                  v-model.number="editDimensions.width"
                  label="W (inches)"
                  type="number"
                  outlined
                  class="form-input dimension-input"
                />
                <q-input
                  v-model.number="editDimensions.height"
                  label="H (inches)"
                  type="number"
                  outlined
                  class="form-input dimension-input"
                />
              </div>
              <q-input
                v-model.number="editWeight"
                label="Weight (lbs)"
                type="number"
                outlined
                suffix="lbs"
                class="form-input"
              />
              <q-input
                v-model="editingItem.material"
                label="Material"
                outlined
                class="form-input"
              />
              <q-input
                v-model="editingItem.primaryColor"
                label="Color"
                outlined
                class="form-input"
              />
              <div class="fragile-toggle-container">
                <q-toggle
                  v-model="editFragile"
                  label="Fragile"
                  color="orange"
                  class="fragile-toggle"
                />
              </div>
              <q-input
                v-model="editingItem.description"
                label="Description"
                type="textarea"
                outlined
                rows="3"
                class="form-input"
              />
              <div class="form-actions">
                <q-btn flat label="Cancel" @click="cancelEdit" />
                <q-btn unelevated color="primary" label="Save" @click="saveItemEdits" />
              </div>
            </div>

            <div v-else class="item-details-content">
              <h3>{{ selectedItemForDetails.name }}</h3>
              <div class="details-grid">
                <div class="detail-row">
                  <strong>Size:</strong> {{ selectedItemForDetails.size }}
                </div>
                <div class="detail-row">
                  <strong>Weight:</strong> {{ selectedItemForDetails.weight }}
                </div>
                <div class="detail-row">
                  <strong>Quantity:</strong> {{ selectedItemForDetails.qty }}
                </div>
                <div class="detail-row">
                  <strong>Material:</strong> {{ selectedItemForDetails.material }}
                </div>
                <div class="detail-row">
                  <strong>Color:</strong> {{ selectedItemForDetails.primaryColor }}
                </div>
              </div>
              <p class="item-description">{{ selectedItemForDetails.description }}</p>
              <div class="item-tags-modal">
                <q-chip
                  v-for="tag in selectedItemForDetails.tags"
                  :key="tag"
                  :color="getTagColor(tag)"
                  text-color="white"
                  dense
                >
                  {{ tag }}
                </q-chip>
              </div>
              <q-btn
                outline
                color="primary"
                label="Edit Item"
                icon="edit"
                @click="startEditingItem(selectedItemForDetails)"
                class="q-mt-md"
              />
            </div>
          </div>
        </q-card-section>
      </q-card>
    </q-dialog>

    <!-- Box Label Modal -->
    <q-dialog v-model="showBoxLabel" persistent>
      <q-card class="box-label-modal">
        <q-card-section class="row items-center q-pb-none">
          <div class="text-h6">Box Label</div>
          <q-space />
          <q-btn icon="close" flat round dense @click="closeBoxLabel" />
        </q-card-section>

        <q-card-section>
          <div class="label-form">
            <q-select
              v-model="boxLabelData.room"
              :options="['Kitchen', 'Bedroom', 'Living Room', 'Bathroom', 'Office', 'Garage']"
              label="Room"
              outlined
              class="q-mb-md"
            />
            <q-input
              v-model="boxLabelData.notes"
              label="Notes"
              type="textarea"
              outlined
              rows="2"
              class="q-mb-md"
            />
          </div>

          <!-- Professional Label Design -->
          <div class="professional-label" :class="{ 'fragile-border': boxLabelData.isFragile }">
            <div class="label-header">
              <q-icon name="qr_code" size="64px" color="primary" />
              <div class="label-info">
                <div class="label-room">{{ boxLabelData.room }}</div>
                <div class="label-stats">
                  {{ currentBox.dimensions.width }}×{{ currentBox.dimensions.height }}×{{ currentBox.dimensions.depth }}" ·
                  {{ boxStats.itemCount }} items ·
                  {{ boxStats.weight.toFixed(1) }} lbs
                </div>
              </div>
            </div>
            <div v-if="boxLabelData.isFragile" class="fragile-warning">
              <q-icon name="warning" size="24px" />
              <span>FRAGILE - HANDLE WITH CARE</span>
            </div>
            <div class="label-contents">
              <div class="contents-header">Contents:</div>
              <ul class="contents-list">
                <li v-for="item in currentBox.items" :key="item.id">{{ item.name }}</li>
              </ul>
            </div>
            <div v-if="boxLabelData.notes" class="label-notes">
              <div class="notes-header">Notes:</div>
              <div class="notes-text">{{ boxLabelData.notes }}</div>
            </div>
          </div>
        </q-card-section>

        <q-card-actions align="right">
          <q-btn unelevated color="primary" label="Pack Another Box" @click="closeBoxLabel" />
        </q-card-actions>
      </q-card>
    </q-dialog>

  </div>
</template>

<style scoped>
.interactive-demo-section {
  padding: 40px 20px;
  background: linear-gradient(135deg, #2c5f7c 0%, #3a7ca5 50%, #4a90c4 100%);
  min-height: 90vh;
}

.demo-wrapper {
  max-width: 1600px;
  margin: 0 auto;
}

/* Split Layout */
.split-layout {
  display: grid;
  grid-template-columns: 380px 1fr;
  gap: 32px;
  align-items: start;
}

/* Left Column */
.col-left {
  color: white;
  padding: 32px 24px;
}

.main-headline {
  font-size: 2.5rem;
  font-weight: 700;
  line-height: 1.1;
  margin: 0 0 12px 0;
  color: white;
}

.sub-headline {
  font-size: 1.5rem;
  font-weight: 500;
  margin: 0 0 20px 0;
  color: rgba(255, 255, 255, 0.95);
}

.description {
  font-size: 1rem;
  line-height: 1.6;
  margin-bottom: 24px;
  color: rgba(255, 255, 255, 0.9);
}

.email-form {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-bottom: 24px;
}

.email-input {
  background-color: rgba(255, 255, 255, 0.95);
  border-radius: 8px;
}

.cta-button {
  font-weight: 600;
  padding: 12px 32px;
  border-radius: 8px;
  font-size: 1rem;
  min-height: 44px;
}

.success-message {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 12px;
  margin-bottom: 24px;
  padding: 16px;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 8px;
}

.success-text {
  margin: 0;
  font-size: 0.95rem;
}


/* Right Column */
.col-right {
  flex: 1;
}

/* Demo Box */
.demo-box {
  background: white;
  border: 3px solid #1976d2;
  border-radius: 16px;
  min-height: 65vh;
  max-height: 75vh;
  overflow: hidden;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.15);
  display: flex;
  flex-direction: column;
}

.experience {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.experience-header {
  padding: 20px 24px 16px;
  border-bottom: 2px solid #e0e0e0;
  background: linear-gradient(to bottom, #ffffff, #f5f5f5);
}

.experience-title {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 1.4rem;
  font-weight: 700;
  color: #212121;
  margin: 0 0 6px 0;
}

.experience-subtitle {
  font-size: 0.875rem;
  color: #616161;
  margin: 0;
}

.experience-content {
  flex: 1;
  overflow-y: auto;
  padding: 20px 24px;
}

/* Experience 1: Inventory */
.filters-bar {
  display: flex;
  gap: 8px;
  margin-bottom: 24px;
  flex-wrap: wrap;
}

.filter-chip {
  font-size: 0.875rem;
}

.items-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 16px;
}

.inventory-item-card {
  background: #fafafa;
  border: 2px solid #e0e0e0;
  border-radius: 12px;
  padding: 16px;
  cursor: pointer;
  transition: all 0.2s;
}

.inventory-item-card:hover {
  transform: translateY(-4px);
  box-shadow: 0 8px 16px rgba(0, 0, 0, 0.1);
  border-color: #1976d2;
}

.item-image {
  aspect-ratio: 1;
  background: white;
  border-radius: 8px;
  margin-bottom: 12px;
  overflow: hidden;
}

.item-info {
  text-align: center;
}

.item-name {
  font-weight: 600;
  color: #212121;
  margin-bottom: 6px;
}

.item-specs {
  font-size: 0.8125rem;
  color: #616161;
  display: flex;
  justify-content: center;
  gap: 8px;
  margin-bottom: 8px;
}

.item-tags {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
  justify-content: center;
}

.tag-chip {
  font-size: 0.6875rem;
}

/* Experience 2: Packing */
.packing-content {
  display: grid;
  grid-template-columns: 1fr 1.5fr;
  gap: 24px;
  padding: 24px !important;
}

.available-items-panel,
.box-panel {
  display: flex;
  flex-direction: column;
}

.panel-title {
  font-size: 1.125rem;
  font-weight: 700;
  color: #212121;
  margin: 0 0 16px 0;
}

.items-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  overflow-y: auto;
  max-height: 400px;
  padding-right: 8px;
}

.draggable-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px;
  background: #fafafa;
  border: 2px solid #e0e0e0;
  border-radius: 8px;
  cursor: grab;
  transition: all 0.2s;
}

.draggable-item:hover {
  background: #f5f5f5;
  border-color: #1976d2;
}

.draggable-item:active {
  cursor: grabbing;
}

.item-thumb {
  width: 50px;
  height: 50px;
  flex-shrink: 0;
}

.item-details {
  flex: 1;
}

.item-name-sm {
  font-weight: 600;
  color: #212121;
  font-size: 0.875rem;
}

.item-specs-sm {
  font-size: 0.75rem;
  color: #616161;
  display: flex;
  gap: 8px;
}

.box-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}

.box-capacity {
  display: flex;
  gap: 12px;
  font-size: 0.875rem;
  color: #616161;
  font-weight: 600;
}

.capacity-meters {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-bottom: 16px;
  padding: 16px;
  background: #f5f5f5;
  border-radius: 8px;
}

.meter-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.meter-label {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.875rem;
  font-weight: 600;
  color: #424242;
}

.drop-zone {
  min-height: 300px;
  border: 3px dashed #bdbdbd;
  border-radius: 12px;
  background: #fafafa;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.3s;
  margin-bottom: 16px;
  padding: 16px;
}

.drop-zone.drag-over {
  border-color: #1976d2;
  background: #e3f2fd;
}

.drop-zone.has-items {
  align-items: flex-start;
  justify-content: flex-start;
}

.drop-placeholder {
  text-align: center;
  color: #9e9e9e;
}

.drop-placeholder p {
  margin-top: 8px;
  font-size: 0.9375rem;
}

.box-items {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(60px, 1fr));
  gap: 8px;
  width: 100%;
}

.box-item {
  position: relative;
  background: white;
  border: 2px solid #e0e0e0;
  border-radius: 6px;
  padding: 4px;
  text-align: center;
  cursor: pointer;
}

.box-item:hover {
  border-color: #1976d2;
  box-shadow: 0 2px 8px rgba(25, 118, 210, 0.2);
}

.box-item-img {
  width: 52px;
  height: 52px;
}

.box-item-name {
  font-size: 0.75rem;
  color: #424242;
  line-height: 1.2;
}

.remove-btn {
  position: absolute;
  top: 0px;
  right: 0px;
  background: rgba(255, 255, 255, 0.9);
  transform: scale(0.8);
}

.label-btn {
  font-weight: 600;
  padding: 16px;
  font-size: 1rem;
  min-height: 52px;
}

/* Experience Toggle */
.experience-toggle {
  padding: 16px 24px;
  border-top: 2px solid #e0e0e0;
  background: #f9f9f9;
}

.toggle-buttons {
  width: 100%;
}

/* Modals */
.item-details-modal {
  min-width: 500px;
  max-width: 600px;
}

.modal-content {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.modal-image {
  max-height: 250px;
  background: #f5f5f5;
  border-radius: 8px;
}

.item-details-content h3 {
  margin: 0 0 16px 0;
  color: #212121;
}

.details-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 12px;
  margin-bottom: 16px;
}

.detail-row {
  font-size: 0.9375rem;
  color: #424242;
}

.item-description {
  padding: 12px;
  background: #f5f5f5;
  border-left: 3px solid #1976d2;
  border-radius: 4px;
  margin: 16px 0;
  font-size: 0.9375rem;
}

.item-tags-modal {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.edit-form {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.form-input {
  margin-bottom: 0;
}

.fragile-toggle-container {
  display: flex;
  align-items: center;
  padding: 12px 0;
}

.fragile-toggle {
  font-size: 1rem;
}

.form-actions {
  display: flex;
  gap: 12px;
  justify-content: flex-end;
}

.dimensions-row {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
}

.dimension-input {
  margin-bottom: 0;
}

.box-label-modal {
  min-width: 500px;
}

.professional-label {
  background: white;
  border: 3px solid #1976d2;
  border-radius: 12px;
  padding: 24px;
  margin-top: 16px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
}

.professional-label.fragile-border {
  border: 5px solid #ff6f00;
  box-shadow: 0 4px 12px rgba(255, 111, 0, 0.3), 0 0 0 3px rgba(255, 111, 0, 0.1);
}

.label-header {
  display: flex;
  gap: 20px;
  align-items: center;
  margin-bottom: 20px;
  padding-bottom: 20px;
  border-bottom: 2px solid #e0e0e0;
}

.label-info {
  flex: 1;
}

.label-room {
  font-size: 1.75rem;
  font-weight: 700;
  color: #212121;
  margin-bottom: 4px;
}

.label-stats {
  font-size: 1rem;
  color: #616161;
  font-weight: 500;
}

.fragile-warning {
  background: linear-gradient(135deg, #ff6f00 0%, #ff9100 100%);
  color: white;
  border-radius: 8px;
  padding: 12px 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  font-weight: 700;
  font-size: 1rem;
  margin-bottom: 20px;
  letter-spacing: 0.5px;
}

.label-contents {
  margin-bottom: 16px;
}

.contents-header {
  font-size: 1rem;
  font-weight: 700;
  color: #212121;
  margin-bottom: 8px;
}

.contents-list {
  margin: 0;
  padding-left: 24px;
  list-style-type: disc;
}

.contents-list li {
  font-size: 0.9375rem;
  color: #424242;
  margin-bottom: 4px;
  line-height: 1.5;
}

.label-notes {
  background: #f5f5f5;
  border-left: 4px solid #1976d2;
  border-radius: 4px;
  padding: 12px 16px;
}

.notes-header {
  font-size: 0.875rem;
  font-weight: 700;
  color: #212121;
  margin-bottom: 6px;
}

.notes-text {
  font-size: 0.9375rem;
  color: #424242;
  line-height: 1.5;
}

@media (max-width: 1400px) {
  .split-layout {
    grid-template-columns: 340px 1fr;
    gap: 24px;
  }

  .main-headline {
    font-size: 2rem;
  }

  .sub-headline {
    font-size: 1.3rem;
  }
}

@media (max-width: 1200px) {
  .packing-content {
    grid-template-columns: 1fr;
  }

  .split-layout {
    grid-template-columns: 300px 1fr;
    gap: 20px;
  }

  .col-left {
    padding: 24px 16px;
  }

  .main-headline {
    font-size: 1.75rem;
  }

  .sub-headline {
    font-size: 1.2rem;
  }

  .description {
    font-size: 0.9rem;
  }
}

@media (max-width: 1024px) {
  .split-layout {
    grid-template-columns: 1fr;
    gap: 24px;
  }

  .col-left {
    padding: 24px;
    text-align: center;
  }

  .main-headline {
    font-size: 2.2rem;
  }

  .sub-headline {
    font-size: 1.4rem;
  }

  .email-form {
    max-width: 400px;
    margin: 0 auto 24px;
  }

}

@media (max-width: 768px) {
  .interactive-demo-section {
    padding: 24px 16px;
  }

  .items-grid {
    grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  }

  .item-details-modal,
  .box-label-modal {
    min-width: auto;
  }

  .main-headline {
    font-size: 1.8rem;
  }

  .sub-headline {
    font-size: 1.2rem;
  }
}

</style>
