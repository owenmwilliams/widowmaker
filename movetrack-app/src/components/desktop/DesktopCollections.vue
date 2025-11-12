<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { inventoryStore } from '../../stores/InventoryStore';
import { storeToRefs } from 'pinia';
import { useQuasar } from 'quasar';
import DesktopEdit from './DesktopEdit.vue';
import { evaluatePackingFit } from '../../utils/packing';

const props = defineProps({
  user: { type: String, required: true }
});

const store = inventoryStore();
const { collections, containers, items } = storeToRefs(store);
const $q = useQuasar();

// State
const selectedCollection = ref<any>(null);
const draggedItem = ref<any>(null);

const UNASSIGNED_TARGET = 'unassigned' as const;
type DragTarget = number | typeof UNASSIGNED_TARGET | null;
const dragOverTarget = ref<DragTarget>(null);

const expandedContainerIds = ref<number[]>([]);

const isContainerExpanded = (containerValue: number) => {
  return expandedContainerIds.value.includes(containerValue);
};

const setContainerExpansion = (containerValue: number, expanded: boolean) => {
  if (expanded) {
    expandedContainerIds.value = Array.from(
      new Set([...expandedContainerIds.value, containerValue])
    );
  } else {
    expandedContainerIds.value = expandedContainerIds.value.filter(id => id !== containerValue);
  }
};

const toggleContainerExpansion = (containerValue: number) => {
  setContainerExpansion(containerValue, !isContainerExpanded(containerValue));
};
const showCreateDialog = ref(false);
const newCollectionName = ref('');
const newCollectionDescription = ref('');
const showCreateContainerDialog = ref(false);
const newContainerName = ref('');
const newContainerDescription = ref('');
const showContainerDetailsDialog = ref(false);
const detailsContainer = ref<any | null>(null);
const showContainerEditDialog = ref(false);
const containerToEdit = ref<number | null>(null);

// Computed
const containersInCollection = computed(() => {
  if (!selectedCollection.value) return [];
  return store.containers.filter(c => c.collection === selectedCollection.value.value);
});

const itemsInCollection = computed(() => {
  if (!selectedCollection.value) return [];
  return store.items.filter(i => i.collection === selectedCollection.value.value);
});

const unassignedItems = computed(() => {
  return itemsInCollection.value.filter(i => !i.container || i.container === null);
});

const getContainerItems = (containerValue: number) => {
  return itemsInCollection.value.filter(i => i.container === containerValue);
};

const parseItemDimensions = (item: any) => {
  // Prefer new separate fields
  if (item.length_in != null && item.width_in != null && item.height_in != null) {
    const length = toNumber(item.length_in);
    const width = toNumber(item.width_in);
    const height = toNumber(item.height_in);
    if (length && width && height) {
      return { length, width, height };
    }
  }

  // Fallback to old dimensions string format for backwards compatibility
  if (item.dimensions) {
    const parts = item.dimensions.split('x').map((p: string) => Number(p.trim()));
    if (parts.length === 3 && !parts.some(isNaN)) {
      return { length: parts[0], width: parts[1], height: parts[2] };
    }
  }

  return null;
};

const toNumber = (value: any) => {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '') return null;
    const num = Number(trimmed);
    return Number.isFinite(num) ? num : null;
  }
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

const getContainerCapacity = (containerValue: number) => {
  const container = store.containers.find(c => c.value === containerValue);
  if (!container) return null;
  const items = getContainerItems(containerValue);
  const totalWeight = items.reduce((sum, item) => {
    const weight = toNumber(item.weight_lbs);
    return sum + (weight ?? 0);
  }, 0);
  const totalVolumeCubicInches = items.reduce((sum, item) => {
    const dims = parseItemDimensions(item);
    if (!dims) return sum;
    return sum + (dims.length * dims.width * dims.height);
  }, 0);
  const totalVolumeCubicFeet = totalVolumeCubicInches / 1728;

  return {
    maxWeight: toNumber(container.max_weight_lbs),
    maxVolume: toNumber(container.max_volume_cuft),
    currentWeight: Number(totalWeight.toFixed(2)),
    currentVolume: Number(totalVolumeCubicFeet.toFixed(2)),
    dimensions: container.dimensions
  };
};

const getPackingStatus = (containerValue: number) => {
  const capacity = getContainerCapacity(containerValue);
  if (!capacity) return null;
  const weightPct = capacity.maxWeight ? Math.min(1, (capacity.currentWeight || 0) / capacity.maxWeight) : null;
  const volumePct = capacity.maxVolume ? Math.min(1, (capacity.currentVolume || 0) / capacity.maxVolume) : null;

  const items = getContainerItems(containerValue).map((item) => ({
    id: item.value,
    weight: toNumber(item.weight_lbs) || 0,
    dimensions: parseItemDimensions(item) || undefined
  }));

  const fitAssessment = evaluatePackingFit(items, {
    maxWeight: capacity.maxWeight ?? undefined,
    maxVolume: capacity.maxVolume ?? undefined,
    innerDimensions: capacity.dimensions
  });

  return { weightPct, volumePct, capacity, fitAssessment };
};

