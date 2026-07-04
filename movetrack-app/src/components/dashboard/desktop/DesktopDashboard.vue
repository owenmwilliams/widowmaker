<script setup lang="ts">
import { computed } from 'vue';
import { inventoryStore } from '../../../stores/InventoryStore'
import { useDataQuality, weightIsTracked } from '../../../composables/useDataQuality';
import BarTrendChart from '../../shared/visuals/BarTrendChart.vue';
import StatTable from '../../shared/visuals/StatTable.vue';
import {
  Package,
  Boxes,
  Folder,
  MapPin,
  Wallet,
  Scale,
  Box,
  TriangleAlert,
  CircleAlert,
  FolderX,
  DollarSign
} from 'lucide-vue-next';

const store = inventoryStore();
const { missingAttributeSummary } = useDataQuality(store);

const normalizeDate = (value: any) => {
  if (!value) return null;
  const date = new Date(value);
  return isNaN(date.getTime()) ? null : date;
};

// Parse item dimensions helper
const parseItemDimensions = (item: any) => {
  if (
    item.length_in != null &&
    item.width_in != null &&
    item.height_in != null
  ) {
    const length = Number(item.length_in);
    const width = Number(item.width_in);
    const height = Number(item.height_in);
    if ([length, width, height].every((val) => Number.isFinite(val) && val > 0)) {
      return { length, width, height };
    }
  }
  if (typeof item.dimensions === 'string' && item.dimensions.trim().length > 0) {
    const cleaned = item.dimensions.toLowerCase().replace(/[^0-9.x×]/g, '');
    const parts = cleaned.split(/[x×]/).filter(Boolean).map(Number);
    if (parts.length === 3 && parts.every((val) => Number.isFinite(val) && val > 0)) {
      return { length: parts[0], width: parts[1], height: parts[2] };
    }
  }
  return null;
};

// Core stats
const totalItems = computed(() => store.items.length);
const totalCollections = computed(() => store.collections.length);
const totalContainers = computed(() => store.containers.length);
const totalLocations = computed(() => store.locations.length);

// Value stats
const totalEstimatedValue = computed(() => {
  return store.items.reduce((sum, item) => {
    const value = Number(item.estimated_value) || 0;
    const quantity = Number(item.quantity) || 1;
    return sum + (value * quantity);
  }, 0);
});

const fragileItemsCount = computed(() => {
  return store.items.filter(item => item.fragile).length;
});

// Weight and volume stats
const totalWeight = computed(() => {
  return store.items.reduce((sum, item) => {
    const weight = Number(item.weight_lbs) || 0;
    const quantity = Number(item.quantity) || 1;
    return sum + (weight * quantity);
  }, 0);
});

const totalVolume = computed(() => {
  return store.items.reduce((sum, item) => {
    const dims = parseItemDimensions(item);
    if (!dims) return sum;
    const volumeCubicInches = dims.length * dims.width * dims.height;
    const volumeCubicFeet = volumeCubicInches / 1728;
    const quantity = Number(item.quantity) || 1;
    return sum + (volumeCubicFeet * quantity);
  }, 0);
});

const itemsWithDimensions = computed(() => {
  return store.items.filter(item => parseItemDimensions(item) !== null).length;
});

const itemsWithWeight = computed(() => {
  return store.items.filter(item => weightIsTracked(item.weight_lbs)).length;
});

type TrendDay = { label: string; count: number; dateKey: string };

const itemsAddedTrend = computed(() => {
  const today = new Date();
  const days: TrendDay[] = [];
  for (let i = 6; i >= 0; i--) {
    const date = new Date(today);
    date.setDate(today.getDate() - i);
    const count = store.items.filter(item => {
      const created = normalizeDate((item as any).created_at || (item as any).createdAt);
      if (!created) return false;
      return created.getFullYear() === date.getFullYear() &&
        created.getMonth() === date.getMonth() &&
        created.getDate() === date.getDate();
    }).length;
    days.push({
      label: date.toLocaleDateString(undefined, { weekday: 'short' }),
      count,
      dateKey: date.toISOString().slice(0, 10)
    });
  }
  const maxCount = Math.max(...days.map(day => day.count), 1);
  const totalWeek = days.reduce((sum, day) => sum + day.count, 0);
  return { days, maxCount, totalWeek };
});

const itemsAddedChart = computed(() => {
  return itemsAddedTrend.value.days.map(day => ({
    label: day.label,
    value: day.count,
    key: day.dateKey
  }));
});

