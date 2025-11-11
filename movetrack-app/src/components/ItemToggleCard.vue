<script setup lang="ts">
import { ref, defineProps } from 'vue';

const props = defineProps({
        id: { 
            type: Number,
            required: true
        },
        picture_url: {
            type: String,
            default: 'https://cdn.quasar.dev/img/parallax2.jpg'
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
</script>

<template>
    <div>
        <q-card
            v-if="!isExpanded"
            bordered
            class="q-ma-sm">
            <q-card-section class="row" v-if="props.picture_url" horizontal>
                <div @click="toggleCard" class="col-2 overflow-hidden">
                    <q-img
                    v-if="props.picture_url"
                    :src="props.picture_url"
                    fit="cover"
                    class="q-ma-none"
                    spinner-color="white"
                    style="min-height: 100%;">
                    </q-img>
                </div>
                <div @click="toggleCard" class="col-10 q-pl-md q-py-md">
                    <div class="text-body1 text-primary">{{ props.label }}</div>
                    <div class="row q-gutter-xs q-mt-xs">
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
            </q-card-section>

            <q-card-section v-else horizontal>
                <div @click="toggleCard" class="col-12 q-pl-sm q-py-sm">
                    <div class="text-body1 text-primary">{{ props.label }}</div>
                    <div class="row q-gutter-xs q-mt-xs">
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
            </q-card-section>
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
  

  
