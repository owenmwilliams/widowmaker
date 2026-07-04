<script setup lang="ts">
import { computed, ref, onMounted, onBeforeUnmount, watch, nextTick, reactive } from 'vue';
import { inventoryStore } from '../../../stores/InventoryStore'
import { useDataQuality } from '../../../composables/useDataQuality';
import { useDuplicateDetection } from '../../../composables/useDuplicateDetection';
import { useQuasar } from 'quasar';
import { CheckCircle2 } from 'lucide-vue-next';

const props = defineProps({
  user: String,
  view: {
    type: String,
    default: 'overview'
  }
});

const store = inventoryStore();
const { missingAttributeSummary, bulkReviewQueueDetailed } = useDataQuality(store);
const { duplicatePairs, duplicateCount, dismissPair } = useDuplicateDetection(store);
const $q = useQuasar();

const selectedIssueFilter = ref<string | null>(null);
const attributesContainerRef = ref<HTMLElement | null>(null);
const attributesHeight = ref<number | null>(null);
const normalizedView = computed(() => {
  if (props.view === 'attributes' || props.view === 'duplicates') {
    return props.view;
  }
  return 'overview';
});
const viewTitle = computed(() => {
  switch (normalizedView.value) {
    case 'attributes':
      return 'Review attributes';
    case 'duplicates':
      return 'Review duplicates';
    default:
      return 'Data quality overview';
  }
});

const viewSubtitle = computed(() => {
  switch (normalizedView.value) {
    case 'attributes':
      return 'Work through missing weights, photos, locations, and other critical details.';
    case 'duplicates':
      return 'Compare highly similar items to merge or dismiss duplicates.';
    default:
      return 'Focus on items missing photos, measurements, and placement details.';
  }
});

const updateAttributesHeight = () => {
  if (typeof window === 'undefined' || !attributesContainerRef.value) return;
  const top = attributesContainerRef.value.getBoundingClientRect().top;
  const available = window.innerHeight - top - 24; // Reserve space for padding
  attributesHeight.value = Math.max(available, 320);
};

let resizeRaf: number | null = null;
const scheduleAttributesHeightUpdate = () => {
  if (resizeRaf !== null && typeof window !== 'undefined') {
    window.cancelAnimationFrame(resizeRaf);
  }
  if (typeof window === 'undefined') return;
  resizeRaf = window.requestAnimationFrame(() => {
    updateAttributesHeight();
    resizeRaf = null;
  });
};

onMounted(() => {
  if (typeof window === 'undefined') return;
  nextTick(() => {
    scheduleAttributesHeightUpdate();
  });
  window.addEventListener('resize', scheduleAttributesHeightUpdate);
});

onBeforeUnmount(() => {
  if (typeof window === 'undefined') return;
  if (resizeRaf !== null) {
    window.cancelAnimationFrame(resizeRaf);
    resizeRaf = null;
  }
  window.removeEventListener('resize', scheduleAttributesHeightUpdate);
});

watch(
  () => normalizedView.value,
  (view) => {
    if (view === 'attributes') {
      nextTick(() => {
        scheduleAttributesHeightUpdate();
      });
    }
  }
);

// Get item full details for hover popup
const getItemDetails = (itemId: number) => {
  const item = store.items.find(i => i.value === itemId);
  if (!item) return null;

  const collection = store.collections.find(c => c.value === item.collection);
  const container = store.containers.find(c => c.value === item.container);

  return {
    collection: collection?.label || 'Unassigned',
    container: container?.label || 'No container',
    description: item.description || null
  };
};

const reviewFilterOptions = computed(() => [
  { label: 'All issues', value: null },
  ...missingAttributeSummary.value.map((item) => ({
    label: item.label,
    value: item.key
  }))
]);

const filteredReviewQueue = computed(() => {
  let queue = bulkReviewQueueDetailed.value;

  if (selectedIssueFilter.value) {
    queue = queue.filter((item) =>
      item.issues.some((issue) => issue.key === selectedIssueFilter.value)
    );
  }

  return queue;
});

const reviewColumns = [
  {
    name: 'name',
    label: 'Item',
    field: 'name',
    align: 'left',
    sortable: true
  },
  {
    name: 'collection',
    label: 'Collection',
    field: 'collection',
    align: 'left',
    sortable: true
  },
  {
    name: 'container',
    label: 'Container',
    field: 'container',
    align: 'left',
    sortable: true
  },
  {
    name: 'issues',
    label: 'Missing details',
    field: 'issues',
    align: 'left'
  },
  {
    name: 'actions',
    label: 'Actions',
    field: 'actions',
    align: 'right'
  }
];

