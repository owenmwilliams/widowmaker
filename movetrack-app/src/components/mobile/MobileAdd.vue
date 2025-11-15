<script setup lang="ts">

//ALL IMPORTS
  import { Ref, onMounted, defineProps, PropType, ref, watch, computed } from 'vue';
  import { inventoryStore } from '../../stores/InventoryStore';
  import { useQuasar } from 'quasar';

  //STORE
  const store = inventoryStore()

  enum ObjectEnum {
    location = 'location',
    collection = 'collection',
    container = 'container',
    item = 'item'
  }

//ALL PROPS & EMITS
  const $q = useQuasar()

  const props = defineProps({
    user: { type: String, required: true },
    editSelect: { type: Boolean, required: true },
    objectType: { type: String as PropType<ObjectEnum>, required: true },
    idProp: { type: Number, required: false },
  })

  const emits = defineEmits<{
    (e: 'app:loading', id: boolean): void
    (e: 'close'): void
  }>()

//ALL CONSTANTS AND VARIABLES

  // These are the user constants that we use for data storage
  const user = ref(props.user)

  // These are constants that are use-inputs from popover to add another item
  // const id = ref('');
  const name = ref('');
  const description = ref('');
  const quantity: Ref<number | undefined> = ref(1);

  const address = ref('');
  const address_2 = ref('');
  const city = ref('');
  const state = ref('');
  const zip = ref('');

    
  // These are constants that populate the drop-down select menu to allow choosing a location and room
  const location: Ref<{label: string, value: number} | undefined> = ref();

  const image_url = ref('');

