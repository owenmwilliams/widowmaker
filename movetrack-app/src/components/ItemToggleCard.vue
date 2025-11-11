<script setup lang="ts">
import { ref, defineProps } from 'vue';

const props = defineProps({
        id: { 
            type: Number,
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
            type: Number,
            default: null
        },
        dimensions: {
            type: String,
            default: null
        }
    })

const emits = defineEmits<{
  (e: 'edit', id: number): void;
}>();

const isExpanded = ref(false);

const toggleCard = () => {
  isExpanded.value = !isExpanded.value;
};

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
        <q-card
            v-if="!isExpanded"
            bordered
            class="item-card q-ma-sm"
            @click="toggleCard"
        >
            <div class="item-thumb">
                <q-img
                    v-if="props.picture_url"
                    :src="props.picture_url"
                    fit="cover"
                    ratio="1"
                    class="item-thumb__img"
                />
                <div v-else class="item-thumb--placeholder">
                    <q-icon name="inventory_2" size="24px" color="grey-5" />
                    <span>{{ truncateText(props.label, 10) }}</span>
                </div>
            </div>
            <div class="item-info">
                <div class="item-title text-primary">{{ props.label }}</div>
                <div class="item-description text-grey-7" v-if="props.description">
                    {{ truncateText(props.description, 48) }}
                </div>
                <div class="item-badges row q-gutter-xs q-mt-xs">
                    <q-badge v-if="props.fragile" color="red" text-color="white" class="q-px-sm">
                        <q-icon name="warning" size="xs" class="q-mr-xs" />
                        Fragile
                    </q-badge>
                    <q-badge v-if="props.priority" :color="getPriorityColor(props.priority)" text-color="white" class="q-px-sm">
                        {{ props.priority }}
                    </q-badge>
                    <q-badge v-if="props.weight_lbs" color="grey-7" text-color="white" class="q-px-sm">
                        {{ props.weight_lbs }} lbs
                    </q-badge>
                </div>
            </div>
        </q-card>

        <q-card 
            v-else
            flat 
            class="q-ma-md">
            <q-card-section class="row justify-end vertical-middle q-pa-none">
                <q-btn
                    @click="toggleCard"
                    class="q-pa-none q-ma-sm absolute-top-left"
                    size="xs"
                    flat
                    icon="close_fullscreen"
                />
                <q-card-section class="col-11 q-pa-none q-pl-sm q-ma-sm">
                    <div class="text-body1 vertical-middle text-primary">{{ props.label }}</div>
                </q-card-section>
            </q-card-section>


            <q-card-section class="q-pa-none" v-if="props.picture_url">
                <q-img
                    :src="props.picture_url"
                    spinner-color="white"
                    fit="cover"
                    ratio="16/9"
                    class="expanded-image"
                />
            </q-card-section>  
            <q-card-section v-if="props.picture_url" class="q-space-between">
                <div class="text-body1 text-weight-medium text-primary">{{ props.label }}</div>
                <div class="row q-gutter-xs q-mt-sm">
                    <q-badge v-if="props.fragile" color="red" text-color="white" class="q-px-sm">
                        <q-icon name="warning" size="xs" class="q-mr-xs" />
                        Fragile
                    </q-badge>
                    <q-badge v-if="props.priority" :color="getPriorityColor(props.priority)" text-color="white" class="q-px-sm">
                        {{ props.priority }}
                    </q-badge>
                    <q-badge v-if="props.weight_lbs" color="grey-7" text-color="white" class="q-px-sm">
                        <q-icon name="scale" size="xs" class="q-mr-xs" />
                        {{ props.weight_lbs }} lbs
                    </q-badge>
                    <q-badge v-if="props.dimensions" color="grey-6" text-color="white" class="q-px-sm">
                        <q-icon name="straighten" size="xs" class="q-mr-xs" />
                        {{ props.dimensions }}
                    </q-badge>
                </div>
            </q-card-section>
            <q-card-section v-if="props.description.length > 0" class="text-weight-light">
                {{props.description}}
            </q-card-section>
            <q-card-actions align="right">
            <q-btn unelevated color="primary" right dense label="View Details" @click="emits('edit', props.id)" />
            </q-card-actions>
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

.item-thumb--placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  gap: 4px;
  color: var(--text-secondary);
  text-align: center;
  padding: 0 6px;
  font-size: 0.75rem;
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

  
