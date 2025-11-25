<script setup lang="ts">
import { defineProps, ref } from 'vue';

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
  (e: 'edit', id: number | string): void;
  (e: 'quickPhoto', id: number | string): void;
}>();

const isImgLoading = ref(true);

const getPriorityColor = (priority: string | null) => {
  if (!priority) return 'grey';
  const p = priority.toLowerCase();
  if (p === 'high') return 'red-7';
  if (p === 'medium') return 'orange-7';
  if (p === 'low') return 'green-7';
  return 'grey-7';
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
              <q-icon name="drag_indicator" size="20px" />
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
                        @click.stop="emits('quickPhoto', props.id)"
                      >
                        <q-tooltip>Add photo</q-tooltip>
                    </q-btn>
                </div>
            </div>
            <div class="item-info">
                <div class="item-title text-primary">{{ props.label }}</div>
                <div class="item-description text-grey-7" v-if="props.description">
                    {{ truncateText(props.description, 48) }}
                </div>
                <div class="item-badges row q-gutter-xs q-mt-xs">
                    <q-badge v-if="props.fragile" color="red-6" text-color="white" class="q-px-sm pill-badge">
                        <q-icon name="warning" size="xs" class="q-mr-xs" />
                        Fragile
                    </q-badge>
                    <q-badge v-if="props.priority" :color="getPriorityColor(props.priority)" text-color="white" class="q-px-sm pill-badge">
                        {{ props.priority }}
                    </q-badge>
                    <q-badge v-if="props.weight_lbs" color="grey-6" text-color="white" class="q-px-sm pill-badge">
                        <q-icon name="scale" size="xs" class="q-mr-xs" />
                        {{ props.weight_lbs }} lbs
                    </q-badge>
                </div>
            </div>
            <div class="item-actions">
              <q-btn dense flat round icon="chevron_right" aria-label="View details" @click.stop="emits('edit', props.id)" />
            </div>
        </q-card>
  </div>
 </template>
 
<style scoped>
.item-card {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 110px;
  padding: 12px;
  cursor: default;
  border-radius: 14px;
  background: linear-gradient(135deg, #ffffff 0%, #f7f9ff 100%);
  box-shadow: 0 12px 30px rgba(31, 42, 68, 0.08);
  transition: transform 120ms ease, box-shadow 120ms ease;
  touch-action: pan-y;
}

.item-card:active {
  transform: scale(0.99);
  box-shadow: 0 6px 18px rgba(31, 42, 68, 0.12);
}

.drag-handle {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 72px;
  border-radius: 16px;
  margin-right: 4px;
  color: #9ba8c7;
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
  border-radius: 12px;
  overflow: hidden;
  background: var(--bg-secondary);
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
  box-shadow: 0 4px 10px rgba(0, 0, 0, 0.15);
}

.item-actions {
  margin-left: auto;
}

.pill-badge {
  border-radius: 999px;
  font-weight: 600;
}

.item-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.item-title {
  font-weight: 600;
}

.item-description {
  font-size: 0.85rem;
  line-height: 1.2;
}

.item-badges q-badge {
  font-size: 0.65rem;
}

.expanded-image {
  border-radius: 12px 12px 0 0;
}
</style>

  
