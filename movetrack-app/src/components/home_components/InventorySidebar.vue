<script setup lang="ts">
import { computed, ref } from 'vue';
import type { InventoryItem } from '../../data/inventoryItems';

const props = defineProps<{
  items: InventoryItem[];
  selectedItemId: number | null;
}>();

const emit = defineEmits<{
  (e: 'selectItem', itemId: number): void;
  (e: 'updateItem', itemId: number, updates: Partial<InventoryItem>): void;
}>();

type FilterType = 'All' | 'Fragile' | 'Glass' | 'Metal';
const activeFilter = ref<FilterType>('All');

const itemNotes = ref<Record<number, string>>({});
const fragilityOverrides = ref<Record<number, boolean>>({});

const filteredItems = computed(() => {
  if (activeFilter.value === 'All') {
    return props.items;
  }

  return props.items.filter(item => {
    if (activeFilter.value === 'Fragile') {
      return item.tags.includes('Fragile') || fragilityOverrides.value[item.id];
    }
    return item.tags.includes(activeFilter.value);
  });
});

const totals = computed(() => {
  const totalQty = filteredItems.value.reduce((sum, item) => sum + item.qty, 0);
  const totalWeight = filteredItems.value.reduce((sum, item) => {
    const weight = parseFloat(item.weight.replace(' lbs', ''));
    return sum + (weight * item.qty);
  }, 0);

  return {
    qty: totalQty,
    weight: totalWeight.toFixed(1)
  };
});

const contextMenuTarget = ref<number | null>(null);
const contextMenuPosition = ref({ x: 0, y: 0 });

const handleRowClick = (itemId: number) => {
  emit('selectItem', itemId);
};

const showContextMenu = (event: MouseEvent, itemId: number) => {
  event.preventDefault();
  contextMenuTarget.value = itemId;
  contextMenuPosition.value = { x: event.clientX, y: event.clientY };
};

const closeContextMenu = () => {
  contextMenuTarget.value = null;
};

const markFragile = (itemId: number) => {
  fragilityOverrides.value[itemId] = true;
  closeContextMenu();
};

const addNote = (itemId: number) => {
  const note = prompt('Add a note for this item:');
  if (note) {
    itemNotes.value[itemId] = note;
  }
  closeContextMenu();
};

const resetFilters = () => {
  activeFilter.value = 'All';
};
</script>

<template>
  <div class="inventory-sidebar">
    <!-- Filters -->
    <div class="filters-section">
      <div class="filter-chips">
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

      <!-- Totals Pill -->
      <div class="totals-pill">
        <q-badge color="primary" text-color="white" class="totals-badge">
          <q-icon name="inventory" size="14px" class="q-mr-xs" />
          {{ totals.qty }} items · {{ totals.weight }} lbs
        </q-badge>
      </div>
    </div>

    <!-- Items List -->
    <div class="items-list-container">
      <!-- Empty State -->
      <div v-if="filteredItems.length === 0" class="empty-state">
        <q-icon name="search_off" size="48px" color="grey-5" />
        <p class="empty-text">No items match</p>
        <q-chip clickable @click="resetFilters" color="primary" text-color="white" class="filter-chip">
          Reset Filters
        </q-chip>
      </div>

      <!-- Items -->
      <div v-else class="items-list">
        <div
          v-for="item in filteredItems"
          :key="item.id"
          :class="['item-row', { selected: selectedItemId === item.id }]"
          @click="handleRowClick(item.id)"
          @contextmenu="showContextMenu($event, item.id)"
        >
          <div class="item-thumbnail">
            <q-img
              :src="item.image"
              :alt="item.name"
              fit="contain"
              loading="lazy"
              class="thumbnail-image"
            >
              <template v-slot:loading>
                <q-skeleton class="full-width full-height" />
              </template>
            </q-img>
          </div>

          <div class="item-info">
            <div class="item-name">
              {{ item.name }}
              <q-icon
                v-if="itemNotes[item.id]"
                name="sticky_note_2"
                size="14px"
                color="amber"
                class="note-icon"
              >
                <q-tooltip>{{ itemNotes[item.id] }}</q-tooltip>
              </q-icon>
            </div>
            <div class="item-details">
              <span class="detail-item">Qty: {{ item.qty }}</span>
              <span class="detail-separator">•</span>
              <span class="detail-item">{{ item.weight }}</span>
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

          <!-- Hover Tooltip -->
          <q-tooltip anchor="top middle" self="bottom middle" :offset="[0, 10]">
            <div class="tooltip-content">
              <strong>{{ item.name }}</strong><br>
              Size: {{ item.size }}
            </div>
          </q-tooltip>

          <!-- More Options -->
          <q-btn
            flat
            dense
            round
            icon="more_vert"
            class="more-button"
            @click.stop="showContextMenu($event, item.id)"
          />
        </div>
      </div>
    </div>

    <!-- Context Menu -->
    <q-menu
      v-model="contextMenuTarget"
      :target="contextMenuTarget !== null"
      context-menu
      @hide="closeContextMenu"
    >
      <q-list style="min-width: 180px">
        <q-item clickable v-close-popup @click="handleRowClick(contextMenuTarget!)">
          <q-item-section avatar>
            <q-icon name="visibility" />
          </q-item-section>
          <q-item-section>View details</q-item-section>
        </q-item>
        <q-item clickable v-close-popup @click="markFragile(contextMenuTarget!)">
          <q-item-section avatar>
            <q-icon name="warning" color="orange" />
          </q-item-section>
          <q-item-section>Mark fragile</q-item-section>
        </q-item>
        <q-item clickable v-close-popup @click="addNote(contextMenuTarget!)">
          <q-item-section avatar>
            <q-icon name="note_add" />
          </q-item-section>
          <q-item-section>Add note</q-item-section>
        </q-item>
      </q-list>
    </q-menu>
  </div>
