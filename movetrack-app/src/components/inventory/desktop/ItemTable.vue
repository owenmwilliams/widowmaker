<script setup lang="ts">
    import { Ref, computed, ref, watch, reactive } from 'vue';
    import { inventoryStore } from '../../../stores/InventoryStore'
    import { QTableProps, useQuasar } from 'quasar';
    import MoveItemsDialog from './MoveItemsDialog.vue';
    import { storeToRefs } from 'pinia';

    const store = inventoryStore();

    type EstimateValue = {
        value: number | null;
        confidence?: number | null;
    };

    interface InlineEstimate {
        weight_lbs?: EstimateValue | null;
        dimensions?: {
            length_in?: EstimateValue | null;
            width_in?: EstimateValue | null;
            height_in?: EstimateValue | null;
        } | null;
        volume_cuft?: number | null;
        notes?: string | null;
    }

    type EstimateState = {
        loading: boolean;
        estimate: InlineEstimate | null;
        error: string | null;
    };

    const aiRowStates = reactive<Record<number, EstimateState>>({});

    const ensureRowState = (id: number): EstimateState => {
        if (!aiRowStates[id]) {
            aiRowStates[id] = { loading: false, estimate: null, error: null };
        }
        return aiRowStates[id];
    };

    const getRowEstimateState = (id: number) => ensureRowState(id);

    const buildItemOverrides = (itemId: number) => {
        const item = store.items.find((entry) => entry.value === itemId);
        if (!item) return {};
        return {
            name: item.label,
            description: item.description,
            quantity: item.quantity,
            material: item.material,
            primary_color: item.primary_color,
            tags: item.tags || [],
            notes: item.notes,
            weight_lbs: item.weight_lbs,
            length_in: item.length_in,
            width_in: item.width_in,
            height_in: item.height_in
        };
    };

    const formatEstimateValue = (value?: number | null, unit?: string) => {
        if (value === null || value === undefined || Number.isNaN(Number(value))) {
            return '—';
        }
        const numeric = Number(value);
        const rounded =
            Math.abs(numeric - Math.round(numeric)) < 0.01
                ? Math.round(numeric).toString()
                : numeric.toFixed(1);
        return unit ? `${rounded} ${unit}` : rounded;
    };

    const formatEstimateDimensions = (estimate?: InlineEstimate | null) => {
        if (!estimate?.dimensions) return '—';
        const length = estimate.dimensions.length_in?.value;
        const width = estimate.dimensions.width_in?.value;
        const height = estimate.dimensions.height_in?.value;
        if (
            length === null || length === undefined ||
            width === null || width === undefined ||
            height === null || height === undefined
        ) {
            return '—';
        }
        return `${formatEstimateValue(length)}" × ${formatEstimateValue(width)}" × ${formatEstimateValue(height)}"`;
    };

    const requestAiEstimateForTableRow = async (itemId: number) => {
        if (!props.user) {
            $q.notify({ type: 'warning', message: 'Sign in to request AI suggestions.' });
            return;
        }
        const state = ensureRowState(itemId);
        state.loading = true;
        state.error = null;
        try {
            const response = await store.requestItemEstimate(String(itemId), {
                overrideFields: buildItemOverrides(itemId)
            });
            if (response?.estimate) {
                state.estimate = response.estimate;
                state.error = null;
                const item = store.items.find((entry) => entry.value === itemId);
                if (item && !item.picture_url) {
                    $q.notify({ type: 'info', message: 'This item has no photo — estimates with photos are much more accurate.', timeout: 4000 });
                }
            } else {
                state.estimate = null;
                state.error = 'No estimate returned.';
            }
        } catch (error: any) {
            console.error('[DesktopItemTable] AI estimate failed', error);
            state.estimate = null;
            state.error = error?.response?.data?.error || error?.message || 'Unable to fetch estimate.';
        } finally {
            state.loading = false;
        }
    };

    const applyAiEstimateForTableRow = async (itemId: number) => {
        if (!props.user) return;
        const suggestion = ensureRowState(itemId).estimate;
        if (!suggestion) return;
        const item = store.items.find((entry) => entry.value === itemId);
        if (!item) return;

        const payload: Record<string, any> = {};
        if (suggestion.weight_lbs?.value) {
            payload.weightLbs = suggestion.weight_lbs.value;
        }
        const length = suggestion.dimensions?.length_in?.value;
        const width = suggestion.dimensions?.width_in?.value;
        const height = suggestion.dimensions?.height_in?.value;
        if (length && width && height) {
            payload.lengthIn = length;
            payload.widthIn = width;
            payload.heightIn = height;
        }

        if (Object.keys(payload).length === 0) {
            $q.notify({ type: 'warning', message: 'Estimate did not include usable values.' });
            return;
        }

        try {
            await store.updateItem(
                itemId,
                props.user,
                item.label,
                item.description || '',
                item.quantity || 1,
                item.collection,
                item.container ?? undefined,
                undefined,
                payload
            );
            $q.notify({ type: 'positive', message: 'Estimate applied' });
        } catch (error) {
            console.error('[DesktopItemTable] failed to apply estimate', error);
            $q.notify({ type: 'negative', message: 'Unable to apply estimate' });
        }
    };

    const props = defineProps({
        user: String,
        // search: String
    })

    const deleteItemDialog = ref(false)
    const moveItemDialog = ref(false)

    const itemPassed: Ref<number | undefined> = ref(undefined)
    
    const $q = useQuasar()

    // Define emits to trigger add-item dialog
    const emit = defineEmits(['addAction'])

    // const emits = defineEmits<{
    //     (e: 'addItem'): void
    // }>()

    const { locationValues, collectionValues, containerValues } = storeToRefs(store);
    
    const { items } = storeToRefs(store)

    const selectedItems: Ref<number[]> = ref([])
    const allSelected = ref(false)

    // Tag filters
    const filterFragile = ref(false)
    const showFiltersMenu = ref(false)

    const toggleFilterValue = (list: Ref<Array<number>>, value: number) => {
        const idx = list.value.indexOf(value)
        if (idx >= 0) {
            list.value.splice(idx, 1)
        } else {
            list.value.push(value)
        }
    }

    const isFilterActive = (list: Ref<Array<number>>, value: number) => list.value.includes(value)

    const toggleCollectionFilter = (value: number) => toggleFilterValue(collectionValues, value)
    const toggleContainerFilter = (value: number) => toggleFilterValue(containerValues, value)
    const toggleLocationFilter = (value: number) => toggleFilterValue(locationValues, value)
    const isCollectionActive = (value: number) => collectionValues.value.includes(value)
    const isContainerActive = (value: number) => containerValues.value.includes(value)
    const isLocationActive = (value: number) => locationValues.value.includes(value)

    const clearFilters = () => {
        collectionValues.value = store.collections.map(i => i.value)
        containerValues.value = store.containers.map(i => i.value)
        locationValues.value = store.locations.map(i => i.value)
        filterFragile.value = false
    }

    const getSelectedString = () => {
        return selectedItems.value.length === 0 ? '' : `${selectedItems.value.length} record${selectedItems.value.length > 1 ? 's' : ''} selected of ${items.value.length}`
    }

    const itemRows = computed(() => {
        return items.value
            .filter(i => {
                // Existing filters
                if (i.value == null) return false
                if (!store.collectionValues?.includes(i.collection)) return false
                if (i.location != null && !store.locationValues?.includes(i.location)) return false
                if (i.container != null && !store.containerValues?.includes(i.container)) return false

                // Tag filters
                if (filterFragile.value && !i.fragile) return false

                return true
            })
            .map(i => {
                return {
                    value: i.value,
                    label: i.label,
                    description: i.description,
                    quantity: i.quantity,
                    collection: i.collection,
                    collection_name: store.collections.find(c => c.value == i.collection)?.label,
                    container: i.container,
                    container_name: store.containers.find(c => c.value == i.container)?.label,
                    room: store.containers.find(c => c.value == i.container)?.collection_id,
                    room_name: store.collections.find(c => c.value == store.containers.find(d => d.value == i.container)?.collection_id)?.label,
                    location: i.location,
                    location_name: store.locations.find(l => l.value == i.location)?.label,
                    picture_url: i.picture_url,
                    fragile: i.fragile || false,
                    priority: i.priority || null,
                    weight_lbs: i.weight_lbs || null,
                    dimensions: (i.length_in && i.width_in && i.height_in)
                        ? `${i.length_in}" × ${i.width_in}" × ${i.height_in}"`
                        : (i.dimensions || null),
                    selection: false
                }
            })
    })

    const editItemLocation = () => {

        console.log(selectedItems.value[0])
        store.activeCollection = {
            label : store.collections.find(i => i.value == store.items.find(j => j.value == selectedItems.value[0])?.collection)?.label ?? undefined, 
            value : store.items.find(i => i.value == selectedItems.value[0])?.collection ?? undefined
        }

        console.log('store.activeCollection is: ', store.activeCollection)

        console.log('store.activeCollection is: ', store.activeCollection)
        store.activeContainer = {
            label : store.containers.find(i => i.value == store.items.find(j => j.value == selectedItems.value[0])?.container)?.label ?? undefined, 
            value : store.items.find(i => i.value == selectedItems.value[0])?.container ?? undefined
        }

        console.log('store.activeContainer is: ', store.activeContainer)
        moveItemDialog.value = true
    }

    const deleteItem = (id: number) => {
        itemPassed.value = id
        deleteItemDialog.value = true
    }

    const search = ref('')

    const columns: QTableProps['columns'] = [
        { name: 'selection', align: 'left', label: '', field: 'selection', sortable: false, required: false },
        { name: 'name', align: 'left', label: 'Item', field: 'label', sortable: true, required: false, sortOrder: 'ad' },
        { name: 'description', align: 'left', label: 'Description', field: 'description', required: false, style: 'max-width: 250px; word-wrap: break-word; overflow: hidden; white-space: nowrap;', headerStyle: 'max-width: 200px;' },
        { name: 'quantity', align: 'center', label: 'Quantity', field: 'quantity', sortable: true, required: false, sort: (a, b) => parseInt(a, 10) - parseInt(b, 10) },
        { name: 'fragile', align: 'center', label: 'Fragile', field: 'fragile', sortable: true, required: false },
        { name: 'weight_lbs', align: 'center', label: 'Weight (lbs)', field: 'weight_lbs', sortable: true, required: false },
        { name: 'dimensions', align: 'center', label: 'Dimensions', field: 'dimensions', sortable: false, required: false },
        { name: 'collection_name', align: 'right', label: 'Collection', field: 'collection_name', sortable: true, required: false },
        { name: 'container_name', align: 'right', label: 'Container', field: 'container_name', sortable: true, required: false },
        { name: 'location_name', align: 'right', label: 'Location', field: 'location_name', sortable: true, required: false }
    ];
    
    const customFilter = (rows, terms) => {
        const lowerSearch = terms ? terms.toLowerCase() : ""

        // If no search term, return all rows (filtering by collection/container/location is already done in itemRows)
        if (lowerSearch === "") {
            return rows
        }

        const searchKeys = ['label', 'description', 'location_name', 'collection_name', 'container_name']

        return rows.filter((row) => {
            // Get the values for all searchable fields
            const searchableValues = searchKeys.map(key => row[key])

            // Convert to lowercase and filter out undefined/null values
            const lowerValues = searchableValues
                .filter((x: any) => x != null && x != undefined)
                .map((y: any) => y.toString().toLowerCase())

            // Check if any field contains the search term
            return lowerValues.some(value => value.includes(lowerSearch))
        })
    }

    const updateAllSelected = () => {
        if (selectedItems.value.length == itemRows.value.length) {
            selectedItems.value = []
        } else {
            selectedItems.value = itemRows.value.map(i => i.value)
        }
    }

    const deleteSelected = () => {
        selectedItems.value.forEach(i => {
            store.deleteItem(i, props.user!)
        })
    }

    const closeDialog = () => {
        selectedItems.value = []
        allSelected.value = false
    }

    const openItemDetails = (itemId: number) => {
        if (!props.user) {
            return
        }
        store.openItemDetailsModal(itemId, props.user)
    }

    const handleRowClick = (event: MouseEvent, rowId: number) => {
        const target = event.target as HTMLElement | null
        if (target?.closest('[data-ignore-row-click]')) {
            return
        }
        openItemDetails(rowId)
    }

