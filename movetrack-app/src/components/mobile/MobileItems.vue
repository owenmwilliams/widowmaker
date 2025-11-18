<script setup lang="ts">

//ALL IMPORTS
  import { Ref, computed, ref, watch } from 'vue';
  import { useRouter } from 'vue-router';
  import FooterVue from '../Footer.vue';
  import { inventoryStore } from '../../stores/InventoryStore';
  import { storeToRefs } from 'pinia';
  import MobileAdd from './MobileAdd.vue';
  import MobileEditSelect from './MobileEditSelect.vue';
  import axios from 'axios';
  import ItemToggleCard from '../ItemToggleCard.vue';
  import PhotoCapture from '../PhotoCapture.vue';
  import ReloPrepLogo from '../ReloPrepLogo.vue';
import MobileSettings from './MobileSettings.vue';
import type { InventoryItem } from '../../data/inventoryItems';
import draggable from 'vuedraggable';
import { useQuasar } from 'quasar';

//ALL PROPS & EMITS
  enum ObjectEnum {
    location = 'location',
    collection = 'collection',
    container = 'container',
    item = 'item'
  }

  const props = defineProps({
    user: {type: String, required: true},
  })

  const emits = defineEmits<{
    (e: 'app:loading', id: boolean): void
  }>()

  type StoreInventoryItem = {
    value: number
    label: string
    description: string | null
    quantity: number
    collection: number
    container?: number | null
    location?: number | null
    picture_url?: string | null
  }

//ALL CONSTANTS AND VARIABLES
  const isAdd = ref(false)

const core_url = import.meta.env.MODE == 'development'
  ? 'http://localhost:3050'
  : 'https://movetrack-api-7hwn7ggbiq-uc.a.run.app'

const store = inventoryStore()
const $q = useQuasar()

  const showAdd = ref(false);
  const collectionIndex = ref(0)
  const { activeContainer, activeCollection } = storeToRefs(store)
  const showLeft = ref(false)
  const showEdit = ref(false)
  const activeId: Ref<number | undefined> = ref(undefined)
  const activeObjectType = ref(ObjectEnum.item)
  const activeEditBool = ref(false)
  const showPhotoCapture = ref(false)
  const showSettings = ref(false)
  const currentVisionProvider = ref<string>('gemini')
  const cameraInput = ref<HTMLInputElement | null>(null)

  const containerItemLists = ref<Record<number, StoreInventoryItem[]>>({})
  const unassignedItems = ref<StoreInventoryItem[]>([])
  const isPersistingMove = ref(false)
  // Track which containers are open locally (survives store reloads)
  const openContainerIds = ref<Set<number>>(new Set())

  const selectedLocationId = ref<number | null>(null)
  const quickPhotoItemId = ref<number | null>(null)
  const quickPhotoUploading = ref(false)

  const rebuildDragLists = () => {
    const map: Record<number, StoreInventoryItem[]> = {}
    const currentCollectionId = activeCollection.value?.value

    if (!currentCollectionId) {
      containerItemLists.value = map
      unassignedItems.value = []
      return
    }

    store.containers
      .filter((container) => container.collection === currentCollectionId)
      .forEach((container) => {
        map[container.value] = store.items.filter(
          (item) => item.collection === currentCollectionId && item.container === container.value
        ) as StoreInventoryItem[]
      })

    containerItemLists.value = map

    unassignedItems.value = store.items.filter(
      (item) => item.collection === currentCollectionId && (item.container === null || item.container === undefined)
    ) as StoreInventoryItem[]

    console.log('🔍 Rebuild drag lists:', {
      currentCollectionId,
      totalStoreItems: store.items.length,
      containerItemLists: containerItemLists.value,
      unassignedItems: unassignedItems.value.length,
      containersInCollection: store.containers.filter((c) => c.collection === currentCollectionId).length
    })
  }

  // Watch items and collection changes, but NOT container changes (to preserve open/closed state)
  watch([() => store.items, activeCollection], () => {
    rebuildDragLists()
  }, { deep: true, immediate: true })

  const shouldRevealHeader = computed(() => !showPhotoCapture.value);
  const shouldRevealFooter = computed(() => !showPhotoCapture.value);

  // Compute total items count for sparse inventory detection
  const totalItemsCount = computed(() => {
    if (!activeCollection.value) return 0;
    return store.items.filter(i => i.collection === activeCollection.value?.value).length;
  });

  const hasItemsOrContainers = computed(() => {
    if (activeCollection.value) {
      const cid = activeCollection.value.value;
      return store.items.some(i => i.collection === cid) || store.containers.some(c => c.collection === cid);
    }
    return store.items.length > 0 || store.containers.length > 0;
  });

  // Show enhanced CTA when inventory is sparse (< 4 items)
  const showEnhancedCTA = computed(() => totalItemsCount.value < 4);

  // Trim username for breadcrumb display
  const trimmedUsername = computed(() => {
    const username = props.user || '';
    return username.length > 15 ? username.substring(0, 15) + '...' : username;
  });

  // Filter collections by selected location
  const filteredCollections = computed(() => {
    if (!selectedLocationId.value) {
      return store.collections;
    }
    return store.collections.filter(c => c.location === selectedLocationId.value);
  });

  // Handler for quick photo capture
  const handleQuickPhoto = (itemId: number) => {
    quickPhotoItemId.value = itemId;
    // Trigger native camera capture (no AI flow)
    if (cameraInput.value) {
      cameraInput.value.value = '';
      cameraInput.value.click();
    }
  };