const getCapacityColor = (pct: number | null) => {
  if (pct === null) return 'grey';
  if (pct >= 0.95) return 'negative';
  if (pct >= 0.80) return 'warning';
  if (pct >= 0.60) return 'orange';
  return 'positive';
};

const getCapacityStatus = (containerValue: number) => {
  const status = getPackingStatus(containerValue);
  if (!status) return 'ok';
  if (!status.fitAssessment.weightOk || !status.fitAssessment.volumeOk || !status.fitAssessment.maxDimensionOk) {
    return 'critical';
  }
  const maxPct = Math.max(status.weightPct || 0, status.volumePct || 0);
  if (maxPct >= 0.95) return 'critical';
  if (maxPct >= 0.80) return 'warning';
  return 'ok';
};

const assessItemPlacement = (item: any, targetContainerValue: number) => {
  const targetContainer = store.containers.find(c => c.value === targetContainerValue);
  if (!targetContainer) {
    return { ok: false, reason: 'Container not found' };
  }
  const baseItems = getContainerItems(targetContainerValue).filter(i => i.value !== item.value);
  const packingItems = [...baseItems, item].map((entry) => ({
    id: entry.value,
    weight: toNumber(entry.weight_lbs) || 0,
    dimensions: parseItemDimensions(entry) || undefined
  }));

  const assessment = evaluatePackingFit(packingItems, {
    maxWeight: toNumber(targetContainer.max_weight_lbs) ?? undefined,
    maxVolume: toNumber(targetContainer.max_volume_cuft) ?? undefined,
    innerDimensions: targetContainer.dimensions
  });

  const ok = assessment.weightOk && assessment.volumeOk && assessment.maxDimensionOk;
  return { ok, reason: assessment.blockingReason };
};

const getItemCount = (collectionValue: number) => {
  return store.items.filter(i => i.collection === collectionValue).length;
};

const truncateLabel = (label?: string, length = 10) => {
  if (!label) return '';
  return label.length > length ? `${label.slice(0, length)}…` : label;
};

// Methods
const selectCollection = (collection: any) => {
  selectedCollection.value = collection;
  store.setActiveCollection({ label: collection.label, value: collection.value });
  expandedContainerIds.value = [];
};

const createCollection = async () => {
  if (!newCollectionName.value.trim()) {
    $q.notify({
      type: 'warning',
      message: 'Please enter a collection name',
      position: 'bottom'
    });
    return;
  }

  try {
    $q.loading.show({ message: 'Creating collection...' });
    await store.createCollection(props.user, newCollectionName.value, newCollectionDescription.value || '');

    $q.notify({
      type: 'positive',
      message: `Collection "${newCollectionName.value}" created!`,
      position: 'bottom',
      timeout: 2000
    });

    // Reset form and close dialog
    newCollectionName.value = '';
    newCollectionDescription.value = '';
    showCreateDialog.value = false;

    // Select the newly created collection
    if (store.collections.length > 0) {
      const newCollection = store.collections[store.collections.length - 1];
      selectCollection(newCollection);
    }
  } catch (error) {
    console.error('Error creating collection:', error);
    $q.notify({
      type: 'negative',
      message: 'Failed to create collection',
      position: 'bottom'
    });
  } finally {
    $q.loading.hide();
  }
};

const createContainer = async () => {
  if (!newContainerName.value.trim()) {
    $q.notify({
      type: 'warning',
      message: 'Please enter a container name',
      position: 'bottom'
    });
    return;
  }

  if (!selectedCollection.value) {
    $q.notify({
      type: 'warning',
      message: 'Please select a collection first',
      position: 'bottom'
    });
    return;
  }

  try {
    $q.loading.show({ message: 'Creating container...' });
    await store.createContainer(
      props.user,
      newContainerName.value,
      selectedCollection.value.value
    );

    $q.notify({
      type: 'positive',
      message: `Container "${newContainerName.value}" created!`,
      position: 'bottom',
      timeout: 2000
    });

    // Reset form and close dialog
    newContainerName.value = '';
    newContainerDescription.value = '';
    showCreateContainerDialog.value = false;

    // Reload inventory to show new container
    await store.loadInventory(props.user);
  } catch (error) {
    console.error('Error creating container:', error);
    $q.notify({
      type: 'negative',
      message: 'Failed to create container',
      position: 'bottom'
    });
  } finally {
    $q.loading.hide();
  }
};