</script>

<template>
    <div class="items-container">
        <div class="items-header q-pa-md">
            <h5 class="text-h5 text-primary q-my-none">Items</h5>
            <p class="text-caption text-grey-7 q-mt-xs">View and manage all items in your inventory</p>
        </div>

    <div class="q-pa-md items-table-page">
        <div class="table-wrapper">
            <q-table
        class="my-sticky-header-column-table full-height-table"
        :rows-per-page-options="[0]"
        :rows="itemRows"
        :columns="columns"
        separator="horizontal"
        row-key="value"
        :filter-method="customFilter"
        :filter="search"
        virtual-scroll
        :virtual-scroll-item-size="48"
        :virtual-scroll-sticky-size-start="48"
        >

        <template v-slot:top>
                <q-input dense filled debounce="300" style="padding: 3px; width: 25vw;" color="primary" bg-color="transparent" v-model="search">
                    <template v-slot:prepend>
                        <q-icon color="primary" name="search" />
                    </template>
                </q-input>

                <q-space />

                <q-btn flat color="primary" label="Filters" icon="filter_list" @click.stop="showFiltersMenu = true" />

                <q-dialog v-model="showFiltersMenu">
                    <q-card class="filters-menu">
                        <q-card-section class="row items-center justify-between q-pb-none">
                            <div class="text-h6 text-primary">Filters</div>
                            <q-btn flat dense icon="close" color="grey-7" v-close-popup />
                        </q-card-section>
                        <q-card-section>
                        <div class="filter-section">
                            <div class="section-label">Collections</div>
                            <div class="chip-row">
                                <q-chip
                                    v-for="collection in store.collections"
                                    :key="collection.value"
                                    dense
                                    clickable
                                    :outline="!isCollectionActive(collection.value)"
                                    color="primary"
                                    text-color="white"
                                    @click="toggleCollectionFilter(collection.value)"
                                >
                                    {{ collection.label }}
                                </q-chip>
                            </div>
                        </div>

                        <div class="filter-section">
                            <div class="section-label">Containers</div>
                            <div class="chip-row">
                                <q-chip
                                    v-for="container in store.containers"
                                    :key="container.value"
                                    dense
                                    clickable
                                    :outline="!isContainerActive(container.value)"
                                    color="secondary"
                                    text-color="white"
                                    @click="toggleContainerFilter(container.value)"
                                >
                                    {{ container.label }}
                                </q-chip>
                            </div>
                        </div>

                        <div class="filter-section">
                            <div class="section-label">Locations</div>
                            <div class="chip-row">
                                <q-chip
                                    v-for="location in store.locations"
                                    :key="location.value"
                                    dense
                                    clickable
                                    :outline="!isLocationActive(location.value)"
                                    color="accent"
                                    text-color="white"
                                    @click="toggleLocationFilter(location.value)"
                                >
                                    {{ location.label }}
                                </q-chip>
                            </div>
                        </div>

                        <div class="filter-section">
                            <div class="section-label">Tags</div>
                            <div class="chip-row">
                                <q-chip
                                    dense
                                    clickable
                                    :outline="!filterFragile"
                                    color="red"
                                    text-color="white"
                                    @click="filterFragile = !filterFragile"
                                >
                                    Fragile
                                </q-chip>
                            </div>
                        </div>

                        <div class="text-right q-mt-md">
                            <q-btn flat color="grey-7" label="Reset" @click="clearFilters" />
                            <q-btn flat color="primary" label="Done" v-close-popup />
                        </div>
                        </q-card-section>
                    </q-card>
                </q-dialog>

            <q-separator />
        </template>

        <template v-slot:bottom="props">
            <div class="full-width row items-center justify-between q-pa-sm">
                <div class="row items-center q-gutter-sm">
                    <q-btn
                        flat
                        color="primary"
                        label="Move"
                        icon="swap_horiz"
                        :disable="selectedItems.length === 0"
                        @click.stop="editItemLocation"
                    >
                        <q-badge v-if="selectedItems.length > 0" color="secondary" floating>{{ selectedItems.length }}</q-badge>
                    </q-btn>

                    <q-btn
                        flat
                        color="negative"
                        label="Delete"
                        icon="delete_forever"
                        :disable="selectedItems.length === 0"
                        @click.stop="deleteItemDialog = true"
                    >
                        <q-badge v-if="selectedItems.length > 0" color="negative" floating>{{ selectedItems.length }}</q-badge>
                    </q-btn>
                </div>

                <q-pagination
                    v-model="props.pagination.page"
                    :max="props.pagesNumber"
                    :max-pages="6"
                    boundary-numbers
                    direction-links
                    @update:model-value="(val) => props.pagination.page = val"
                />

                <div class="row items-center">
                    <span class="text-caption q-mr-sm">Records per page:</span>
                    <q-select
                        v-model="props.pagination.rowsPerPage"
                        :options="[25, 50, 100]"
                        dense
                        outlined
                        style="width: 70px"
                        @update:model-value="(val) => props.pagination.rowsPerPage = val"
                    />
                </div>
            </div>
        </template>

        <template v-slot:header="props">
            <q-th key="selection" :props="props">
                <q-checkbox
                    v-model="allSelected"
                    @update:model-value="updateAllSelected"
                    data-ignore-row-click
                    @click.stop
                    @keydown.stop
                />
            </q-th>
            <q-th key="name" :props="props">
                Name
            </q-th>
            <q-th key="description" :props="props">
                Description
            </q-th>
            <q-th key="quantity" :props="props">
                Quantity
            </q-th>
            <q-th key="fragile" :props="props">
                Fragile
            </q-th>
            <q-th key="priority" :props="props">
                Priority
            </q-th>
            <q-th key="weight_lbs" :props="props">
                Weight (lbs)
            </q-th>
            <q-th key="dimensions" :props="props">
                Dimensions
            </q-th>
            <q-th key="collection_name" :props="props">
                Collection
            </q-th>
            <q-th key="container_name" :props="props">
                Container
            </q-th>
            <q-th key="location_name" :props="props">
                Location
            </q-th>
        </template>

        <template v-slot:body="props">
            <q-tr :props="props" class="item-row" @click="handleRowClick($event, props.row.value)">

            <q-td key="selection" :props="props">
                <q-checkbox
                    v-model="selectedItems"
                    :val="props.row.value"
                    data-ignore-row-click
                    @click.stop
                    @keydown.stop
                />
            </q-td>

            <q-td key="name" :props="props">
                <div class="text-pre-wrap text-weight-medium">
                    {{ props.row.label }}
                </div>
            </q-td>

            <q-td key="description" :props="props">
                <div class="text-pre-wrap">{{ props.row.description }}</div>
            </q-td>

            <q-td key="quantity" :props="props">
                {{ props.row.quantity }}
            </q-td>

            <q-td key="fragile" :props="props">
                <q-badge v-if="props.row.fragile" color="red" text-color="white">
                    <q-icon name="warning" size="xs" class="q-mr-xs" />
                    Fragile
                </q-badge>
                <span v-else class="text-grey-5">—</span>
            </q-td>

            <q-td key="weight_lbs" :props="props">
                <div class="weight-cell">
                    <span>{{ props.row.weight_lbs ? props.row.weight_lbs + ' lbs' : '—' }}</span>
                    <q-btn
                        v-if="!props.row.weight_lbs || !props.row.dimensions"
                        flat
                        dense
                        round
                        size="sm"
                        color="primary"
                        icon="auto_fix_high"
                        data-ignore-row-click
                        :loading="getRowEstimateState(props.row.value).loading"
                        @click.stop="requestAiEstimateForTableRow(props.row.value)"
                    >
                        <q-tooltip>Suggest weight &amp; dimensions</q-tooltip>
                    </q-btn>
                </div>
                <div
                    v-if="getRowEstimateState(props.row.value).estimate"
                    class="ai-suggestion-inline"
                >
                    <div class="ai-inline-summary">
                        ≈ {{ formatEstimateValue(getRowEstimateState(props.row.value).estimate?.weight_lbs?.value, 'lbs') }}
                        <span class="text-grey-5">•</span>
                        {{ formatEstimateDimensions(getRowEstimateState(props.row.value).estimate) }}
                    </div>
                    <q-btn
                        flat
                        dense
                        size="sm"
                        color="primary"
                        data-ignore-row-click
                        icon="playlist_add"
                        label="Apply"
                        @click.stop="applyAiEstimateForTableRow(props.row.value)"
                    />
                </div>
                <div
                    v-else-if="getRowEstimateState(props.row.value).error"
                    class="text-negative text-caption q-mt-xs"
                >
                    {{ getRowEstimateState(props.row.value).error }}
                </div>
            </q-td>

            <q-td key="dimensions" :props="props">
                {{ props.row.dimensions || '—' }}
            </q-td>

            <q-td key="collection_name" :props="props">{{ props.row.collection_name }}</q-td>
            <q-td key="container_name" :props="props">{{ props.row.container_name }}</q-td>
            <q-td key="location_name" :props="props">
                {{ props.row.location_name }}
                <!-- <q-btn primary  flat small icon='swap_horiz' padding="none" @click="editItemLocation(props.row.value)" /> -->
            </q-td>

            </q-tr>
        </template>
        </q-table>
        </div>
    </div>

    <q-dialog  v-model="deleteItemDialog" @hide="closeDialog">
        <q-card style="max-height: 80vh; min-width: 30vw;">
        <q-card-section class="row items-center">
            <q-avatar icon="warning" color="negative" text-color="white" />
            <span class="q-ml-sm">Delete the following items?</span>
        </q-card-section>
        <q-card-section class="row">
            <q-list>
                <q-item v-for="(item, index) in selectedItems" :key="index">
                    <li>{{ store.items.find(i => i.value == item).label }}</li>
                </q-item>
            </q-list>
        </q-card-section>

        <q-card-actions align="right">
            <q-btn flat label="Cancel" color="info" v-close-popup />
            <q-btn flat label="Delete" color="negative" v-close-popup @click="deleteSelected()" />
        </q-card-actions>
        </q-card>
    </q-dialog>

    <q-dialog  v-model="moveItemDialog" @hide="closeDialog">
        <MoveItemsDialog :user="user!" :idList="selectedItems" @submitted="selectedItems = []" />
    </q-dialog>
    </div>