</template>

<script lang="ts">
function getTagColor(tag: string): string {
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
}
</script>

<style scoped>
.inventory-sidebar {
  display: flex;
  flex-direction: column;
  height: 100%;
  background-color: #ffffff;
  border-left: 1px solid #e0e0e0;
}

.filters-section {
  padding: 16px;
  border-bottom: 1px solid #e0e0e0;
  background-color: #f9f9f9;
}

.filter-chips {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 12px;
}

.filter-chip {
  font-size: 0.875rem;
  padding: 4px 12px;
}

.tag-chip {
  font-size: 0.75rem;
  padding: 2px 8px;
}

.totals-pill {
  display: flex;
  justify-content: flex-end;
}

.totals-badge {
  padding: 8px 12px;
  font-size: 0.875rem;
  font-weight: 500;
}

.items-list-container {
  flex: 1;
  overflow-y: auto;
  min-height: 0;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 48px 16px;
  text-align: center;
}

.empty-text {
  font-size: 1rem;
  color: #757575;
  margin: 16px 0;
}

.items-list {
  padding: 8px;
}

.item-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px;
  margin-bottom: 8px;
  border-radius: 8px;
  background-color: #ffffff;
  border: 2px solid transparent;
  cursor: pointer;
  transition: all 0.2s ease;
  position: relative;
}

.item-row:hover {
  background-color: #f5f5f5;
  border-color: #e0e0e0;
}

.item-row.selected {
  background-color: #e3f2fd;
  border-color: #1976d2;
}

.item-thumbnail {
  width: 60px;
  height: 60px;
  flex-shrink: 0;
  border-radius: 6px;
  overflow: hidden;
  background-color: #f5f5f5;
}

.thumbnail-image {
  width: 100%;
  height: 100%;
}

.item-info {
  flex: 1;
  min-width: 0;
}

.item-name {
  font-size: 0.9375rem;
  font-weight: 600;
  color: #212121;
  margin-bottom: 4px;
  display: flex;
  align-items: center;
  gap: 6px;
}

.note-icon {
  flex-shrink: 0;
}

.item-details {
  font-size: 0.8125rem;
  color: #616161;
  margin-bottom: 6px;
  display: flex;
  align-items: center;
  gap: 6px;
}

.detail-separator {
  color: #bdbdbd;
}

.item-tags {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
}

.more-button {
  opacity: 0;
  transition: opacity 0.2s;
}

.item-row:hover .more-button {
  opacity: 1;
}

.tooltip-content {
  padding: 4px 8px;
  font-size: 0.875rem;
  line-height: 1.4;
}

@media (max-width: 768px) {
  .filters-section {
    padding: 12px;
  }

  .item-row {
    padding: 10px;
  }

  .item-thumbnail {
    width: 50px;
    height: 50px;
  }
}
</style>