const containerOptions = computed(() =>
  store.containers.map(container => ({
    label: container.label,
    value: container.value
  }))
);

const getIssueModelValue = (itemId: number, issueKey: string) => {
  const item = store.items.find(i => i.value === itemId);
  if (!item) {
    return issueKey === 'dimensions'
      ? { length: null, width: null, height: null }
      : '';
  }

  switch (issueKey) {
    case 'weight':
      return item.weight_lbs?.toString() || '';
    case 'dimensions':
      return {
        length: item.length_in ?? null,
        width: item.width_in ?? null,
        height: item.height_in ?? null
      };
    case 'container':
      return item.container ?? null;
    default:
      return '';
  }
};

type EstimateValue = {
  value: number | null;
  confidence?: number | null;
};

interface InlineEstimate {
  weight_lbs?: EstimateValue | null;
  dimensions?: {
    length_in?: EstimateValue | null;
    width_in?: EstimateValue | null;
    height_in?: EstimateValue | null;
  } | null;
  volume_cuft?: number | null;
  notes?: string | null;
  confidence?: number | null;
}

type EstimateState = {
  loading: boolean;
  estimate: InlineEstimate | null;
  error: string | null;
};

const aiEstimateStates = reactive<Record<number, EstimateState>>({});

const ensureEstimateState = (itemId: number): EstimateState => {
  if (!aiEstimateStates[itemId]) {
    aiEstimateStates[itemId] = {
      loading: false,
      estimate: null,
      error: null
    };
  }
  return aiEstimateStates[itemId];
};

const getEstimateState = (itemId: number) => ensureEstimateState(itemId);

const buildOverrideContext = (itemId: number) => {
  const item = store.items.find((entry) => entry.value === itemId);
  if (!item) return {};
  return {
    name: item.label,
    description: item.description,
    quantity: item.quantity,
    notes: item.notes,
    material: item.material,
    primary_color: item.primary_color,
    tags: item.tags || [],
    weight_lbs: item.weight_lbs,
    length_in: item.length_in,
    width_in: item.width_in,
    height_in: item.height_in
  };
};

const formatEstimateValue = (value?: number | null, unit?: string) => {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return '—';
  }
  const numeric = Number(value);
  const rounded =
    Math.abs(numeric - Math.round(numeric)) < 0.01
      ? Math.round(numeric).toString()
      : numeric.toFixed(1);
  return unit ? `${rounded} ${unit}` : rounded;
};

const formatEstimateDimensions = (estimate?: InlineEstimate | null) => {
  if (!estimate?.dimensions) return '—';
  const length = estimate.dimensions.length_in?.value;
  const width = estimate.dimensions.width_in?.value;
  const height = estimate.dimensions.height_in?.value;
  if (
    length === null ||
    length === undefined ||
    width === null ||
    width === undefined ||
    height === null ||
    height === undefined
  ) {
    return '—';
  }
  return `${formatEstimateValue(length)}" × ${formatEstimateValue(width)}" × ${formatEstimateValue(height)}"`;
};

const requestAiEstimateForItem = async (itemId: number) => {
  if (!props.user) {
    $q.notify({ type: 'warning', message: 'Sign in to request AI estimates.' });
    return;
  }
  const state = ensureEstimateState(itemId);
  state.loading = true;
  state.error = null;
  try {
    const response = await store.requestItemEstimate(String(itemId), {
      overrideFields: buildOverrideContext(itemId)
    });
    if (response?.estimate) {
      state.estimate = response.estimate;
      state.error = null;
    } else {
      state.estimate = null;
      state.error = 'No estimate returned.';
    }
  } catch (error: any) {
    console.error('[ReviewQueue] AI estimate failed', error);
    state.estimate = null;
    state.error = error?.response?.data?.error || error?.message || 'Unable to fetch estimate.';
  } finally {
    state.loading = false;
  }
};