const handleCameraCapture = async (event: Event) => {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file || !quickPhotoItemId.value) return;

  const item = store.items.find(i => i.value === quickPhotoItemId.value);
  if (!item) return;

  try {
    quickPhotoUploading.value = true;
    $q.loading.show({ message: 'Uploading photo...' });
    await store.updateItem(
      item.value,
      props.user,
      item.label,
      item.description || '',
        item.quantity ?? 1,
        item.collection,
      item.container ?? undefined,
      undefined,
      undefined,
      { newImage: file }
    );
    $q.notify({ type: 'positive', message: 'Photo added' });
  } catch (error: any) {
    $q.notify({ type: 'negative', message: 'Upload failed', caption: error?.message || 'Please try again' });
  } finally {
    quickPhotoItemId.value = null;
    if (cameraInput.value) cameraInput.value.value = '';
    quickPhotoUploading.value = false;
    $q.loading.hide();
  }
};


  const onSelectThing = (item: string) => {
    // Debugging console logs
    if (item == 'item') {
      activeObjectType.value = ObjectEnum.item
      activeEditBool.value = false
      isAdd.value = !isAdd.value
    } else if (item == 'container') {
      activeObjectType.value = ObjectEnum.container
      activeEditBool.value = false
      isAdd.value = !isAdd.value
    } else if (item == 'collection') {
      activeObjectType.value = ObjectEnum.collection
      activeEditBool.value = false
      isAdd.value = !isAdd.value
    } else if (item == 'location') {
      activeObjectType.value = ObjectEnum.location
      activeEditBool.value = false
      isAdd.value = !isAdd.value
    };
    showAdd.value = false;
  }

  const openItemDetails = (id: number) => {
    store.openItemDetailsModal(id, props.user);
  }

  const onEditItem = (id: number) => {
    openItemDetails(id)
  }

  const onEditContainer = (id: number) => {
    activeId.value = id
    activeObjectType.value = ObjectEnum.container
    activeEditBool.value = true
    isAdd.value = !isAdd.value
  }

  const onEditLocation = (id: number) => {
    activeId.value = id
    activeObjectType.value = ObjectEnum.location
    activeEditBool.value = true
    isAdd.value = !isAdd.value
  }

  // These are the user constants that we use for data storage
  // const user = ref('')
  const router = useRouter();