// Drag and Drop Handlers
const handleDragStart = (item: any) => {
  draggedItem.value = item;
  draggedFromContainerId.value = item.container ?? null;
};

const handleDragEnd = () => {
  draggedItem.value = null;
  dragOverTarget.value = null;
};

const handleDragOver = (event: DragEvent, target: number | typeof UNASSIGNED_TARGET) => {
  event.preventDefault();
  dragOverTarget.value = target;
};

const handleDragLeave = (target?: number | typeof UNASSIGNED_TARGET) => {
  if (!target || dragOverTarget.value === target) {
    dragOverTarget.value = null;
  }
};

const draggedFromContainerId = ref<number | null>(null);

const handleDrop = async (event: DragEvent, containerValue: number | null) => {
  event.preventDefault();

  if (!draggedItem.value) return;
  const droppedItem = draggedItem.value;

  try {
    $q.loading.show({ message: 'Moving item...' });

    if (containerValue !== null) {
      const fitCheck = assessItemPlacement(droppedItem, containerValue);
      if (!fitCheck.ok) {
        $q.notify({
          type: 'warning',
          message: fitCheck.reason || 'Item does not fit in this container',
          position: 'bottom'
        });
        return;
      }
      await store.moveItemToContainer(
        droppedItem.value,
        containerValue,
        props.user
      );
    } else {
      await store.moveItemToContainer(
        droppedItem.value,
        null,
        props.user
      );
    }

    $q.notify({
      type: 'positive',
      message: containerValue === null ? `Removed ${droppedItem.label || 'Item'} from container` : `Moved ${droppedItem.label || 'Item'} to container`,
      position: 'bottom',
      timeout: 1500
    });
  } catch (error) {
    console.error('Error moving item:', error);
    $q.notify({
      type: 'negative',
      message: 'Failed to move item',
      position: 'bottom'
    });
  } finally {
    $q.loading.hide();
    draggedItem.value = null;
    dragOverTarget.value = null;
    draggedFromContainerId.value = null;
  }
};

const openContainerDetails = (container: any) => {
  detailsContainer.value = container;
  showContainerDetailsDialog.value = true;
};

const openContainerEdit = (container: any) => {
  containerToEdit.value = container.value;
  showContainerEditDialog.value = true;
};

const openItemDetails = (itemId: number) => {
  store.openItemDetailsModal(itemId, props.user);
};

// Initialize
onMounted(() => {
  if (store.collections.length > 0 && !selectedCollection.value) {
    selectCollection(store.collections[0]);
  }
});
</script>

