<script setup lang="ts">
    import { ref, defineProps, defineEmits, Ref } from 'vue';
    import { onMounted } from 'vue';
    import { inventoryStore } from '../../stores/InventoryStore';

    enum ObjectEnum {
        location = 'location',
        collection = 'collection',
        container = 'container',
        item = 'item'
    }

    const props = defineProps({
        collection_id: Number,
    })
    const emits = defineEmits<{
        (e: 'selected', id: [ObjectEnum, string]): void
        (e: 'close'): void
    }>()

    const store = inventoryStore()

    const handleItemClick = (type: ObjectEnum, id: string) => {
        emits('selected', [type, id]);
    };
</script>

<template>
    <div class="row">
        <q-list class="col-6 q-pa-sm flex">
            <!-- <q-item-label header>Containers</q-item-label> -->
            <h6 class="text-info q-ma-none relative-position">Containers</h6>
            <q-btn
                v-for="(container, index) in store.containers.filter(i => i.collection = store.activeCollection)"
                square
                class="q-ma-sm"
                style="width: 100%;"
                size="sm"
                :content-style="{ backgroundColor: 'black' }"
                :label="container.label"
                @click="handleItemClick(ObjectEnum.container, container.value)"
                />
        </q-list>
        <div class="col-6 q-pa-sm flex">
            <h6 class="text-info q-ma-none">Locations</h6>
            <q-btn
                v-for="(location, index) in store.locations"
                square
                class="q-ma-sm"
                style="width: 100%;"
                size="sm"
                :content-style="{ backgroundColor: 'black' }"
                :label="location.label"
                @click="handleItemClick(ObjectEnum.location, location.value)"
                />
        </div>
    </div>
  </template>
  

  
  <style scoped>
  /* Your custom styles go here */
  </style>
  