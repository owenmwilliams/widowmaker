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
        }
    })

const emits = defineEmits<{
  (e: 'edit', id: number): void;
  (e: 'tokenize'): void;
}>();

const isExpanded = ref(false);

const toggleCard = () => {
  isExpanded.value = !isExpanded.value;
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
                <div  @click="toggleCard" class="text-body1 text-primary col-8 q-pl-md q-py-md">{{ props.label }}</div>
                <div v-if="props.picture_url.includes('take-stock')" class="col-2 flex flex-center">
                    <q-btn @click="() => emits('tokenize')" flat dense>
                        <q-avatar >
                            <q-img class="q-ma-sm" src="https://storage.googleapis.com/take-stock-design-assets/icons/lock_icon.png" />
                        </q-avatar>
                    </q-btn>
                </div>
            </q-card-section>

            <q-card-section v-else horizontal>
                <div  @click="toggleCard" class="text-body1 text-primary col-10 q-pl-sm q-py-sm">{{ props.label }}</div>
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
                <q-card-section v-if="!props.picture_url.includes('take-stock')" class="col-11 q-pa-none q-pl-sm q-ma-sm">
                    <div class="text-body1 vertical-middle text-primary">{{ props.label }}</div>
                </q-card-section>
                
                <div v-else class="q-ma-sm">
                    <q-btn @click="() => emits('tokenize')" flat dense>
                        <q-avatar >
                            <q-img class="q-ma-sm" src="https://storage.googleapis.com/take-stock-design-assets/icons/lock_icon.png" />
                        </q-avatar>
                    </q-btn>
                </div>
            </q-card-section>


            <q-card-section class="q-pa-none" v-if="props.picture_url">
                <q-img
                    :src="props.picture_url"
                    spinner-color="white"
                />
            </q-card-section>  
            <q-card-section v-if="props.picture_url" class="q-space-between">
                <div class="text-body1 text-weight-medium text-primary">{{ props.label }}</div>
            </q-card-section>
            <q-card-section v-if="props.description.length > 0" class="text-weight-light">
                {{props.description}}
            </q-card-section>
            <q-card-actions align="right">
            <q-btn filled color="secondary" right dense label="Edit" @click="emits('edit', props.id)" />
            </q-card-actions>
        </q-card>
    </div>
  </template>
  

  