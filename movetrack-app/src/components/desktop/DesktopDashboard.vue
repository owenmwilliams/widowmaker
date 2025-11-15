<script setup lang="ts">
import { computed } from 'vue';
import { inventoryStore } from '../../stores/InventoryStore';
import { storeToRefs } from 'pinia';
import { useDataQuality, weightIsTracked } from '../../composables/useDataQuality';

const props = defineProps({
  user: String
});

const store = inventoryStore();
const { locationValues, collectionValues, containerValues } = storeToRefs(store);
const { missingAttributeSummary } = useDataQuality(store);

const normalizeDate = (value: any) => {
  if (!value) return null;
  const date = new Date(value);
  return isNaN(date.getTime()) ? null : date;
};

// Parse item dimensions helper
const parseItemDimensions = (item: any) => {
  if (item.length_in != null && item.width_in != null && item.height_in != null) {
    const length = Number(item.length_in);
    const width = Number(item.width_in);
    const height = Number(item.height_in);
    if (length && width && height) {
      return { length, width, height };
    }
  }
  if (item.dimensions) {
    const parts = item.dimensions.split('x').map((p: string) => Number(p.trim()));
    if (parts.length === 3 && !parts.some(isNaN)) {
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
  if (pct >= 80) return 'warning';
  if (pct >= 60) return 'orange';
  return 'positive';
};
</script>

<template>
  <div class="dashboard-container">
    <div class="dashboard-header q-pa-md">
      <h5 class="text-h5 text-primary q-my-none">Dashboard</h5>
      <p class="text-caption text-grey-7 q-mt-xs">Overview of your inventory</p>
    </div>

    <!-- Key Stats Cards -->
    <div class="stats-grid q-pa-md">
      <q-card flat bordered class="stat-card">
        <q-card-section>
          <div class="row items-center q-mb-sm">
            <q-icon name="inventory_2" size="md" color="primary" />
            <span class="text-h6 text-primary q-ml-sm">{{ totalItems }}</span>
          </div>
          <div class="text-subtitle2 text-grey-8">Items</div>
          <div class="text-caption text-grey-6">Total inventory items</div>
        </q-card-section>
      </q-card>

      <q-card flat bordered class="stat-card">
        <q-card-section>
          <div class="row items-center q-mb-sm">
            <q-icon name="inventory" size="md" color="secondary" />
            <span class="text-h6 text-primary q-ml-sm">{{ totalContainers }}</span>
          </div>
          <div class="text-subtitle2 text-grey-8">Containers</div>
          <div class="text-caption text-grey-6">Boxes and containers</div>
        </q-card-section>
      </q-card>

      <q-card flat bordered class="stat-card">
        <q-card-section>
          <div class="row items-center q-mb-sm">
            <q-icon name="folder" size="md" color="accent" />
            <span class="text-h6 text-primary q-ml-sm">{{ totalCollections }}</span>
          </div>
          <div class="text-subtitle2 text-grey-8">Collections</div>
          <div class="text-caption text-grey-6">Organizational groups</div>
        </q-card-section>
      </q-card>

      <q-card flat bordered class="stat-card">
        <q-card-section>
          <div class="row items-center q-mb-sm">
            <q-icon name="place" size="md" color="positive" />
            <span class="text-h6 text-primary q-ml-sm">{{ totalLocations }}</span>
          </div>
          <div class="text-subtitle2 text-grey-8">Locations</div>
          <div class="text-caption text-grey-6">Physical addresses</div>
        </q-card-section>
      </q-card>
    </div>

    <!-- Secondary Stats -->
    <div class="secondary-stats q-pa-md">
      <q-card flat bordered>
        <q-card-section>
          <div class="row q-col-gutter-md">
            <div class="col-12 col-md-3">
              <div class="secondary-stat">
                <q-icon name="savings" size="sm" color="grey-7" />
                <div class="q-ml-sm">
                  <div class="text-body1 text-weight-medium">${{ totalEstimatedValue.toLocaleString() }}</div>
                  <div class="text-caption text-grey-6">Total Value</div>
                  <div class="text-caption text-grey-5">Estimated inventory value</div>
                </div>
              </div>
            </div>
            <div class="col-12 col-md-3">
              <div class="secondary-stat">
                <q-icon name="scale" size="sm" color="grey-7" />
                <div class="q-ml-sm">
                  <div class="text-body1 text-weight-medium">{{ totalWeight.toFixed(1) }} lbs</div>
                  <div class="text-caption text-grey-6">Total Weight</div>
                  <div class="text-caption text-grey-5">{{ itemsWithWeight }}/{{ totalItems }} items tracked</div>
                </div>
              </div>
            </div>
            <div class="col-12 col-md-3">
              <div class="secondary-stat">
                <q-icon name="view_in_ar" size="sm" color="grey-7" />
                <div class="q-ml-sm">
                  <div class="text-body1 text-weight-medium">{{ totalVolume.toFixed(2) }} cu ft</div>
                  <div class="text-caption text-grey-6">Total Volume</div>
                  <div class="text-caption text-grey-5">{{ itemsWithDimensions }}/{{ totalItems }} items tracked</div>
                </div>
              </div>
            </div>
            <div class="col-12 col-md-3">
              <div class="secondary-stat">
                <q-icon name="warning" size="sm" color="grey-7" />
                <div class="q-ml-sm">
                  <div class="text-body1 text-weight-medium">{{ fragileItemsCount }}</div>
                  <div class="text-caption text-grey-6">Fragile Items</div>
                  <div class="text-caption text-grey-5">Handle with care</div>
                </div>
              </div>
            </div>
          </div>
        </q-card-section>
      </q-card>
    </div>

    <!-- Engagement Row -->
    <div class="engagement-grid q-pa-md">
      <q-card flat bordered class="engagement-card packing-card">
        <q-card-section>
          <div class="row items-center justify-between q-mb-sm">
            <div>
              <div class="text-h6 text-primary">Packing Streak</div>
              <div class="text-caption text-grey-6">Items added in the last 7 days</div>
            </div>
            <q-badge color="primary" outline align="top">{{ itemsAddedTrend.totalWeek }} this week</q-badge>
          </div>
          <div class="trend-chart">
            <div
              v-for="day in itemsAddedTrend.days"
              :key="day.dateKey"
              class="trend-bar"
              :class="{ 'trend-bar--active': day.count > 0 }"
            >
              <div class="trend-bar-track">
                <div
                  class="trend-bar-fill"
                  :style="{
                    height: `${Math.min(100, day.count === 0 ? 6 : Math.max((day.count / itemsAddedTrend.maxCount) * 100, 12))}%`
                  }"
                >
                  <span class="trend-bar-count" v-if="day.count">{{ day.count }}</span>
                </div>
              </div>
              <div class="trend-bar-label">{{ day.label }}</div>
            </div>
          </div>
        </q-card-section>
      </q-card>

      <q-card flat bordered class="engagement-card data-quality-card">
        <q-card-section>
          <div class="text-h6 text-primary q-mb-sm">Data Quality Watchlist</div>
          <q-markup-table dense flat class="missing-attr-table">
            <thead>
              <tr>
                <th class="text-left">Attribute</th>
                <th class="text-right">Missing</th>
                <th class="text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="attr in missingAttributeSummary" :key="attr.key">
                <td>
                  <div class="text-body2 text-weight-medium">{{ attr.label }}</div>
                  <div class="text-caption text-grey-6">{{ attr.description }}</div>
                  <q-linear-progress
                    :value="attr.pct / 100"
                    :color="attr.color"
                    track-color="grey-4"
                    rounded
                    size="6px"
                    class="q-mt-xs"
                  />
                </td>
                <td class="text-right text-weight-bold">{{ attr.missing }}</td>
                <td class="text-right text-grey-7">{{ attr.total }}</td>
              </tr>
            </tbody>
          </q-markup-table>
        </q-card-section>
      </q-card>
    </div>

    <!-- Main Content Grid -->
    <div class="content-grid q-pa-md">
      <!-- Collection Breakdown -->
      <q-card flat bordered class="content-card">
        <q-card-section class="content-card-header">
          <div class="text-h6 text-primary q-mb-md">Collection Breakdown</div>
        </q-card-section>
        <q-card-section class="content-card-body">
          <div v-if="collectionBreakdown.length > 0">
            <div v-for="collection in collectionBreakdown" :key="collection.name" class="collection-item q-mb-md">
              <div class="row items-center justify-between q-mb-xs">
                <div class="text-subtitle2 text-weight-medium">{{ collection.name }}</div>
                <div class="text-caption text-grey-7">{{ collection.itemCount }} items</div>
              </div>
              <q-linear-progress
                :value="collection.percentage / 100"
                color="primary"
                size="12px"
                rounded
                class="q-mb-xs"
              />
              <div class="row items-center justify-between">
                <div class="text-caption text-grey-6">{{ collection.containerCount }} containers</div>
                <div class="text-caption text-grey-6">${{ collection.totalValue.toLocaleString() }}</div>
              </div>
            </div>
          </div>
          <div v-else class="text-center text-grey-5 q-py-md">
            <q-icon name="folder_off" size="lg" />
            <div class="q-mt-sm">No collections yet</div>
          </div>
        </q-card-section>
      </q-card>

      <!-- Container Utilization -->
      <q-card flat bordered class="content-card">
        <q-card-section class="content-card-header">
          <div class="text-h6 text-primary q-mb-md">Container Utilization</div>
        </q-card-section>
        <q-card-section class="content-card-body">
          <div v-if="containerUtilization.length > 0">
            <div v-for="container in containerUtilization" :key="container.name" class="container-util-item q-mb-md">
              <div class="row items-center justify-between q-mb-xs">
                <div class="row items-center">
                  <q-icon
                    v-if="container.status === 'critical'"
                    name="error"
                    color="negative"
                    size="xs"
                    class="q-mr-xs"
                  />
                  <q-icon
                    v-else-if="container.status === 'warning'"
                    name="warning"
                    color="warning"
                    size="xs"
                    class="q-mr-xs"
                  />
                  <span class="text-subtitle2 text-weight-medium">{{ container.name }}</span>
                </div>
                <div class="text-caption text-grey-7">{{ container.utilizationPct.toFixed(0) }}%</div>
              </div>
              <q-linear-progress
                :value="container.utilizationPct / 100"
                :color="getUtilizationColor(container.utilizationPct)"
                size="12px"
                rounded
                class="q-mb-xs"
              />
              <div class="text-caption text-grey-6">{{ container.itemCount }} items</div>
            </div>
          </div>
          <div v-else class="text-center text-grey-5 q-py-md">
            <q-icon name="inventory" size="lg" />
            <div class="q-mt-sm">No containers with limits</div>
          </div>
        </q-card-section>
      </q-card>

      <!-- Most Valuable Items -->
      <q-card flat bordered class="content-card">
        <q-card-section class="content-card-header">
          <div class="text-h6 text-primary q-mb-md">Most Valuable Items</div>
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
                  <q-item-label class="text-positive text-weight-bold">${{ item.value.toLocaleString() }}</q-item-label>
                </q-item-section>
              </q-item>
            </q-list>
          </div>
          <div v-else class="text-center text-grey-5 q-py-md">
            <q-icon name="attach_money" size="lg" />
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
  background: #F7F8FA;
}