const dataQualityHeaders = [
  { label: 'Attribute', align: 'left' },
  { label: 'Missing', align: 'right' },
  { label: 'Total', align: 'right' }
] as const;


// Collection breakdown
const collectionBreakdown = computed(() => {
  return store.collections.map(collection => {
    const items = store.items.filter(item => item.collection === collection.value);
    const itemCount = items.length;
    const totalValue = items.reduce((sum, item) => {
      const value = Number(item.estimated_value) || 0;
      const quantity = Number(item.quantity) || 1;
      return sum + (value * quantity);
    }, 0);
    const containerCount = store.containers.filter(c => c.collection === collection.value).length;

    return {
      name: collection.label,
      itemCount,
      totalValue,
      containerCount,
      percentage: totalItems.value > 0 ? (itemCount / totalItems.value) * 100 : 0
    };
  }).sort((a, b) => b.itemCount - a.itemCount);
});

// Container utilization
const containerUtilization = computed(() => {
  const containersWithLimits = store.containers.filter(c =>
    c.max_weight_lbs || c.max_volume_cuft
  );

  return containersWithLimits.map(container => {
    const items = store.items.filter(item => item.container === container.value);
    const currentWeight = items.reduce((sum, item) => {
      const weight = Number(item.weight_lbs) || 0;
      return sum + weight;
    }, 0);
    const currentVolume = items.reduce((sum, item) => {
      const dims = parseItemDimensions(item);
      if (!dims) return sum;
      return sum + (dims.length * dims.width * dims.height) / 1728;
    }, 0);

    const maxWeight = Number(container.max_weight_lbs) || null;
    const maxVolume = Number(container.max_volume_cuft) || null;

    const weightPct = maxWeight ? (currentWeight / maxWeight) * 100 : null;
    const volumePct = maxVolume ? (currentVolume / maxVolume) * 100 : null;

    const utilizationPct = Math.max(weightPct || 0, volumePct || 0);

    return {
      name: container.label,
      itemCount: items.length,
      utilizationPct,
      status: utilizationPct >= 95 ? 'critical' : utilizationPct >= 80 ? 'warning' : 'ok'
    };
  }).sort((a, b) => b.utilizationPct - a.utilizationPct).slice(0, 5);
});

// Most valuable items
const mostValuableItems = computed(() => {
  return [...store.items]
    .filter(item => item.estimated_value)
    .sort((a, b) => {
      const aValue = (Number(a.estimated_value) || 0) * (Number(a.quantity) || 1);
      const bValue = (Number(b.estimated_value) || 0) * (Number(b.quantity) || 1);
      return bValue - aValue;
    })
    .slice(0, 5)
    .map(item => ({
      name: item.label,
      value: (Number(item.estimated_value) || 0) * (Number(item.quantity) || 1),
      quantity: item.quantity
    }));
});

const getUtilizationColor = (pct: number) => {
  if (pct >= 95) return 'negative';
  if (pct >= 60) return 'warning';
  return 'positive';
};
</script>

