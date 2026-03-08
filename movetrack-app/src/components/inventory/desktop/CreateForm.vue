<script setup lang="ts">
    import { Ref, computed, onMounted, ref, watch } from 'vue';
    import { inventoryStore } from '../../../stores/InventoryStore'

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
    const itemLength = ref<number | null>(null);
    const itemWidth = ref<number | null>(null);
    const itemHeight = ref<number | null>(null);
    const notes = ref('');

    // New MoveTrack fields for Containers
    const boxNumber = ref('');
    const boxType = ref('medium');
    const sealed = ref(false);
    const fragileContents = ref(false);
    const colorCode = ref('');
    const boxSize = ref('medium');
    const maxWeightCapacity = ref<number | null>(null);
    const maxVolumeCapacity = ref<number | null>(null);
    const boxLength = ref<number | null>(null);
    const boxWidth = ref<number | null>(null);
    const boxHeight = ref<number | null>(null);

    const boxSizeOptions = [
        { label: 'Small (16" x 12" x 12")', value: 'small', weight: 30, dimensions: { length: 16, width: 12, height: 12 } },
        { label: 'Medium (18" x 18" x 16")', value: 'medium', weight: 40, dimensions: { length: 18, width: 18, height: 16 } },
        { label: 'Large (24" x 18" x 18")', value: 'large', weight: 65, dimensions: { length: 24, width: 18, height: 18 } },
        { label: 'Wardrobe (24" x 24" x 40")', value: 'wardrobe', weight: 80, dimensions: { length: 24, width: 24, height: 40 } },
        { label: 'Custom', value: 'custom' }
    ];

    const selectedBoxPreset = computed(() => boxSizeOptions.find(option => option.value === boxSize.value));

    watch(boxSize, (newValue) => {
        if (newValue && newValue !== 'custom') {
            const preset = boxSizeOptions.find(option => option.value === newValue);
            maxWeightCapacity.value = preset?.weight ?? null;
            boxLength.value = preset?.dimensions?.length ?? null;
            boxWidth.value = preset?.dimensions?.width ?? null;
            boxHeight.value = preset?.dimensions?.height ?? null;
        }
    }, { immediate: true });

    const updateVolumeFromDimensions = () => {
        if (boxLength.value && boxWidth.value && boxHeight.value) {
            const volume = (boxLength.value * boxWidth.value * boxHeight.value) / 1728;
            maxVolumeCapacity.value = Number(volume.toFixed(2));
        } else if (boxSize.value === 'custom') {
            maxVolumeCapacity.value = null;
        }
    };

    watch([boxLength, boxWidth, boxHeight], updateVolumeFromDimensions);

    watch(selectedBoxPreset, (preset) => {
        if (preset && preset.value !== 'custom') {
            updateVolumeFromDimensions();
        }
    });

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
    // Note: locationOptions no longer needed for items/containers as they inherit from collection

    const fileToBlob = (file: File): Promise<Blob> => {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => {
                const result = reader.result;
                if (result instanceof ArrayBuffer) {
                    resolve(new Blob([result]));
                } else if (typeof result === 'string') {
                    resolve(new Blob([result]));
                } else {
                    resolve(new Blob());
                }
            };
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
            let blob: Blob | undefined;
            if (file.value) {
                blob = await fileToBlob(file.value);
            }

            // Note: location is now inherited from collection
            store.createItem(
                props.user,
                name.value,
                description.value,
                quantity.value,
                store.activeCollection!.value,
                store.activeContainer?.value,
                blob,
                // New MoveTrack fields
                estimatedValue.value,
                fragile.value,
                priority.value,
                weightLbs.value,
                itemLength.value,
                itemWidth.value,
                itemHeight.value,
                notes.value || undefined
            )
        } else if (props.addType == 'Container') {
            // Note: location is now inherited from collection
            store.createContainer(
                props.user,
                name.value,
                store.activeCollection!.value,
                // New MoveTrack fields
                boxNumber.value,
                boxType.value,
                sealed.value,
                weightLbs.value,
                fragileContents.value,
                colorCode.value,
                boxSize.value,
                maxWeightCapacity.value,
                maxVolumeCapacity.value,
                description.value,
                boxLength.value,
                boxWidth.value,
                boxHeight.value
            )
        } else if (props.addType == 'Collection') {
            // Collections now require a location
            if (!location.value?.value) {
                alert('Please select a location for this collection');
                return;
            }
            store.createCollection(
                props.user,
                name.value,
                description.value,
                location.value.value
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
                zip.value,
                false,
                null,
                null,
                'USA'
            )
        }
    }

    watch(() => store.activeCollection, (newCollection, oldCollection) => {
        store.activeContainer = undefined
    });

    const file = ref<File | null>(null);
    const updateFiles = async() => {
        console.log('file is: ', file.value)
    }

