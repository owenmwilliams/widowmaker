<script setup lang="ts">
    import { Ref, computed, ref, watch } from 'vue';
    import { inventoryStore } from '../../stores/InventoryStore';
    import { onMounted } from 'vue';

    const emits = defineEmits<{
        (e: 'item:saved', id: boolean): void
        (e: 'submitted'): void
    }>()

    const props = defineProps({
        user: {type: String, required: true},
        // id: {type: Number, required: true},
        idList: {type: Array, required: true}
    })

    const store = inventoryStore();

    // These are constants that populate the drop-down select menu to allow choosing a location and room
    const location: Ref<{label: string, value: number} | undefined> = ref();
    // const locationOptions: Ref<{label: string, value: number}[]> = ref([]);

    const locationOptions = computed(() => {
    if (store.activeContainer == undefined) {
      return store.locations.map(i => {return {label: i.label, value: i.value}})
    } else if (store.containers.find(i => i.value == store.activeContainer?.value)?.location == undefined) {
      console.log('location is undefined and this container doesnt have a location')
      return store.locations.map(i => {return {label: i.label, value: i.value}})
    } else {
      return store.locations.filter(i => i.value == store.containers.find(i => i.value == store.activeContainer?.value)?.location).map(i => {return {label: i.label, value: i.value}})
    }
  })

    onMounted(() => {        
        location.value = { 
            label: store.locations.find(i => i.value == store.items.find(i => i.value == props.idList[0])?.location)?.label, 
            value: store.items.find(i => i.value == props.idList[0])?.location
        }
    })

    const submit = () => {
        try {
            if (store.activeCollection!.value == undefined) {
                throw new Error('Collection is undefined')
            } else {
                props.idList.forEach((i: any) => {
                    store.updateItem(
                        i,
                        props.user, 
                        store.items.filter(i => i.value == props.idList[0])[0]?.label,
                        store.items.filter(i => i.value == props.idList[0])[0]?.description,
                        store.items.filter(i => i.value == props.idList[0])[0]?.quantity,
                        store.activeCollection!.value,
                        store.activeContainer?.value,
                        location.value?.value
                    )
                })
                emits('submitted')
            }
        } catch (e) {
            console.log(e)
            return
        }

    }

    watch(() => store.activeCollection, (newCollection, oldCollection) => {
        store.activeContainer = undefined
    });

    watch(() => store.activeContainer, (newContainer, oldContainer) => {
        if (newContainer != undefined && store.containers.find(i => i.value == newContainer?.value)?.location != undefined) {
        location.value = { 
            label: store.locations.find(i => i.value == store.containers.find(i => i.value == newContainer?.value)?.location)?.label, 
            value: store.containers.find(i => i.value == newContainer?.value)?.location
        }
        } else {
        location.value = undefined
        }
    });

    const consoleLog = () => {
        // console.log(container.value)
        console.log(props.idList[0])
    }

</script>

<template>
    <q-card style="min-width: 450px; max-width: 600px;">
        <q-card-section class="bg-primary text-white">
            <div class="text-h6 row items-center">
                <q-icon name="swap_horiz" size="sm" class="q-mr-sm" />
                Move Items
            </div>
            <div class="text-caption">Organize your inventory by moving items to a different location</div>
        </q-card-section>

        <q-card-section>
            <div class="text-subtitle2 text-grey-8 q-mb-sm">
                Moving {{ props.idList.length }} item{{ props.idList.length > 1 ? 's' : '' }}:
            </div>
            <q-list dense bordered class="rounded-borders q-mb-md" style="max-height: 150px; overflow-y: auto;">
                <q-item v-for="(item, index) in props.idList.slice(0,6)" :key="index" dense>
                    <q-item-section avatar>
                        <q-icon name="inventory_2" size="xs" color="grey-6" />
                    </q-item-section>
                    <q-item-section v-if="index <= 4">
                        <q-item-label>{{ store.items.find(i => i.value == item)?.label }}</q-item-label>
                    </q-item-section>
                    <q-item-section v-else-if="index == 5">
                        <q-item-label class="text-grey-7">+ {{ props.idList.length - 5 }} more items</q-item-label>
                    </q-item-section>
                </q-item>
            </q-list>

            <div class="text-subtitle2 text-grey-8 q-mb-xs q-mt-md">
                <q-icon name="info" size="xs" color="info" class="q-mr-xs" />
                How it works:
            </div>
            <div class="text-caption text-grey-7 q-mb-md q-pl-md">
                1. Choose a <strong>Collection</strong> (e.g., "Living Room", "Bedroom")<br/>
                2. Optionally select a <strong>Container</strong> (e.g., "Box #1")<br/>
                3. Set a <strong>Location</strong> if needed (e.g., "Home", "Storage Unit")
            </div>

            <q-separator class="q-mb-md" />

            <q-select
                v-model="store.activeCollection"
                :options="store.collections.map(i => {return {label: i.label, value: i.value}})"
                filled
                label="1. Collection (Required)"
                hint="Which room or area do these items belong to?"
                color="primary"
            >
                <template v-slot:prepend>
                    <q-icon name="folder" />
                </template>
            </q-select>

            <q-select
                v-if="store.containers.filter(i => i.collection == store.activeCollection?.value).length > 0"
                v-model="store.activeContainer"
                :options="store.containers.filter(i => i.collection == store.activeCollection?.value).map(i => {return {label: i.label, value: i.value}})"
                filled
                label="2. Container (Optional)"
                hint="Which box or container are these items in?"
                clearable
                color="secondary"
                class="q-mt-md"
            >
                <template v-slot:prepend>
                    <q-icon name="archive" />
                </template>
            </q-select>

            <div v-else class="text-caption text-grey-6 q-mt-md q-mb-md q-pa-sm bg-grey-2 rounded-borders">
                <q-icon name="info" size="xs" /> No containers in this collection yet. Items will be unassigned.
            </div>

            <q-select
                v-if="locationOptions.length > 0"
                v-model="location"
                :options="locationOptions"
                :disable="(store.activeContainer != undefined && store.containers.find(i => i.value == store.activeContainer?.value)?.location != undefined)"
                filled
                label="3. Location (Optional)"
                :hint="store.activeContainer != undefined && store.containers.find(i => i.value == store.activeContainer?.value)?.location != undefined ? 'Automatically set from container' : 'Where are these items physically located?'"
                clearable
                color="accent"
                class="q-mt-md"
            >
                <template v-slot:prepend>
                    <q-icon name="place" />
                </template>
            </q-select>

        </q-card-section>

        <q-card-actions align="right" class="q-pa-md">
            <q-btn flat label="Cancel" color="grey-7" v-close-popup />
            <q-btn unelevated label="Move Items" color="primary" icon-right="arrow_forward" @click="submit" v-close-popup />
        </q-card-actions>
    </q-card>
</template>