<template>
  <div class="dashboard-container">
    <div class="dashboard-header q-pa-md">
      <h5 class="text-h5 text-primary q-my-none dashboard-title">Dashboard</h5>
      <p class="text-caption text-soft q-mt-xs">Overview of your inventory</p>
    </div>

    <!-- Key Stats Cards -->
    <div class="stats-grid q-pa-md">
      <div class="stat-card">
        <div class="stat-card-top">
          <span class="stat-icon tone-accent"><Package :size="22" /></span>
          <span class="stat-eyebrow">Items</span>
        </div>
        <div class="stat-value">{{ totalItems }}</div>
        <div class="stat-sub">Total inventory items</div>
      </div>

      <div class="stat-card">
        <div class="stat-card-top">
          <span class="stat-icon tone-cyan"><Boxes :size="22" /></span>
          <span class="stat-eyebrow">Containers</span>
        </div>
        <div class="stat-value">{{ totalContainers }}</div>
        <div class="stat-sub">Boxes and containers</div>
      </div>

      <div class="stat-card">
        <div class="stat-card-top">
          <span class="stat-icon tone-cyan"><Folder :size="22" /></span>
          <span class="stat-eyebrow">Collections</span>
        </div>
        <div class="stat-value">{{ totalCollections }}</div>
        <div class="stat-sub">Organizational groups</div>
      </div>

      <div class="stat-card">
        <div class="stat-card-top">
          <span class="stat-icon tone-success"><MapPin :size="22" /></span>
          <span class="stat-eyebrow">Locations</span>
        </div>
        <div class="stat-value">{{ totalLocations }}</div>
        <div class="stat-sub">Physical addresses</div>
      </div>

      <div class="stat-card">
        <div class="stat-card-top">
          <span class="stat-icon tone-beacon"><Wallet :size="22" /></span>
          <span class="stat-eyebrow">Total value</span>
        </div>
        <div class="stat-value stat-value--data">${{ totalEstimatedValue.toLocaleString() }}</div>
        <div class="stat-sub">Estimated inventory value</div>
      </div>

      <div class="stat-card">
        <div class="stat-card-top">
          <span class="stat-icon tone-cyan"><Scale :size="22" /></span>
          <span class="stat-eyebrow">Total weight</span>
        </div>
        <div class="stat-value stat-value--data">{{ totalWeight.toFixed(1) }} lbs</div>
        <div class="stat-sub">{{ itemsWithWeight }}/{{ totalItems }} items tracked</div>
      </div>

      <div class="stat-card">
        <div class="stat-card-top">
          <span class="stat-icon tone-accent"><Box :size="22" /></span>
          <span class="stat-eyebrow">Total volume</span>
        </div>
        <div class="stat-value stat-value--data">{{ totalVolume.toFixed(2) }} cu ft</div>
        <div class="stat-sub">{{ itemsWithDimensions }}/{{ totalItems }} items tracked</div>
      </div>

      <div class="stat-card">
        <div class="stat-card-top">
          <span class="stat-icon tone-warning"><TriangleAlert :size="22" /></span>
          <span class="stat-eyebrow">Fragile items</span>
        </div>
        <div class="stat-value">{{ fragileItemsCount }}</div>
        <div class="stat-sub">Handle with care</div>
      </div>
    </div>

    <!-- Engagement Row -->
    <div class="engagement-grid q-pa-md">
      <q-card flat bordered class="engagement-card packing-card">
        <q-card-section>
          <div class="row items-center justify-between q-mb-sm">
            <div>
              <div class="card-title">Packing streak</div>
              <div class="text-caption text-faint">Items added in the last 7 days</div>
            </div>
            <span class="streak-pill">{{ itemsAddedTrend.totalWeek }} this week</span>
          </div>
          <BarTrendChart :data="itemsAddedChart" />
        </q-card-section>
      </q-card>

      <q-card flat bordered class="engagement-card data-quality-card">
        <q-card-section>
          <div class="card-title q-mb-sm">Data quality watchlist</div>
          <StatTable
            class="missing-attr-table"
            :headers="dataQualityHeaders"
            :rows="missingAttributeSummary"
            row-key="key"
          >
            <template #row="{ row }">
              <tr>
                <td>
                  <div class="text-body2 text-weight-medium">{{ row.label }}</div>
                  <div class="text-caption text-faint">{{ row.description }}</div>
                  <q-linear-progress
                    :value="row.pct / 100"
                    :color="row.color"
                    track-color="grey-4"
                    rounded
                    size="6px"
                    class="q-mt-xs"
                  />
                </td>
                <td class="text-right text-weight-bold">{{ row.missing }}</td>
                <td class="text-right text-soft">{{ row.total }}</td>
              </tr>
            </template>
          </StatTable>
        </q-card-section>
      </q-card>
    </div>

    <!-- Main Content Grid -->
    <div class="content-grid q-pa-md">
      <!-- Collection Breakdown -->
      <q-card flat bordered class="content-card">
        <q-card-section class="content-card-header">
          <div class="card-title q-mb-md">Collection breakdown</div>
        </q-card-section>
        <q-card-section class="content-card-body">
          <div v-if="collectionBreakdown.length > 0">
            <div v-for="collection in collectionBreakdown" :key="collection.name" class="collection-item q-mb-md">
              <div class="row items-center justify-between q-mb-xs">
                <div class="text-subtitle2 text-weight-medium">{{ collection.name }}</div>
                <div class="text-caption text-soft">{{ collection.itemCount }} items</div>
              </div>
              <q-linear-progress
                :value="collection.percentage / 100"
                color="primary"
                size="12px"
                rounded
                class="q-mb-xs"
              />
              <div class="row items-center justify-between">
                <div class="text-caption text-faint">{{ collection.containerCount }} containers</div>
                <div class="text-caption text-faint mono-readout">${{ collection.totalValue.toLocaleString() }}</div>
              </div>
            </div>
          </div>
          <div v-else class="empty-state">
            <FolderX :size="32" class="empty-icon" />
            <div class="q-mt-sm">No collections yet</div>
          </div>
        </q-card-section>
      </q-card>

      <!-- Container Utilization -->
      <q-card flat bordered class="content-card">
        <q-card-section class="content-card-header">
          <div class="card-title q-mb-md">Container utilization</div>
        </q-card-section>
        <q-card-section class="content-card-body">
          <div v-if="containerUtilization.length > 0">
            <div v-for="container in containerUtilization" :key="container.name" class="container-util-item q-mb-md">
              <div class="row items-center justify-between q-mb-xs">
                <div class="row items-center">
                  <CircleAlert
                    v-if="container.status === 'critical'"
                    :size="16"
                    class="status-icon status-icon--critical q-mr-xs"
                  />
                  <TriangleAlert
                    v-else-if="container.status === 'warning'"
                    :size="16"
                    class="status-icon status-icon--warning q-mr-xs"
                  />
                  <span class="text-subtitle2 text-weight-medium">{{ container.name }}</span>
                </div>
                <div class="text-caption text-soft mono-readout">{{ container.utilizationPct.toFixed(0) }}%</div>
              </div>
              <q-linear-progress
                :value="container.utilizationPct / 100"
                :color="getUtilizationColor(container.utilizationPct)"
                size="12px"
                rounded
                class="q-mb-xs"
              />
              <div class="text-caption text-faint">{{ container.itemCount }} items</div>
            </div>
          </div>
          <div v-else class="empty-state">
            <Boxes :size="32" class="empty-icon" />
            <div class="q-mt-sm">No containers with limits</div>
          </div>
        </q-card-section>
      </q-card>

      <!-- Most Valuable Items -->
      <q-card flat bordered class="content-card">
        <q-card-section class="content-card-header">
          <div class="card-title q-mb-md">Most valuable items</div>
        </q-card-section>
        <q-card-section class="content-card-body">
          <div v-if="mostValuableItems.length > 0">
            <q-list dense>
              <q-item v-for="(item, index) in mostValuableItems" :key="index" class="q-px-none">
                <q-item-section avatar>
                  <q-avatar color="positive" text-color="white" size="32px">
                    {{ index + 1 }}
                  </q-avatar>
                </q-item-section>
                <q-item-section>
                  <q-item-label class="text-weight-medium">{{ item.name }}</q-item-label>
                  <q-item-label caption v-if="item.quantity > 1">Qty: {{ item.quantity }}</q-item-label>
                </q-item-section>
                <q-item-section side>
                  <q-item-label class="text-positive text-weight-bold mono-readout">${{ item.value.toLocaleString() }}</q-item-label>
                </q-item-section>
              </q-item>
            </q-list>
          </div>
          <div v-else class="empty-state">
            <DollarSign :size="32" class="empty-icon" />
            <div class="q-mt-sm">No items with values</div>
          </div>
        </q-card-section>
      </q-card>
    </div>
  </div>

