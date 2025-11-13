<script setup lang="ts">
import { computed, ref } from 'vue';
import { inventoryStore } from '../../stores/InventoryStore';
import { useDataQuality } from '../../composables/useDataQuality';

const props = defineProps({
  user: String
});

const store = inventoryStore();
const { missingAttributeSummary, bulkReviewQueueDetailed } = useDataQuality(store);

const selectedIssueFilter = ref<string | null>(null);
const searchTerm = ref('');

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
  },
  {
    name: 'actions',
    label: '',
    align: 'right',
    field: 'id'
  }
];

const totalMissingItems = computed(() => bulkReviewQueueDetailed.value.length);

const editItem = (itemId: number) => {
  if (!props.user) return;
  store.openItemDetailsModal(itemId, props.user, 'edit');
};
</script>

<template>
  <div class="review-queue-container">
    <div class="review-header q-pa-md">
      <h5 class="text-h5 text-primary q-my-none">Data Quality Review</h5>
      <p class="text-caption text-grey-7 q-mt-xs">
        Focus on items missing photos, measurements, and placement details
      </p>
    </div>

    <div class="summary-grid q-pa-md">
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
    </div>

    <div class="review-filters q-mt-lg">
      <q-select
        v-model="selectedIssueFilter"
        :options="reviewFilterOptions"
        emit-value
        map-options
        label="Filter by issue"
        dense
        outlined
        clearable
        class="filter-select"
      />
      <q-input
        v-model="searchTerm"
        dense
        outlined
        label="Search by item name"
        class="filter-search"
        clear-icon="close"
        @clear="searchTerm = ''"
      >
        <template #append>
          <q-icon name="search" />
        </template>
      </q-input>
      <q-btn
        flat
        color="primary"
        icon="restart_alt"
        label="Reset filters"
        @click="selectedIssueFilter = null; searchTerm = ''"
      />
    </div>

    <q-card flat bordered class="queue-table-card">
      <q-table
        flat
        :rows="filteredReviewQueue"
        :columns="reviewColumns"
        row-key="id"
        :rows-per-page-options="[10, 20, 50]"
        :loading="false"
        no-data-label="All caught up! Nothing to review."
      >
        <template #body-cell-issues="props">
          <q-td :props="props">
            <div class="issue-chip-row">
              <q-chip
                v-for="issue in props.row.issues"
                :key="issue.key"
                dense
                :color="issue.color"
                text-color="white"
                class="issue-chip"
              >
                {{ issue.label }}
              </q-chip>
            </div>
          </q-td>
        </template>
        <template #body-cell-actions="props">
          <q-td :props="props" class="text-right">
            <q-btn
              flat
              dense
              color="primary"
              icon="edit"
              label="Edit"
              @click="editItem(props.row.id)"
            />
          </q-td>
        </template>
      </q-table>
    </q-card>
  </div>
</template>

<style scoped>
.review-queue-container {
  max-width: 100%;
  background: #F7F8FA;
}

.summary-grid {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 16px;
}

.summary-card {
  background: white;
}

@media (max-width: 1100px) {
  .summary-grid {
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
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

.review-filters {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  align-items: center;
}

.filter-select {
  min-width: 240px;
}

.filter-search {
  flex: 1;
  min-width: 240px;
}

.queue-table-card {
  margin-top: 16px;
}

.issue-chip-row {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.issue-chip {
  font-size: 0.7rem;
}
</style>
