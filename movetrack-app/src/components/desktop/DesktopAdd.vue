<script setup lang="ts">
    import { Ref, computed, onMounted, ref, watch } from 'vue';
    import { inventoryStore } from '../../stores/InventoryStore';

    const props = defineProps({
        user: {type: String, required: true},
        addType: {type: String, required: true}
    })

    const emits = defineEmits<{
        (e: 'app:loading', id: boolean): void
        (e: 'close'): void
    }>()

    const store = inventoryStore();

    const name = ref('');
    const description = ref('');
    const quantity = ref(1);
    const address = ref('');
    const address_2 = ref('');
    const city = ref('');
    const state = ref('');
    const zip = ref('');

    // New MoveTrack fields for Items
    const estimatedValue = ref<number | null>(null);
    const fragile = ref(false);
    const priority = ref('normal');
    const weightLbs = ref<number | null>(null);
    const dimensions = ref('');
    const notes = ref('');

    // New MoveTrack fields for Containers
    const boxNumber = ref('');
    const boxType = ref('medium');
    const sealed = ref(false);
    const fragileContents = ref(false);
    const colorCode = ref('');

    // These are constants that populate the drop-down select menu to allow choosing a location and room
    const location: Ref<{label: string, value: number} | undefined> = ref();

    // Priority options
    const priorityOptions = [
        { label: 'Low', value: 'low' },
        { label: 'Normal', value: 'normal' },
        { label: 'High', value: 'high' }
    ];

    // Box type options
    const boxTypeOptions = [
        { label: 'Small', value: 'small' },
        { label: 'Medium', value: 'medium' },
        { label: 'Large', value: 'large' },
        { label: 'Wardrobe', value: 'wardrobe' },
        { label: 'Custom', value: 'custom' }
    ];
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

    const fileToBlob = (file) => {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(new Blob([reader.result as ArrayBuffer]));
            reader.onerror = reject;
            reader.readAsArrayBuffer(file);
        });
    };

    onMounted(() => {
        emits("app:loading", true)

        try {
            store.activeContainer = undefined

        } catch (error) {
        console.log(error)
        }
        emits("app:loading", false)
    })

    const submit = async () => {
        if (props.addType == 'Item') {
            // Convert file to blob to pass to createItem (only if a file was selected)
            let blob = undefined;
            if (file.value) {
                blob = await fileToBlob(file.value);
            }

            store.createItem(
                props.user,
                name.value,
                description.value,
                quantity.value,
                store.activeCollection!.value,
                store.activeContainer?.value,
                location.value?.value,
                blob as Blob,
                // New MoveTrack fields
                estimatedValue.value,
                fragile.value,
                priority.value,
                weightLbs.value,
                dimensions.value,
                notes.value
            )
        } else if (props.addType == 'Container') {
            store.createContainer(
                props.user,
                name.value,
                store.activeCollection!.value,
                location.value?.value,
                // New MoveTrack fields
                boxNumber.value,
                boxType.value,
                sealed.value,
                weightLbs.value,
                fragileContents.value,
                colorCode.value
            )
        } else if (props.addType == 'Collection') {
            store.createCollection(
                props.user,
                name.value,
                description.value
            )
        } else if (props.addType == 'Location') {
            store.createLocation(
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

    const file = ref(null);
    const updateFiles = async() => {
        console.log('file is: ', file.value)
    }

</script>

<template>

    <q-card  style="min-width: 350px">
        <q-card-section>
            <div v-if="(props.addType == 'Item')" class="text-h6 text-primary">Add an item</div>
            <div v-if="(props.addType == 'Container')" class="text-h6 text-primary">Add a container</div>
            <div v-if="(props.addType == 'Collection')" class="text-h6 text-primary">Add a collection</div>
            <div v-if="(props.addType == 'Location')" class="text-h6 text-primary">Add a location</div>
        </q-card-section>

        <q-card-section class="q-pt-none">
            
            <q-file v-if="(props.addType == 'Item')"
                @update:model-value="updateFiles"
                v-model="file"
                label="Pick one file"
                filled
                style="max-width: 300px"
            />
            
        </q-card-section>

        <q-card-section class="q-pt-none">
            <!-- REQUIRED FOR ALL -->
            <q-input  color="teal" v-model="name" label="Name" :rules="[(val: any) => val != '' || 'Field is required']" />
            
            <!-- REQUIRED FOR ITEM -->
            <q-input v-if="(props.addType == 'Item')"  color="teal" v-model.number="quantity" type="number" label="Quantity" :rules="[(val: number) => val > 0 || 'Quantity has to be 1 or greater']"/>

            <!-- REQUIRED FOR ITEM & COLLECTION -->
            <q-input v-if="(props.addType == 'Item') || (props.addType == 'Collection')"  v-model="description" label="Description" color="teal" autogrow />

            <!-- NEW MOVETRACK FIELDS FOR ITEMS -->
            <template v-if="props.addType == 'Item'">
                <q-input v-model.number="estimatedValue" type="number" label="Estimated Value ($)" color="teal" prefix="$" step="0.01" />
                <q-checkbox v-model="fragile" label="Fragile Item" color="orange" />
                <q-select v-model="priority" :options="priorityOptions" label="Priority" filled color="teal" />
                <q-input v-model.number="weightLbs" type="number" label="Weight (lbs)" color="teal" suffix="lbs" step="0.1" />
                <q-input v-model="dimensions" label="Dimensions (L x W x H)" color="teal" hint="e.g., 12x8x6" />
                <q-input v-model="notes" label="Notes" color="teal" autogrow type="textarea" />
            </template>

            <!-- NEW MOVETRACK FIELDS FOR CONTAINERS -->
            <template v-if="props.addType == 'Container'">
                <q-input v-model="boxNumber" label="Box Number" color="teal" hint="e.g., BOX-001, Kitchen-3" />
                <q-select v-model="boxType" :options="boxTypeOptions" label="Box Type" filled color="teal" />
                <q-input v-model="colorCode" label="Color Code" color="teal" hint="For room identification" />
                <q-checkbox v-model="fragileContents" label="Contains Fragile Items" color="orange" />
                <q-checkbox v-model="sealed" label="Box is Sealed" color="green" />
                <q-input v-model.number="weightLbs" type="number" label="Weight (lbs)" color="teal" suffix="lbs" step="0.1" />
            </template>

            <q-select
                v-if="props.addType == 'Item' || props.addType == 'Container'"
                
                v-model="store.activeCollection"
                :options="store.collections.map(i => {return {label: i.label, value: i.value}})"
                filled
                behavior="dialog"
                :rules="[(val: any) => !!val || 'Field is required']"
            />

            <q-select
                v-if="props.addType == 'Item' && store.containers.filter(i => i.collection == store.activeCollection?.value).length > 0"
                
                v-model="store.activeContainer"
                :options="store.containers.filter(i => i.collection == store.activeCollection?.value).map(i => {return {label: i.label, value: i.value}})"
                filled
                behavior="dialog"
                label="Container"
            />

            <q-select
                v-if="(props.addType == 'Item' || props.addType == 'Container') && store.locations.length > 0"
                v-model="location"
                :options="locationOptions"
                :disable="(store.activeContainer != undefined && store.containers.find(i => i.value == store.activeContainer?.value)?.location != undefined)"
                disable-hint="Items in containers will take the location of that container"
                filled
                label="Location"
                clearable
            />
            
            <!-- REQUIRED FOR LOCATION -->
            <q-input v-if="(props.addType == 'Location')" v-model="address" label="Address" />
            <q-input v-if="(props.addType == 'Location')" v-model="address_2" label="Unit / Apt Number" />
            <q-input v-if="(props.addType == 'Location')" v-model="city" label="City" />
            <q-input v-if="(props.addType == 'Location')" v-model="state" label="State" />
            <q-input v-if="(props.addType == 'Location')" v-model="zip" label="Zip Code" />
        </q-card-section>

        <q-card-actions align="right" class="text-primary">
        <q-btn flat color="info" label="Cancel" v-close-popup />
        <q-btn flat color="primary" label="Add" @click="submit" v-close-popup />
        <!-- <q-btn color="secondary" label="Console Log" @click="consoleLog" /> -->
        </q-card-actions>
    </q-card>
</template>

<style scoped>

</style>