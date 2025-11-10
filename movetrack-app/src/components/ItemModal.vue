<script setup lang="ts">
import { computed } from 'vue';
import { useQuasar } from 'quasar';
import type { InventoryItem } from '../data/inventoryItems';

const props = defineProps<{
  item: InventoryItem | null;
  modelValue: boolean;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void;
  (e: 'addToInventory', item: InventoryItem): void;
  (e: 'seeAllItems'): void;
}>();

const $q = useQuasar();

const show = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value)
});

const handleAddToInventory = () => {
  if (props.item) {
    emit('addToInventory', props.item);
    $q.notify({
      type: 'positive',
      message: `${props.item.name} added to your inventory!`,
      caption: 'Ready to track'
    });
    show.value = false;
  }
};

const handleSeeAllItems = () => {
  emit('seeAllItems');
  show.value = false;
};
</script>

<template>
  <q-dialog v-model="show" transition-show="scale" transition-hide="scale">
    <q-card v-if="item" class="item-modal-card">
      <q-card-section class="modal-header">
        <div class="text-h5">{{ item.name }}</div>
        <q-btn
          icon="close"
          flat
          round
          dense
          v-close-popup
          aria-label="Close modal"
        />
      </q-card-section>

      <q-card-section class="modal-body">
        <div class="row q-col-gutter-md">
          <div class="col-12 col-md-6">
            <q-img
              :src="item.image"
              :alt="`${item.name}, ${item.material}, ${item.primaryColor}`"
              class="modal-image"
              fit="contain"
            >
              <template v-slot:loading>
                <q-skeleton class="full-width full-height" />
              </template>
            </q-img>
          </div>

          <div class="col-12 col-md-6">
            <div class="item-details">
              <p class="description">{{ item.description }}</p>

              <div class="spec-grid">
                <div class="spec-row">
                  <span class="spec-label">Quantity:</span>
                  <span class="spec-value">{{ item.qty }}</span>
                </div>
                <div class="spec-row">
                  <span class="spec-label">Size:</span>
                  <span class="spec-value">{{ item.size }}</span>
                </div>
                <div class="spec-row">
                  <span class="spec-label">Weight:</span>
                  <span class="spec-value">{{ item.weight }}</span>
                </div>
                <div class="spec-row">
                  <span class="spec-label">Material:</span>
                  <span class="spec-value">{{ item.material }}</span>
                </div>
              </div>

              <div class="tags-section q-mt-md">
                <q-chip
                  v-for="tag in item.tags"
                  :key="tag"
                  :color="getTagColor(tag)"
                  text-color="white"
                  size="sm"
                >
                  {{ tag }}
                </q-chip>
              </div>
            </div>
          </div>
        </div>
      </q-card-section>

      <q-card-actions align="right" class="modal-actions">
        <q-btn
          outline
          color="primary"
          label="See All Items"
          @click="handleSeeAllItems"
          class="action-btn"
        />
        <q-btn
          unelevated
          color="primary"
          label="Add to My Inventory"
          @click="handleAddToInventory"
          class="action-btn"
        />
      </q-card-actions>
    </q-card>
  </q-dialog>
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
.item-modal-card {
  min-width: 320px;
  max-width: 900px;
  width: 90vw;
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px solid rgba(0, 0, 0, 0.12);
}

.modal-body {
  padding: 24px;
}

.modal-image {
  height: 400px;
  border-radius: 8px;
  background-color: #f5f5f5;
}

.item-details {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.description {
  font-size: 1rem;
  line-height: 1.6;
  color: #424242;
  margin-bottom: 24px;
}

.spec-grid {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.spec-row {
  display: flex;
  justify-content: space-between;
  padding: 8px 0;
  border-bottom: 1px solid #e0e0e0;
}

.spec-label {
  font-weight: 600;
  color: #616161;
  font-family: 'Courier New', monospace;
}

.spec-value {
  font-style: italic;
  color: #212121;
  font-family: 'Courier New', monospace;
}

.tags-section {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.modal-actions {
  padding: 16px 24px;
  border-top: 1px solid rgba(0, 0, 0, 0.12);
}

.action-btn {
  min-width: 140px;
}

@media (max-width: 768px) {
  .modal-image {
    height: 250px;
  }

  .item-modal-card {
    width: 95vw;
  }

  .action-btn {
    min-width: 100px;
    font-size: 0.875rem;
  }
}
</style>
