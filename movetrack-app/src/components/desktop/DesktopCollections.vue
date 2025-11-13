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
const showBoxGenerationDialog = ref(false);

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

// Box generation for current collection
const collectionBoxEstimates = computed(() => {
  // Only analyze loose (uncontained) items in current collection
  const looseItems = unassignedItems.value;

  // Box specifications with volume and weight limits
  const boxSpecs = {
    small: {
      volumeCuFt: 1.5,       // 16x12.5x12.5 inches
      maxWeightLbs: 30,
      targetDensity: 20       // lbs per cu ft (30 lbs / 1.5 cu ft)
    },
    medium: {
      volumeCuFt: 3.0,       // 18x18x16 inches
      maxWeightLbs: 40,
      targetDensity: 13.33    // lbs per cu ft (40 lbs / 3 cu ft)
    },
    large: {
      volumeCuFt: 4.5,       // 18x18x24 inches
      maxWeightLbs: 50,
      targetDensity: 11.11    // lbs per cu ft (50 lbs / 4.5 cu ft)
    }
  };

  let smallBoxes = 0;
  let mediumBoxes = 0;
  let largeBoxes = 0;

  // Track remaining capacity in current boxes
  let currentSmallVolume = 0;
  let currentSmallWeight = 0;
  let currentMediumVolume = 0;
  let currentMediumWeight = 0;
  let currentLargeVolume = 0;
  let currentLargeWeight = 0;

  // Helper function to check if an item needs a box
  const isBoxable = (item: any): boolean => {
    const itemName = (item.label || '').toLowerCase().trim();
    const dims = parseItemDimensions(item);
    const weight = Number(item.weight_lbs) || 0;

    // Multi-word phrases that indicate furniture (check these first for precision)
    const furniturePhrases = [
      'dining table', 'coffee table', 'end table', 'side table', 'kitchen table', 'console table',
      'bed frame', 'box spring', 'file cabinet', 'filing cabinet', 'floor lamp', 'standing lamp',
      'entertainment center', 'tv stand', 'media console', 'shelving unit',
      'keyboard piano', 'digital piano', 'exercise bike', 'weight bench'
    ];

    if (furniturePhrases.some(phrase => itemName.includes(phrase))) {
      return false;
    }

    // Single-word furniture keywords
    const furnitureKeywords = [
      'sofa', 'couch', 'armchair', 'recliner', 'loveseat', 'sectional',
      'dresser', 'mattress', 'headboard', 'footboard',
      'bookshelf', 'bookcase', 'wardrobe', 'armoire',
      'nightstand', 'bureau', 'credenza', 'hutch',
      'bench', 'stool', 'ottoman', 'futon',
      'bike', 'bicycle', 'treadmill', 'elliptical', 'piano'
    ];

    // Use word boundaries to avoid false matches (e.g., "desktop" shouldn't match "desk")
    const hasFurnitureKeyword = furnitureKeywords.some(keyword => {
      const regex = new RegExp(`\\b${keyword}\\b`, 'i');
      return regex.test(itemName);
    });

    if (hasFurnitureKeyword) return false;

    // Size-based rules
    if (dims) {
      const maxDim = Math.max(dims.length, dims.width, dims.height);
      const volume = (dims.length * dims.width * dims.height) / 1728; // cu ft

      // Very large items (>36 inches in any dimension)
      if (maxDim > 36) return false;

      // Items 30-36 inches might be boxable if they're not too heavy
      if (maxDim >= 30) {
        const density = volume > 0 ? weight / volume : 0;
        // If it's large but very light (density < 3), probably furniture/bulky
        if (density < 3) return false;
      }
    }

    // If we got here, it's boxable
    return true;
  };

  // Filter to boxable items
  const boxableItems = looseItems.filter(isBoxable);

  // Track non-boxable items for display
  const nonBoxableItems = looseItems.filter(item => !isBoxable(item));

  // Group items with their calculated properties
  const processedItems = boxableItems.map(item => {
    const dims = parseItemDimensions(item);
    const weight = Number(item.weight_lbs) || 0;
    const quantity = Number(item.quantity) || 1;

    let volumeCuFt = 0;
    let density = 0;

    if (dims) {
      volumeCuFt = (dims.length * dims.width * dims.height) / 1728;
      density = volumeCuFt > 0 ? weight / volumeCuFt : 0;
    } else {
      // Estimate: medium density items without dimensions
      volumeCuFt = 0.5; // Assume 0.5 cu ft per item
      density = weight / volumeCuFt;
    }

    return {
      label: item.label,
      volumeCuFt,
      weight,
      density,
      quantity
    };
  });

  // Sort by density (high to low) - pack heavy items first
  processedItems.sort((a, b) => b.density - a.density);

  // Pack items based on density
  processedItems.forEach(item => {
    for (let i = 0; i < item.quantity; i++) {
      let packed = false;

      // Determine box type based on density
      // High density (>20 lbs/cu ft) -> small box
      // Medium density (13-20 lbs/cu ft) -> medium box
      // Low density (<13 lbs/cu ft) -> large box

      if (item.density >= boxSpecs.small.targetDensity) {
        // High density - try small box
        if (
          currentSmallVolume + item.volumeCuFt <= boxSpecs.small.volumeCuFt &&
          currentSmallWeight + item.weight <= boxSpecs.small.maxWeightLbs
        ) {
          currentSmallVolume += item.volumeCuFt;
          currentSmallWeight += item.weight;
          packed = true;
        } else {
          // Start new small box
          smallBoxes++;
          currentSmallVolume = item.volumeCuFt;
          currentSmallWeight = item.weight;
          packed = true;
        }
      } else if (item.density >= boxSpecs.medium.targetDensity) {
        // Medium density - try medium box
        if (
          currentMediumVolume + item.volumeCuFt <= boxSpecs.medium.volumeCuFt &&
          currentMediumWeight + item.weight <= boxSpecs.medium.maxWeightLbs
        ) {
          currentMediumVolume += item.volumeCuFt;
          currentMediumWeight += item.weight;
          packed = true;
        } else {
          // Start new medium box
          mediumBoxes++;
          currentMediumVolume = item.volumeCuFt;
          currentMediumWeight = item.weight;
          packed = true;
        }
      } else {
        // Low density - try large box
        if (
          currentLargeVolume + item.volumeCuFt <= boxSpecs.large.volumeCuFt &&
          currentLargeWeight + item.weight <= boxSpecs.large.maxWeightLbs
        ) {
          currentLargeVolume += item.volumeCuFt;
          currentLargeWeight += item.weight;
          packed = true;
        } else {
          // Start new large box
          largeBoxes++;
          currentLargeVolume = item.volumeCuFt;
          currentLargeWeight = item.weight;
          packed = true;
        }
      }

      // If item couldn't be packed (too large), try to fit in best available box
      if (!packed) {
        // Try to fit in largest box that can handle it
        if (item.volumeCuFt <= boxSpecs.large.volumeCuFt && item.weight <= boxSpecs.large.maxWeightLbs) {
          largeBoxes++;
          currentLargeVolume = item.volumeCuFt;
          currentLargeWeight = item.weight;
        } else if (item.volumeCuFt <= boxSpecs.medium.volumeCuFt && item.weight <= boxSpecs.medium.maxWeightLbs) {
          mediumBoxes++;
          currentMediumVolume = item.volumeCuFt;
          currentMediumWeight = item.weight;
        } else {
          smallBoxes++;
          currentSmallVolume = item.volumeCuFt;
          currentSmallWeight = item.weight;
        }
      }
    }
  });

  // Account for partially filled boxes
  if (currentSmallVolume > 0) smallBoxes++;
  if (currentMediumVolume > 0) mediumBoxes++;
  if (currentLargeVolume > 0) largeBoxes++;

  return {
    small: smallBoxes,
    medium: mediumBoxes,
    large: largeBoxes,
    total: smallBoxes + mediumBoxes + largeBoxes,
    nonBoxableCount: nonBoxableItems.length,
    nonBoxableItems: nonBoxableItems,
    details: {
      smallCapacity: boxSpecs.small.volumeCuFt,
      smallMaxWeight: boxSpecs.small.maxWeightLbs,
      smallDensity: boxSpecs.small.targetDensity,
      mediumCapacity: boxSpecs.medium.volumeCuFt,
      mediumMaxWeight: boxSpecs.medium.maxWeightLbs,
      mediumDensity: boxSpecs.medium.targetDensity,
      largeCapacity: boxSpecs.large.volumeCuFt,
      largeMaxWeight: boxSpecs.large.maxWeightLbs,
      largeDensity: boxSpecs.large.targetDensity
    }
  };
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

const generateBoxesForCollection = async () => {
  if (!selectedCollection.value) return;

  const estimates = collectionBoxEstimates.value;

  if (estimates.total === 0) {
    $q.notify({
      type: 'info',
      message: 'No boxes needed - all items are already in containers',
      position: 'bottom'
    });
    return;
  }

  try {
    $q.loading.show({ message: 'Smart packing in progress...' });

    // Get loose items that need to be packed
    const looseItems = unassignedItems.value;

    // Box specifications
    const boxSpecs = {
      small: { volumeCuFt: 1.5, maxWeightLbs: 30, targetDensity: 20, size: 'small' },
      medium: { volumeCuFt: 3.0, maxWeightLbs: 40, targetDensity: 13.33, size: 'medium' },
      large: { volumeCuFt: 4.5, maxWeightLbs: 50, targetDensity: 11.11, size: 'large' }
    };

    // Helper function to check if an item needs a box (same logic as estimation)
    const isBoxable = (item: any): boolean => {
      const itemName = (item.label || '').toLowerCase().trim();
      const dims = parseItemDimensions(item);
      const weight = Number(item.weight_lbs) || 0;

      // Multi-word phrases that indicate furniture (check these first for precision)
      const furniturePhrases = [
        'dining table', 'coffee table', 'end table', 'side table', 'kitchen table', 'console table',
        'bed frame', 'box spring', 'file cabinet', 'filing cabinet', 'floor lamp', 'standing lamp',
        'entertainment center', 'tv stand', 'media console', 'shelving unit',
        'keyboard piano', 'digital piano', 'exercise bike', 'weight bench'
      ];

      if (furniturePhrases.some(phrase => itemName.includes(phrase))) {
        return false;
      }

      // Single-word furniture keywords
      const furnitureKeywords = [
        'sofa', 'couch', 'armchair', 'recliner', 'loveseat', 'sectional',
        'dresser', 'mattress', 'headboard', 'footboard',
        'bookshelf', 'bookcase', 'wardrobe', 'armoire',
        'nightstand', 'bureau', 'credenza', 'hutch',
        'bench', 'stool', 'ottoman', 'futon',
        'bike', 'bicycle', 'treadmill', 'elliptical', 'piano'
      ];

      // Use word boundaries to avoid false matches (e.g., "desktop" shouldn't match "desk")
      const hasFurnitureKeyword = furnitureKeywords.some(keyword => {
        const regex = new RegExp(`\\b${keyword}\\b`, 'i');
        return regex.test(itemName);
      });

      if (hasFurnitureKeyword) return false;

      // Size-based rules
      if (dims) {
        const maxDim = Math.max(dims.length, dims.width, dims.height);
        const volume = (dims.length * dims.width * dims.height) / 1728; // cu ft

        // Very large items (>36 inches in any dimension)
        if (maxDim > 36) return false;

        // Items 30-36 inches might be boxable if they're not too heavy
        if (maxDim >= 30) {
          const density = volume > 0 ? weight / volume : 0;
          // If it's large but very light (density < 3), probably furniture/bulky
          if (density < 3) return false;
        }
      }

      // If we got here, it's boxable
      return true;
    };

    // Filter to boxable items only
    const boxableItems = looseItems.filter(isBoxable);

    // Process and sort items by density
    const processedItems = boxableItems.map(item => {
      const dims = parseItemDimensions(item);
      const weight = Number(item.weight_lbs) || 0;
      const quantity = Number(item.quantity) || 1;
      let volumeCuFt = 0;
      let density = 0;

      if (dims) {
        volumeCuFt = (dims.length * dims.width * dims.height) / 1728;
        density = volumeCuFt > 0 ? weight / volumeCuFt : 0;
      } else {
        volumeCuFt = 0.5;
        density = weight / volumeCuFt;
      }

      return { item, volumeCuFt, weight, density, quantity };
    });

    processedItems.sort((a, b) => b.density - a.density);

    // Get existing boxes in the collection
    const existingBoxes = containersInCollection.value
      .filter(c => c.box_size) // Only containers that are boxes
      .map(c => {
        const capacity = getContainerCapacity(c.value);
        const spec = boxSpecs[c.box_size as 'small' | 'medium' | 'large'];
        return {
          container: c,
          size: c.box_size,
          volumeUsed: capacity?.currentVolume || 0,
          weightUsed: capacity?.currentWeight || 0,
          maxVolume: spec?.volumeCuFt || (capacity?.maxVolume || 0),
          maxWeight: spec?.maxWeightLbs || (capacity?.maxWeight || 0)
        };
      });

    // Track items to be packed and their target boxes (existing or new)
    const itemAssignments: Array<{ item: any; containerValue: number | null }> = [];
    const newBoxesToCreate: Array<{ size: string; items: Array<{ item: any }> }> = [];

    // Try to pack items into existing boxes first, then plan new boxes
    for (const processedItem of processedItems) {
      for (let q = 0; q < processedItem.quantity; q++) {
        // Determine target box size by density
        let targetSize: 'small' | 'medium' | 'large';
        if (processedItem.density >= boxSpecs.small.targetDensity) {
          targetSize = 'small';
        } else if (processedItem.density >= boxSpecs.medium.targetDensity) {
          targetSize = 'medium';
        } else {
          targetSize = 'large';
        }

        const spec = boxSpecs[targetSize];
        let packed = false;

        // Try to fit in existing boxes of the same size
        const availableBoxes = existingBoxes.filter(b => b.size === targetSize);
        for (const box of availableBoxes) {
          if (box.volumeUsed + processedItem.volumeCuFt <= box.maxVolume &&
              box.weightUsed + processedItem.weight <= box.maxWeight) {
            // Can fit in this existing box
            itemAssignments.push({ item: processedItem.item, containerValue: box.container.value });
            box.volumeUsed += processedItem.volumeCuFt;
            box.weightUsed += processedItem.weight;
            packed = true;
            break;
          }
        }

        // If not packed, plan a new box
        if (!packed) {
          // Check if we have a new box being planned for this size
          let targetNewBox = newBoxesToCreate.find(b =>
            b.size === targetSize &&
            b.items.reduce((sum, i) => {
              const iWeight = Number(i.item.weight_lbs) || 0;
              const iDims = parseItemDimensions(i.item);
              const iVolume = iDims ? (iDims.length * iDims.width * iDims.height) / 1728 : 0.5;
              return sum + iVolume;
            }, processedItem.volumeCuFt) <= spec.volumeCuFt &&
            b.items.reduce((sum, i) => sum + (Number(i.item.weight_lbs) || 0), processedItem.weight) <= spec.maxWeightLbs
          );

          if (!targetNewBox) {
            targetNewBox = { size: targetSize, items: [] };
            newBoxesToCreate.push(targetNewBox);
          }

          targetNewBox.items.push({ item: processedItem.item });
        }
      }
    }

    // First, assign items to existing boxes
    let itemsPackedInExisting = 0;
    for (const assignment of itemAssignments) {
      await store.moveItemToContainer(assignment.item.value, assignment.containerValue, props.user);
      await new Promise(resolve => setTimeout(resolve, 50));
      itemsPackedInExisting++;
    }

    // Then create new boxes and assign items
    let boxNumber = containersInCollection.value.filter(c => c.box_size).length + 1;
    for (const newBox of newBoxesToCreate) {
      const spec = boxSpecs[newBox.size as 'small' | 'medium' | 'large'];

      // Create the container
      await store.createContainer(
        props.user,
        `${newBox.size.charAt(0).toUpperCase() + newBox.size.slice(1)} Box ${boxNumber}`,
        selectedCollection.value.value,
        undefined, undefined, undefined, undefined, undefined, undefined, undefined,
        newBox.size,
        spec.maxWeightLbs,
        spec.volumeCuFt
      );

      // Wait for container creation
      await new Promise(resolve => setTimeout(resolve, 100));

      // Reload to get the new container
      await store.loadInventory(props.user);

      // Find the newly created container
      const newContainer = store.containers.find(c =>
        c.label === `${newBox.size.charAt(0).toUpperCase() + newBox.size.slice(1)} Box ${boxNumber}` &&
        c.collection === selectedCollection.value.value
      );

      if (newContainer) {
        // Move items into the box
        for (const boxItem of newBox.items) {
          await store.moveItemToContainer(boxItem.item.value, newContainer.value, props.user);
          await new Promise(resolve => setTimeout(resolve, 50));
        }
      }

      boxNumber++;
    }

    await store.loadInventory(props.user);

    const message = itemsPackedInExisting > 0
      ? `Smart pack complete! Packed ${itemsPackedInExisting} items into existing boxes and created ${newBoxesToCreate.length} new boxes`
      : `Smart pack complete! Created ${newBoxesToCreate.length} boxes and packed ${boxableItems.length} items`;

    $q.notify({
      type: 'positive',
      message,
      position: 'bottom',
      timeout: 3000
    });

    showBoxGenerationDialog.value = false;
  } catch (error) {
    console.error('Error during smart pack:', error);
    $q.notify({
      type: 'negative',
      message: 'Failed to complete smart pack',
      position: 'bottom'
    });
  } finally {
    $q.loading.hide();
  }
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
    <div class="collections-header q-pa-md">
      <h5 class="text-h5 text-primary q-my-none">Collections</h5>
      <p class="text-caption text-grey-7 q-mt-xs">Organize and pack your items by room or category</p>
    </div>

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
            <div class="q-gutter-sm">
              <q-btn
                v-if="unassignedItems.length > 0"
                outline
                color="secondary"
                icon="auto_awesome"
                label="Smart Pack"
                @click="showBoxGenerationDialog = true"
              />
              <q-btn unelevated color="primary" icon="add" label="Add Container" @click="showCreateContainerDialog = true" />
            </div>
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
                      <div class="capacity-row" v-else-if="(getPackingStatus(container.value)?.capacity?.currentVolume || 0) > 0">
                        <div class="capacity-label">
                          <q-icon name="view_in_ar" size="xs" class="q-mr-xs" />
                          <span class="text-caption text-weight-medium">
                            {{ getPackingStatus(container.value)?.capacity?.currentVolume.toFixed(2) }} cu ft
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
                        v-else-if="getContainerItems(container.value).length > 0 && getPackingStatus(container.value)?.capacity?.currentVolume === 0 && getPackingStatus(container.value)?.capacity?.maxVolume"
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

    <!-- Box Generation Dialog -->
    <q-dialog v-model="showBoxGenerationDialog" persistent>
      <q-card style="min-width: 500px;">
        <q-card-section>
          <div class="text-h6">Smart Pack for {{ selectedCollection?.label }}</div>
          <div class="text-body2 text-grey-7 q-mt-sm">
            Analyzing {{ unassignedItems.length }} unpacked item(s)
            <span v-if="collectionBoxEstimates.nonBoxableCount > 0">
              ({{ collectionBoxEstimates.nonBoxableCount }} furniture/large items excluded)
            </span>
          </div>
        </q-card-section>

        <q-card-section class="q-pt-none">
          <div v-if="collectionBoxEstimates.total > 0" class="box-estimates">
            <q-banner class="bg-blue-1 text-primary q-mb-md">
              <template v-slot:avatar>
                <q-icon name="lightbulb" color="primary" />
              </template>
              <div class="text-subtitle2">Density-Based Packing Algorithm</div>
              <div class="text-caption">
                Heavy items (>{{ collectionBoxEstimates.details.smallDensity }} lbs/cu ft) → Small boxes<br>
                Medium items ({{ collectionBoxEstimates.details.mediumDensity.toFixed(1) }}-{{ collectionBoxEstimates.details.smallDensity }} lbs/cu ft) → Medium boxes<br>
                Light items (&lt;{{ collectionBoxEstimates.details.mediumDensity.toFixed(1) }} lbs/cu ft) → Large boxes
              </div>
            </q-banner>

            <div class="box-summary">
              <div v-if="collectionBoxEstimates.small > 0" class="box-row">
                <q-icon name="inventory_2" size="sm" color="primary" />
                <div class="box-info">
                  <span class="text-weight-medium">{{ collectionBoxEstimates.small }} Small Boxes</span>
                  <span class="text-caption text-grey-7">
                    ({{ collectionBoxEstimates.details.smallCapacity }} cu ft, max {{ collectionBoxEstimates.details.smallMaxWeight }} lbs)
                  </span>
                </div>
              </div>

              <div v-if="collectionBoxEstimates.medium > 0" class="box-row">
                <q-icon name="inventory_2" size="sm" color="secondary" />
                <div class="box-info">
                  <span class="text-weight-medium">{{ collectionBoxEstimates.medium }} Medium Boxes</span>
                  <span class="text-caption text-grey-7">
                    ({{ collectionBoxEstimates.details.mediumCapacity }} cu ft, max {{ collectionBoxEstimates.details.mediumMaxWeight }} lbs)
                  </span>
                </div>
              </div>

              <div v-if="collectionBoxEstimates.large > 0" class="box-row">
                <q-icon name="inventory_2" size="sm" color="accent" />
                <div class="box-info">
                  <span class="text-weight-medium">{{ collectionBoxEstimates.large }} Large Boxes</span>
                  <span class="text-caption text-grey-7">
                    ({{ collectionBoxEstimates.details.largeCapacity }} cu ft, max {{ collectionBoxEstimates.details.largeMaxWeight }} lbs)
                  </span>
                </div>
              </div>

              <q-separator class="q-my-md" />

              <div class="box-total">
                <q-icon name="inventory" size="md" color="primary" />
                <span class="text-h6 text-primary">Total: {{ collectionBoxEstimates.total }} boxes</span>
              </div>
            </div>

            <!-- Non-boxable items section -->
            <div v-if="collectionBoxEstimates.nonBoxableCount > 0" class="q-mt-md">
              <q-expansion-item
                dense
                expand-separator
                icon="weekend"
                :label="`${collectionBoxEstimates.nonBoxableCount} Furniture/Large Items (no boxes needed)`"
                caption="These items will be moved as-is"
                header-class="bg-grey-2"
              >
                <q-card>
                  <q-card-section class="q-pa-sm">
                    <q-list dense>
                      <q-item v-for="item in collectionBoxEstimates.nonBoxableItems" :key="item.value" dense>
                        <q-item-section avatar>
                          <q-icon name="check_circle" color="positive" size="xs" />
                        </q-item-section>
                        <q-item-section>
                          <q-item-label class="text-body2">{{ item.label }}</q-item-label>
                          <q-item-label caption v-if="item.quantity > 1">Qty: {{ item.quantity }}</q-item-label>
                        </q-item-section>
                      </q-item>
                    </q-list>
                  </q-card-section>
                </q-card>
              </q-expansion-item>
            </div>
          </div>
          <div v-else class="text-center text-grey-6 q-py-md">
            <q-icon name="check_circle" size="lg" color="positive" />
            <div class="text-body1 q-mt-sm">
              <span v-if="collectionBoxEstimates.nonBoxableCount > 0">
                All boxable items are packed!<br>
                <span class="text-caption">{{ collectionBoxEstimates.nonBoxableCount }} furniture/large items don't need boxes</span>
              </span>
              <span v-else>All items are already packed!</span>
            </div>
          </div>
        </q-card-section>

        <q-card-actions align="right">
          <q-btn flat label="Cancel" color="grey-7" v-close-popup />
          <q-btn
            v-if="collectionBoxEstimates.total > 0"
            unelevated
            label="Smart Pack"
            color="primary"
            icon="auto_awesome"
            @click="generateBoxesForCollection"
          />
        </q-card-actions>
      </q-card>
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

/* Box Generation Dialog */
.box-estimates {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.box-summary {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.box-row {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 12px;
  background: var(--bg-secondary);
  border-radius: 8px;
}

.box-info {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.box-total {
  display: flex;
  align-items: center;
  gap: 12px;
  justify-content: center;
  padding: 16px;
  background: var(--primary-subtle);
  border-radius: 8px;
}
</style>