//ALL FUNCTIONS

  // This function allows the user to log-out
  function logoutFunction () {
    // Clear session token and user data from localStorage
    localStorage.removeItem('session_token');
    localStorage.removeItem('user_data');

    // Redirect to home page
    router.push('/');
  }

  // Handle photo item added
  const handlePhotoItemAdded = (item: InventoryItem) => {
    // Add item to inventory store
    // Note: You may need to call a store action here to persist the item
    console.log('Photo item added:', item);
    showPhotoCapture.value = false;
  }

  // Handle vision provider changed
  const handleProviderChanged = (provider: string) => {
    currentVisionProvider.value = provider;
  }

  console.log('props user is: ' + props.user)

  // Calculate container capacity info
  const getContainerCapacity = (containerId: number) => {
    const container = store.containers.find(c => c.value === containerId)
    if (!container) return null

    const items = containerItemLists.value[containerId] || []
    const totalWeight = items.reduce((sum, item: any) => sum + (item.weight_lbs || 0), 0)
    
    return {
      itemCount: items.length,
      currentWeight: totalWeight,
      capacityWeight: container.max_weight_lbs ?? container.capacity_weight,
      capacityVolume: container.max_volume_cuft ?? container.capacity_volume,
      currentVolume: container.current_volume
    }
  }

  // Format container caption with capacity info
  const getContainerCaption = (containerId: number) => {
    const capacity = getContainerCapacity(containerId)
    if (!capacity) return '0 item(s)'
    
    let caption = `${capacity.itemCount} item(s)`
    
    if (capacity.capacityWeight && capacity.currentWeight > 0) {
      const weightPercent = Math.round((capacity.currentWeight / capacity.capacityWeight) * 100)
      caption += ` • ${capacity.currentWeight}/${capacity.capacityWeight} lbs (${weightPercent}%)`
    }
    
    return caption
  }

  // Get color for capacity progress bar
  const getCapacityColor = (current: number | undefined, max: number | undefined) => {
    if (!current || !max) return 'grey'
    const percent = (current / max) * 100
    if (percent >= 90) return 'red'
    if (percent >= 70) return 'orange'
    return 'green'
  }


  const changeCollection = (index) => {
    activeContainer.value = undefined
    store.setActiveCollection({label: store.collections[index].label, value: store.collections[index].value})
    showLeft.value = false
  }

  watch(activeCollection, (newCollection, oldCollection) => {
    collectionIndex.value = store.collections.findIndex(i => i.value == newCollection?.value)
  });

  watch(() => props.user, (newUser, oldUser) => {
    store.loadInventory(props.user)
  });

  // const consoleLog = () => {
  //   console.log('log here to debug')
  // }

  function pushSelected(arg: any) {
    console.log('push selected arg is: ', arg)
    if (arg[0] == ObjectEnum.location) {
      onEditLocation(arg[1])
    } else if (arg[0] == ObjectEnum.container) {
      onEditContainer(arg[1])
    }
  }

  function closeAddDialog() {
    store.activeContainer = store.activeContainer
    console.log('close add dialog active container is: ', store.activeContainer)
    activeId.value = undefined
    isAdd.value = false
  }

  function closeEditDialog() {
    activeId.value = undefined
    isAdd.value = false
    showEdit.value = false

  }

  async function persistItemMove(itemId: number, targetContainerId: number | null) {
    const storeItem = store.items.find((i) => i.value === itemId)
    if (!storeItem) {
      return
    }

    const normalizedTarget = targetContainerId ?? null
    const normalizedCurrent = storeItem.container ?? null

    if (normalizedTarget === normalizedCurrent) {
      return
    }

    const headers: Record<string, string> = {}
    const sessionToken = localStorage.getItem('session_token')
    if (sessionToken) {
      headers.Authorization = 'Bearer ' + sessionToken
    }

    try {
      isPersistingMove.value = true

      await axios({
        method: 'put',
        url: core_url + '/items/update',
        params: {
          item_id: storeItem.value,
          user: props.user,
          name: storeItem.label,
          description: storeItem.description,
          quantity: storeItem.quantity,
          collection: storeItem.collection,
          container: normalizedTarget,
          location: storeItem.location,
          picture_url: storeItem.picture_url
        },
        headers
      })

      storeItem.container = normalizedTarget
      
      // Don't reload inventory - just update the item in place
      // This preserves container open/closed state
      rebuildDragLists()
    } catch (error) {
      console.error('Failed to move item to container', error)
    } finally {
      isPersistingMove.value = false
    }
  }

  const handleContainerChange = async (containerId: number, evt: any) => {
    if (evt.added) {
      const movedItem = evt.added.element as StoreInventoryItem
      await persistItemMove(movedItem.value, containerId)
    }
  }

  const handleUnassignedChange = async (evt: any) => {
    if (evt.added) {
      const movedItem = evt.added.element as StoreInventoryItem
      await persistItemMove(movedItem.value, null)
    }
  }

  // Handle drop on collapsed container header
  const handleCollapsedContainerDrop = async (containerId: number, evt: any) => {
    if (evt.added) {
      const movedItem = evt.added.element as StoreInventoryItem
      
      // Open the container after drop (add to local state)
      openContainerIds.value.add(containerId)
      
      await persistItemMove(movedItem.value, containerId)
    }
  }

  // Helper to check if container is open
  const isContainerOpen = (containerId: number) => {
    return openContainerIds.value.has(containerId)
  }

  // Handle container opened by user click
  const handleContainerShow = (containerId: number) => {
    openContainerIds.value.add(containerId)
    store.activeContainer = store.containers.find(c => c.value === containerId)
  }

  // Handle container closed by user click
  const handleContainerHide = (containerId: number) => {
    openContainerIds.value.delete(containerId)
    if (store.activeContainer?.value === containerId) {
      store.activeContainer = undefined
    }
  }