const applyAiEstimateToItem = async (itemId: number) => {
  if (!props.user) return;
  const suggestion = ensureEstimateState(itemId).estimate;
  if (!suggestion) return;
  const item = store.items.find((entry) => entry.value === itemId);
  if (!item) return;

  const payload: Record<string, any> = {};
  if (suggestion.weight_lbs?.value) {
    payload.weightLbs = suggestion.weight_lbs.value;
  }
  const length = suggestion.dimensions?.length_in?.value;
  const width = suggestion.dimensions?.width_in?.value;
  const height = suggestion.dimensions?.height_in?.value;
  if (length && width && height) {
    payload.lengthIn = length;
    payload.widthIn = width;
    payload.heightIn = height;
  }

  if (Object.keys(payload).length === 0) {
    $q.notify({
      type: 'warning',
      message: 'Estimate did not contain usable values.'
    });
    return;
  }

  try {
    await store.updateItem(
      itemId,
      props.user,
      item.label,
      item.description || '',
      item.quantity || 1,
      item.collection,
      item.container ?? undefined,
      undefined,
      payload
    );
    $q.notify({
      type: 'positive',
      message: 'Estimate applied'
    });
  } catch (error) {
    console.error('[ReviewQueue] Failed to apply AI estimate', error);
    $q.notify({
      type: 'negative',
      message: 'Failed to apply estimate'
    });
  }
};

const handleInlineSave = async (itemId: number, issueKey: string, value: any) => {
  if (!props.user) return;

  const item = store.items.find(i => i.value === itemId);
  if (!item) return;

  try {
    const updateData: Record<string, any> = {};
    let containerParam = item.container ?? undefined;

    switch (issueKey) {
      case 'weight': {
        const weight = parseFloat(String(value));
        if (isNaN(weight) || weight <= 0) {
          $q.notify({ type: 'warning', message: 'Please enter a valid weight greater than zero.' });
          return;
        }
        updateData.weightLbs = weight;
        break;
      }
      case 'dimensions': {
        const dims = value || {};
        const length = Number(dims.length);
        const width = Number(dims.width);
        const height = Number(dims.height);
        if (![length, width, height].every(num => Number.isFinite(num) && num > 0)) {
          $q.notify({
            type: 'warning',
            message: 'Enter positive numbers for length, width, and height.'
          });
          return;
        }
        updateData.lengthIn = length;
        updateData.widthIn = width;
        updateData.heightIn = height;
        break;
      }
      case 'container': {
        containerParam = value ? Number(value) : undefined;
        break;
      }
      default:
        return;
    }

    await store.updateItem(
      itemId,
      props.user,
      item.label,
      item.description || '',
      item.quantity || 1,
      item.collection,
      containerParam,
      undefined,
      updateData
    );

    $q.notify({
      type: 'positive',
      message: 'Item updated successfully'
    });
  } catch (error) {
    console.error('Error updating item:', error);
    $q.notify({
      type: 'negative',
      message: 'Failed to update item'
    });
  }
};

const handlePhotoFix = (itemId: number) => {
  if (!props.user) return;
  store.openItemDetailsModal(itemId, props.user, 'edit');
};

const handleMarkAsLoose = async (itemId: number) => {
  if (!props.user) return;

  const item = store.items.find(i => i.value === itemId);
  if (!item) return;

  try {
    // Get current tags and add 'loose' if not already present
    const currentTags = Array.isArray(item.tags) ? item.tags : [];
    const updatedTags = currentTags.includes('loose')
      ? currentTags
      : [...currentTags, 'loose'];

    const updateData = {
      tags: updatedTags
    };

    await store.updateItem(
      itemId,
      props.user,
      item.label,
      item.description || '',
      item.quantity || 1,
      item.collection,
      item.container ?? undefined,
      undefined,
      updateData
    );

    $q.notify({
      type: 'positive',
      message: 'Item marked as loose - no container needed',
      icon: 'chair'
    });
  } catch (error) {
    console.error('Error marking item as loose:', error);
    $q.notify({
      type: 'negative',
      message: 'Failed to mark item as loose'
    });
  }
};

  const handleDeleteItem = (itemId: number, itemName: string) => {
  $q.dialog({
    title: 'Delete item?',
    message: `Are you sure you want to permanently delete "${itemName}"? This action cannot be undone.`,
    persistent: false,
    ok: {
      label: 'Delete',
      color: 'negative',
      flat: true
    },
    cancel: {
      label: 'Cancel',
      color: 'grey-7',
      flat: true
    }
  }).onOk(async () => {
    try {
      await store.deleteItem(itemId, props.user!);
      $q.notify({
        type: 'positive',
        message: `"${itemName}" deleted successfully`
      });
    } catch (error) {
      console.error('Error deleting item:', error);
      $q.notify({
        type: 'negative',
        message: 'Failed to delete item'
      });
    }
  });
};

