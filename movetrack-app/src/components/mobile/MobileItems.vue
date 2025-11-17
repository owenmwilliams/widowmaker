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

  const containerItemLists = ref<Record<number, StoreInventoryItem[]>>({})
  const unassignedItems = ref<StoreInventoryItem[]>([])
  const isPersistingMove = ref(false)
  // Track which containers are open locally (survives store reloads)
  const openContainerIds = ref<Set<number>>(new Set())
  
  // Filter states
  const filterFragile = ref(false)
  const filterPriority = ref<string | null>(null)

  const rebuildDragLists = () => {
    const map: Record<number, StoreInventoryItem[]> = {}
    const currentCollectionId = activeCollection.value?.value

    if (!currentCollectionId) {
      containerItemLists.value = map
      unassignedItems.value = []
      return
    }

    // Filter function for items
    const shouldIncludeItem = (item: any) => {
      if (filterFragile.value && !item.fragile) return false
      if (filterPriority.value && item.priority?.toLowerCase() !== filterPriority.value.toLowerCase()) return false
      return true
    }

    store.containers
      .filter((container) => container.collection === currentCollectionId)
      .forEach((container) => {
        map[container.value] = store.items.filter(
          (item) => item.collection === currentCollectionId && item.container === container.value && shouldIncludeItem(item)
        ) as StoreInventoryItem[]
      })

    containerItemLists.value = map

    unassignedItems.value = store.items.filter(
      (item) => item.collection === currentCollectionId && (item.container === null || item.container === undefined) && shouldIncludeItem(item)
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
  watch([() => store.items, activeCollection, filterFragile, filterPriority], () => {
    rebuildDragLists()
  }, { deep: true, immediate: true })

  const shouldRevealHeader = computed(() => !showPhotoCapture.value);
  const shouldRevealFooter = computed(() => !showPhotoCapture.value);

  // Compute total items count for sparse inventory detection
  const totalItemsCount = computed(() => {
    if (!activeCollection.value) return 0;
    return store.items.filter(i => i.collection === activeCollection.value?.value).length;
  });

  // Show enhanced CTA when inventory is sparse (< 4 items)
  const showEnhancedCTA = computed(() => totalItemsCount.value < 4);

  // Trim username for breadcrumb display
  const trimmedUsername = computed(() => {
    const username = props.user || '';
    return username.length > 15 ? username.substring(0, 15) + '...' : username;
  });

  // Removed computedAddThings and show() function - bottom sheet no longer used


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

  <q-layout view="hHh lpR fFf">

    <q-header v-if="shouldRevealHeader" reveal bordered class="bg-primary text-white">
      <q-toolbar>
        <q-btn dense flat round icon="menu" @click="showLeft = !showLeft" />

        <q-toolbar-title center>
          <q-breadcrumbs active-color="white" style="font-size: 16px">
            <q-breadcrumbs-el v-if="store.activeCollection" :label="store.activeCollection.label" />
          </q-breadcrumbs>
        </q-toolbar-title>

        <ReloPrepLogo :width="30" :height="8" logo-src="https://storage.googleapis.com/widowmaker-site-images/reloprep_color.png" style="margin-left: 8px;" />
      </q-toolbar>
    </q-header>

    <q-drawer  v-model="showLeft" style="background-color: #f5f9e9;" side="left" overlay behavior="mobile" elevated>
      <q-list  padding class="rounded-borders text-primary">
        <!-- Collections Section -->
        <q-item-label header>Collections</q-item-label>
        <q-item
          v-for="(collection, index) in store.collections"
          clickable
          v-ripple
          :active="(index == collectionIndex)"
          @click="changeCollection(index)"
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

    <q-page-container>

      <!-- Filter chips -->
      <div class="q-px-md q-pt-md q-pb-sm">
        <div class="text-caption text-grey-7 q-mb-xs">Filter Items:</div>
        <div class="row q-gutter-sm">
          <q-chip
            :outline="!filterFragile"
            :color="filterFragile ? 'red' : 'grey-4'"
            :text-color="filterFragile ? 'white' : 'grey-8'"
            clickable
            @click="filterFragile = !filterFragile"
          >
            <q-icon name="warning" size="xs" class="q-mr-xs" />
            Fragile
          </q-chip>
          
          <q-chip
            :outline="filterPriority !== 'high'"
            :color="filterPriority === 'high' ? 'red-7' : 'grey-4'"
            :text-color="filterPriority === 'high' ? 'white' : 'grey-8'"
            clickable
            @click="filterPriority = filterPriority === 'high' ? null : 'high'"
          >
            High Priority
          </q-chip>
          
          <q-chip
            :outline="filterPriority !== 'medium'"
            :color="filterPriority === 'medium' ? 'orange-7' : 'grey-4'"
            :text-color="filterPriority === 'medium' ? 'white' : 'grey-8'"
            clickable
            @click="filterPriority = filterPriority === 'medium' ? null : 'medium'"
          >
            Medium Priority
          </q-chip>
          
          <q-chip
            :outline="filterPriority !== 'low'"
            :color="filterPriority === 'low' ? 'green-7' : 'grey-4'"
            :text-color="filterPriority === 'low' ? 'white' : 'grey-8'"
            clickable
            @click="filterPriority = filterPriority === 'low' ? null : 'low'"
          >
            Low Priority
          </q-chip>
          
          <q-chip
            v-if="filterFragile || filterPriority"
            outline
            color="grey-6"
            text-color="grey-8"
            clickable
            @click="filterFragile = false; filterPriority = null"
          >
            <q-icon name="clear" size="xs" class="q-mr-xs" />
            Clear All
          </q-chip>
        </div>
      </div>

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
                />
              </template>
            </draggable>
          </div>
        </q-list>
      </div>
      
    </q-page-container>

    <!-- Enhanced CTA Bottom Sheet (when inventory is sparse) -->
    <q-page-sticky v-if="shouldRevealFooter && showEnhancedCTA" position="bottom" :offset="[0, 0]">
      <div class="enhanced-cta-sheet">
        <div class="cta-gradient-top"></div>
        <div class="cta-content">
          <div class="cta-header">
            <h3 class="cta-title">Start Adding Items</h3>
            <p class="cta-subtitle">Build your moving inventory with AI-powered photo capture</p>
          </div>

          <div class="cta-actions">
            <q-btn
              unelevated
              size="lg"
              color="primary"
              icon="add_a_photo"
              label="Take Photo"
              class="cta-primary-btn"
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
        fab
        icon="add_a_photo"
        color="primary"
        size="lg"
        class="fab-button"
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
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  transition: transform 0.2s ease;
}

.fab-button:hover {
  transform: scale(1.1);
}

.fab-button:active {
  transform: scale(0.95);
}

/* Enhanced CTA Bottom Sheet for Sparse Inventory */
.enhanced-cta-sheet {
  width: 100vw;
  background: linear-gradient(to top, #ffffff 85%, rgba(255, 255, 255, 0.95) 95%, transparent);
  border-radius: 24px 24px 0 0;
  box-shadow: 0 -4px 20px rgba(0, 0, 0, 0.15);
  animation: slideUpFade 0.6s ease-out;
  position: relative;
  overflow: hidden;
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
  font-weight: 600;
  border-radius: 12px;
  box-shadow: 0 4px 12px rgba(39, 70, 144, 0.3);
  transition: all 0.2s ease;
}

.cta-primary-btn:hover {
  box-shadow: 0 6px 16px rgba(39, 70, 144, 0.4);
  transform: translateY(-2px);
}

.cta-primary-btn:active {
  transform: translateY(0);
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

</style>