</template>

<style scoped>
.dashboard-container {
  max-width: 100%;
  background: var(--bg);
}

.dashboard-header {
  background: var(--surface);
  border-bottom: 1px solid var(--border);
}

.dashboard-title {
  font-family: var(--font-display);
  letter-spacing: var(--ls-title);
}

/* Token-mapped text helpers (replace Quasar grey classes) */
.text-soft {
  color: var(--text-secondary);
}

.text-faint {
  color: var(--text-tertiary);
}

.mono-readout {
  font-family: var(--font-mono);
}

/* -------- StatCard metric tiles -------- */
.stats-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: var(--sp-5);
}

.stat-card {
  background: var(--surface-card);
  border: 1px solid var(--border);
  border-radius: var(--r-lg);
  padding: var(--sp-6);
  box-shadow: var(--shadow-sm);
  display: flex;
  flex-direction: column;
  gap: var(--sp-4);
  transition: transform var(--dur-base) var(--ease-standard), box-shadow var(--dur-base) var(--ease-standard);
}

.stat-card:hover {
  transform: translateY(-2px);
  box-shadow: var(--shadow-md);
}

.stat-card-top {
  display: flex;
  align-items: center;
  gap: var(--sp-4);
}

.stat-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border-radius: var(--r-md);
  flex-shrink: 0;
}

.tone-accent {
  color: var(--accent);
  background: color-mix(in oklab, var(--accent) 14%, transparent);
}

