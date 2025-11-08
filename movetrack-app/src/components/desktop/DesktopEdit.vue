<script setup lang="ts">
    import { Ref, computed, ref } from 'vue';
    import { inventoryStore } from '../../stores/InventoryStore';
import { onMounted } from 'vue';

    const props = defineProps({
        user: {type: String, required: true},
        addType: {type: String, required: true},
        id: {type: Number, required: true}
    })

    const store = inventoryStore();
    const name = ref('');
    const description = ref('');
    const quantity = ref(1);
    // const collection: Ref<number | undefined> = ref();
    // const location: Ref<number | undefined> = ref();
    // const container: Ref<number | undefined> = ref();

        
    const address = ref('');
    const address_2 = ref('');
    const city = ref('');
    const state = ref('');
    const zip = ref('');

    const location: Ref<{label: string, value: number} | undefined> = ref();
    const locationOptions = computed(() => {
        if (store.activeContainer == undefined || props.addType == 'Item') {
        return store.locations.map(i => {return {label: i.label, value: i.value}})
        } else if (store.containers.find(i => i.value == store.activeContainer?.value)?.location == undefined) {
        console.log('location is undefined and this container doesnt have a location')
        return store.locations.map(i => {return {label: i.label, value: i.value}})
        } else {
        return store.locations.filter(i => i.value == store.containers.find(i => i.value == store.activeContainer?.value)?.location).map(i => {return {label: i.label, value: i.value}})
        }
    })

    onMounted(() => {
        if (props.addType == 'Location') {
            name.value = store.locations.filter(i => i.value == props.id)[0]?.label
            description.value = store.locations.filter(i => i.value == props.id)[0]?.description
            address.value = store.locations.filter(i => i.value == props.id)[0]?.address
            address_2.value = store.locations.filter(i => i.value == props.id)[0]?.address_2
            city.value = store.locations.filter(i => i.value == props.id)[0]?.city
            state.value = store.locations.filter(i => i.value == props.id)[0]?.state
            zip.value = store.locations.filter(i => i.value == props.id)[0]?.zip
        } else if (props.addType == 'Container') {
            name.value = store.containers.filter(i => i.value == props.id)[0]?.label
            store.activeCollection = { value: store.containers.filter(i => i.value == props.id)[0]?.collection, label: store.collections.filter(i => i.value == store.containers.filter(i => i.value == props.id)[0]?.collection)[0]?.label }
            location.value = { value: store.containers.filter(i => i.value == props.id)[0]?.location, label: store.locations.filter(i => i.value == store.containers.filter(i => i.value == props.id)[0]?.location)[0]?.label }
        } else if (props.addType == 'Collection') {
            name.value = store.collections.filter(i => i.value == props.id)[0]?.label
            description.value = store.collections.filter(i => i.value == props.id)[0]?.description
        }
    })


    
    const submit = () => {
        if (props.addType == 'Collection') {
            store.updateCollection(
                props.id,
                props.user, 
                name.value, 
                description.value
            )
        } else if (props.addType == 'Container') {
            store.updateContainer(
                props.id,
                props.user, 
                name.value, 
                store.activeCollection!.value,
                location.value?.value
            )
        } else if (props.addType == 'Location') {
            store.updateLocation(
                props.id,
                props.user, 
                name.value, 
                description.value, 
                address.value, 
                address_2.value, 
                city.value, 
                state.value, 
                zip.value
            )
        }
    }

</script>

<template>
    <q-card style="min-width: 350px">
        <q-card-section>
            <div v-if="(props.addType == 'Container')" class="text-h6">Edit container</div>
            <div v-if="(props.addType == 'Room')" class="text-h6">Edit collection</div>
            <div v-if="(props.addType == 'Location')" class="text-h6">Edit location</div>
        </q-card-section>

        <q-card-section class="q-pt-none">
            <!-- REQUIRED FOR ALL -->
            <q-input color="teal" v-model="name" label="Name" :rules="[(val: any) => !!val || 'Field is required']" />
            
            <!-- REQUIRED FOR ITEM -->
            <q-input v-if="(props.addType == 'Item')" color="teal" v-model.number="quantity" type="number" label="Quantity" :rules="[(val: number) => val > 0 || 'Quantity has to be 1 or greater']"/>
            
            <!-- OPTIONAL FOR ITEM / COLLECTION -->
            <q-input v-if="(props.addType == 'Item') || (props.addType == 'Collection')" v-model="description" label="Description" color="teal" autogrow />

            <!-- REQUIRED FOR ITEM, CONTAINER -->
            <q-select
                v-if="props.addType == 'Item' || props.addType == 'Container'"
                v-model="store.activeCollection"
                :options="store.collections.map(i => {return {label: i.label, value: i.value}})"
                filled
                behavior="dialog"
                :rules="[(val: any) => !!val || 'Field is required']"
            />

            <!-- OPTIONAL FOR ITEM -->
            <q-select
                v-if="props.addType == 'Item' && store.containers.filter(i => i.collection_id == store.activeCollection).length > 0"
                v-model="store.activeContainer"
                :options="store.containers.filter(i => i.collection_id == store.activeCollection).map(i => {return {label: i.label, value: i.value}})"
                filled
                behavior="dialog"
            />

            <!-- OPTIONAL FOR ITEM, CONTAINER -->
            <q-select
                v-if="(props.addType == 'Item') || (props.addType == 'Container')"
                v-model="location"
                :options="locationOptions"
                label="Location"
                filled
            />
            
            <q-input v-if="(props.addType == 'Location')"  color="teal" v-model="address" label="Address" />
            <q-input v-if="(props.addType == 'Location')"  color="teal" v-model="address_2" label="Unit / Apt Number" />
            <q-input v-if="(props.addType == 'Location')"  color="teal" v-model="city" label="City" />
            <q-input v-if="(props.addType == 'Location')"  color="teal" v-model="state" label="State" />
            <q-input v-if="(props.addType == 'Location')"  color="teal" v-model="zip" label="Zip Code" />
        </q-card-section>

        <q-card-actions align="right" class="text-primary">
        <q-btn flat color="info" label="Cancel" v-close-popup />
        <q-btn flat color="primary" label="Save" @click="submit" v-close-popup />
        <!-- <q-btn color="secondary" label="Console Log" @click="consoleLog" /> -->
        </q-card-actions>
    </q-card>
</template>

<style scoped>

</style>