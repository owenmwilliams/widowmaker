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
    <q-card style="min-width: 350px">
        <q-card-section class="row items-center">
            <q-avatar icon="warning" color="warning" />
            <span class="q-ml-sm">Moving the following items:</span>
        </q-card-section>
        <q-card-section class="row">
            <q-list dense>
                <q-item v-for="(item, index) in props.idList.slice(0,6)" :key="index">
                    <li v-if="index <= 4">{{ store.items.find(i => i.value == item).label }}</li>
                    <li v-else-if="index == 5">+ {{ props.idList.length - 5 }} more items</li>

                </q-item>
            </q-list>
        </q-card-section>

        <q-card-section class="q-pt-none">

            <q-select
                v-model="store.activeCollection"
                :options="store.collections.map(i => {return {label: i.label, value: i.value}})"
                filled
                label="Collection"
            />

            <q-select
                v-if="store.containers.filter(i => i.collection == store.activeCollection?.value).length > 0"
                v-model="store.activeContainer"
                :options="store.containers.filter(i => i.collection == store.activeCollection?.value).map(i => {return {label: i.label, value: i.value}})"
                filled
                label="Container"
                clearable
            />

            <q-select
                v-if="locationOptions.length > 0"
                v-model="location"
                :options="locationOptions"
                :disable="(store.activeContainer != undefined && store.containers.find(i => i.value == store.activeContainer?.value)?.location != undefined)"
                disable-hint="Items in containers will take the location of that container"
                filled
                label="Location"
                clearable
            />

        </q-card-section>

        <q-card-actions align="right" class="text-primary">
        <q-btn color="info" flat label="Cancel" v-close-popup />
        <q-btn color="primary" flat label="Move" @click="submit" v-close-popup />
        <!-- <q-btn color="secondary" label="Console Log" @click="consoleLog" /> -->
        </q-card-actions>
    </q-card>
</template>