.tone-cyan {
  color: var(--cyan-500);
  background: color-mix(in oklab, var(--cyan-500) 14%, transparent);
}

.tone-success {
  color: var(--success);
  background: color-mix(in oklab, var(--success) 14%, transparent);
}

.tone-beacon {
  color: var(--beacon-500);
  background: color-mix(in oklab, var(--beacon-500) 14%, transparent);
}

.tone-warning {
  color: var(--warning);
  background: color-mix(in oklab, var(--warning) 14%, transparent);
}

.stat-eyebrow {
  font-family: var(--font-mono);
  font-size: var(--fs-micro);
  font-weight: var(--fw-semibold);
  letter-spacing: var(--ls-eyebrow);
  text-transform: uppercase;
  color: var(--text-tertiary);
}

.stat-value {
  font-family: var(--font-display);
  font-size: var(--fs-title-l);
  font-weight: var(--fw-extrabold);
  letter-spacing: var(--ls-display);
  line-height: var(--lh-tight);
  color: var(--text-primary);
}

.stat-value--data {
  font-family: var(--font-mono);
  letter-spacing: var(--ls-title);
}

.stat-sub {
  font-size: var(--fs-label);
  color: var(--text-tertiary);
}

/* -------- Engagement row -------- */
.engagement-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
  gap: var(--sp-5);
  align-items: stretch;
  grid-auto-rows: 1fr;
}

.engagement-card {
  height: 100%;
}

.engagement-card,
.content-card {
  background: var(--surface-card);
  border: 1px solid var(--border);
  border-radius: var(--r-lg);
  box-shadow: var(--shadow-sm);
}

.card-title {
  font-family: var(--font-display);
  font-size: var(--fs-title-s);
  font-weight: var(--fw-extrabold);
  letter-spacing: var(--ls-title);
  line-height: var(--lh-snug);
  color: var(--accent);
}

.streak-pill {
  font-family: var(--font-mono);
  font-size: var(--fs-label);
  font-weight: var(--fw-semibold);
  color: var(--accent);
  border: 1px solid var(--accent-quiet-2);
  border-radius: var(--r-pill);
  padding: var(--sp-2) var(--sp-4);
  white-space: nowrap;
}

.packing-card,
.data-quality-card {
  display: flex;
  flex-direction: column;
}

.packing-card .q-card-section,
.data-quality-card .q-card-section {
  flex: 1;
  display: flex;
  flex-direction: column;
}

.data-quality-card .missing-attr-table {
  flex: 1;
}

/* Streak chart: shimmer fill on active bars, quiet tokens elsewhere */
.packing-card :deep(.trend-bar-track) {
  background: var(--surface-sunk);
  border: 1px solid var(--border-soft);
  border-radius: var(--r-sm);
}

.packing-card :deep(.trend-bar-fill) {
  background: var(--surface-hover);
  border-radius: var(--r-xs);
}

.packing-card :deep(.trend-bar--active .trend-bar-fill) {
  background: var(--shimmer-v);
}

.packing-card :deep(.trend-bar-count) {
  font-family: var(--font-mono);
  color: var(--text-primary);
}

.packing-card :deep(.trend-bar-label) {
  color: var(--text-tertiary);
}

/* -------- Content grid -------- */
.content-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: var(--sp-5);
  margin-top: calc(-1 * var(--sp-3));
}

.content-card {
  display: flex;
  flex-direction: column;
  max-height: calc(33vh);
}

.content-card-header {
  flex-shrink: 0;
  padding-bottom: 0 !important;
}

.content-card-body {
  flex: 1;
  overflow-y: auto;
  padding-top: 0 !important;
}

.issue-chip-row {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sp-2);
  margin-top: var(--sp-2);
}

.issue-chip {
  font-size: var(--fs-micro);
}

.collection-item,
.container-util-item {
  padding: var(--sp-3);
  background: var(--surface-sunk);
  border-radius: var(--r-sm);
}

.status-icon {
  flex-shrink: 0;
}

.status-icon--critical {
  color: var(--danger);
}

.status-icon--warning {
  color: var(--warning);
}

.empty-state {
  text-align: center;
  color: var(--text-tertiary);
  padding: var(--sp-5) 0;
}

.empty-icon {
  color: var(--text-tertiary);
}

@media (max-width: 1024px) {
  .content-grid {
    grid-template-columns: 1fr;
  }

  .content-card {
    max-height: 400px;
  }

  .stats-grid {
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  }
}
</style>