<template>
  <div class="collections-container">
    <!-- Empty state -->
    <div v-if="collections.length === 0" class="empty-state">
      <q-icon name="inventory_2" size="80px" color="grey-5" />
      <div class="text-h5 q-mt-md text-grey-7">No Collections Yet</div>
      <div class="text-body2 text-grey-6 q-mt-sm">Create your first collection to start organizing items</div>
      <q-btn unelevated color="primary" icon="add" label="Create Collection" class="q-mt-lg" @click="showCreateDialog = true" />
    </div>

    <!-- Main layout with collections -->
    <div v-else class="main-layout">
      <!-- Left Sidebar - Collections List -->
      <div class="collections-sidebar">
        <div class="sidebar-header">
          <div class="text-h6 text-primary">Collections</div>
          <q-btn flat dense round icon="add" color="primary" size="sm" @click="showCreateDialog = true">
            <q-tooltip>Add Collection</q-tooltip>
          </q-btn>
        </div>

        <q-separator class="q-my-sm" />

        <div class="collections-list">
          <div
            v-for="collection in collections"
            :key="collection.value"
            class="collection-item"
            :class="{ 'active': selectedCollection?.value === collection.value }"
            @click="selectCollection(collection)"
          >
            <div class="collection-icon">
              <q-icon name="inventory_2" size="24px" />
            </div>
            <div class="collection-info">
              <div class="collection-name">{{ collection.label }}</div>
              <div class="collection-count">{{ getItemCount(collection.value) }} items</div>
            </div>
          </div>
        </div>
      </div>

      <!-- Right Content - Containers and Items -->
      <div class="content-area">
        <div v-if="!selectedCollection" class="select-prompt">
          <q-icon name="arrow_back" size="48px" color="grey-5" />
          <div class="text-h6 text-grey-6 q-mt-md">Select a collection to view containers</div>
        </div>

        <div v-else class="collection-content">
          <!-- Header -->
          <div class="content-header">
            <div>
              <div class="text-h5 text-primary">{{ selectedCollection.label }}</div>
              <div class="text-body2 text-grey-7">{{ selectedCollection.description }}</div>
            </div>
            <q-btn unelevated color="primary" icon="add" label="Add Container" @click="showCreateContainerDialog = true" />
          </div>

          <!-- Containers Grid -->
          <div class="section-title">
            <q-icon name="inventory_2" size="20px" class="q-mr-sm" />
            Containers
            <q-chip dense size="sm" color="primary" text-color="white" class="q-ml-sm">
              {{ containersInCollection.length }}
            </q-chip>
          </div>

          <div v-if="containersInCollection.length === 0" class="no-containers">
            <q-icon name="inventory_2" size="48px" color="grey-5" />
            <div class="text-body1 text-grey-6 q-mt-sm">No containers in this collection</div>
            <q-btn unelevated color="secondary" icon="add" label="Add First Container" class="q-mt-sm" @click="showCreateContainerDialog = true" />
          </div>

          <div v-else class="containers-grid">
            <div
              v-for="container in containersInCollection"
              :key="container.value"
              class="container-card"
              :class="{
                'drag-over': dragOverTarget === container.value,
                expanded: isContainerExpanded(container.value)
              }"
              @dragover="handleDragOver($event, container.value)"
              @dragleave="handleDragLeave(container.value)"
              @drop="handleDrop($event, container.value)"
            >
              <q-card flat bordered>
                <q-card-section class="container-card-header">
                  <div class="row items-center">
                    <q-icon name="inventory_2" size="sm" color="primary" />
                    <span class="text-subtitle1 text-weight-medium q-ml-sm">{{ container.label }}</span>
                    <q-space />
                    <q-icon
                      v-if="getCapacityStatus(container.value) === 'critical'"
                      name="error"
                      color="negative"
                      size="sm"
                      class="q-mr-xs"
                    >
                      <q-tooltip>Container limit exceeded!</q-tooltip>
                    </q-icon>
                    <q-icon
                      v-else-if="getCapacityStatus(container.value) === 'warning'"
                      name="warning"
                      color="warning"
                      size="sm"
                      class="q-mr-xs"
                    >
                      <q-tooltip>Container nearly full</q-tooltip>
                    </q-icon>
                    <q-btn
                      flat
                      dense
                      round
                      size="sm"
                      color="primary"
                      :icon="isContainerExpanded(container.value) ? 'expand_less' : 'expand_more'"
                      @click.stop="toggleContainerExpansion(container.value)"
                    >
                      <q-tooltip>{{ isContainerExpanded(container.value) ? 'Collapse' : 'Expand' }}</q-tooltip>
                    </q-btn>
                    <q-chip
                      dense
                      :color="getCapacityStatus(container.value) === 'critical' ? 'negative' : getCapacityStatus(container.value) === 'warning' ? 'warning' : 'secondary'"
                      text-color="white"
                      size="sm"
                    >
                      {{ getContainerItems(container.value).length }}
                    </q-chip>
                  </div>
                </q-card-section>

                <template v-if="!isContainerExpanded(container.value)">
                  <q-card-section>
                    <!-- Item thumbnails -->
                    <div v-if="getContainerItems(container.value).length > 0" class="item-thumbnails">
                      <div
                        v-for="(item, index) in getContainerItems(container.value).slice(0, 6)"
                        :key="getContainerItems(container.value).length > 6 && index === 5 ? `${container.value}-overflow` : item.value"
                        class="item-thumb"
                        :class="{ clickable: !(getContainerItems(container.value).length > 6 && index === 5) }"
                        :draggable="!(getContainerItems(container.value).length > 6 && index === 5)"
                        @click.stop="!(getContainerItems(container.value).length > 6 && index === 5) && openItemDetails(item.value)"
                        @dragstart="!(getContainerItems(container.value).length > 6 && index === 5) && handleDragStart(item)"
                        @dragend="!(getContainerItems(container.value).length > 6 && index === 5) && handleDragEnd"
                      >
                        <template v-if="getContainerItems(container.value).length > 6 && index === 5">
                          <div class="more-items">
                            +{{ getContainerItems(container.value).length - 5 }}
                          </div>
                        </template>
                        <template v-else>
                          <q-img
                            v-if="item.picture_url"
                            :src="item.picture_url"
                            fit="cover"
                            class="thumb-img"
                          />
                          <div v-else class="thumb-placeholder">
                            <q-icon name="category" size="16px" color="grey-6" />
                            <span class="thumb-text">{{ truncateLabel(item.label, 8) }}</span>
                          </div>
                        </template>
                      </div>
                    </div>

                    <div v-else class="empty-container">
                      <q-icon name="inbox" size="24px" color="grey-5" />
                      <div class="text-caption text-grey-6">Drop items here</div>
                    </div>

                    <div class="capacity-section q-mt-md" v-if="getPackingStatus(container.value) || container.dimensions || container.max_weight_lbs || container.max_volume_cuft">
                      <!-- Dimensions Badge -->
                      <div v-if="container.dimensions" class="dimension-badge q-mb-sm">
                        <q-icon name="straighten" size="xs" class="q-mr-xs" />
                        <span class="text-caption">{{ container.dimensions.length }}" × {{ container.dimensions.width }}" × {{ container.dimensions.height }}"</span>
                      </div>
                      <div v-else-if="container.box_size" class="dimension-badge q-mb-sm">
                        <q-icon name="inventory_2" size="xs" class="q-mr-xs" />
                        <span class="text-caption">{{ container.box_size }} box</span>
                      </div>
                      <div v-else class="dimension-badge q-mb-sm">
                        <q-icon name="help_outline" size="xs" class="q-mr-xs" />
                        <span class="text-caption">No dimensions set</span>
                      </div>

                      <!-- Weight Capacity -->
                      <div class="capacity-row" v-if="getPackingStatus(container.value)?.weightPct !== null">
                        <div class="capacity-label">
                          <q-icon name="scale" size="xs" class="q-mr-xs" />
                          <span class="text-caption text-weight-medium">
                            {{ getPackingStatus(container.value)?.capacity.currentWeight.toFixed(1) }} / {{ getPackingStatus(container.value)?.capacity.maxWeight }} lbs
                          </span>
                          <span class="text-caption text-grey-6 q-ml-xs">
                            ({{ Math.round((getPackingStatus(container.value)?.weightPct || 0) * 100) }}%)
                          </span>
                        </div>
                        <q-linear-progress
                          :value="getPackingStatus(container.value)?.weightPct || 0"
                          :color="getCapacityColor(getPackingStatus(container.value)?.weightPct || 0)"
                          rounded
                          size="8px"
                          class="capacity-bar"
                        />
                      </div>

                      <!-- Volume Capacity -->
                      <div class="capacity-row" v-if="getPackingStatus(container.value)?.capacity.maxVolume">
                        <div class="capacity-label">
                          <q-icon name="view_in_ar" size="xs" class="q-mr-xs" />
                          <span class="text-caption text-weight-medium">
                            {{ getPackingStatus(container.value)?.capacity.currentVolume.toFixed(2) }} / {{ getPackingStatus(container.value)?.capacity.maxVolume }} cu ft
                          </span>
                          <span class="text-caption text-grey-6 q-ml-xs">
                            ({{ Math.round((getPackingStatus(container.value)?.volumePct || 0) * 100) }}%)
                          </span>
                        </div>
                        <q-linear-progress
                          :value="getPackingStatus(container.value)?.volumePct || 0"
                          :color="getCapacityColor(getPackingStatus(container.value)?.volumePct || 0)"
                          rounded
                          size="8px"
                          class="capacity-bar"
                        />
                      </div>
                      <div class="capacity-row" v-else-if="getPackingStatus(container.value)?.capacity.currentVolume > 0">
                        <div class="capacity-label">
                          <q-icon name="view_in_ar" size="xs" class="q-mr-xs" />
                          <span class="text-caption text-weight-medium">
                            {{ getPackingStatus(container.value)?.capacity.currentVolume.toFixed(2) }} cu ft
                          </span>
                          <span class="text-caption text-grey-6 q-ml-xs">(no limit set)</span>
                        </div>
                      </div>

                      <!-- Error/Warning Messages -->
                      <div
                        v-if="getPackingStatus(container.value)?.fitAssessment.blockingReason"
                        class="constraint-warning q-mt-sm"
                      >
                        <q-icon name="error_outline" size="sm" class="q-mr-xs" />
                        <span class="text-caption">{{ getPackingStatus(container.value)?.fitAssessment.blockingReason }}</span>
                      </div>

                      <!-- Info message for missing item dimensions -->
                      <div
                        v-else-if="getContainerItems(container.value).length > 0 && getPackingStatus(container.value)?.capacity.currentVolume === 0 && getPackingStatus(container.value)?.capacity.maxVolume"
                        class="constraint-info q-mt-sm"
                      >
                        <q-icon name="info_outline" size="sm" class="q-mr-xs" />
                        <span class="text-caption">Add item dimensions to track volume</span>
                      </div>
                    </div>
                  </q-card-section>
                </template>

                <q-slide-transition>
                  <q-card-section
                    v-if="isContainerExpanded(container.value)"
                    class="container-list-section"
                  >
                    <div class="container-items-list">
                      <div
                        v-if="getContainerItems(container.value).length === 0"
                        class="container-items-empty"
                      >
                        <q-icon name="inbox" size="24px" color="grey-5" class="q-mb-sm" />
                        <div class="text-caption text-grey-6">No items yet. Drag items here to start packing.</div>
                      </div>
                      <div v-else class="container-items-scroll">
                        <div
                          v-for="item in getContainerItems(container.value)"
                          :key="item.value"
                          class="container-item"
                          draggable="true"
                          @click.stop="openItemDetails(item.value)"
                          @dragstart="handleDragStart(item)"
                          @dragend="handleDragEnd"
                        >
                          <div
                            v-if="item.picture_url"
                            class="container-item-image"
                          >
                            <q-img
                              :src="item.picture_url"
                              fit="cover"
                              class="item-img"
                            />
                          </div>
                          <div class="container-item-details">
                            <div class="text-body2 text-weight-medium ellipsis">{{ item.label }}</div>
                            <div class="text-caption text-grey-7 ellipsis">
                              {{ item.description || 'No description' }}
                            </div>
                          </div>
                          <div class="container-item-meta text-caption text-grey-6">
                            {{ item.quantity }} pcs
                          </div>
                        </div>
                      </div>
                    </div>
                  </q-card-section>
                </q-slide-transition>

                <q-card-actions align="right">
                  <q-btn flat dense color="primary" icon="visibility" size="sm" @click="openContainerDetails(container)">
                    <q-tooltip>View Details</q-tooltip>
                  </q-btn>
                  <q-btn flat dense color="primary" icon="edit" size="sm" @click="openContainerEdit(container)">
                    <q-tooltip>Edit</q-tooltip>
                  </q-btn>
                </q-card-actions>
              </q-card>
            </div>
          </div>

          <!-- Unpacked Items -->
          <div
            class="unassigned-section"
            :class="{ 'drag-over': dragOverTarget === UNASSIGNED_TARGET }"
            @dragover.prevent="handleDragOver($event, UNASSIGNED_TARGET)"
            @dragleave="handleDragLeave(UNASSIGNED_TARGET)"
            @drop="handleDrop($event, null)"
          >
            <div class="section-title">
              <q-icon name="category" size="20px" class="q-mr-sm" />
              Unpacked Items
              <q-chip dense size="sm" color="warning" text-color="white" class="q-ml-sm">
                {{ unassignedItems.length }}
              </q-chip>
            </div>

            <div v-if="unassignedItems.length === 0" class="unassigned-empty">
              <q-icon name="outbox" size="32px" color="grey-5" class="q-mb-sm" />
              <div class="text-body2 text-grey-7">Drop items here to remove them from containers.</div>
            </div>

            <div v-else class="unassigned-items">
              <div
                v-for="item in unassignedItems"
                :key="item.value"
                class="draggable-item"
                draggable="true"
                @click="openItemDetails(item.value)"
                @dragstart="handleDragStart(item)"
                @dragend="handleDragEnd"
              >
                <q-icon name="drag_indicator" class="drag-handle" />
                <div class="item-image">
                  <q-img
                    v-if="item.picture_url"
                    :src="item.picture_url"
                    fit="cover"
                    class="item-img"
                  />
                  <div v-else class="item-placeholder">
                    <q-icon name="category" size="24px" color="grey-6" />
                  </div>
                </div>
                <div class="item-details">
                  <div class="text-weight-medium">{{ item.label }}</div>
                  <div class="text-caption text-grey-7">{{ item.description }}</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Create Collection Dialog -->
    <q-dialog v-model="showCreateDialog" persistent>
      <q-card style="min-width: 450px;">
        <q-card-section>
          <div class="text-h6">Create Collection</div>
        </q-card-section>

        <q-card-section class="q-pt-none">
          <q-input
            v-model="newCollectionName"
            label="Collection Name *"
            outlined
            autofocus
            class="q-mb-md"
            :rules="[val => !!val || 'Name is required']"
            @keyup.enter="createCollection"
          />

          <q-input
            v-model="newCollectionDescription"
            label="Description (optional)"
            type="textarea"
            outlined
            rows="3"
          />
        </q-card-section>

        <q-card-actions align="right">
          <q-btn flat label="Cancel" color="grey-7" v-close-popup @click="newCollectionName = ''; newCollectionDescription = ''" />
          <q-btn unelevated label="Create" color="primary" @click="createCollection" />
        </q-card-actions>
      </q-card>
    </q-dialog>

    <!-- Create Container Dialog -->
    <q-dialog v-model="showCreateContainerDialog" persistent>
      <q-card style="min-width: 450px;">
        <q-card-section>
          <div class="text-h6">Create Container</div>
        </q-card-section>

        <q-card-section class="q-pt-none">
          <q-input
            v-model="newContainerName"
            label="Container Name *"
            outlined
            autofocus
            class="q-mb-md"
            :rules="[val => !!val || 'Name is required']"
            @keyup.enter="createContainer"
          />

          <q-input
            v-model="newContainerDescription"
            label="Description (optional)"
            type="textarea"
            outlined
            rows="3"
          />
        </q-card-section>

        <q-card-actions align="right">
          <q-btn flat label="Cancel" color="grey-7" v-close-popup @click="newContainerName = ''; newContainerDescription = ''" />
          <q-btn unelevated label="Create" color="primary" @click="createContainer" />
        </q-card-actions>
      </q-card>
    </q-dialog>

    <q-dialog v-model="showContainerDetailsDialog">
      <q-card style="min-width: 420px; max-width: 600px;">
        <q-card-section>
          <div class="text-h6">{{ detailsContainer?.label }}</div>
          <div class="text-caption text-grey-7">
            {{ store.locations.find(loc => loc.value === detailsContainer?.location)?.label || 'No location specified' }}
          </div>
        </q-card-section>
        <q-separator />
        <q-card-section class="q-pt-none">
          <div v-if="detailsContainer" class="row q-col-gutter-md q-mb-md">
            <div class="col-12 col-sm-6">
              <div class="text-caption text-grey-7">Standard Size</div>
              <div class="text-subtitle2">
                {{ detailsContainer.box_size ? detailsContainer.box_size : 'Custom' }}
              </div>
            </div>
            <div class="col-12 col-sm-6" v-if="detailsContainer.max_weight_lbs">
              <div class="text-caption text-grey-7">Max Weight</div>
              <div class="text-subtitle2">{{ detailsContainer.max_weight_lbs }} lbs</div>
            </div>
            <div class="col-12 col-sm-6" v-if="detailsContainer.max_volume_cuft">
              <div class="text-caption text-grey-7">Max Volume</div>
              <div class="text-subtitle2">{{ detailsContainer.max_volume_cuft }} cu ft</div>
            </div>
            <div class="col-12 col-sm-6" v-if="detailsContainer.weight_lbs">
              <div class="text-caption text-grey-7">Current Weight</div>
              <div class="text-subtitle2">{{ detailsContainer.weight_lbs }} lbs</div>
            </div>
          </div>
          <div class="text-subtitle2 q-mb-sm">Items in container</div>
          <div v-if="detailsContainer && getContainerItems(detailsContainer.value).length === 0" class="text-caption text-grey-6">
            No items assigned yet.
          </div>
          <q-list v-else dense bordered separator class="rounded-borders">
            <q-item v-for="item in detailsContainer ? getContainerItems(detailsContainer.value) : []" :key="item.value">
              <q-item-section>
                <q-item-label>{{ item.label }}</q-item-label>
                <q-item-label caption>{{ item.description }}</q-item-label>
              </q-item-section>
              <q-item-section side top>
                Qty {{ item.quantity }}
              </q-item-section>
            </q-item>
          </q-list>
        </q-card-section>
        <q-card-actions align="right">
          <q-btn flat label="Close" color="primary" v-close-popup />
        </q-card-actions>
      </q-card>
    </q-dialog>

    <q-dialog v-model="showContainerEditDialog" persistent>
      <DesktopEdit v-if="containerToEdit !== null" :user="props.user" addType="Container" :id="containerToEdit" />
    </q-dialog>
  </div>