// Duplicate handling functions
const keepItemA = async (pairKey: string, itemAId: number, itemBId: number) => {
  $q.dialog({
    title: 'Delete item B?',
    message: 'This will permanently delete the second item and keep the first one.',
    cancel: true,
    persistent: false
  }).onOk(async () => {
    try {
      await store.deleteItem(itemBId, props.user!);
      dismissPair(pairKey);
      $q.notify({
        type: 'positive',
        message: 'Item B deleted successfully'
      });
    } catch (error) {
      $q.notify({
        type: 'negative',
        message: 'Failed to delete item'
      });
    }
  });
};

const keepItemB = async (pairKey: string, itemAId: number, itemBId: number) => {
  $q.dialog({
    title: 'Delete item A?',
    message: 'This will permanently delete the first item and keep the second one.',
    cancel: true,
    persistent: false
  }).onOk(async () => {
    try {
      await store.deleteItem(itemAId, props.user!);
      dismissPair(pairKey);
      $q.notify({
        type: 'positive',
        message: 'Item A deleted successfully'
      });
    } catch (error) {
      $q.notify({
        type: 'negative',
        message: 'Failed to delete item'
      });
    }
  });
};

const keepBothItems = (pairKey: string) => {
  dismissPair(pairKey);
  $q.notify({
    type: 'info',
    message: 'Marked as not duplicates'
  });
};
</script>