</script>

<template>
  <q-dialog v-model="showEdit">
    <q-card dense >
      <MobileEditSelect @selected="pushSelected" @close="closeEditDialog" :collection_id="Number(store.activeCollection?.value)" />
    </q-card>
  </q-dialog>

  <q-dialog v-model="isAdd">
    <MobileAdd :user="user" :edit-select="activeEditBool" :object-type="activeObjectType" :id-prop="Number(activeId)" @close="closeAddDialog" />
    <!-- <testSelect  /> -->
  </q-dialog>

  <!-- Photo Capture Dialog -->
  <q-dialog v-model="showPhotoCapture" maximized>
    <q-card>
      <q-card-section class="q-pa-none">
        <PhotoCapture
          :vision-provider="currentVisionProvider"
          :user="props.user"
          @item-added="handlePhotoItemAdded"
          @close="showPhotoCapture = false"
        />
      </q-card-section>
    </q-card>
  </q-dialog>

  <!-- Settings Dialog -->
  <q-dialog v-model="showSettings" maximized>
    <MobileSettings 
      :user="props.user"
      @close="showSettings = false"
      @add-collection="onSelectThing('collection'); showSettings = false"
      @add-location="onSelectThing('location'); showSettings = false"
    />
  </q-dialog>

  <q-layout view="hHh lpR fFf" class="mobile-layout">
    <input
      ref="cameraInput"
      type="file"
      accept="image/*"
      capture="environment"
      class="hidden-file-input"
      @change="handleCameraCapture"
    />

    <q-header v-if="shouldRevealHeader" reveal bordered class="frosted-header text-white">
      <q-toolbar>
        <q-btn dense flat round icon="menu" @click="showLeft = !showLeft" />

        <q-toolbar-title center>
          <q-breadcrumbs active-color="white" style="font-size: 16px">
            <q-breadcrumbs-el v-if="store.activeCollection" :label="store.activeCollection.label" />
          </q-breadcrumbs>
        </q-toolbar-title>

        <ReloPrepLogo :width="30" logo-src="https://storage.googleapis.com/widowmaker-site-images/verimove_app_logo_white.png" style="margin-left: 8px;" />
      </q-toolbar>
    </q-header>

    <q-drawer  v-model="showLeft" style="background-color: #f5f9e9;" side="left" overlay behavior="mobile" elevated>
      <q-list  padding class="rounded-borders text-primary">
        <!-- Location Filter Section -->
        <q-item-label header>Location</q-item-label>
        <q-item>
          <q-item-section>
            <q-select
              v-model="selectedLocationId"
              :options="[{ label: 'All Locations', value: null }, ...store.locations.map(l => ({ label: l.label, value: l.value }))]"
              option-label="label"
              option-value="value"
              emit-value
              map-options
              dense
              outlined
              label="Filter by location"
            />
          </q-item-section>
        </q-item>

        <q-separator class="q-my-md" />

        <!-- Collections Section -->
        <q-item-label header>Collections</q-item-label>
        <q-item
          v-for="(collection, index) in filteredCollections"
          :key="collection.value"
          clickable
          v-ripple
          :active="(activeCollection?.value == collection.value)"
          @click="changeCollection(store.collections.findIndex(c => c.value === collection.value))"
          active-class="bg-primary text-white"
        >
          <q-item-section>{{ collection.label }}</q-item-section>
        </q-item>

        <q-separator class="q-my-md" />

        <!-- Actions Section -->
        <q-item-label header>Actions</q-item-label>

        <q-item clickable v-ripple @click="onSelectThing('item')">
          <q-item-section>Add Item (Manual)</q-item-section>
        </q-item>

        <q-item clickable v-ripple @click="onSelectThing('container')">
          <q-item-section>Add Container</q-item-section>
        </q-item>

        <q-item clickable v-ripple @click="onSelectThing('collection')">
          <q-item-section>Add Collection</q-item-section>
        </q-item>

        <q-separator class="q-my-md" />

        <!-- Settings Section -->
        <q-item-label header>Settings</q-item-label>

        <q-item clickable v-ripple @click="showSettings = true; showLeft = false">
          <q-item-section>Settings</q-item-section>
        </q-item>

        <q-item clickable v-ripple @click="router.push('/privacypolicy')">
          <q-item-section>Privacy Policy</q-item-section>
        </q-item>

        <q-item clickable v-ripple @click="router.push('/terms')">
          <q-item-section>Terms of Service</q-item-section>
        </q-item>

        <q-item clickable v-ripple @click="logoutFunction">
          <q-item-section>Logout</q-item-section>
        </q-item>
      </q-list>
    </q-drawer>

    <q-page-container :class="[{ 'empty-bg': !hasItemsOrContainers }, 'page-container']">

      <!-- Collection card removed - editing collections only available on desktop -->
      <div class="q-pa-md" >
        <q-list class="text-primary text-weight-medium">

          <!-- Expansion item for each container in the collection -->
          <div
            v-for="container in store.containers.filter((i) => i.collection == store.activeCollection?.value)"
            :key="container.value"
            class="container-wrapper"
          >
            <!-- Drop zone for collapsed container (allows dropping when closed) -->
            <draggable
              v-if="!isContainerOpen(container.value)"
              :list="[]"
              :group="{ name: 'items', pull: false, put: true }"
              item-key="value"
              class="collapsed-container-drop-zone"
              :disabled="isPersistingMove"
              @change="(evt) => handleCollapsedContainerDrop(container.value, evt)"
            >
              <template #item="{ element }">
                <!-- This slot is required but never renders since list is empty -->
                <div></div>
              </template>
              <template #header>
                <q-expansion-item
                  expand-separator
                  :model-value="isContainerOpen(container.value)"
                  @update:model-value="(val) => val ? handleContainerShow(container.value) : handleContainerHide(container.value)"
                  icon="filter_none"
                  header-class="text-h6 font-weight-medium"
                  :label="container.label"
                  :caption="getContainerCaption(container.value)"
                >
                </q-expansion-item>
              </template>
            </draggable>

            <!-- Expanded container with draggable items -->
            <q-expansion-item
              v-else
              expand-separator
              :model-value="isContainerOpen(container.value)"
              @update:model-value="(val) => val ? handleContainerShow(container.value) : handleContainerHide(container.value)"
              icon="filter_none"
              header-class="text-h6 font-weight-medium"
              :label="container.label"
              :caption="getContainerCaption(container.value)"
            >
              <!-- Capacity progress bar -->
              <div v-if="getContainerCapacity(container.value)?.capacityWeight" class="q-pa-sm">
                <div class="text-caption text-grey-7 q-mb-xs">Weight Capacity</div>
                <q-linear-progress
                  :value="(getContainerCapacity(container.value)?.currentWeight || 0) / (getContainerCapacity(container.value)?.capacityWeight || 1)"
                  :color="getCapacityColor(getContainerCapacity(container.value)?.currentWeight, getContainerCapacity(container.value)?.capacityWeight)"
                  size="md"
                  class="q-mb-xs"
                />
                <div class="text-caption text-grey-7">
                  {{ getContainerCapacity(container.value)?.currentWeight || 0 }} /
                  {{ getContainerCapacity(container.value)?.capacityWeight }} lbs
                </div>
              </div>

              <draggable
                :list="containerItemLists[container.value] ?? []"
                :group="{ name: 'items', pull: true, put: true }"
                item-key="value"
                class="container-drop-zone"
                :disabled="isPersistingMove"
                @change="(evt) => handleContainerChange(container.value, evt)"
              >
                <template #item="{ element }">
                  <ItemToggleCard
                    :id="element.value"
                    :picture_url="element.picture_url"
                    :label="element.label"
                    :description="element.description"
                    :fragile="element.fragile"
                    :priority="element.priority"
                    :weight_lbs="element.weight_lbs"
                    :dimensions="element.dimensions"
                    @edit="onEditItem"
                    @quick-photo="handleQuickPhoto"
                  />
                </template>

                <template #footer>
                  <div v-if="(containerItemLists[container.value]?.length ?? 0) === 0" class="empty-container-hint">
                    Drag items here
                  </div>
                </template>
              </draggable>
            </q-expansion-item>
          </div>

          <div v-if="unassignedItems.length > 0" class="uncontainerized-section">
            <div class="uncontainerized-title">Unassigned items ({{ unassignedItems.length }})</div>
            <draggable
              :list="unassignedItems"
              :group="{ name: 'items', pull: true, put: true }"
              item-key="value"
              class="uncontainerized-items"
              :disabled="isPersistingMove"
              @change="handleUnassignedChange"
            >
              <template #item="{ element }">
                <ItemToggleCard
                  :id="element.value"
                  :picture_url="element.picture_url"
                  :label="element.label"
                  :description="element.description"
                  :fragile="element.fragile"
                  :priority="element.priority"
                  :weight_lbs="element.weight_lbs"
                  :dimensions="element.dimensions"
                  @edit="onEditItem"
                  @quick-photo="handleQuickPhoto"
                />
              </template>
            </draggable>
          </div>
        </q-list>
      </div>

      <!-- Fade spacer to separate content from sticky CTAs on long lists -->
      <div v-if="!showEnhancedCTA" class="footer-fade-spacer"></div>

    </q-page-container>

    <!-- Enhanced CTA Bottom Sheet (when inventory is sparse) -->
    <q-page-sticky v-if="shouldRevealFooter && showEnhancedCTA" position="bottom" :offset="[0, 0]">
      <div class="enhanced-cta-sheet">
        <!-- <div class="cta-gradient-top"></div> -->
        <div class="cta-content">
          <div class="cta-header">
            <h3 class="cta-title">Start Adding Items</h3>
            <p class="cta-subtitle">Build your moving inventory with AI-powered photo capture</p>
          </div>

          <div class="cta-actions">
            <q-btn
              unelevated
              size="lg"
              icon="add_a_photo"
              label="Take Photo"
              class="fab-button fab-pill"
              :disable="store.collections.length == 0"
              @click="showPhotoCapture = true"
            />

            <div class="cta-secondary-actions">
              <q-btn
                flat
                dense
                color="primary"
                label="Add Manually"
                :disable="store.collections.length == 0"
                @click="onSelectThing('item')"
              />
              <q-btn
                flat
                dense
                color="primary"
                label="Add Container"
                :disable="store.collections.length == 0"
                @click="onSelectThing('container')"
              />
            </div>
          </div>
        </div>
      </div>
    </q-page-sticky>

    <!-- Regular FAB (when inventory is substantial) -->
    <q-page-sticky v-if="shouldRevealFooter && !showEnhancedCTA" position="bottom" :offset="[0, 16]">
      <q-btn
        unelevated
        icon="add_a_photo"
        label="Add photo"
        class="fab-button fab-pill"
        :disable="store.collections.length == 0"
        @click="showPhotoCapture = true"
      >
        <q-tooltip>Add item with AI</q-tooltip>
      </q-btn>
    </q-page-sticky>

  </q-layout>  