</template>

<style scoped>
.collections-container {
  height: calc(100vh - 50px);
  background: var(--bg-secondary);
  overflow: hidden;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
}

.main-layout {
  display: flex;
  height: 100%;
  gap: 0;
}

/* Collections Sidebar */
.collections-sidebar {
  width: 280px;
  background: white;
  border-right: 1px solid var(--border-light);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.sidebar-header {
  padding: 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.collections-list {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
}

.collection-item {
  display: flex;
  align-items: center;
  padding: 12px;
  margin-bottom: 4px;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s;
  border: 2px solid transparent;
}

.collection-item:hover {
  background: var(--bg-secondary);
}

.collection-item.active {
  background: var(--primary-subtle);
  border-color: var(--primary);
}

.collection-icon {
  color: var(--primary);
  margin-right: 12px;
}

.collection-info {
  flex: 1;
}

.collection-name {
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 2px;
}

.collection-count {
  font-size: 12px;
  color: var(--text-secondary);
}

/* Content Area */
.content-area {
  flex: 1;
  overflow-y: auto;
  padding: 24px;
}

.select-prompt {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
}

.collection-content {
  max-width: 1400px;
  margin: 0 auto;
}

.content-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 32px;
}

.section-title {
  display: flex;
  align-items: center;
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
  margin: 24px 0 16px 0;
}

/* Containers Grid */
.no-containers {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 48px;
  background: white;
  border-radius: 12px;
  border: 2px dashed var(--border-light);
}

.containers-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 16px;
  margin-bottom: 32px;
}