//ALL FUNCTIONS
  // collectionOptions.value = store.collections.map(i => {return {label: i.label, value: i.value}})

  onMounted(() => {
    emits("app:loading", true)
    try {
        console.log('props.idProp is ' + props.idProp)
        console.log('props.objectType is ' + props.objectType)
        if (props.objectType == ObjectEnum.location) {
          const targetLocation = store.locations.find(i => i.value == props.idProp);
          if (targetLocation) {
            location.value = { label: targetLocation.label, value: targetLocation.value };
          } else {
            location.value = undefined;
          }
          name.value = store.locations.find(i => i.value == props.idProp)?.label ?? ''
          description.value = store.locations.find(i => i.value == props.idProp)?.description ?? ''
          address.value = store.locations.find(i => i.value == props.idProp)?.address ?? ''
          address_2.value = store.locations.find(i => i.value == props.idProp)?.address_2 ?? ''
          city.value = store.locations.find(i => i.value == props.idProp)?.city ?? ''
          state.value = store.locations.find(i => i.value == props.idProp)?.state ?? ''
          zip.value = store.locations.find(i => i.value == props.idProp)?.zip ?? ''

        } else if (props.objectType == ObjectEnum.collection) {
          const collection = store.collections.find(i => i.value == props.idProp);
          name.value = collection?.label ?? ''
          description.value = collection?.description ?? ''

          // Load location for collection
          if (collection && collection.location != null) {
            location.value = {
              label: store.locations.find(i => i.value == collection.location)?.label ?? '',
              value: collection.location
            };
          }

        } else if (props.objectType == ObjectEnum.container) {
          name.value = store.containers.find(i => i.value == props.idProp)?.label ?? ''
          description.value = store.containers.find(i => i.value == props.idProp)?.description ?? ''
          // Note: location is now inherited from collection, so we don't load it here

        } else if (props.objectType == ObjectEnum.item) {
          name.value = store.items.find(i => i.value == props.idProp)?.label ?? ''
          description.value = store.items.find(i => i.value == props.idProp)?.description ?? ''
          quantity.value = store.items.find(i => i.value == props.idProp)?.quantity ?? 1
          image_url.value = store.items.find(i => i.value == props.idProp)?.picture_url ?? undefined
          // Note: location is now inherited from collection, so we don't load it here

          if (!props.editSelect) {
            location.value = undefined
          }

          console.log('location.value is: ', location.value)
          console.log('activeContainer is: ', store.activeContainer)

          // locationOptions.value = store.locations.map(i => {return {label: i.label, value: i.value}})
        }
    } catch (error) {
      console.log(error)
    }
    emits("app:loading", false)
  })
  
  // This function calls post function to add a container to a room and *** SHOULD *** navigate to the room added to
  const onSubmit = async () => {
    if (props.objectType == ObjectEnum.location) {
      if (props.editSelect) {
        store.updateLocation(props.idProp!, user.value, name.value, description.value, address.value, address_2.value, city.value, state.value, zip.value)
      } else {
        store.createLocation(user.value, name.value, description.value, address.value, address_2.value, city.value, state.value, zip.value)
      }
    } else if (props.objectType == ObjectEnum.collection) {
      if (props.editSelect) {
        store.updateCollection(props.idProp!, user.value, name.value, description.value)
      } else {
        console.log('user value in mobile add is: ', user.value)
        if (!location.value?.value) {
          $q.notify({
            type: 'warning',
            message: 'Please select a location for this collection',
            position: 'bottom'
          });
          return;
        }
        store.createCollection(user.value, name.value, description.value, location.value.value)
      }
    } else if (props.objectType == ObjectEnum.container) {
      if (props.editSelect) {
        store.updateContainer(props.idProp!, user.value, name.value, store.activeCollection!.value)
      } else {
        store.createContainer(user.value, name.value, store.activeCollection!.value)
      }
    } else if (props.objectType == ObjectEnum.item) {
      if (props.editSelect) {
        store.updateItem(props.idProp!, user.value, name.value, description.value, quantity.value ?? 1, store.activeCollection!.value, store.activeContainer?.value, image_url.value)
      } else {
        store.createItem(user.value, name.value, description.value, quantity.value ?? 1, store.activeCollection!.value, store.activeContainer?.value)
      }
    }

    name.value = ''
    description.value = ''
    quantity.value = 1
    address.value = ''
    address_2.value = ''
    city.value = ''
    state.value = ''
    zip.value = ''
    location.value = undefined
    image_url.value = ''


    // store.activeCollection = collection.value?.value ?? 0
    // store.activeContainer = container.value?.value ?? 0

    emits('close')
  }

  // This function pops up an alert dialog for deleting an item
  const onDelete = async (id: number, name: string) => {
    
    const message = ref('')

      if (props.objectType == ObjectEnum.location) {
        message.value = 'Deleting a location will remove all rooms, containers, and items within that location. Consider moving them to another location before deleting.'
      } else if (props.objectType == ObjectEnum.collection) {
        message.value = 'Deleting a collection will remove all containers and items within that collection. Consider moving them to another collection before deleting.'
      } else if (props.objectType == ObjectEnum.container) {
        message.value = 'Deleting a container will remove all items within that container. Consider moving them to another container before deleting.'
      } else if (props.objectType == ObjectEnum.item) {
        message.value = 'Deleting an item will remove that item from your inventory.'
      }
    
      $q.dialog({
        title: 'Delete ' + name + '?',
        message: message.value,
        cancel: true,
        persistent: true
      }).onOk(async () => {
        if (props.objectType == ObjectEnum.location) {
          store.deleteLocation(id, user.value)
        } else if (props.objectType == ObjectEnum.collection) {
          store.deleteCollection(id, user.value)
        } else if (props.objectType == ObjectEnum.container) {
          store.deleteContainer(id, user.value)
        } else if (props.objectType == ObjectEnum.item) {
          if (image_url.value && image_url.value.includes('take-stock')) {
            console.log('deleting owned image')
            store.deleteItem(id, user.value)
          } else {
            console.log('deleting unowned image')
            store.deleteItem(id, user.value, false)
          }
        }
      }).onCancel(() => {
        // on cancel
      }).onDismiss(() => {
        emits('close')
      })
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

</script>

<template>

  <div>
    <q-card style="width: 80vw;">
      <q-card-section>
        <q-img
          v-if="props.objectType == ObjectEnum.item && image_url != undefined"
          :src = image_url />

        <q-input
          v-model="name"
          filled
          label="Name"
          type="text"
          @input="" />

        <q-input
          v-if="props.objectType == ObjectEnum.item"
          v-model="quantity"
          filled
          label="Quantity"
          type="number"
          @input="" />

        <q-input
          v-if="(props.objectType == ObjectEnum.item || props.objectType == ObjectEnum.collection)"
          v-model="description"
          filled
          label="Description"
          type="textarea"
          @input="" />

        <q-input
          v-if="props.objectType == ObjectEnum.location"
          v-model="address"
          filled
          label="Address"
          type="text"
          @input="" />

        <q-input
          v-if="props.objectType == ObjectEnum.location"
          v-model="address_2"
          filled
          label="Floor / Unit #"
          type="text"
          @input="" />

        <div class="row">
          <div class="col-6">
            <q-input
              v-if="props.objectType == ObjectEnum.location"
              v-model="city"
              filled
              label="City"
              type="text"
              @input="" />
          </div>
          <div class="col-3">
            <q-input
              v-if="props.objectType == ObjectEnum.location"
              v-model="state"
              filled
              label="State"
              type="text"
              @input="" />
          </div>
          <div class="col-3">
            <q-input
              v-if="props.objectType == ObjectEnum.location"
              v-model="zip"
              filled
              label="Zip"
              type="text"
              @input="" />
          </div>
        </div>

        <q-select
          v-if="props.objectType == ObjectEnum.item || props.objectType == ObjectEnum.container"
          v-model="store.activeCollection"
          :options="store.collections.map(i => {return {label: i.label, value: i.value}})"
          label="Collection"
          filled
        />

        <q-select
          v-if="props.objectType == ObjectEnum.item && store.containers.filter(i => i.collection == store.activeCollection?.value).length > 0"
          v-model="store.activeContainer"
          :options="store.containers.filter(i => i.collection == store.activeCollection?.value).map(i => {return {label: i.label, value: i.value}})"
          label="Container"
          filled
          clearable
        />

        <!-- Location selector: Required for Collections, not shown for Items/Containers (they inherit from collection) -->
        <q-select
          v-if="props.objectType == ObjectEnum.collection && store.locations.length > 0"
          v-model="location"
          :options="store.locations.map(i => {return {label: i.label, value: i.value}})"
          label="Location *"
          filled
        />
        
      </q-card-section>
      
      <q-card-actions align="right">
        <q-btn label="Delete" color="negative" @click="onDelete(props.idProp!, name)" v-if="props.editSelect" />
        <q-space />
        <q-btn flat label="Cancel" color="info" text-color="black" v-close-popup />
        <q-btn flat label="OK" color="primary" @click="onSubmit" />
      </q-card-actions>
    </q-card>
  </div>
</template>

<style scoped>

</style>
