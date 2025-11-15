<script setup lang="ts">
import { computed, ref, onMounted, onBeforeUnmount, watch, nextTick } from 'vue';
import { inventoryStore } from '../../stores/InventoryStore';
import { useDataQuality } from '../../composables/useDataQuality';
import { useDuplicateDetection } from '../../composables/useDuplicateDetection';
import { useQuasar } from 'quasar';

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
const searchTerm = ref('');
const showFiltersMenu = ref(false);
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
      return 'Review Attributes';
    case 'duplicates':
      return 'Review Duplicates';
    default:
      return 'Data Quality Overview';
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

  if (searchTerm.value.trim()) {
    const term = searchTerm.value.trim().toLowerCase();
    queue = queue.filter((item) => item.name.toLowerCase().includes(term));
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
    label: 'Missing Details',
    field: 'issues',
    align: 'left'
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
        updateData.dimensions = `${length} x ${width} x ${height} in`;
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

// Duplicate handling functions
const keepItemA = async (pairKey: string, itemAId: number, itemBId: number) => {
  $q.dialog({
    title: 'Delete Item B?',
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
    title: 'Delete Item A?',
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
          <div class="summary-label">Potential Duplicates</div>
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
            <template #top>
              <q-input
                dense
                filled
                debounce="300"
                color="primary"
                bg-color="transparent"
                v-model="searchTerm"
                placeholder="Search items"
                class="search-input"
              >
                <template #prepend>
                  <q-icon color="primary" name="search" />
                </template>
                <template #append>
                  <q-icon
                    v-if="searchTerm"
                    name="close"
                    class="cursor-pointer"
                    @click="searchTerm = ''"
                  />
                </template>
              </q-input>

              <q-space />

              <div class="row items-center q-gutter-sm">
                <q-chip
                  v-if="selectedIssueFilter"
                  dense
                  color="primary"
                  text-color="white"
                  removable
                  @remove="selectedIssueFilter = null"
                >
                  {{
                    reviewFilterOptions.find(option => option.value === selectedIssueFilter)?.label ||
                    'Filtered'
                  }}
                </q-chip>
                <q-btn
                  flat
                  color="primary"
                  label="Filters"
                  icon="filter_list"
                  @click.stop="showFiltersMenu = true"
                />
              </div>

              <q-dialog v-model="showFiltersMenu">
                <q-card class="filters-menu">
                  <q-card-section class="row items-center justify-between q-pb-none">
                    <div class="text-h6 text-primary">Filter Missing Attributes</div>
                    <q-btn flat dense icon="close" color="grey-7" v-close-popup />
                  </q-card-section>
                  <q-card-section>
                    <div class="filter-section">
                      <div class="section-label">Issue Types</div>
                      <div class="chip-row">
                        <q-chip
                          v-for="option in reviewFilterOptions"
                          :key="option.value ?? 'all'"
                          dense
                          clickable
                          :color="selectedIssueFilter === option.value ? 'primary' : 'grey-4'"
                          :text-color="selectedIssueFilter === option.value ? 'white' : 'grey-8'"
                          @click="selectedIssueFilter = option.value"
                        >
                          {{ option.label }}
                        </q-chip>
                      </div>
                    </div>
                    <div class="text-right q-mt-md">
                      <q-btn flat color="grey-7" label="Reset" @click="selectedIssueFilter = null" />
                      <q-btn flat color="primary" label="Done" v-close-popup />
                    </div>
                  </q-card-section>
                </q-card>
              </q-dialog>
            </template>

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
                          <q-select
                            v-else-if="issue.key === 'container'"
                            v-model="scope.value"
                            :options="containerOptions"
                            emit-value
                            map-options
                            label="Select container"
                            outlined
                            dense
                          />
                        </template>
                      </q-popup-edit>
                    </template>
                  </q-chip>
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
        <q-icon name="check_circle" size="64px" color="positive" />
        <div class="text-h6 q-mt-md">No Potential Duplicates Found</div>
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
                {{ pair.similarity }}% Match
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
                label="Keep Both"
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
  background: #F7F8FA;
}

.review-header {
  background: white;
  border-bottom: 1px solid #E0E0E0;
}

.summary-grid {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 16px;
}

.summary-card {
  background: white;
}

.duplicate-card.has-duplicates {
  border-color: var(--q-warning);
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

.summary-label {
  font-size: 0.9rem;
  color: var(--text-secondary);
}

.summary-value {
  font-size: 2rem;
  font-weight: 700;
  color: var(--text-primary);
}

.attributes-container {
  min-height: 0;
  background: #F7F8FA;
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
  background: white;
  border: 1px solid #E0E0E0;
  border-radius: 16px;
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
  padding-bottom: 8px;
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
  background: #274690;
  color: white;
  font-weight: 600;
}

.search-input {
  width: 25vw;
  min-width: 220px;
}

.filters-menu {
  min-width: 320px;
  max-width: 420px;
  padding: 16px;
}

.filter-section + .filter-section {
  margin-top: 12px;
}

.section-label {
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: #6b7280;
  margin-bottom: 6px;
}

.chip-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.dimension-form-grid {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 240px;
}

.review-table-footer {
  border-top: 1px solid #e0e0e0;
  background: #fafafa;
}

.issue-chip-row {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.issue-chip {
  font-size: 0.7rem;
  cursor: pointer;
  transition: transform 0.1s ease;
}

.issue-chip:hover {
  transform: translateY(-1px);
}

.item-name-cell {
  cursor: help;
}

.item-tooltip {
  padding: 4px;
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
  background: white;
  border-radius: 8px;
}

.duplicate-pairs-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 16px;
  max-width: 1200px;
  margin: 0 auto;
}

.duplicate-pair-card {
  background: white;
}

.pair-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.comparison-container {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 24px;
  align-items: start;
}

.comparison-item {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.item-a-box,
.item-b-box {
  border: 2px solid #e0e0e0;
  border-radius: 12px;
  padding: 16px;
  background: #fafafa;
  transition: border-color 0.2s ease;
}

.item-a-box:hover,
.item-b-box:hover {
  border-color: var(--q-primary);
}

.item-label {
  font-weight: 600;
  font-size: 0.9rem;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.item-photo-container {
  width: 120px;
  height: 120px;
  border-radius: 8px;
  overflow: hidden;
  background: #f5f5f5;
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
  gap: 8px;
}

.item-name {
  font-size: 1.1rem;
  font-weight: 600;
  color: var(--text-primary);
  word-break: break-word;
}

.item-meta {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.meta-row {
  display: flex;
  gap: 8px;
  font-size: 0.85rem;
}

.meta-label {
  font-weight: 600;
  color: var(--text-secondary);
  min-width: 80px;
}

.meta-value {
  color: var(--text-primary);
  word-break: break-word;
}

.action-buttons {
  display: flex;
  gap: 8px;
  justify-content: center;
  flex-wrap: wrap;
}

@media (max-width: 768px) {
  .comparison-container {
    grid-template-columns: 1fr;
    gap: 16px;
  }

  .action-buttons {
    flex-direction: column;
  }

  .action-buttons .q-btn {
    width: 100%;
  }
}
</style>