.container-card {
  transition: all 0.3s;
}

.container-card.drag-over {
  transform: scale(1.02);
}

.container-card.drag-over .q-card {
  border-color: var(--primary);
  background: var(--primary-subtle);
  box-shadow: 0 4px 12px rgba(139, 115, 85, 0.2);
}

.container-card.expanded .q-card {
  border-color: var(--primary);
}

.container-card-header {
  padding-bottom: 0;
}

.container-list-section {
  padding-top: 0;
}

.item-thumbnails {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
  margin-top: 12px;
}

.item-thumb {
  aspect-ratio: 1;
  border-radius: 6px;
  overflow: hidden;
  background: var(--bg-tertiary);
  cursor: grab;
}

.item-thumb:active {
  cursor: grabbing;
}

.thumb-img {
  width: 100%;
  height: 100%;
}

.thumb-placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  gap: 4px;
}

.thumb-text {
  font-size: 0.7rem;
  color: var(--text-secondary);
  text-align: center;
  padding: 0 4px;
}

.more-items {
  width: 100%;
  height: 100%;
  aspect-ratio: 1;
  background: var(--primary);
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 600;
  border-radius: 6px;
}

.empty-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 24px;
  border: 2px dashed var(--border-light);
  border-radius: 8px;
  margin-top: 12px;
}