<template>
  <div class="review-queue-container">
    <div class="review-header q-pa-md">
      <h5 class="text-h5 text-primary q-my-none">{{ viewTitle }}</h5>
      <p class="text-caption text-grey-7 q-mt-xs">
        {{ viewSubtitle }}
      </p>
    </div>

    <!-- Overview Section -->
    <div v-if="normalizedView === 'overview'" class="summary-grid q-pa-md">
      <q-card
        v-for="summary in missingAttributeSummary"
        :key="summary.key"
        flat
        bordered
        class="summary-card"
      >
        <q-card-section>
          <div class="summary-label">{{ summary.label }}</div>
          <div class="summary-value">{{ summary.missing }}</div>
          <q-linear-progress
            :value="summary.pct / 100"
            :color="summary.color"
            rounded
            size="8px"
            class="q-mt-sm"
          />
          <div class="text-caption text-grey-6 q-mt-xs">
            {{ summary.total }} total items
          </div>
        </q-card-section>
      </q-card>

      <!-- Potential Duplicates Card -->
      <q-card
        flat
        bordered
        class="summary-card duplicate-card"
        :class="{ 'has-duplicates': duplicateCount > 0 }"
      >
        <q-card-section>
          <div class="summary-label">Potential duplicates</div>
          <div class="summary-value">{{ duplicateCount }}</div>
          <q-linear-progress
            :value="duplicateCount > 0 ? 1 : 0"
            :color="duplicateCount > 3 ? 'negative' : duplicateCount > 0 ? 'warning' : 'positive'"
            rounded
            size="8px"
            class="q-mt-sm"
          />
          <div class="text-caption text-grey-6 q-mt-xs">
            pairs to review
          </div>
        </q-card-section>
      </q-card>
    </div>

    <!-- Review Attributes Section -->
    <div
      v-else-if="normalizedView === 'attributes'"
      class="attributes-container"
      ref="attributesContainerRef"
      :style="attributesHeight ? { height: attributesHeight + 'px' } : undefined"
    >
      <!-- Summary Cards for Attributes View -->
      <div class="summary-cards q-pa-md">
        <q-card
          v-for="summary in missingAttributeSummary"
          :key="summary.key"
          flat
          bordered
          clickable
          class="summary-card"
          :class="{ 'selected-filter': selectedIssueFilter === summary.key }"
          @click="selectedIssueFilter = selectedIssueFilter === summary.key ? null : summary.key"
        >
          <q-card-section>
            <div class="summary-label">{{ summary.label }}</div>
            <div class="summary-value">{{ summary.missing }}</div>
            <q-linear-progress
              :value="summary.pct / 100"
              :color="summary.color"
              rounded
              size="8px"
              class="q-mt-sm"
            />
            <div class="text-caption text-grey-6 q-mt-xs">
              {{ summary.total }} total items
            </div>
          </q-card-section>
        </q-card>
      </div>

      <div class="attributes-table-page q-pa-md">
        <div class="attributes-table-wrapper">
          <q-table
            flat
            bordered
            class="review-attributes-table"
            :rows="filteredReviewQueue"
            :columns="reviewColumns"
            row-key="id"
            :rows-per-page-options="[0]"
            virtual-scroll
            :virtual-scroll-item-size="60"
            :virtual-scroll-sticky-size-start="48"
            no-data-label="All caught up! Nothing to review."
          >
            <template #body-cell-name="props">
              <q-td :props="props">
                <div class="item-name-cell">
                  {{ props.row.name }}
                  <q-tooltip :delay="300" anchor="top middle" self="bottom middle" max-width="300px">
                    <div class="item-tooltip">
                      <div class="text-weight-bold q-mb-xs">{{ props.row.name }}</div>
                      <div v-if="getItemDetails(props.row.id)">
                        <div class="text-caption">
                          <strong>Collection:</strong> {{ getItemDetails(props.row.id)?.collection }}
                        </div>
                        <div class="text-caption">
                          <strong>Container:</strong> {{ getItemDetails(props.row.id)?.container }}
                        </div>
                        <div v-if="getItemDetails(props.row.id)?.description" class="text-caption q-mt-sm">
                          <strong>Description:</strong><br>
                          {{ getItemDetails(props.row.id)?.description }}
                        </div>
                      </div>
                    </div>
                  </q-tooltip>
                </div>
              </q-td>
            </template>

            <template #body-cell-collection="props">
              <q-td :props="props">
                {{ props.row.collection }}
              </q-td>
            </template>

            <template #body-cell-container="props">
              <q-td :props="props">
                {{ props.row.container }}
              </q-td>
            </template>

            <template #body-cell-issues="props">
              <q-td :props="props">
                <div class="issue-chip-row">
                  <q-chip
                    v-for="issue in props.row.issues"
                    :key="issue.key"
                    dense
                    outline
                    clickable
                    class="issue-chip"
                    :color="issue.color"
                    text-color="white"
                    @click="issue.key === 'picture' ? handlePhotoFix(props.row.id) : null"
                  >
                    {{ issue.label }}
                    <q-tooltip>
                      {{
                        issue.key === 'picture'
                          ? 'Open item to upload a photo'
                          : 'Click to edit inline'
                      }}
                    </q-tooltip>

                    <template v-if="issue.key !== 'picture'">
                      <q-popup-edit
                        :model-value="getIssueModelValue(props.row.id, issue.key)"
                        buttons
                        persistent
                        @save="value => handleInlineSave(props.row.id, issue.key, value)"
                      >
                        <template #default="scope">
                          <q-input
                            v-if="issue.key === 'weight'"
                            v-model="scope.value"
                            label="Weight (lbs)"
                            type="number"
                            dense
                            outlined
                            autofocus
                            min="0"
                          />
                          <div
                            v-else-if="issue.key === 'dimensions'"
                            class="dimension-form-grid"
                          >
                            <q-input
                              v-model.number="scope.value.length"
                              label="Length (in)"
                              type="number"
                              dense
                              outlined
                              autofocus
                              min="0"
                              step="0.1"
                            />
                            <q-input
                              v-model.number="scope.value.width"
                              label="Width (in)"
                              type="number"
                              dense
                              outlined
                              min="0"
                              step="0.1"
                            />
                            <q-input
                              v-model.number="scope.value.height"
                              label="Height (in)"
                              type="number"
                              dense
                              outlined
                              min="0"
                              step="0.1"
                            />
                          </div>
                          <div v-else-if="issue.key === 'container'" class="container-fix-options">
                            <q-select
                              v-model="scope.value"
                              :options="containerOptions"
                              emit-value
                              map-options
                              label="Select container"
                              outlined
                              dense
                              class="q-mb-sm"
                            />
                            <div class="text-center q-mb-xs text-caption text-grey-7">or</div>
                            <q-btn
                              flat
                              dense
                              color="secondary"
                              icon="chair"
                              label="Mark as loose item"
                              class="full-width"
                              @click="handleMarkAsLoose(props.row.id); scope.cancel()"
                            >
                              <q-tooltip>Mark this as furniture/large item that doesn't need a container</q-tooltip>
                            </q-btn>
                          </div>
                        </template>
                      </q-popup-edit>
                    </template>
                  </q-chip>
                </div>
              </q-td>
            </template>

            <template #body-cell-actions="props">
              <q-td :props="props">
                <div class="actions-cell">
                  <div class="action-buttons">
                    <q-btn
                      flat
                      dense
                      round
                      color="primary"
                      icon="auto_fix_high"
                      size="sm"
                      data-ignore-row-click
                      :loading="getEstimateState(props.row.id).loading"
                      @click.stop="requestAiEstimateForItem(props.row.id)"
                    >
                      <q-tooltip>Suggest weight &amp; size</q-tooltip>
                    </q-btn>
                    <q-btn
                      flat
                      dense
                      round
                      color="negative"
                      icon="delete"
                      size="sm"
                      data-ignore-row-click
                      @click.stop="handleDeleteItem(props.row.id, props.row.name)"
                    >
                      <q-tooltip>Delete item</q-tooltip>
                    </q-btn>
                  </div>
                  <div
                    v-if="getEstimateState(props.row.id).estimate"
                    class="ai-suggestion-pill"
                  >
                    <div class="pill-summary">
                      ≈ {{ formatEstimateValue(getEstimateState(props.row.id).estimate?.weight_lbs?.value, 'lbs') }}
                      <span class="text-grey-5">•</span>
                      {{ formatEstimateDimensions(getEstimateState(props.row.id).estimate) }}
                    </div>
                    <q-btn
                      flat
                      dense
                      size="sm"
                      color="primary"
                      data-ignore-row-click
                      label="Apply"
                      icon="playlist_add"
                      @click.stop="applyAiEstimateToItem(props.row.id)"
                    />
                  </div>
                  <div
                    v-else-if="getEstimateState(props.row.id).error"
                    class="text-negative text-caption q-mt-xs"
                  >
                    {{ getEstimateState(props.row.id).error }}
                  </div>
                </div>
              </q-td>
            </template>

            <template #bottom>
              <div class="review-table-footer row items-center justify-between full-width q-pa-sm">
                <div class="text-caption text-grey-7">
                  Showing {{ filteredReviewQueue.length }} of {{ bulkReviewQueueDetailed.length }} items
                </div>
                <q-btn
                  flat
                  dense
                  color="primary"
                  icon="refresh"
                  label="Refresh data"
                  :disable="!props.user"
                  @click="props.user && store.loadInventory(props.user)"
                />
              </div>
            </template>
          </q-table>
        </div>
      </div>
    </div>

    <!-- Potential Duplicates Section -->
    <div v-else class="duplicates-section q-pa-md">
      <div v-if="duplicatePairs.length === 0" class="no-duplicates q-pa-xl text-center">
        <CheckCircle2 :size="64" class="no-duplicates-icon" />
        <div class="text-h6 q-mt-md">No potential duplicates found</div>
        <div class="text-body2 text-grey-7 q-mt-sm">
          Your inventory looks clean!
        </div>
      </div>

      <div v-else class="duplicate-pairs-grid">
        <q-card
          v-for="pair in duplicatePairs"
          :key="pair.pairKey"
          flat
          bordered
          class="duplicate-pair-card q-mb-md"
        >
          <q-card-section>
            <div class="pair-header q-mb-md">
              <q-badge :color="pair.similarity >= 90 ? 'negative' : pair.similarity >= 80 ? 'warning' : 'info'" outline>
                {{ pair.similarity }}% match
              </q-badge>
            </div>

            <div class="comparison-container">
              <!-- Item A -->
              <div class="comparison-item item-a-box">
                <div class="item-label">Item A</div>
                <div class="item-photo-container" v-if="pair.itemA.picture_url">
                  <img
                    :src="pair.itemA.picture_url"
                    class="item-photo"
                    alt="Item A photo"
                  />
                </div>
                <div class="item-details">
                  <div class="item-name">{{ pair.itemA.label }}</div>
                  <div class="item-meta">
                    <div class="meta-row">
                      <span class="meta-label">Quantity:</span>
                      <span class="meta-value">{{ pair.itemA.quantity || 1 }}</span>
                    </div>
                    <div class="meta-row" v-if="pair.itemA.collection">
                      <span class="meta-label">Collection:</span>
                      <span class="meta-value">{{ store.collections.find(c => c.value === pair.itemA.collection)?.label || 'Unknown' }}</span>
                    </div>
                    <div class="meta-row" v-if="pair.itemA.description">
                      <span class="meta-label">Description:</span>
                      <span class="meta-value">{{ pair.itemA.description }}</span>
                    </div>
                  </div>
                </div>
              </div>

              <!-- Item B -->
              <div class="comparison-item item-b-box">
                <div class="item-label">Item B</div>
                <div class="item-photo-container" v-if="pair.itemB.picture_url">
                  <img
                    :src="pair.itemB.picture_url"
                    class="item-photo"
                    alt="Item B photo"
                  />
                </div>
                <div class="item-details">
                  <div class="item-name">{{ pair.itemB.label }}</div>
                  <div class="item-meta">
                    <div class="meta-row">
                      <span class="meta-label">Quantity:</span>
                      <span class="meta-value">{{ pair.itemB.quantity || 1 }}</span>
                    </div>
                    <div class="meta-row" v-if="pair.itemB.collection">
                      <span class="meta-label">Collection:</span>
                      <span class="meta-value">{{ store.collections.find(c => c.value === pair.itemB.collection)?.label || 'Unknown' }}</span>
                    </div>
                    <div class="meta-row" v-if="pair.itemB.description">
                      <span class="meta-label">Description:</span>
                      <span class="meta-value">{{ pair.itemB.description }}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <!-- Action Buttons -->
            <q-separator class="q-my-md" />
            <div class="action-buttons">
              <q-btn
                flat
                color="primary"
                label="Keep A"
                icon="check"
                @click="keepItemA(pair.pairKey, pair.itemA.value, pair.itemB.value)"
              />
              <q-btn
                flat
                color="primary"
                label="Keep B"
                icon="check"
                @click="keepItemB(pair.pairKey, pair.itemA.value, pair.itemB.value)"
              />
              <q-btn
                flat
                color="grey-7"
                label="Keep both"
                icon="done_all"
                @click="keepBothItems(pair.pairKey)"
              />
            </div>
          </q-card-section>
        </q-card>
      </div>
    </div>
  </div>
