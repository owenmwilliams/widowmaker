<script setup lang="ts">
import { Ref, ref } from 'vue';
import { computed, watch } from 'vue';
import { storeToRefs } from 'pinia';
import { inventoryStore } from '../../../stores/InventoryStore'
import CreateForm from '../../inventory/desktop/CreateForm.vue';
import EditForm from '../../inventory/desktop/EditForm.vue';
import LocationDeleteDialog from '../LocationDeleteDialog.vue';

  const store = inventoryStore();

  const props = defineProps({
      user: {type: String, required: true},
      search: {type: String, required: true}
  })

  const deleteDialog = ref(false);
  const locationDeleteDialog = ref(false);
  const locationToDelete = ref<{ id: number; name: string } | null>(null);
  const editDialog = ref(false);
  const typePassed = ref('');
  const itemPassed: Ref<number | undefined> = ref();
  const toggle = ref(false);
  // const roomsDeleted: Ref<any[]> = ref([])

const deleteThing = (id: number, type: string) => {
  if (type === 'Location') {
    const location = store.locations.find(l => l.value === id);
    if (location) {
      locationToDelete.value = { id, name: location.label };
      locationDeleteDialog.value = true;
    }
  } else {
    itemPassed.value = id;
    typePassed.value = type;
    deleteDialog.value = true;
  }
}

const handleLocationDeleted = async () => {
    // Refresh inventory after location deletion
    await store.loadInventory(props.user);
    locationDeleteDialog.value = false;
    locationToDelete.value = null;
  }

  // const { containers, collections, locations } = storeToRefs(store);

  const addLocationDialog = ref(false);
  const addCollectionDialog = ref(false);
  const addContainerDialog = ref(false);

  var allContainers = computed(() => {
    return store.containers
      .filter(
        i => store.containerValues?.includes(i.value) && 
        (props.search == '' || i.label.toLowerCase().includes(props.search.toLowerCase()))
      )
  })
  
  const containerPics = [
    "https://storage.googleapis.com/take-stock-design-assets/Logos/squirrel_containers.png"
  ]
  const collectionPics = [
    "https://storage.googleapis.com/take-stock-design-assets/Logos/squirrel_collections.png"
  ]

  const locationPics = [
    "https://storage.googleapis.com/take-stock-design-assets/Logos/squirrel_location.png"
  ]

  const editThing = (id: number, type: string) => {
      itemPassed.value = id
      typePassed.value = type
      editDialog.value = true
  }

  const confirmDelete = (id: number, type: string) => {
    if (type == 'Container') {
      store.deleteContainer(id, props.user)
    } else if (type == 'Collection') {
      store.deleteCollection(id, props.user)
    } else if (type == 'Location') {
      store.deleteLocation(id, props.user)
    }
    
  }

  watch(store.containers, (newContainer, oldContainer) => {
    
    console.log('watcher catches: ', newContainer)
    // allContainers.value = newContainer
    //   .filter(
    //     i => store.containerValues?.includes(i.value) && 
    //     (props.search == '' || i.label.toLowerCase().includes(props.search.toLowerCase()))
    //   )
    // store.setActiveContainer(newContainer)
  })

</script>