.container-items-list {
  margin-top: 16px;
  border-top: 1px solid var(--border-light);
  padding-top: 12px;
}

.container-items-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding: 24px 12px;
  border: 2px dashed var(--border-light);
  border-radius: 8px;
}

.container-items-scroll {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 240px;
  overflow-y: auto;
  padding-right: 4px;
}

.container-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px;
  border: 1px solid var(--border-light);
  border-radius: 8px;
  background: var(--bg-secondary);
  cursor: grab;
}

.container-item:active {
  cursor: grabbing;
}

.container-item-image {
  width: 48px;
  height: 48px;
  border-radius: 6px;
  overflow: hidden;
  background: var(--bg-tertiary);
  flex-shrink: 0;
}

.container-item-details {
  flex: 1;
  min-width: 0;
}

.container-item-meta {
  color: var(--text-secondary);
  flex-shrink: 0;
}

/* Unassigned Items */
.unassigned-section {
  background: white;
  border-radius: 12px;
  padding: 16px;
  margin-top: 24px;
  border: 2px dashed transparent;
  transition: border-color 0.2s, background 0.2s;
}

.unassigned-section.drag-over {
  border-color: var(--primary);
  background: var(--primary-subtle);
}

.unassigned-items {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 12px;
  margin-top: 16px;
}