</template>

<style scoped>
.items-container {
  max-width: 100%;
  background: #F7F8FA;
  height: calc(100vh - 50px - 48px); /* 50px for header, 48px for subnav */
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.items-header {
  flex-shrink: 0;
  background: white;
  border-bottom: 1px solid #E0E0E0;
}

.items-table-page {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  height: 100%;
}

.table-wrapper {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: white;
  border: 1px solid #E0E0E0;
  border-radius: 16px;
  overflow: hidden;
}

.table-wrapper :deep(.q-table__container) {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.button-container {
    position: sticky;
    top: 0;
    background-color: white; /* Adjust the background color as needed */
    z-index: 1; /* Ensure buttons appear above the table */
}

.full-height-table {
  flex: 1;
  min-height: 0;
}

.my-sticky-header-column-table {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.my-sticky-header-column-table :deep(.q-table__container) {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.my-sticky-header-column-table :deep(.q-table__top) {
  flex-shrink: 0;
}

.my-sticky-header-column-table :deep(.q-table__middle) {
  flex: 1;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
}

.my-sticky-header-column-table :deep(.q-table__middle)::-webkit-scrollbar {
  width: 0px;
  height: 0px;
}

.my-sticky-header-column-table :deep(.q-table__middle) {
  scrollbar-width: none;
  -ms-overflow-style: none;
}

.my-sticky-header-column-table td:first-child {
  background-color: #467599;
  color: #fff;
}
.my-sticky-header-column-table thead tr th {
  position: sticky;
    /* higher than z-index for td below */
    z-index: 2;
    /* bg color is important; just specify one */
    background: #467599;
    /* text color must be specified */
    color: #fff;
}

.my-sticky-header-column-table thead tr:last-child th {
  /* height of all previous header rows */
  top: 48px;
  /* highest z-index */
  z-index: 3;
}

.my-sticky-header-column-table thead tr:first-child th {
  top: 0;
  z-index: 1;
}

.my-sticky-header-column-table tr:first-child th:first-child {
  z-index: 3;
}

.my-sticky-header-column-table td:first-child {
  z-index: 1;
}

.my-sticky-header-column-table td:first-child th:first-child {
  position: sticky;
  left:0;
}

.my-sticky-header-column-table tbody {
  scroll-margin-top: 48px;
}

.item-row {
  cursor: pointer;
}

.item-row:hover {
  background-color: rgba(70, 117, 153, 0.08);
}

.filters-menu {
  min-width: 320px;
  max-width: 420px;
  padding: 16px;
}

.filter-section + .filter-section {
  margin-top: 12px;
}

.section-label {
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: #6b7280;
  margin-bottom: 6px;
}

.chip-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.weight-cell {
  display: flex;
  align-items: center;
  gap: 6px;
}

.ai-suggestion-inline {
  margin-top: 4px;
  padding: 6px 10px;
  border-radius: 8px;
  border: 1px solid #d0def6;
  background: #eef4ff;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.ai-inline-summary {
  font-size: 12px;
  font-weight: 600;
  color: #0f172a;
}
</style>
