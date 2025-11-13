<script setup lang="ts">
    import { Ref, computed, ref, onMounted, watch } from 'vue';
    import { inventoryStore } from '../../stores/InventoryStore';

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
    const boxNumber = ref('');
    const boxType = ref('medium');
    const sealed = ref(false);
    const fragileContents = ref(false);
    const colorCode = ref('');
    const boxSize = ref('medium');
    const weightLbs = ref<number | null>(null);
    const maxWeightCapacity = ref<number | null>(null);
    const maxVolumeCapacity = ref<number | null>(null);
    const boxLength = ref<number | null>(null);
    const boxWidth = ref<number | null>(null);
    const boxHeight = ref<number | null>(null);

    const boxTypeOptions = [
        { label: 'Small', value: 'small' },
        { label: 'Medium', value: 'medium' },
        { label: 'Large', value: 'large' },
        { label: 'Wardrobe', value: 'wardrobe' },
        { label: 'Custom', value: 'custom' }
    ];

    const boxSizeOptions = [
        {
            label: 'Small (16" x 12.5" x 12.5") - Max 30 lbs',
            value: 'small',
            weight: 30,
            dimensions: { length: 16, width: 12.5, height: 12.5 },
            description: 'Heavy items like books, tools, canned goods'
        },
        {
            label: 'Medium (18" x 18" x 16") - Max 40 lbs',
            value: 'medium',
            weight: 40,
            dimensions: { length: 18, width: 18, height: 16 },
            description: 'General items, kitchen items, small appliances'
        },
        {
            label: 'Large (18" x 18" x 24") - Max 50 lbs',
            value: 'large',
            weight: 50,
            dimensions: { length: 18, width: 18, height: 24 },
            description: 'Light/bulky items, linens, pillows, lampshades'
        },
        {
            label: 'Wardrobe (24" x 24" x 40") - Max 80 lbs',
            value: 'wardrobe',
            weight: 80,
            dimensions: { length: 24, width: 24, height: 40 },
            description: 'Hanging clothes, coats'
        },
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

    // Weight validation and density calculation
    const weightStatus = computed(() => {
        if (!weightLbs.value || !maxWeightCapacity.value) return null;

        const percentage = (weightLbs.value / maxWeightCapacity.value) * 100;

        if (percentage > 100) {
            return {
                status: 'over',
                color: 'negative',
                icon: 'error',
                message: `Overweight! ${(weightLbs.value - maxWeightCapacity.value).toFixed(1)} lbs over capacity`
            };
        } else if (percentage > 90) {
            return {
                status: 'near',
                color: 'warning',
                icon: 'warning',
                message: `Near capacity (${percentage.toFixed(0)}% full)`
            };
        } else {
            return {
                status: 'ok',
                color: 'positive',
                icon: 'check_circle',
                message: `${(maxWeightCapacity.value - weightLbs.value).toFixed(1)} lbs remaining`
            };
        }
    });

    // Calculate density and recommend box size for custom containers
    const densityRecommendation = computed(() => {
        if (boxSize.value !== 'custom' || !maxVolumeCapacity.value || !maxWeightCapacity.value) {
            return null;
        }

        const density = maxWeightCapacity.value / maxVolumeCapacity.value;

        // Density thresholds based on standard box specs
        // Small: 20 lbs/cu ft, Medium: 13.33 lbs/cu ft, Large: 11.11 lbs/cu ft

        if (density >= 20) {
            return {
                recommended: 'small',
                message: 'High density - Consider using small boxes instead',
                icon: 'lightbulb'
            };
        } else if (density >= 13.33) {
            return {
                recommended: 'medium',
                message: 'Medium density - Standard medium boxes work well',
                icon: 'info'
            };
        } else {
            return {
                recommended: 'large',
                message: 'Low density - Perfect for large boxes',
                icon: 'check_circle'
            };
        }
    });
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
            const container = store.containers.find(i => i.value == props.id)
            if (container) {
                name.value = container.label
                description.value = container.description || ''
                boxNumber.value = container.box_number || ''
                boxType.value = container.box_type || 'medium'
                boxSize.value = container.box_size || 'custom'
                sealed.value = Boolean(container.sealed)
                fragileContents.value = Boolean(container.fragile_contents)
                colorCode.value = container.color_code || ''
                weightLbs.value = container.weight_lbs ?? null
                maxWeightCapacity.value = container.max_weight_lbs ?? null
                maxVolumeCapacity.value = container.max_volume_cuft ?? null
                const preset = boxSizeOptions.find(option => option.value === container.box_size)
                if (preset && preset.value !== 'custom') {
                    boxLength.value = preset.dimensions?.length ?? null
                    boxWidth.value = preset.dimensions?.width ?? null
                    boxHeight.value = preset.dimensions?.height ?? null
                } else if (container.max_volume_cuft) {
                    const cubicInches = container.max_volume_cuft * 1728
                    const side = Math.cbrt(cubicInches)
                    boxLength.value = Number(side.toFixed(1))
                    boxWidth.value = Number(side.toFixed(1))
                    boxHeight.value = Number(side.toFixed(1))
                } else {
                    boxLength.value = null
                    boxWidth.value = null
                    boxHeight.value = null
                }
                location.value = container.location
                    ? { value: container.location, label: store.locations.find(i => i.value == container.location)?.label }
                    : undefined
                store.activeCollection = {
                    value: container.collection,
                    label: store.collections.find(i => i.value == container.collection)?.label
                }
            }
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
                location.value?.value,
                {
                    boxNumber: boxNumber.value,
                    boxType: boxType.value,
                    sealed: sealed.value,
                    weightLbs: weightLbs.value,
                    fragileContents: fragileContents.value,
                    colorCode: colorCode.value,
                    boxSize: boxSize.value,
                    maxWeightLbs: maxWeightCapacity.value,
                    maxVolumeCuFt: maxVolumeCapacity.value,
                    description: description.value
                }
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
    <q-card class="modal-card">
        <q-card-section>
            <div v-if="(props.addType == 'Container')" class="text-h6">Edit container</div>
            <div v-if="(props.addType == 'Room')" class="text-h6">Edit collection</div>
            <div v-if="(props.addType == 'Location')" class="text-h6">Edit location</div>
        </q-card-section>

        <q-card-section class="q-pt-none">
            <!-- REQUIRED FOR ALL -->
            <q-input dense color="teal" v-model="name" label="Name" :rules="[(val: any) => !!val || 'Field is required']" />
            
            <!-- REQUIRED FOR ITEM -->
            <q-input dense v-if="(props.addType == 'Item')" color="teal" v-model.number="quantity" type="number" label="Quantity" :rules="[(val: number) => val > 0 || 'Quantity has to be 1 or greater']"/>
            
            <!-- OPTIONAL FOR ITEM / COLLECTION -->
            <q-input dense v-if="(props.addType == 'Item') || (props.addType == 'Collection')" v-model="description" label="Description" color="teal" autogrow />

            <!-- REQUIRED FOR ITEM, CONTAINER -->
            <q-select
                v-if="props.addType == 'Item' || props.addType == 'Container'"
                dense
                v-model="store.activeCollection"
                :options="store.collections.map(i => {return {label: i.label, value: i.value}})"
                filled
                behavior="dialog"
                :rules="[(val: any) => !!val || 'Field is required']"
            />

            <!-- OPTIONAL FOR ITEM -->
            <q-select
                v-if="props.addType == 'Item' && store.containers.filter(i => i.collection_id == store.activeCollection).length > 0"
                dense
                v-model="store.activeContainer"
                :options="store.containers.filter(i => i.collection_id == store.activeCollection).map(i => {return {label: i.label, value: i.value}})"
                filled
                behavior="dialog"
            />

            <!-- OPTIONAL FOR ITEM, CONTAINER -->
            <q-select
                v-if="(props.addType == 'Item') || (props.addType == 'Container')"
                dense
                v-model="location"
                :options="locationOptions"
                label="Location"
                filled
            />

            <template v-if="props.addType == 'Container'">
                <q-input dense v-model="boxNumber" label="Box Number" color="teal" />
                <q-select
                    dense
                    v-model="boxType"
                    :options="boxTypeOptions"
                    label="Box Type"
                    filled
                    color="teal"
                />
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
                <q-input dense v-model="colorCode" label="Color Code" color="teal" />
                <q-checkbox dense v-model="fragileContents" label="Contains Fragile Items" color="orange" />
                <q-checkbox dense v-model="sealed" label="Box is Sealed" color="green" />
                <q-input dense v-model.number="weightLbs" type="number" label="Current Weight (lbs)" color="teal" suffix="lbs" step="0.1" />
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

                <!-- Weight Status Warning -->
                <q-banner v-if="weightStatus" rounded dense class="q-mt-sm" :class="`bg-${weightStatus.color} text-white`">
                    <template v-slot:avatar>
                        <q-icon :name="weightStatus.icon" />
                    </template>
                    {{ weightStatus.message }}
                </q-banner>

                <!-- Density Recommendation for Custom Boxes -->
                <q-banner v-if="densityRecommendation" rounded dense class="q-mt-sm bg-info text-white">
                    <template v-slot:avatar>
                        <q-icon :name="densityRecommendation.icon" />
                    </template>
                    {{ densityRecommendation.message }}
                    <template v-slot:action>
                        <q-btn flat dense label="Use Preset" @click="boxSize = densityRecommendation.recommended" />
                    </template>
                </q-banner>

                <!-- Box Type Description -->
                <q-banner v-if="selectedBoxPreset && selectedBoxPreset.description" rounded dense class="q-mt-sm bg-grey-3 text-grey-8">
                    <template v-slot:avatar>
                        <q-icon name="info" color="primary" />
                    </template>
                    <div class="text-body2">{{ selectedBoxPreset.description }}</div>
                </q-banner>

                <q-input dense v-model="description" label="Container Description" color="teal" autogrow />
            </template>
            
            <q-input dense v-if="(props.addType == 'Location')"  color="teal" v-model="address" label="Address" />
            <q-input dense v-if="(props.addType == 'Location')"  color="teal" v-model="address_2" label="Unit / Apt Number" />
            <q-input dense v-if="(props.addType == 'Location')"  color="teal" v-model="city" label="City" />
            <q-input dense v-if="(props.addType == 'Location')"  color="teal" v-model="state" label="State" />
            <q-input dense v-if="(props.addType == 'Location')"  color="teal" v-model="zip" label="Zip Code" />
        </q-card-section>

        <q-card-actions align="right" class="text-primary">
        <q-btn flat color="info" label="Cancel" v-close-popup />
        <q-btn flat color="primary" label="Save" @click="submit" v-close-popup />
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