.dashboard-header {
  background: white;
  border-bottom: 1px solid #E0E0E0;
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 16px;
}

.stat-card {
  background: white;
  transition: transform 0.2s ease, box-shadow 0.2s ease;
}

.stat-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
}

.secondary-stats {
  margin-top: -8px;
}

.secondary-stat {
  display: flex;
  align-items: flex-start;
  padding: 8px;
}

.engagement-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
  gap: 16px;
  align-items: stretch;
  grid-auto-rows: 1fr;
}

.engagement-card {
  background: white;
  height: 100%;
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

.packing-card .trend-chart {
  flex: 1;
  margin-top: 8px;
}

.data-quality-card .missing-attr-table {
  flex: 1;
}

.trend-chart {
  display: flex;
  align-items: flex-end;
  gap: 12px;
  min-height: 220px;
  padding-top: 12px;
}

.trend-bar {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-end;
  min-width: 32px;
}

.trend-bar-track {
  width: 100%;
  height: 200px;
  border-radius: 12px;
  background: linear-gradient(180deg, rgba(39,70,144,0.08), rgba(39,70,144,0.02));
  border: 1px solid rgba(39, 70, 144, 0.08);
  padding: 4px;
  display: flex;
  align-items: flex-end;
}

.trend-bar-fill {
  width: 100%;
  border-radius: 8px;
  background: #e0e0e0;
  position: relative;
  transition: height 0.2s ease;
}

.trend-bar--active .trend-bar-fill {
  background: linear-gradient(180deg, #1CA1C1, #274690);
}

.trend-bar-count {
  position: absolute;
  top: -22px;
  left: 0;
  right: 0;
  text-align: center;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-primary, #274690);
}

.trend-bar-label {
  margin-top: 8px;
  font-size: 12px;
  color: #666;
}

.missing-attr-table th,
.missing-attr-table td {
  padding-top: 8px;
  padding-bottom: 8px;
}

.content-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16px;
  margin-top: -8px;
}

.content-card {
  background: white;
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
  gap: 4px;
  margin-top: 4px;
}

.issue-chip {
  font-size: 0.7rem;
}

.collection-item {
  padding: 8px;
  background: #F7F8FA;
  border-radius: 8px;
}

.container-util-item {
  padding: 8px;
  background: #F7F8FA;
  border-radius: 8px;
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
