<script setup lang="ts">
    import { Ref, computed, ref, watch } from 'vue';
    import { inventoryStore } from '../../stores/InventoryStore';
    import { QTableProps, useQuasar } from 'quasar';
    import ContainerSelect from './ContainerSelect.vue';
    import { storeToRefs } from 'pinia';
    import axios from 'axios';

    const store = inventoryStore();

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
    const filterPriority = ref<string[]>([])
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

    const togglePriorityValue = (value: string) => {
        const idx = filterPriority.value.indexOf(value)
        if (idx >= 0) {
            filterPriority.value.splice(idx, 1)
        } else {
            filterPriority.value.push(value)
        }
    }

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
        filterPriority.value = []
    }

    const getSelectedString = () => {
        return selectedItems.value.length === 0 ? '' : `${selectedItems.value.length} record${selectedItems.value.length > 1 ? 's' : ''} selected of ${items.value.length}`
    }

    const xyzURL: Ref<Array<any>> = ref([])

    // To adjust url based on whether in prod or not
    const token_url = import.meta.env.MODE == 'development' ? 'http://localhost:5174/tokens/' : 'https://take-stock.xyz/tokens/'
    const showTokens = ref(false)

    const tokenList = async () => {
        $q.loading.show({
            delay: 400 // ms
        })



        for (let i = 0; i < selectedItems.value.length; i++) {
            const selectedItem = selectedItems.value[i];
            const item = items.value.find(item => item.value == selectedItem);

            if (item && item.picture_url && item.picture_url.includes('take-stock')) {
                await pushToToken(selectedItem);
            }
        }
        $q.loading.hide()
        showTokens.value = true;
    }

    const pushToToken = async (item: number) => {
        let urlSlug = item.toString() + '/' + props.user
        const core_url = import.meta.env.MODE == 'development' ? 'http://localhost:3050' : 'https://movetrack-api-7hwn7ggbiq-uc.a.run.app'
        
        let encryptionData = await axios({
        method: 'post',
        url: core_url + '/secure/encrypt',
        params: {
            url: urlSlug
        },
        });

        // // Convert Uint8Array to a string using TextDecoder
        const encrypted = binaryToBase64(encryptionData.data.encrypted);
        const encodedIV = binaryToBase64(encryptionData.data.iv);

        xyzURL.value.push({id: item, url: token_url + '?id=' + encodeURIComponent(encrypted) + '&iv=' + encodeURIComponent(encodedIV)})
    }

    function openXYZ(url: string) {
        window.open(url)
    }

    function binaryToBase64(buffer) {
        // Convert binary data to a string
        const binaryString = Object.values(buffer).map(byte => String.fromCharCode(byte as number)).join('');

        // Encode the binary string to base64
        const base64Data = window.btoa(binaryString);

        return base64Data;
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
                if (filterPriority.value.length > 0 && !filterPriority.value.includes(i.priority?.toLowerCase() || '')) return false
                
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
                    dimensions: i.dimensions || null,
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

    const props = defineProps({
        user: String,
        // search: String
    })

    const columns: QTableProps['columns'] = [
        { name: 'selection', align: 'left', label: '', field: 'selection', sortable: false, required: false },
        { name: 'name', align: 'left', label: 'Item', field: 'name', sortable: true, required: false, sortOrder: 'ad' },
        { name: 'description', align: 'left', label: 'Description', field: 'description', required: false, style: 'max-width: 250px; word-wrap: break-word; overflow: hidden; white-space: nowrap;', headerStyle: 'max-width: 200px;' },
        { name: 'quantity', align: 'center', label: 'Quantity', field: 'quantity', sortable: true, required: false, sort: (a, b) => parseInt(a, 10) - parseInt(b, 10) },
        { name: 'fragile', align: 'center', label: 'Fragile', field: 'fragile', sortable: true, required: false },
        { name: 'priority', align: 'center', label: 'Priority', field: 'priority', sortable: true, required: false },
        { name: 'weight_lbs', align: 'center', label: 'Weight (lbs)', field: 'weight_lbs', sortable: true, required: false },
        { name: 'dimensions', align: 'center', label: 'Dimensions', field: 'dimensions', sortable: false, required: false },
        { name: 'collection_name', align: 'right', label: 'Collection', field: 'collection_name', sortable: true, required: false },
        { name: 'container_name', align: 'right', label: 'Container', field: 'container_name', sortable: true, required: false },
        { name: 'location_name', align: 'right', label: 'Location', field: 'location_name', sortable: true, required: false }
    ];
    
    const customFilter = (rows, terms) => {
        const lowerSearch = terms ? terms.toLowerCase() : ""

        const searchKeys = ['label', 'description', 'location_name', 'collection_name', 'container_name']
        const filteredRows = rows.filter((row, i) => {

            let ans = false
            
            //Gather toggle conditions
            let c1 = store.locationValues?.includes(row.location)
            let c2 = store.collectionValues?.includes(row.collection)
            let c3 = store.containerValues?.includes(row.container)

            //Assume true in case there is no search 
            let s1 = true
            
            //If search term exists, convert to lower case and see which rows contain it
            if(lowerSearch != ""){
                s1 = false
                //Get the values
                let s1_values = searchKeys.map(key => row[key])

                //Convert to lowercase
                let s1_lower = s1_values.filter((x: any) => x != undefined).map((y: any) => y.toString()?.toLowerCase())
                // console.log('s1_values are: ', s1_lower)

                for (let val = 0; val<s1_lower.length; val++){
                    if (s1_lower[val].includes(lowerSearch)){
                        s1 = true
                        // console.log(s1_lower[val], lowerSearch, s1)
                        break
                    }
                    // console.log(s1_lower[val], lowerSearch, s1)
                }
            }

            //assume row doesn't match
            ans = false
                
            //check if any of the conditions match  
            if ( s1 && c3 && c2 && c1 ) {
                ans = true
            }
            
            return ans

        })
        return filteredRows
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
        xyzURL.value = []
        selectedItems.value = []
        allSelected.value = false
    }

    const getPriorityColor = (priority: string | null) => {
        if (!priority) return 'grey'
        const p = priority.toLowerCase()
        if (p === 'high') return 'red-7'
        if (p === 'medium') return 'orange-7'
        if (p === 'low') return 'green-7'
        return 'grey-7'
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
    <q-dialog v-model="showTokens" style="z-index: 9999;" @hide="closeDialog">
        <q-card style="min-width: 60vw;">
        <q-card-section class="row flex flex-center">
            <masonry-wall v-if="xyzURL.length > 0" :items="xyzURL" :max-columns="5" :column-width="50" :gap="16" style="min-width: 50vw;" class="q-mx-xl q-my-md">
                <template #default="{ item, index }">
                 <q-card clickable @click="openXYZ(item.url)">
                    <q-img fit="cover" :src="store.items.find(i => i.value == item.id).picture_url" />
                    <q-card-section>
                        <div class="text-body1 text-weight-medium flex flex-center full-width text-primary">{{ store.items.find(i => i.value == item.id).label }}</div>
                    </q-card-section>
                 </q-card>
                </template>
            </masonry-wall>
        </q-card-section>

        <q-card-actions align="right">
            <q-btn flat label="Cancel" color="info" v-close-popup />
        </q-card-actions>
        </q-card>
    </q-dialog>


    <q-page class="q-pa-md">
        
        
        <q-table
        class="my-sticky-header-column-table"
        :rows-per-page-options="[25, 50, 100]"
        :rows="itemRows"
        :columns="columns"
        separator="horizontal"
        row-key="value"
        :filter-method="customFilter"
        :filter="search"
        >

        <template v-slot:top>
                <q-input dense filled debounce="300" style="padding: 3px; width: 25vw;" color="primary" bg-color="transparent" v-model="search">
                    <template v-slot:prepend>
                        <q-icon color="primary" name="search" />
                    </template>
                </q-input>

                <q-space />

                <q-btn
                    unelevated
                    color="primary"
                    class="q-ml-sm"
                    icon="add"
                    label="Add Item"
                    :disable="store.collections.length === 0"
                    @click.stop="emit('addAction')"
                />

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
                                <q-chip
                                    dense
                                    clickable
                                    :outline="!filterPriority.includes('high')"
                                    color="negative"
                                    text-color="white"
                                    @click="togglePriorityValue('high')"
                                >
                                    High Priority
                                </q-chip>
                                <q-chip
                                    dense
                                    clickable
                                    :outline="!filterPriority.includes('medium')"
                                    color="warning"
                                    text-color="white"
                                    @click="togglePriorityValue('medium')"
                                >
                                    Medium Priority
                                </q-chip>
                                <q-chip
                                    dense
                                    clickable
                                    :outline="!filterPriority.includes('low')"
                                    color="positive"
                                    text-color="white"
                                    @click="togglePriorityValue('low')"
                                >
                                    Low Priority
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

                <q-btn-dropdown flat color="primary" label="actions">
                    <q-btn push flat color="primary" :disable="(selectedItems.length == 0)" label="Move" icon="swap_horiz" @click="editItemLocation" />
                    <q-btn push flat color="primary" :disable="(selectedItems.length == 0)" label="List" icon="sell" @click="tokenList()" />
                    <q-btn push flat :disable="(selectedItems.length == 0)" label="Delete" color="negative" icon="delete_forever" @click="deleteItemDialog = true" />
                </q-btn-dropdown>
                
                

                <!-- q-btn dropdown that allows for filtering based on the collection -->
                
                


            <q-separator />
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

            <q-td key="priority" :props="props">
                <q-badge 
                    v-if="props.row.priority" 
                    :color="getPriorityColor(props.row.priority)" 
                    text-color="white"
                >
                    {{ props.row.priority }}
                </q-badge>
                <span v-else class="text-grey-5">—</span>
            </q-td>

            <q-td key="weight_lbs" :props="props">
                {{ props.row.weight_lbs ? props.row.weight_lbs + ' lbs' : '—' }}
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
    </q-page>

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
        <ContainerSelect :user="user!" :idList="selectedItems" @submitted="selectedItems = []" />
    </q-dialog>
</template>

<style scoped>
.button-container {
    position: sticky;
    top: 0;
    background-color: white; /* Adjust the background color as needed */
    z-index: 1; /* Ensure buttons appear above the table */
}
.my-sticky-header-column-table {
  max-height: 90vh;
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
</style>