</template>

<style scoped>
.review-queue-container {
  max-width: 100%;
  background: var(--bg);
}

.review-header {
  background: var(--surface-card);
  border-bottom: 1px solid var(--border);
}

.review-header h5 {
  font-family: var(--font-display);
  letter-spacing: var(--ls-title);
}

.summary-grid {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: var(--sp-5);
}

.summary-card {
  background: var(--surface-card);
  border: 1px solid var(--border);
  border-radius: var(--r-lg);
  box-shadow: var(--shadow-sm);
  cursor: pointer;
  transition: all var(--dur-base) var(--ease-standard);
}

.summary-card:hover {
  transform: translateY(-2px);
  box-shadow: var(--shadow-md);
}

.summary-card:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring);
}

.summary-card.selected-filter {
  border-color: var(--accent);
  border-width: 2px;
  background: var(--accent-quiet);
}

.duplicate-card.has-duplicates {
  border-color: var(--warning);
  border-width: 2px;
}

@media (max-width: 1400px) {
  .summary-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}

@media (max-width: 900px) {
  .summary-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 600px) {
  .summary-grid {
    grid-template-columns: repeat(1, minmax(0, 1fr));
  }
}

.summary-cards {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: var(--sp-5);
  margin-bottom: 0;
}

@media (max-width: 1200px) {
  .summary-cards {
    grid-template-columns: repeat(2, 1fr);
  }
}