.unassigned-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 32px;
  border: 2px dashed var(--border-light);
  border-radius: 8px;
  margin-top: 16px;
  color: var(--text-secondary);
}

.draggable-item {
  display: flex;
  align-items: center;
  padding: 12px;
  background: white;
  border: 2px solid var(--border-light);
  border-radius: 8px;
  cursor: grab;
  transition: all 0.2s;
}

.draggable-item:hover {
  background: var(--bg-secondary);
  border-color: var(--primary);
  transform: translateY(-2px);
  box-shadow: var(--shadow-md);
}

.draggable-item:active {
  cursor: grabbing;
  transform: scale(0.98);
}

.drag-handle {
  color: var(--text-hint);
  margin-right: 8px;
}

.item-image {
  width: 60px;
  height: 60px;
  border-radius: 6px;
  overflow: hidden;
  background: var(--bg-tertiary);
  flex-shrink: 0;
  margin-right: 12px;
}

.item-img {
  width: 100%;
  height: 100%;
}

.item-placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.item-details {
  flex: 1;
  min-width: 0;
}

.item-details > div {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.capacity-section {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 8px;
  background: var(--bg-secondary);
  border-radius: 6px;
}

.capacity-row {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.capacity-label {
  display: flex;
  align-items: center;
  color: var(--text-primary);
}

.capacity-bar {
  transition: all 0.3s ease;
}

.dimension-badge {
  display: inline-flex;
  align-items: center;
  padding: 4px 8px;
  background: white;
  border: 1px solid var(--border-light);
  border-radius: 4px;
  color: var(--text-secondary);
  font-size: 0.75rem;
  width: fit-content;
}

.constraint-warning {
  display: flex;
  align-items: center;
  padding: 6px 8px;
  background: rgba(244, 67, 54, 0.1);
  border-left: 3px solid var(--negative);
  border-radius: 4px;
  color: var(--negative);
  font-weight: 500;
}

.constraint-info {
  display: flex;
  align-items: center;
  padding: 6px 8px;
  background: rgba(33, 150, 243, 0.1);
  border-left: 3px solid #2196f3;
  border-radius: 4px;
  color: #1976d2;
  font-weight: 400;
}
</style>
