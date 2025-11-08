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

    // Define emits to add Item
    const emits = defineEmits(['addItem'])

    // const emits = defineEmits<{
    //     (e: 'addItem'): void
    // }>()

    const { locationValues, collectionValues, containerValues } = storeToRefs(store);
    
    const { items } = storeToRefs(store)

    const selectedItems: Ref<number[]> = ref([])
    const allSelected = ref(false)

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
            .filter(i => 
                i.value != null && 
                store.collectionValues?.includes(i.collection) &&
                (store.locationValues?.includes(i.location) || i.location == null) &&
                (store.containerValues?.includes(i.container) || i.container == null)
            )
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
            <q-btn color="secondary" label="Add Item" icon="add" @click="emits('addItem')" />
                <q-input dense filled debounce="300" style="padding: 3px; width: 25vw;" color="primary" bg-color="transparent" v-model="search">
                    <template v-slot:prepend>
                        <q-icon color="primary" name="search" />
                    </template>
                </q-input>

                <q-space />

                <q-btn-dropdown flat color="primary" label="filters">

                    <q-btn-dropdown flat color="primary" label="Collections">
                        <q-option-group
                            class="text-primary q-pa-sm"
                            v-model="collectionValues"
                            :options="store.collections.filter(i => i.disable == false).map(i => {return {label: i.label, value: i.value, disable: i.disable}})"
                            option-value="value"
                            option-label="label"
                            type="checkbox"
                        />
                    </q-btn-dropdown>
                    <q-btn-dropdown flat color="primary" label="Containers">
                        <q-option-group
                            class="text-primary q-pa-sm"
                            v-model="containerValues"
                            :options="store.containers.filter(i => collectionValues.includes(i.collection) && i.disable == false).map(i => {return {label: i.label, value: i.value, disable: i.disable}})"
                            option-value="value"
                            option-label="label"
                            type="checkbox"
                        />
                    </q-btn-dropdown>

                    <q-btn-dropdown flat color="primary" label="Locations">
                        <q-option-group
                            class="text-primary q-pa-sm"
                            v-model="locationValues"
                            :options="store.locations.filter(i => i.disable == false).map(i => {return {label: i.label, value: i.value, disable: i.disable}})"
                            option-value="value"
                            option-label="label"
                            type="checkbox"
                        />
                    </q-btn-dropdown>
                </q-btn-dropdown>

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
                <q-checkbox v-model="allSelected" @update:model-value="updateAllSelected" />
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
            <q-tr :props="props">

            <q-td key="selection" :props="props">
                <q-checkbox v-model="selectedItems" :val="props.row.value" />
            </q-td>

            <q-td key="name" :props="props">
                <div class="text-pre-wrap">
                <!-- <q-btn primary flat tiny icon='delete_forever' padding="none" @click="deleteItem(props.row.value)" /> -->
                {{ props.row.label }}
                </div>
                <q-popup-edit :disable="deleteItemDialog" buttons v-model="props.row.label" v-slot="scope">

                    <!-- (
                        id: number, 
                        user: string, 
                        name: string, 
                        description: string, 
                        quantity: number, 
                        collection: number, 
                        container?: number | undefined, 
                        location?: number | undefined, 
                        picture_url?: string) -->

                <q-input  v-model="scope.value"  dense autofocus @keyup.enter="async () => { await store.updateItem(
                    props.row.value, 
                    user!, 
                    scope.value,
                    props.row.description,
                    props.row.quantity,
                    props.row.collection,
                    props.row.container ?? undefined,
                    props.row.location ?? undefined,
                    props.row.picture_url ?? undefined)
                    .then(() => {
                        scope.set()
                    })
                    }
                "/>
                </q-popup-edit>
            </q-td>

            <q-td key="description" :props="props">
                <div class="text-pre-wrap">{{ props.row.description }}</div>
                <q-popup-edit v-model="props.row.description"  v-slot="scope">
                <q-input type="textarea" v-model="scope.value"  dense autofocus @keyup.enter="async () => { await store.updateItem(
                    props.row.value, 
                    user!, 
                    props.row.label,
                    scope.value,
                    props.row.quantity,
                    props.row.collection,
                    props.row.container ?? undefined,
                    props.row.location ?? undefined,
                    props.row.picture_url ?? undefined)
                    .then(() => {
                        scope.set()
                    })
                    }
                "/>
                </q-popup-edit>
            </q-td>

            <q-td key="quantity" :props="props">
                {{ props.row.quantity }}
                <q-popup-edit v-model="props.row.quantity"  v-slot="scope">
                <q-input type="number" v-model.number="scope.value"  dense autofocus counter @keyup.enter="async () => { await store.updateItem(
                    props.row.value, 
                    user!, 
                    props.row.label, 
                    props.row.description,
                    scope.value,
                    props.row.collection,
                    props.row.container ?? undefined,
                    props.row.location ?? undefined,
                    props.row.picture_url ?? undefined)
                    .then(() => {
                        scope.set()
                    })
                    }
                "  />
                </q-popup-edit>
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
</style>