@media (max-width: 600px) {
  .summary-cards {
    grid-template-columns: repeat(1, 1fr);
  }
}

.summary-label {
  font-size: var(--fs-body);
  color: var(--text-secondary);
}

.summary-value {
  font-family: var(--font-display);
  font-size: var(--fs-display-m);
  font-weight: var(--fw-bold);
  line-height: var(--lh-tight);
  color: var(--text-primary);
}

.attributes-container {
  min-height: 0;
  background: var(--bg);
  display: flex;
  flex-direction: column;
}

.attributes-table-page {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.attributes-table-wrapper {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: var(--surface-card);
  border: 1px solid var(--border);
  border-radius: var(--r-lg);
  box-shadow: var(--shadow-sm);
  overflow: hidden;
}

.review-attributes-table {
  flex: 1;
  min-height: 0;
  display: flex;
}

.review-attributes-table :deep(.q-table__container) {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.review-attributes-table :deep(.q-table__top) {
  flex-shrink: 0;
  padding-bottom: var(--sp-3);
}

.review-attributes-table :deep(.q-table__middle) {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
}

.review-attributes-table :deep(.q-table__bottom) {
  flex-shrink: 0;
}

.review-attributes-table :deep(thead tr th) {
  background: var(--accent-quiet);
  color: var(--accent);
  font-weight: var(--fw-semibold);
}

.search-input {
  width: 25vw;
  min-width: 220px;
}

.filters-menu {
  min-width: 320px;
  max-width: 420px;
  padding: var(--sp-5);
}

.actions-cell {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
}

.action-buttons {
  display: flex;
  gap: var(--sp-3);
}

.ai-suggestion-pill {
  border: 1px solid var(--accent-quiet-2);
  border-radius: var(--r-xs);
  padding: var(--sp-2) var(--sp-4);
  background: var(--accent-quiet);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-3);
}

.ai-suggestion-pill .pill-summary {
  font-family: var(--font-mono);
  font-size: var(--fs-label);
  color: var(--text-primary);
  font-weight: var(--fw-semibold);
}

.filter-section + .filter-section {
  margin-top: var(--sp-4);
}

.section-label {
  font-family: var(--font-mono);
  font-size: var(--fs-micro);
  text-transform: uppercase;
  letter-spacing: var(--ls-eyebrow);
  color: var(--text-tertiary);
  margin-bottom: var(--sp-2);
}

.chip-row {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sp-3);
}

