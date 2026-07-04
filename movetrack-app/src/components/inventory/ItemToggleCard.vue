<script setup lang="ts">
import { defineProps, ref, computed } from 'vue';
import { GripVertical, TriangleAlert, Weight } from 'lucide-vue-next';

const props = defineProps({
        id: {
            type: [Number, String],
            required: true
        },
        picture_url: {
            type: String,
            default: ''
        },
        label: String,
        description: {
            type: String,
            default: ''
        },
        fragile: {
            type: Boolean,
            default: false
        },
        priority: {
            type: String,
            default: null
        },
        weight_lbs: {
            type: [Number, String],
            default: null
        },
        dimensions: {
            type: String,
            default: null
        }
    })

const emits = defineEmits<{
  (e: 'edit', id: string): void;
  (e: 'quickPhoto', id: string): void;
}>();

const isImgLoading = ref(true);

// Convert id to string for emits
const stringId = computed(() => String(props.id));

const getPriorityClass = (priority: string | null) => {
  if (!priority) return 'pill--neutral';
  const p = priority.toLowerCase();
  if (p === 'high') return 'pill--danger';
  if (p === 'medium') return 'pill--warning';
  if (p === 'low') return 'pill--success';
  return 'pill--neutral';
};

const truncateText = (text?: string, length = 18) => {
  if (!text) return '';
  return text.length > length ? `${text.slice(0, length)}…` : text;
};
</script>

<template>
    <div>
        <q-card bordered class="item-card q-ma-sm">
            <div class="drag-handle" aria-label="Reorder">
              <GripVertical :size="20" />
            </div>
            <div class="item-thumb">
                <q-skeleton
                  v-if="props.picture_url && isImgLoading"
                  type="rect"
                  class="thumb-skeleton"
                />
                <q-img
                    v-if="props.picture_url"
                    :src="props.picture_url"
                    fit="cover"
                    ratio="1"
                    class="item-thumb__img"
                    :img-style="{ objectFit: 'cover' }"
                    loading="lazy"
                    @load="isImgLoading = false"
                    @error="isImgLoading = false"
                />
                <div v-if="!props.picture_url" class="item-thumb--placeholder">
                    <q-btn
                        round
                        dense
                        size="sm"
                        color="primary"
                        icon="photo_camera"
                        class="add-photo-btn"
                        @click.stop="emits('quickPhoto', stringId)"
                      >
                        <q-tooltip>Add photo</q-tooltip>
                    </q-btn>
                </div>
            </div>
            <div class="item-info">
                <div class="item-title">{{ props.label }}</div>
                <div class="item-description" v-if="props.description">
                    {{ truncateText(props.description, 48) }}
                </div>
                <div class="item-badges row q-gutter-xs q-mt-xs">
                    <span v-if="props.fragile" class="pill pill--danger">
                        <TriangleAlert :size="12" />
                        Fragile
                    </span>
                    <span v-if="props.priority" class="pill" :class="getPriorityClass(props.priority)">
                        {{ props.priority }}
                    </span>
                    <span v-if="props.weight_lbs" class="pill pill--neutral pill--mono">
                        <Weight :size="12" />
                        {{ props.weight_lbs }} lbs
                    </span>
                </div>
            </div>
            <div class="item-actions">
              <q-btn dense flat round icon="chevron_right" aria-label="View details" @click.stop="emits('edit', stringId)" />
            </div>
        </q-card>
  </div>
 </template>
 
<style scoped>
.item-card {
  display: flex;
  align-items: center;
  gap: var(--sp-4);
  min-height: 110px;
  padding: var(--sp-4);
  cursor: default;
  border-radius: var(--r-lg);
  background: var(--surface-card);
  border: 1px solid var(--border);
  box-shadow: var(--shadow-sm);
  transition: transform var(--dur-base) var(--ease-standard), box-shadow var(--dur-base) var(--ease-standard);
  touch-action: pan-y;
}

.item-card:hover {
  transform: translateY(-2px);
  box-shadow: var(--shadow-md);
}

.item-card:active {
  transform: scale(0.97);
  box-shadow: var(--shadow-xs);
}

.drag-handle {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 72px;
  border-radius: var(--r-md);
  margin-right: var(--sp-2);
  color: var(--text-tertiary);
  touch-action: none;
  cursor: grab;
  flex-shrink: 0;
}

.drag-handle :deep(.q-icon) {
  color: inherit;
}

.drag-handle:active {
  cursor: grabbing;
}

.item-thumb {
  width: 80px;
  height: 80px;
  border-radius: var(--r-md);
  overflow: hidden;
  background: var(--surface-sunk);
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.item-thumb__img {
  width: 100%;
  height: 100%;
}

.thumb-skeleton {
  width: 100%;
  height: 100%;
}

.item-thumb--placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-secondary);
  text-align: center;
  position: relative;
}

.add-photo-btn {
  box-shadow: var(--shadow-sm);
}

.item-actions {
  margin-left: auto;
}

.pill {
  display: inline-flex;
  align-items: center;
  gap: var(--sp-2);
  padding: 3px 10px;
  border-radius: var(--r-pill);
  font-size: var(--fs-label);
  font-weight: var(--fw-bold);
}

.pill--danger {
  background: var(--danger-quiet);
  color: var(--danger);
}

.pill--warning {
  background: var(--warning-surface);
  color: var(--warning-ink);
}

.pill--success {
  background: var(--success-quiet);
  color: var(--success);
}

.pill--neutral {
  background: var(--surface-hover);
  color: var(--text-secondary);
}

.pill--mono {
  font-family: var(--font-mono);
}

.item-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
}

.item-title {
  font-weight: var(--fw-semibold);
  color: var(--text-primary);
}

.item-description {
  font-size: var(--fs-label);
  line-height: var(--lh-snug);
  color: var(--text-secondary);
}

.expanded-image {
  border-radius: var(--r-md) var(--r-md) 0 0;
}
</style>

  