<template>
  <div class="row">
    <div class="text-h5 text-primary col-3 q-pa-md">
      <q-card flat bordered>
        <q-card-section class="q-pa-none">
          <q-img class="q-pa-none q-ma-none" src="https://storage.googleapis.com/take-stock-design-assets/Logos/squirrel_collections.png">
            <div class="absolute-full">
              <div class="text-weight-bold text-white" style="padding: 10px;">Collections</div>
              <div class="text-caption text-weight-normal text-white" style="padding: 10px;">Organize, update, delete all your collections</div>
            </div>
          </q-img>
          <q-card-actions horizontal class="justify-around q-px-md">
            <q-btn class="q-pa-none" label="start a new collection" flat size="md" icon="add" @click="addCollectionDialog = true" />
          </q-card-actions>
        </q-card-section>
      </q-card>

    </div>

    <div class="col-9 q-pa-md">
      <div class="row q-col-gutter-md" >
        <div class="col-4" v-for="obj in store.collections.filter(i => store.collectionValues?.includes(i.value) && (props.search == '' || i.label.toLowerCase().includes(props.search.toLowerCase())))" :key="obj.value">
          <q-card style="height: 100%; width: 100%;" flat bordered>
            <q-card-section horizontal>
              <div>
                  <div class="text-body2 text-weight-bold text-primary" style="padding: 10px;">{{ obj.label }}</div>
                  <div class="text-subtitle text-weight-normal text-dark" style="padding: 10px;">{{ obj.description }}</div>
                  <q-space />
                  <div class="text-caption text-weight-light text-dark" style="padding-left: 12px;">{{ store.containers.filter(i => i.collection == obj.value).length }} total container(s) in collection</div>
                  <div class="text-caption text-weight-light text-dark" style="padding-left: 12px;">{{ store.items.filter(i => i.collection == obj.value).length }} total item(s) in collection</div>
                </div>
              <q-space />
              <q-card-actions vertical class="justify-around q-px-md">
                <q-btn flat color="primary" icon="edit" @click="editThing(obj.value, 'Collection')" />
                <q-space />
                <q-btn flat color="red" icon="delete" @click="deleteThing(obj.value, 'Collection')" />
              </q-card-actions>
            </q-card-section>
          </q-card>
        </div>
      </div>
    </div>
  </div>

  <q-separator />
  <div class="row">
    <div class="text-h5 text-primary col-3 q-pa-md">
      <q-card flat bordered>
        <q-card-section class="q-pa-none">
          <q-img class="q-pa-none q-ma-none" src="https://storage.googleapis.com/take-stock-design-assets/Logos/squirrel_containers.png">
            <div class="absolute-full">
              <div class="text-weight-bold text-white" style="padding: 10px;">Containers</div>
              <div class="text-caption text-weight-normal text-white" style="padding: 10px;">Add more containers to organize your items</div>
            </div>
          </q-img>
          <q-card-actions horizontal class="justify-around q-px-md">
            <q-btn class="q-pa-none" label="add a new container" flat size="md" icon="add" @click="addContainerDialog = true" />
          </q-card-actions>
        </q-card-section>
      </q-card>

    </div>

    <div class="col-9 q-pa-md">
      <div class="row q-col-gutter-md" >
        <div class="col-4" v-for="obj in allContainers" :key="obj.value">
          <q-card style="height: 100%; width: 100%;" flat bordered>
            <q-card-section horizontal>
              <div>
                  <div class="text-body2 text-weight-bold text-primary" style="padding: 10px;">{{ obj.label }}</div>
                  <div class="text-subtitle text-weight-normal text-dark" style="padding: 10px;">In collection: {{ store.collections.find(i => i.value == obj.collection).label }}</div>
                  <q-space />
                  <div v-if="(obj.location != null)" class="text-caption text-weight-light text-dark" style="padding-left: 12px;">Location: {{ store.locations.find(i => i.value == obj.location)?.label }}</div>
                  <div class="text-caption text-weight-light text-dark" style="padding-left: 12px;">{{ store.items.filter(i => i.container == obj.value).length }} total item(s) in container</div>
                </div>
              <q-space />
              <q-card-actions vertical class="justify-around q-px-md">
                <q-btn flat color="primary" icon="edit" @click="editThing(obj.value, 'Container')" />
                <q-space />
                <q-btn flat color="red" icon="delete" @click="deleteThing(obj.value, 'Container')" />
              </q-card-actions>
            </q-card-section>
          </q-card>
        </div>
      </div>
    </div>
  </div>

  <q-separator  />
  <div class="row">
    <div class="text-h5 text-primary col-3 q-pa-md">
      <q-card flat bordered>
        <q-card-section class="q-pa-none">
          <q-img class="q-pa-none q-ma-none" src="https://storage.googleapis.com/take-stock-design-assets/Logos/squirrel_location.png">
            <div class="absolute-full">
              <div class="text-weight-bold text-white" style="padding: 10px;">Locations</div>
              <div class="text-caption text-weight-normal text-white" style="padding: 10px;">Add locations to keep track</div>
            </div>
          </q-img>
          <q-card-actions horizontal class="justify-around q-px-md">
            <q-btn class="q-pa-none" label="add a new location" flat size="md" icon="add" @click="addLocationDialog = true" />
          </q-card-actions>
        </q-card-section>
      </q-card>

    </div>

    <div class="col-9 q-pa-md">
      <div class="row q-col-gutter-md" >
        <div class="col-4" v-for="obj in store.locations.filter(i => store.locationValues?.includes(i.value) && (props.search == '' || i.label.toLowerCase().includes(props.search.toLowerCase())))" :key="obj.value">
          <q-card style="height: 100%; width: 100%;" flat bordered>
            <q-card-section horizontal>
              <div>
                  <div class="text-body2 text-weight-bold text-primary" style="padding: 10px;">{{ obj.label }}</div>
                  <q-space />
                  
                  <div class="text-caption text-weight-light text-dark" style="padding-left: 12px;">{{ store.items.filter(i => i.location == obj.value).length }} total item(s) in location</div>
                  <div class="text-caption text-weight-light text-dark" style="padding-left: 12px;">{{ store.containers.filter(i => i.location == obj.value).length }} total container(s) in location</div>
                </div>
              <q-space />
              <q-card-actions vertical class="justify-around q-px-md">
                <q-btn flat color="primary" icon="edit" @click="editThing(obj.value, 'Location')" />
                <q-space />
                <q-btn flat color="red" icon="delete" @click="deleteThing(obj.value, 'Location')" />
              </q-card-actions>
            </q-card-section>
          </q-card>
        </div>
      </div>
    </div>
  </div>
  
  <!-- title: 'Delete ' + locationName + '?',
      message: 'Deleting a location will remove all rooms, containers, and items within that room. Consider moving them before deleting.' -->

  <q-dialog
   v-model="deleteDialog" persistent>
      <q-card>
      <q-card-section class="row items-center">
          <q-avatar icon="warning" color="negative" />
          <!-- Dialog popup for collection deletion -->
          <div v-if="typePassed == 'Collection'" class="q-ml-sm q-pa-sm">
            <div>Delete {{ store.collections.find(i => i.value == itemPassed)?.label }}?</div>
            <div class="text-weight-light">Deleting a collection will delete all containers and items within. Consider moving the below items before deleting.</div>
            <div class="row">
              Containers: &nbsp;
              <div v-if ="store.containers.filter(i => i.collection == itemPassed).length == 0" class="text-weight-thin">&nbsp; None </div>
              <div v-else v-for="container in store.containers.filter(i => i.collection == itemPassed)" class="text-weight-thin">&nbsp; {{ container.label }} </div>
            </div>
            
            <div class="row">
              Items: &nbsp;
              <div v-if="store.items.filter(i => i.collection == itemPassed).length == 0" class="text-weight-thin">&nbsp; None </div>
              <div v-else v-for="item in store.items.filter(i => i.collection == itemPassed)" class="text-weight-thin">&nbsp; {{ item.name }} </div>
            </div>
          </div>
          <!-- Dialog popup for container deletion -->
          <div v-if="typePassed == 'Container'" class="q-ml-sm q-pa-sm">
            <div>Delete {{ store.containers.find(i => i.value == itemPassed)?.label }}?</div>
            <div class="text-weight-light">After deleting, all items in this container will remain in the collection and (if applicable), keep the same associated location.</div>
          </div>
          <!-- Dialog popup for location deletion -->
          <div v-if="typePassed == 'Location'" class="q-ml-sm q-pa-sm">
            <div>Delete {{ store.locations.find(i => i.value == Number(itemPassed))?.label }}?</div>
            <div class="text-weight-light">Deleting this location will remove it's association with any containers or items in your inventory.</div>
          </div>

          

          
          
          
          
          

      </q-card-section>

      <q-card-actions align="right">
          <q-btn flat label="Cancel" color="info" v-close-popup />
          <q-btn flat label="Delete" color="negative" v-close-popup :disabled="(itemPassed == undefined)" @click="confirmDelete(itemPassed!, typePassed)" />
      </q-card-actions>
      </q-card>


  </q-dialog>

  <q-dialog v-model="addLocationDialog" persistent>
    <CreateForm :user="props.user!" addType="Location" />
  </q-dialog>

  <q-dialog v-model="addCollectionDialog" persistent>
    <CreateForm :user="props.user!" addType="Collection" />
  </q-dialog>

  <q-dialog v-model="addContainerDialog" persistent>
    <CreateForm :user="props.user!" addType="Container" />
  </q-dialog>

  <q-dialog v-model="editDialog" persistent>
    <EditForm :user="props.user!" :addType="typePassed" :id="itemPassed!" />
  </q-dialog>

  <!-- Location Delete Dialog with Move Handling -->
  <LocationDeleteDialog
    v-if="locationToDelete"
    v-model="locationDeleteDialog"
    :location-id="locationToDelete.id"
    :location-name="locationToDelete.name"
    @deleted="handleLocationDeleted"
  />

  <!-- <q-dialog dark v-model="editRoomDialog" persistent>
    <EditForm :user="props.user!" addType="Room" />
  </q-dialog>

  <q-dialog dark v-model="editContainerDialog" persistent>
    <EditForm :user="props.user!" addType="Container" />
  </q-dialog> -->