.dimension-form-grid {
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
  width: 240px;
}

.container-fix-options {
  min-width: 260px;
}

.review-table-footer {
  border-top: 1px solid var(--border);
  background: var(--surface-sunk);
}

.issue-chip-row {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sp-2);
}

.issue-chip {
  font-size: var(--fs-micro);
  cursor: pointer;
  transition: transform var(--dur-fast) var(--ease-standard);
}

.issue-chip:hover {
  transform: translateY(-1px);
}

.item-name-cell {
  cursor: help;
}

.item-tooltip {
  padding: var(--sp-2);
}

/* Section Toggle */
.section-toggle {
  display: flex;
  justify-content: center;
}

/* Duplicates Section */
.duplicates-section {
  max-width: 100%;
}

.no-duplicates {
  background: var(--surface-card);
  border: 1px solid var(--border);
  border-radius: var(--r-lg);
  box-shadow: var(--shadow-sm);
}

.no-duplicates-icon {
  color: var(--success);
}

.duplicate-pairs-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: var(--sp-5);
  max-width: 1200px;
  margin: 0 auto;
}

.duplicate-pair-card {
  background: var(--surface-card);
  border: 1px solid var(--border);
  border-radius: var(--r-lg);
  box-shadow: var(--shadow-sm);
}

.pair-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.comparison-container {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--sp-7);
  align-items: start;
}

.comparison-item {
  display: flex;
  flex-direction: column;
  gap: var(--sp-4);
}

.item-a-box,
.item-b-box {
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  padding: var(--sp-5);
  background: var(--surface-sunk);
  transition: border-color var(--dur-base) var(--ease-standard);
}

.item-a-box:hover,
.item-b-box:hover {
  border-color: var(--accent);
}

.item-label {
  font-family: var(--font-mono);
  font-weight: var(--fw-semibold);
  font-size: var(--fs-micro);
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: var(--ls-eyebrow);
}

.item-photo-container {
  width: 120px;
  height: 120px;
  border-radius: var(--r-xs);
  overflow: hidden;
  background: var(--surface-hover);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.item-photo {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.item-details {
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
}

.item-name {
  font-size: var(--fs-body-l);
  font-weight: var(--fw-semibold);
  color: var(--text-primary);
  word-break: break-word;
}

.item-meta {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
}

.meta-row {
  display: flex;
  gap: var(--sp-3);
  font-size: var(--fs-label);
}

.meta-label {
  font-weight: var(--fw-semibold);
  color: var(--text-secondary);
  min-width: 80px;
}

.meta-value {
  color: var(--text-primary);
  word-break: break-word;
}

.action-buttons {
  display: flex;
  gap: var(--sp-3);
  justify-content: center;
  flex-wrap: wrap;
}

@media (max-width: 768px) {
  .comparison-container {
    grid-template-columns: 1fr;
    gap: var(--sp-5);
  }

  .action-buttons {
    flex-direction: column;
  }

  .action-buttons .q-btn {
    width: 100%;
  }
}
</style>