</script>

<template>

    <q-card class="modal-card">
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
                dense
                style="max-width: 300px"
            />
            
        </q-card-section>

        <q-card-section class="q-pt-none">
            <!-- REQUIRED FOR ALL -->
            <q-input dense color="teal" v-model="name" label="Name" :rules="[(val: any) => val != '' || 'Field is required']" />
            
            <!-- REQUIRED FOR ITEM -->
            <q-input dense v-if="(props.addType == 'Item')"  color="teal" v-model.number="quantity" type="number" label="Quantity" :rules="[(val: number) => val > 0 || 'Quantity has to be 1 or greater']"/>

            <!-- REQUIRED FOR ITEM & COLLECTION -->
            <q-input dense v-if="(props.addType == 'Item') || (props.addType == 'Collection')"  v-model="description" label="Description" color="teal" autogrow />

            <!-- NEW MOVETRACK FIELDS FOR ITEMS -->
            <template v-if="props.addType == 'Item'">
                <q-input dense v-model.number="estimatedValue" type="number" label="Estimated Value ($)" color="teal" prefix="$" step="0.01" />
                <q-checkbox dense v-model="fragile" label="Fragile Item" color="orange" />
                <q-select dense v-model="priority" :options="priorityOptions" label="Priority" filled color="teal" />
                <q-input dense v-model.number="weightLbs" type="number" label="Weight (lbs)" color="teal" suffix="lbs" step="0.1" />
                <div class="row q-col-gutter-sm">
                    <div class="col-4">
                        <q-input
                            dense
                            v-model.number="itemLength"
                            type="number"
                            label="Length (in)"
                            color="teal"
                            step="0.5"
                            hint="Rough measurement"
                        />
                    </div>
                    <div class="col-4">
                        <q-input
                            dense
                            v-model.number="itemWidth"
                            type="number"
                            label="Width (in)"
                            color="teal"
                            step="0.5"
                        />
                    </div>
                    <div class="col-4">
                        <q-input
                            dense
                            v-model.number="itemHeight"
                            type="number"
                            label="Height (in)"
                            color="teal"
                            step="0.5"
                        />
                    </div>
                </div>
                <q-input dense v-model="notes" label="Notes" color="teal" autogrow type="textarea" />
            </template>

            <!-- NEW MOVETRACK FIELDS FOR CONTAINERS -->
            <template v-if="props.addType == 'Container'">
                <q-input dense v-model="boxNumber" label="Box Number" color="teal" hint="e.g., BOX-001, Kitchen-3" />
                <q-select dense v-model="boxType" :options="boxTypeOptions" label="Box Type" filled color="teal" />
                <q-select
                    dense
                    v-model="boxSize"
                    :options="boxSizeOptions"
                    label="Standard Size"
                    filled
                    color="teal"
                    emit-value
                    map-options
                />
                <q-input dense v-model="colorCode" label="Color Code" color="teal" hint="For room identification" />
                <q-checkbox dense v-model="fragileContents" label="Contains Fragile Items" color="orange" />
                <q-checkbox dense v-model="sealed" label="Box is Sealed" color="green" />
                <q-input dense v-model.number="weightLbs" type="number" label="Weight (lbs)" color="teal" suffix="lbs" step="0.1" />
                <q-input
                    dense
                    v-model.number="maxWeightCapacity"
                    type="number"
                    label="Max Weight Capacity (lbs)"
                    color="teal"
                    suffix="lbs"
                    step="0.5"
                    :hint="boxSize !== 'custom' ? `Preset from ${selectedBoxPreset?.label || ''}` : 'Define your own limit'"
                />
                <div class="row q-col-gutter-md">
                    <div class="col-4">
                        <q-input
                            dense
                            v-model.number="boxLength"
                            type="number"
                            label="Length (in)"
                            color="teal"
                            step="0.5"
                        />
                    </div>
                    <div class="col-4">
                        <q-input
                            dense
                            v-model.number="boxWidth"
                            type="number"
                            label="Width (in)"
                            color="teal"
                            step="0.5"
                        />
                    </div>
                    <div class="col-4">
                        <q-input
                            dense
                            v-model.number="boxHeight"
                            type="number"
                            label="Height (in)"
                            color="teal"
                            step="0.5"
                        />
                    </div>
                </div>
                <div class="text-caption text-grey-7">
                    Volume: {{ maxVolumeCapacity ? `${maxVolumeCapacity} cu ft` : 'Enter dimensions to calculate volume' }}
                </div>
                <q-input dense v-model="description" label="Container Description" color="teal" autogrow />
            </template>

            <q-select
                v-if="props.addType == 'Item' || props.addType == 'Container'"
                dense
                v-model="store.activeCollection"
                :options="store.collections.map(i => {return {label: i.label, value: i.value}})"
                filled
                behavior="dialog"
                :rules="[(val: any) => !!val || 'Field is required']"
            />

            <q-select
                v-if="props.addType == 'Item' && store.containers.filter(i => i.collection == store.activeCollection?.value).length > 0"
                dense
                v-model="store.activeContainer"
                :options="store.containers.filter(i => i.collection == store.activeCollection?.value).map(i => {return {label: i.label, value: i.value}})"
                filled
                behavior="dialog"
                label="Container"
            />

            <!-- Location selector: Required for Collections, not shown for Items/Containers (they inherit from collection) -->
            <q-select
                v-if="props.addType == 'Collection' && store.locations.length > 0"
                dense
                v-model="location"
                :options="store.locations.map(i => {return {label: i.label, value: i.value}})"
                filled
                label="Location"
                :rules="[(val: any) => !!val || 'Location is required for collections']"
            />
            
            <!-- REQUIRED FOR LOCATION -->
            <q-input dense v-if="(props.addType == 'Location')" v-model="address" label="Address" />
            <q-input dense v-if="(props.addType == 'Location')" v-model="address_2" label="Unit / Apt Number" />
            <q-input dense v-if="(props.addType == 'Location')" v-model="city" label="City" />
            <q-input dense v-if="(props.addType == 'Location')" v-model="state" label="State" />
            <q-input dense v-if="(props.addType == 'Location')" v-model="zip" label="Zip Code" />
        </q-card-section>

        <q-card-actions align="right" class="text-primary">
        <q-btn flat color="info" label="Cancel" v-close-popup />
        <q-btn flat color="primary" label="Add" @click="submit" v-close-popup />
        <!-- <q-btn color="secondary" label="Console Log" @click="consoleLog" /> -->
        </q-card-actions>
    </q-card>
</template>

<style scoped>
.modal-card {
    min-width: 350px;
    width: 90vw;
    max-width: 520px;
    max-height: calc(100vh - 96px);
    overflow-y: auto;
    font-size: 0.92rem;
}

.modal-card :deep(.q-field__label) {
    font-size: 0.85rem;
}
</style>