</template>

<style scoped>
.my-card {
  background-color: #f5f9e9;
}
.my-img {
  width: 100% !important;
  /* WHY THE FUCK DOES THIS HAVE TO BE HARDCODED? */
  /* top: -400px; */
}
.absolute-full {
  z-index: 2;
}
.parallax-container {
  position: relative;
  /* max-height: 25vh;
  width: 40vh; */
  max-height: 25vh;
   /* Adjust to 'contain' or specific values as needed */
  /* You can also set a fixed size (e.g., width and height) if desired */
  width: 100%;
  /* height: 20vh; */
}

.parallax-container::before {
  content: "";
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background-color: rgba(255, 255, 255, 0.75); /* Adjust the opacity here */
  z-index: 1;
}
.text-weight-thin {
  padding: 1px;
}
/* .text-h5 {
  padding: 10px;
} */
/* .col-3 {
  padding:1%;
  max-height:20%;
} */
/* .col-4 {
  padding:1%;
  max-height:20%;
} */
.example-row-all-breakpoints .row > div {
  padding: 10px 15px;
  background: rgba(153, 153, 153, 0.15);
  border: 1px solid rgba(153, 153, 153, 0.2); 
}

.example-row-all-breakpoints .row + .row {
  margin-top: 1rem; 
}
.absolute-top {
  padding: 10px;
}
</style>