</template>

<style scoped>
.fullscreen-popover {
  width: 100vw;
  height: 100vh;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  padding: 0 !important;
  margin: 0;
}
.imageScreen {
  width: 100vw;
  height: 100vh;
}
.image {
  width: 100vw;
  height: 100vh;
}

/* Content scroll */

 .footer {
  margin: 0;
  left: 0;
  position: relative;
}

/* Floating Action Button for AI Photo */
.fab-button {
  box-shadow: 0 10px 24px rgba(39, 70, 144, 0.28);
  transition: transform 0.2s ease, box-shadow 0.2s ease;
  background: linear-gradient(135deg, #274690, #1CA1C1, #7dd3fc);
  background-size: 240% 240%;
  animation: fabShimmer 2.8s ease-in-out infinite;
  position: relative;
  overflow: hidden;
}

.fab-pill {
  border-radius: 999px;
  padding: 14px 22px;
  font-weight: 800;
  letter-spacing: 0.2px;
  text-transform: none;
  color: white;
  min-width: 160px;
}

.fab-pill :deep(.q-btn__content) {
  gap: 10px;
  font-size: 1rem;
}

.fab-button:hover {
  transform: scale(1.1);
  box-shadow: 0 12px 28px rgba(39, 70, 144, 0.32);
}

.fab-button:active {
  transform: scale(0.95);
  box-shadow: 0 8px 18px rgba(39, 70, 144, 0.25);
}

@keyframes fabShimmer {
  0% { background-position: 0% 50%; }
  50% { background-position: 100% 50%; box-shadow: 0 12px 28px rgba(39, 70, 144, 0.34); }
  100% { background-position: 0% 50%; }
}

.fab-button::after {
  content: '';
  position: absolute;
  inset: -12%;
  background:
    radial-gradient(10px 10px at 20% 30%, rgba(255,255,255,0.45), transparent 60%),
    radial-gradient(6px 6px at 70% 20%, rgba(255,255,255,0.25), transparent 60%),
    radial-gradient(5px 5px at 40% 70%, rgba(255,255,255,0.25), transparent 60%);
  opacity: 0.9;
  pointer-events: none;
  mix-blend-mode: screen;
  animation: sparkleDrift 4s linear infinite;
}

@keyframes sparkleDrift {
  0% { transform: translateY(0); opacity: 0.75; }
  50% { transform: translateY(-6px); opacity: 1; }
  100% { transform: translateY(0); opacity: 0.75; }
}

.hidden-file-input {
  display: none;
}

/* Enhanced CTA Bottom Sheet for Sparse Inventory */
.enhanced-cta-sheet {
  width: 100vw;
  background: linear-gradient(180deg, #93b3f5 0%, #e6edff 100%);
  border-radius: 24px 24px 0 0;
  border: none;
  box-shadow: 0 -12px 30px rgba(0, 0, 0, 0.16);
  animation: slideUpFade 0.6s ease-out;
  position: relative;
  overflow: hidden;
}

.enhanced-cta-sheet::before {
  content: '';
  position: absolute;
  inset: -20%;
  background:
    radial-gradient(12px 12px at 20% 30%, rgba(255,255,255,0.45), transparent 70%),
    radial-gradient(8px 8px at 70% 25%, rgba(255,255,255,0.3), transparent 65%),
    radial-gradient(10px 10px at 40% 75%, rgba(255,255,255,0.3), transparent 65%);
  opacity: 0.8;
  pointer-events: none;
  mix-blend-mode: screen;
  animation: sparkleDrift 5s linear infinite;
}

@keyframes slideUpFade {
  from {
    transform: translateY(20px);
    opacity: 0;
  }
  to {
    transform: translateY(0);
    opacity: 1;
  }
}

.cta-gradient-top {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 4px;
  background: linear-gradient(to right, #274690, #1CA1C1, #274690);
  background-size: 200% 100%;
  animation: shimmer 3s ease-in-out infinite;
}

@keyframes shimmer {
  0%, 100% {
    background-position: 0% 50%;
  }
  50% {
    background-position: 100% 50%;
  }
}

.cta-content {
  padding: 32px 24px 24px;
  position: relative;
}

.cta-header {
  text-align: center;
  margin-bottom: 24px;
}

.cta-title {
  font-size: 1.5rem;
  font-weight: 700;
  color: #274690;
  margin: 0 0 8px 0;
  animation: fadeInDown 0.6s ease-out 0.2s both;
}

@keyframes fadeInDown {
  from {
    opacity: 0;
    transform: translateY(-10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.cta-subtitle {
  font-size: 0.95rem;
  color: #616161;
  margin: 0;
  line-height: 1.4;
  animation: fadeInDown 0.6s ease-out 0.3s both;
}

.cta-actions {
  display: flex;
  flex-direction: column;
  gap: 16px;
  animation: fadeInUp 0.6s ease-out 0.4s both;
}

@keyframes fadeInUp {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.cta-primary-btn {
  width: 100%;
  padding: 16px;
  font-size: 1.1rem;
  font-weight: 700;
  border-radius: 999px;
  box-shadow: 0 18px 40px rgba(39, 70, 144, 0.18), 0 0 0 1px rgba(39, 70, 144, 0.12);
  transition: all 0.2s ease;
  background: linear-gradient(145deg, #ffffff, #f7fbff);
  border: 2px solid rgba(39, 70, 144, 0.16);
  color: #20335d;
  position: relative;
  overflow: hidden;
}

.cta-primary-btn:hover {
  box-shadow: 0 20px 44px rgba(39, 70, 144, 0.22), 0 0 0 1px rgba(39, 70, 144, 0.2);
  transform: translateY(-2px);
}

.cta-primary-btn:active {
  transform: translateY(0);
  box-shadow: 0 8px 18px rgba(39, 70, 144, 0.25);
}

.cta-primary-btn::after {
  content: '';
  position: absolute;
  inset: -10%;
  background:
    radial-gradient(10px 10px at 25% 20%, rgba(255,255,255,0.45), transparent 60%),
    radial-gradient(7px 7px at 70% 30%, rgba(255,255,255,0.3), transparent 60%),
    radial-gradient(6px 6px at 50% 70%, rgba(255,255,255,0.3), transparent 60%);
  opacity: 0.9;
  pointer-events: none;
  mix-blend-mode: screen;
  animation: sparkleDrift 4s linear infinite;
}

.cta-primary-btn :deep(.q-btn__content) {
  color: #20335d;
  font-weight: 800;
  letter-spacing: 0.2px;
}

.cta-primary-btn :deep(.q-icon) {
  color: #20335d;
}

.cta-secondary-actions {
  display: flex;
  gap: 12px;
  justify-content: center;
}

.cta-secondary-actions .q-btn {
  font-size: 0.9rem;
}

/* Drag and drop styles */
.container-drop-zone {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 8px 0;
  min-height: 56px;
  transition: background-color 0.2s ease;
}

.container-drop-zone:hover {
  background-color: rgba(39, 70, 144, 0.05);
}

.collapsed-container-drop-zone {
  width: 100%;
  min-height: 56px;
  transition: all 0.2s ease;
  border-radius: 4px;
}

.collapsed-container-drop-zone:hover {
  background-color: rgba(39, 70, 144, 0.05);
}

/* When dragging over a collapsed container */
.collapsed-container-drop-zone.sortable-drag-over {
  background-color: rgba(39, 70, 144, 0.1);
  border: 2px dashed rgba(39, 70, 144, 0.5);
  box-shadow: 0 2px 8px rgba(39, 70, 144, 0.2);
}

.empty-container-hint {
  width: 100%;
  padding: 16px;
  text-align: center;
  border: 1px dashed rgba(39, 70, 144, 0.3);
  border-radius: 12px;
  color: rgba(39, 70, 144, 0.7);
  background: rgba(39, 70, 144, 0.04);
  font-size: 0.9rem;
}

.sortable-ghost {
  opacity: 0.4;
  background: #f0f0f0;
}

.sortable-drag {
  opacity: 0.8;
}

.uncontainerized-section {
  margin-top: 24px;
}

.uncontainerized-title {
  font-size: 0.95rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: rgba(39, 70, 144, 0.7);
  margin-bottom: 8px;
}

.uncontainerized-items {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.mobile-layout {
  background: radial-gradient(circle at 20% 20%, rgba(39, 70, 144, 0.08), transparent 35%), radial-gradient(circle at 80% 10%, rgba(28, 161, 193, 0.07), transparent 30%), #f7f8fa;
}

.page-container {
  position: relative;
}

.empty-bg {
  background: url('https://storage.googleapis.com/widowmaker-site-images/no_items_graphic.png') center 40% no-repeat;
  background-size: 220px;
  min-height: 100vh;
}

.footer-fade-spacer {
  height: 20vh;
  min-height: 200px;
  background: linear-gradient(to bottom, rgba(255, 255, 255, 0) 0%, rgba(255, 255, 255, 0.5) 100%);
  pointer-events: none;
}

.frosted-header {
  background: rgba(39, 70, 144, 0.86);
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.15);
}

/* Fixed gradient overlay that sits between content and FAB */
.q-page-container::after {
  content: '';
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  height: 18vh;
  min-height: 120px;
  background: linear-gradient(to bottom, rgba(255, 255, 255, 0) 0%, rgba(255, 255, 255, 1) 100%);
  pointer-events: none;
  z-index: 1;
}

/* Ensure FAB is above the gradient overlay */
.q-page-sticky {
  z-index: 2;
}

</style>
