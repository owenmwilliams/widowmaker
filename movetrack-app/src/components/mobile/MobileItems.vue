<script setup lang="ts">
//ALL IMPORTS
import { Ref, computed, ref, watch, onMounted } from "vue";
import { useRoute, useRouter } from "vue-router";
import FooterVue from "../Footer.vue";
import { inventoryStore } from "../../stores/InventoryStore";
import { storeToRefs } from "pinia";
import MobileAdd from "./MobileAdd.vue";
import MobileEditSelect from "./MobileEditSelect.vue";
import axios from "axios";
import ItemToggleCard from "../ItemToggleCard.vue";
import PhotoCapture from "../PhotoCapture.vue";
import ReloPrepLogo from "../ReloPrepLogo.vue";
import MobileNavDrawer from "./MobileNavDrawer.vue";
import MobileSettings from "./MobileSettings.vue";
import type { InventoryItem } from "../../data/inventoryItems";
import draggable from "vuedraggable";
import { useQuasar } from "quasar";

//ALL PROPS & EMITS
enum ObjectEnum {
  location = "location",
  collection = "collection",
  container = "container",
  item = "item",
}

const props = defineProps({
  user: { type: String, required: true },
});

const emits = defineEmits<{
  (e: "app:loading", id: boolean): void;
}>();

type StoreInventoryItem = {
  value: string;
  label: string;
  description: string | null;
  quantity: number;
  collection: string | null;
  container?: string | null;
  location?: string | null;
  picture_url?: string | null;
};

//ALL CONSTANTS AND VARIABLES
const isAdd = ref(false);

const core_url =
  import.meta.env.MODE == "development"
    ? "http://localhost:3050"
    : "https://movetrack-api-7hwn7ggbiq-uc.a.run.app";

const store = inventoryStore();
const router = useRouter();
const route = useRoute();
const $q = useQuasar();

const showAdd = ref(false);
const collectionIndex = ref(0);
const { activeContainer, activeCollection } = storeToRefs(store);
const showLeft = ref(false);
const showEdit = ref(false);
const activeId: Ref<string | undefined> = ref(undefined);
const activeObjectType = ref(ObjectEnum.item);
const activeEditBool = ref(false);
const showPhotoCapture = ref(false);
const autoOpenCamera = ref(false);
const pendingCaptureMode = ref<"single" | "multi" | null>(null);
const currentVisionProvider = ref<string>("gemini");
const cameraInput = ref<HTMLInputElement | null>(null);
const savedMoves = ref<any[]>([]);
const savedMovesLoading = ref(false);
const locationLocks = computed(() => {
  const locks = new Map<string, { moveId: string; moveName: string | null }>();
  savedMoves.value.forEach((move) => {
    if (move?.status === "in_progress") {
      const info = { moveId: String(move.id), moveName: move.name || null };
      if (move.origin_location_id) {
        locks.set(String(move.origin_location_id), info);
      }
      if (move.destination_location_id) {
        locks.set(String(move.destination_location_id), info);
      }
    }
  });
  return locks;
});
const lockedLocationMessage = (locationId: string | number) => {
  const lock = locationLocks.value.get(String(locationId));
  if (!lock) return null;
  return `Move "${lock.moveName || lock.moveId}" currently in progress`;
};

const containerItemLists = ref<Record<string, StoreInventoryItem[]>>({});
const unassignedItems = ref<StoreInventoryItem[]>([]);
const isPersistingMove = ref(false);
// Track which containers are open locally (survives store reloads)
const openContainerIds = ref<Set<string>>(new Set());
const pendingCollectionLocationId = ref<string | null>(null);

const selectedLocationId = ref<string | null>(null);
const quickPhotoItemId = ref<string | null>(null);
const quickPhotoUploading = ref(false);
const getRouteLocationParam = (): string | null => {
  const param = route.params.locationId;
  if (Array.isArray(param)) {
    return param[0] ? String(param[0]) : null;
  }
  return typeof param === "string" && param.length > 0 ? param : null;
};

const openPhotoCapture = (
  mode?: "single" | "multi",
  options?: { autoOpen?: boolean },
) => {
  pendingCaptureMode.value = mode ?? null;
  autoOpenCamera.value = options?.autoOpen ?? false;
  showPhotoCapture.value = true;
};

const maybeLaunchCaptureFromStorage = () => {
  if (typeof window === "undefined") return;
  const stored = localStorage.getItem("launch_capture_mode");
  if (stored === "single" || stored === "multi") {
    const autoLaunch = localStorage.getItem("launch_capture_auto") === "true";
    openPhotoCapture(stored, { autoOpen: autoLaunch });
    localStorage.removeItem("launch_capture_mode");
    localStorage.removeItem("launch_capture_auto");
  }
};

const rebuildDragLists = () => {
  const map: Record<number, StoreInventoryItem[]> = {};
  const currentCollectionId = activeCollection.value?.value;

  if (!currentCollectionId) {
    containerItemLists.value = map;
    unassignedItems.value = [];
    return;
  }

  store.containers
    .filter((container) => container.collection === currentCollectionId)
    .forEach((container) => {
      map[container.value] = store.items.filter(
        (item) =>
          item.collection === currentCollectionId &&
          item.container === container.value,
      ) as StoreInventoryItem[];
    });

  containerItemLists.value = map;

  unassignedItems.value = store.items.filter(
    (item) =>
      item.collection === currentCollectionId &&
      (item.container === null || item.container === undefined),
  ) as StoreInventoryItem[];

  console.log("🔍 Rebuild drag lists:", {
    currentCollectionId,
    totalStoreItems: store.items.length,
    containerItemLists: containerItemLists.value,
    unassignedItems: unassignedItems.value.length,
    containersInCollection: store.containers.filter(
      (c) => c.collection === currentCollectionId,
    ).length,
  });
};

const shouldRevealHeader = computed(() => !showPhotoCapture.value);
const shouldRevealFooter = computed(() => !showPhotoCapture.value);

// Compute total items count for sparse inventory detection
const totalItemsCount = computed(() => {
  if (!activeCollection.value) return 0;
  return store.items.filter(
    (i) => i.collection === activeCollection.value?.value,
  ).length;
});

const hasItemsOrContainers = computed(() => {
  if (activeCollection.value) {
    const cid = activeCollection.value.value;
    return (
      store.items.some((i) => i.collection === cid) ||
      store.containers.some((c) => c.collection === cid)
    );
  }
  return store.items.length > 0 || store.containers.length > 0;
});

// Show enhanced CTA when inventory is sparse (< 4 items)
const showEnhancedCTA = computed(() => totalItemsCount.value < 4);

// Trim username for breadcrumb display
const trimmedUsername = computed(() => {
  const username = props.user || "";
  return username.length > 15 ? username.substring(0, 15) + "..." : username;
});

const collectionsForSelectedLocation = computed(() => {
  if (!selectedLocationId.value) {
    return store.collections;
  }
  return store.collections.filter(
    (c) => c.location === selectedLocationId.value,
  );
});

const shouldShowAddCollectionLanding = computed(() => {
  if (store.locations.length === 0) {
    return false;
  }
  if (selectedLocationId.value) {
    return collectionsForSelectedLocation.value.length === 0;
  }
  return store.collections.length === 0;
});

const addCollectionLandingTitle = computed(() => {
  if (selectedLocationId.value) {
    const loc = store.locations.find(
      (l) => l.value === selectedLocationId.value,
    );
    if (loc?.label) {
      return `Add a Collection in ${loc.label}`;
    }
  }
  return "Add a Collection to Get Started";
});

const addCollectionLandingSubtitle = computed(() => {
  if (selectedLocationId.value) {
    const loc = store.locations.find(
      (l) => l.value === selectedLocationId.value,
    );
    if (loc?.label) {
      return `Create a room for ${loc.label} to organize containers and items.`;
    }
  }
  if (store.locations.length === 0) {
    return "Add a location first to start organizing your move.";
  }
  return "Create your first room to start building your moving inventory.";
});

// Filter collections by selected location
const loadSavedMoves = async () => {
  try {
    savedMovesLoading.value = true;
    const token = localStorage.getItem("session_token");
    if (!token) {
      savedMoves.value = [];
      return;
    }
    const response = await axios.get(`${core_url}/api/saved-moves`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    savedMoves.value = Array.isArray(response.data) ? response.data : [];
  } catch (error) {
    console.error("Failed to load saved moves:", error);
    savedMoves.value = [];
  } finally {
    savedMovesLoading.value = false;
  }
};

const filteredCollections = computed(() => {
  if (!selectedLocationId.value) {
    return store.collections;
  }
  return store.collections.filter(
    (c) => c.location === selectedLocationId.value,
  );
});

const collectionOptions = computed(() =>
  filteredCollections.value.map((collection) => ({
    label: collection.label,
    value: collection.value,
  })),
);

const activeLocation = computed(() => {
  const collection = store.collections.find(
    (c) => c.value === store.activeCollection?.value,
  );
  if (collection?.location) {
    return store.locations.find((loc) => loc.value === collection.location);
  }
  if (selectedLocationId.value) {
    return store.locations.find(
      (loc) => loc.value === selectedLocationId.value,
    );
  }
  return null;
});

const activeLocationTitle = computed(
  () => activeLocation.value?.label || "No Location Selected",
);
const activeLocationSubtitle = computed(() => {
  const loc = activeLocation.value;
  if (!loc) return "";
  const parts = [
    loc.address,
    loc.address_2,
    [loc.city, loc.state].filter(Boolean).join(", "),
    loc.zip,
  ].filter(Boolean);
  return parts.join(" • ");
});

const goToMoveSession = (moveId?: number | string) => {
  const params = moveId ? { moveId: String(moveId) } : {};
  router.push({ name: "mobile-moves", params });
  showLeft.value = false;
};

const startAddCollectionFlow = (preferredLocationId?: string | null) => {
  const normalizedLocation = preferredLocationId
    ? String(preferredLocationId)
    : selectedLocationId.value || store.locations[0]?.value || null;

  pendingCollectionLocationId.value = normalizedLocation ?? null;
  activeId.value = undefined;
  activeObjectType.value = ObjectEnum.collection;
  activeEditBool.value = false;
  isAdd.value = true;
  showAdd.value = false;
};

const updateLocationContext = (normalizedId: string | null) => {
  selectedLocationId.value = normalizedId;
  const availableCollections = normalizedId
    ? store.collections.filter(
        (collection) => collection.location === normalizedId,
      )
    : store.collections;

  if (availableCollections.length > 0) {
    store.setActiveCollection({
      label: availableCollections[0].label,
      value: availableCollections[0].value,
    });
    pendingCollectionLocationId.value = normalizedId;
  } else if (store.collections.length > 0) {
    store.setActiveCollection({
      label: store.collections[0].label,
      value: store.collections[0].value,
    });
    pendingCollectionLocationId.value = normalizedId;
  } else {
    activeCollection.value = undefined;
    pendingCollectionLocationId.value = normalizedId;
  }
};

const syncLocationFromRoute = () => {
  const paramId = getRouteLocationParam();
  const locationIds = store.locations.map((loc) => String(loc.value));

  if (locationIds.length === 0) {
    if (paramId) {
      router.replace({ name: "mobile-locations" });
    }
    updateLocationContext(null);
    return;
  }

  if (paramId && locationIds.includes(paramId)) {
    updateLocationContext(paramId);
    return;
  }

  const fallbackId = locationIds[0];
  if (paramId !== fallbackId) {
    router.replace({
      name: "mobile-locations",
      params: { locationId: fallbackId },
    });
    return;
  }
  updateLocationContext(fallbackId);
};

const applyLocationFilter = (
  locationId: string | number | null,
  closeDrawer = true,
) => {
  const normalizedId = locationId != null ? String(locationId) : null;
  if (normalizedId) {
    router.push({
      name: "mobile-locations",
      params: { locationId: normalizedId },
    });
  } else {
    router.push({ name: "mobile-locations" });
  }

  if (closeDrawer) {
    showLeft.value = false;
  }
};

// Watch items and active collection to rebuild drag lists
watch(
  [() => store.items, activeCollection],
  () => {
    rebuildDragLists();
  },
  { deep: true, immediate: true },
);

watch(
  () => route.params.locationId,
  () => {
    syncLocationFromRoute();
  },
  { immediate: true },
);

watch(
  () => store.locations.map((loc) => String(loc.value)).join("|"),
  () => {
    syncLocationFromRoute();
  },
);

const handleRouteAction = (actionParam: unknown) => {
  const action = typeof actionParam === "string" ? actionParam : null;
  if (!action) {
    return;
  }
  if (action === "addLocation") {
    onSelectThing("location");
  } else if (action === "addCollection") {
    onSelectThing("collection");
  }
  const currentLocation = selectedLocationId.value || getRouteLocationParam();
  if (currentLocation) {
    router.replace({
      name: "mobile-locations",
      params: { locationId: currentLocation },
    });
  } else {
    router.replace({ name: "mobile-locations" });
  }
};

watch(
  () => route.query.action,
  (action) => {
    handleRouteAction(action);
  },
  { immediate: true },
);

// Handler for quick photo capture
const handleQuickPhoto = (itemId: string) => {
  quickPhotoItemId.value = itemId;
  // Trigger native camera capture (no AI flow)
  if (cameraInput.value) {
    cameraInput.value.value = "";
    cameraInput.value.click();
  }
};

const handleCameraCapture = async (event: Event) => {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file || !quickPhotoItemId.value) return;

  const item = store.items.find((i) => i.value === quickPhotoItemId.value);
  if (!item) return;

  try {
    quickPhotoUploading.value = true;
    $q.loading.show({ message: "Uploading photo..." });
    await store.updateItem(
      item.value,
      props.user,
      item.label,
      item.description || "",
      item.quantity ?? 1,
      item.collection,
      item.container ?? undefined,
      undefined,
      undefined,
      { newImage: file },
    );
    $q.notify({ type: "positive", message: "Photo added" });
  } catch (error: any) {
    $q.notify({
      type: "negative",
      message: "Upload failed",
      caption: error?.message || "Please try again",
    });
  } finally {
    quickPhotoItemId.value = null;
    if (cameraInput.value) cameraInput.value.value = "";
    quickPhotoUploading.value = false;
    $q.loading.hide();
  }
};

const onSelectThing = (item: string) => {
  // Debugging console logs
  pendingCollectionLocationId.value = null;
  if (item == "item") {
    activeObjectType.value = ObjectEnum.item;
    activeEditBool.value = false;
    isAdd.value = !isAdd.value;
  } else if (item == "container") {
    activeObjectType.value = ObjectEnum.container;
    activeEditBool.value = false;
    isAdd.value = !isAdd.value;
  } else if (item == "collection") {
    activeObjectType.value = ObjectEnum.collection;
    activeEditBool.value = false;
    isAdd.value = !isAdd.value;
    pendingCollectionLocationId.value = selectedLocationId.value ?? null;
  } else if (item == "location") {
    activeObjectType.value = ObjectEnum.location;
    activeEditBool.value = false;
    isAdd.value = !isAdd.value;
  }
  showAdd.value = false;
};

const openItemDetails = (id: string) => {
  store.openItemDetailsModal(id, props.user);
};

const onEditItem = (id: string) => {
  openItemDetails(id);
};

const onEditContainer = (id: string) => {
  activeId.value = id;
  activeObjectType.value = ObjectEnum.container;
  activeEditBool.value = true;
  isAdd.value = !isAdd.value;
};

const onEditLocation = (id: string) => {
  activeId.value = id;
  activeObjectType.value = ObjectEnum.location;
  activeEditBool.value = true;
  isAdd.value = !isAdd.value;
};

// These are the user constants that we use for data storage
// const user = ref('')

//ALL FUNCTIONS

// This function allows the user to log-out
function logoutFunction() {
  // Clear session token and user data from localStorage
  localStorage.removeItem("session_token");
  localStorage.removeItem("user_data");

  // Redirect to home page
  router.push("/");
}

// Handle photo item added
const handlePhotoItemAdded = async (item: InventoryItem) => {
  console.log("Photo item added:", item);

  // Reload inventory to show the newly added item
  await store.loadInventory(props.user);

  // Rebuild drag lists to show item in correct container
  rebuildDragLists();

  showPhotoCapture.value = false;

  $q.notify({
    type: "positive",
    message: `${item.label || item.name || "Item"} added to inventory!`,
    position: "bottom",
    timeout: 2000,
  });
};

// Handle vision provider changed
const handleProviderChanged = (provider: string) => {
  currentVisionProvider.value = provider;
};

console.log("props user is: " + props.user);

// Calculate container capacity info
const getContainerCapacity = (containerId: number) => {
  const container = store.containers.find((c) => c.value === containerId);
  if (!container) return null;

  const items = containerItemLists.value[containerId] || [];
  const totalWeight = items.reduce(
    (sum, item: any) => sum + (item.weight_lbs || 0),
    0,
  );

  return {
    itemCount: items.length,
    currentWeight: totalWeight,
    capacityWeight: container.max_weight_lbs ?? container.capacity_weight,
    capacityVolume: container.max_volume_cuft ?? container.capacity_volume,
    currentVolume: container.current_volume,
  };
};

// Format container caption with capacity info
const getContainerCaption = (containerId: number) => {
  const capacity = getContainerCapacity(containerId);
  if (!capacity) return "0 item(s)";

  let caption = `${capacity.itemCount} item(s)`;

  if (capacity.capacityWeight && capacity.currentWeight > 0) {
    const weightPercent = Math.round(
      (capacity.currentWeight / capacity.capacityWeight) * 100,
    );
    caption += ` • ${capacity.currentWeight}/${capacity.capacityWeight} lbs (${weightPercent}%)`;
  }

  return caption;
};

// Get color for capacity progress bar
const getCapacityColor = (
  current: number | undefined,
  max: number | undefined,
) => {
  if (!current || !max) return "grey";
  const percent = (current / max) * 100;
  if (percent >= 90) return "red";
  if (percent >= 70) return "orange";
  return "green";
};

const changeCollection = (collectionId: string | number | null) => {
  if (collectionId === null || collectionId === undefined) {
    return;
  }
  const normalizedId = String(collectionId);
  const match = store.collections.find((i) => i.value === normalizedId);
  if (!match) {
    return;
  }
  activeContainer.value = undefined;
  store.setActiveCollection({ label: match.label, value: match.value });
  showLeft.value = false;
};

watch(activeCollection, (newCollection, oldCollection) => {
  collectionIndex.value = store.collections.findIndex(
    (i) => i.value == newCollection?.value,
  );
});

watch(
  () => props.user,
  () => {
    store.loadInventory(props.user);
    loadSavedMoves();
  },
);

onMounted(() => {
  store.loadInventory(props.user);
  loadSavedMoves();
  maybeLaunchCaptureFromStorage();
});

// const consoleLog = () => {
//   console.log('log here to debug')
// }

function pushSelected(arg: any) {
  console.log("push selected arg is: ", arg);
  if (arg[0] == ObjectEnum.location) {
    onEditLocation(arg[1]);
  } else if (arg[0] == ObjectEnum.container) {
    onEditContainer(arg[1]);
  }
}

function closeAddDialog() {
  store.activeContainer = store.activeContainer;
  console.log("close add dialog active container is: ", store.activeContainer);
  activeId.value = undefined;
  isAdd.value = false;
  pendingCollectionLocationId.value = null;
}

function closeEditDialog() {
  activeId.value = undefined;
  isAdd.value = false;
  showEdit.value = false;
}

async function persistItemMove(
  itemId: string,
  targetContainerId: string | null,
) {
  const storeItem = store.items.find((i) => i.value === itemId);
  if (!storeItem) {
    return;
  }

  const normalizedTarget = targetContainerId ?? null;
  const normalizedCurrent = storeItem.container ?? null;

  if (normalizedTarget === normalizedCurrent) {
    return;
  }

  const headers: Record<string, string> = {};
  const sessionToken = localStorage.getItem("session_token");
  if (sessionToken) {
    headers.Authorization = "Bearer " + sessionToken;
  }

  try {
    isPersistingMove.value = true;

    await axios({
      method: "put",
      url: core_url + "/items/update",
      params: {
        item_id: storeItem.value,
        user: props.user,
        name: storeItem.label,
        description: storeItem.description,
        quantity: storeItem.quantity,
        collection: storeItem.collection,
        container: normalizedTarget,
        location: storeItem.location,
        picture_url: storeItem.picture_url,
      },
      headers,
    });

    storeItem.container = normalizedTarget;

    // Don't reload inventory - just update the item in place
    // This preserves container open/closed state
    rebuildDragLists();
  } catch (error) {
    console.error("Failed to move item to container", error);
  } finally {
    isPersistingMove.value = false;
  }
}

const handleContainerChange = async (containerId: string, evt: any) => {
  if (evt.added) {
    const movedItem = evt.added.element as StoreInventoryItem;
    await persistItemMove(movedItem.value, containerId);
  }
};

const handleUnassignedChange = async (evt: any) => {
  if (evt.added) {
    const movedItem = evt.added.element as StoreInventoryItem;
    await persistItemMove(movedItem.value, null);
  }
};

// Handle drop on collapsed container header
const handleCollapsedContainerDrop = async (containerId: string, evt: any) => {
  if (evt.added) {
    const movedItem = evt.added.element as StoreInventoryItem;

    // Open the container after drop (add to local state)
    openContainerIds.value.add(containerId);

    await persistItemMove(movedItem.value, containerId);
  }
};

// Helper to check if container is open
const isContainerOpen = (containerId: string) => {
  return openContainerIds.value.has(containerId);
};

// Handle container opened by user click
const handleContainerShow = (containerId: string) => {
  openContainerIds.value.add(containerId);
  store.activeContainer = store.containers.find((c) => c.value === containerId);
};

// Handle container closed by user click
const handleContainerHide = (containerId: string) => {
  openContainerIds.value.delete(containerId);
  if (store.activeContainer?.value === containerId) {
    store.activeContainer = undefined;
  }
};
</script>

<template>
  <q-dialog v-model="showEdit">
    <q-card dense>
      <MobileEditSelect
        @selected="pushSelected"
        @close="closeEditDialog"
        :collection_id="store.activeCollection?.value"
      />
    </q-card>
  </q-dialog>

  <q-dialog v-model="isAdd">
    <MobileAdd
      :user="user"
      :edit-select="activeEditBool"
      :object-type="activeObjectType"
      :id-prop="activeId"
      :default-location-id="pendingCollectionLocationId"
      @close="closeAddDialog"
    />
    <!-- <testSelect  /> -->
  </q-dialog>

  <!-- Photo Capture Dialog -->
  <q-dialog v-model="showPhotoCapture" maximized>
    <q-card>
      <q-card-section class="q-pa-none">
        <PhotoCapture
          :vision-provider="currentVisionProvider"
          :user="props.user"
          :default-capture-mode="pendingCaptureMode || undefined"
          :auto-open="autoOpenCamera"
          @item-added="handlePhotoItemAdded"
          @close="showPhotoCapture = false"
        />
      </q-card-section>
    </q-card>
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

    <q-header
      v-if="shouldRevealHeader"
      reveal
      bordered
      class="frosted-header text-white"
    >
      <q-toolbar>
        <q-btn dense flat round icon="menu" @click="showLeft = !showLeft" />

        <q-toolbar-title class="text-subtitle1 text-weight-medium">
          Inventory
        </q-toolbar-title>

        <ReloPrepLogo
          :width="30"
          logo-src="https://storage.googleapis.com/widowmaker-site-images/verimove_app_logo_white.png"
          style="margin-left: 8px"
        />
      </q-toolbar>
    </q-header>

    <MobileNavDrawer
      v-model="showLeft"
      :selected-location-id="selectedLocationId"
      :saved-moves="savedMoves"
      :saved-moves-loading="savedMovesLoading"
      :active-move-id="null"
      @select-location="applyLocationFilter"
      @select-move="goToMoveSession"
    />

    <q-page-container
      :class="[{ 'empty-bg': !hasItemsOrContainers }, 'page-container']"
    >
      <div
        v-if="shouldShowAddCollectionLanding"
        class="empty-collection-landing"
      >
        <div class="landing-card">
          <div class="landing-card-content">
            <div class="landing-eyebrow">You're almost ready</div>
            <div class="landing-title">{{ addCollectionLandingTitle }}</div>
            <div class="landing-subtitle">
              {{ addCollectionLandingSubtitle }}
            </div>
            <q-btn
              unelevated
              class="landing-primary-btn fab-button fab-pill"
              icon="add"
              label="Add Collection"
              :disable="store.locations.length === 0"
              @click="startAddCollectionFlow(selectedLocationId)"
            />
            <div class="landing-secondary" v-if="store.locations.length > 1">
              <q-icon name="place" size="18px" />
              <span>Switch locations from the menu to add elsewhere.</span>
            </div>
          </div>
        </div>
      </div>

      <template v-else>
        <!-- Location summary -->
        <div class="q-pa-md q-pb-none">
          <q-card class="inventory-card q-mb-md">
            <q-card-section>
              <div class="text-subtitle1 text-weight-bold text-primary">
                {{ activeLocationTitle }}
              </div>
              <div
                class="text-caption text-grey-7"
                v-if="activeLocationSubtitle"
              >
                {{ activeLocationSubtitle }}
              </div>
              <div class="text-caption text-grey-6" v-else>
                Select a location from the menu
              </div>
            </q-card-section>
          </q-card>

          <q-card class="inventory-card">
            <q-card-section>
              <div class="text-subtitle2 q-mb-sm">Collection</div>
              <q-select
                :model-value="store.activeCollection?.value"
                :options="collectionOptions"
                outlined
                label="Select Collection"
                emit-value
                map-options
                option-label="label"
                option-value="value"
                @update:model-value="changeCollection"
                class="rounded-select"
              >
                <template v-slot:prepend>
                  <q-icon name="folder" />
                </template>
              </q-select>
            </q-card-section>
          </q-card>
        </div>

        <!-- Collection card removed - editing collections only available on desktop -->
        <div class="q-pa-md">
          <q-list class="text-primary text-weight-medium">
            <!-- Expansion item for each container in the collection -->
            <div
              v-for="container in store.containers.filter(
                (i) => i.collection == store.activeCollection?.value,
              )"
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
                handle=".drag-handle"
                @change="
                  (evt) => handleCollapsedContainerDrop(container.value, evt)
                "
              >
                <template #item="{ element }">
                  <!-- This slot is required but never renders since list is empty -->
                  <div></div>
                </template>
                <template #header>
                  <q-expansion-item
                    expand-separator
                    :model-value="isContainerOpen(container.value)"
                    @update:model-value="
                      (val) =>
                        val
                          ? handleContainerShow(container.value)
                          : handleContainerHide(container.value)
                    "
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
                @update:model-value="
                  (val) =>
                    val
                      ? handleContainerShow(container.value)
                      : handleContainerHide(container.value)
                "
                icon="filter_none"
                header-class="text-h6 font-weight-medium"
                :label="container.label"
                :caption="getContainerCaption(container.value)"
              >
                <!-- Capacity progress bar -->
                <div
                  v-if="getContainerCapacity(container.value)?.capacityWeight"
                  class="q-pa-sm"
                >
                  <div class="text-caption text-grey-7 q-mb-xs">
                    Weight Capacity
                  </div>
                  <q-linear-progress
                    :value="
                      (getContainerCapacity(container.value)?.currentWeight ||
                        0) /
                      (getContainerCapacity(container.value)?.capacityWeight ||
                        1)
                    "
                    :color="
                      getCapacityColor(
                        getContainerCapacity(container.value)?.currentWeight,
                        getContainerCapacity(container.value)?.capacityWeight,
                      )
                    "
                    size="md"
                    class="q-mb-xs"
                  />
                  <div class="text-caption text-grey-7">
                    {{
                      getContainerCapacity(container.value)?.currentWeight || 0
                    }}
                    /
                    {{ getContainerCapacity(container.value)?.capacityWeight }}
                    lbs
                  </div>
                </div>

                <draggable
                  :list="containerItemLists[container.value] ?? []"
                  :group="{ name: 'items', pull: true, put: true }"
                  item-key="value"
                  class="container-drop-zone"
                  :disabled="isPersistingMove"
                  handle=".drag-handle"
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
                    <div
                      v-if="
                        (containerItemLists[container.value]?.length ?? 0) === 0
                      "
                      class="empty-container-hint"
                    >
                      Drag items here
                    </div>
                  </template>
                </draggable>
              </q-expansion-item>
            </div>

            <div
              v-if="unassignedItems.length > 0"
              class="uncontainerized-section"
            >
              <div class="uncontainerized-title">
                Unassigned items ({{ unassignedItems.length }})
              </div>
              <draggable
                :list="unassignedItems"
                :group="{ name: 'items', pull: true, put: true }"
                item-key="value"
                class="uncontainerized-items"
                :disabled="isPersistingMove"
                handle=".drag-handle"
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
      </template>
    </q-page-container>

    <!-- Enhanced CTA Bottom Sheet (when inventory is sparse) -->
    <q-page-sticky
      v-if="
        shouldRevealFooter && showEnhancedCTA && !shouldShowAddCollectionLanding
      "
      position="bottom"
      :offset="[0, 0]"
    >
      <div class="enhanced-cta-sheet">
        <!-- <div class="cta-gradient-top"></div> -->
        <div class="cta-content">
          <div class="cta-header">
            <h3 class="cta-title">Start Adding Items</h3>
            <p class="cta-subtitle">
              Build your moving inventory with AI-powered photo capture
            </p>
          </div>

          <div class="cta-actions">
            <q-btn
              unelevated
              size="lg"
              icon="add_a_photo"
              label="Take Photo"
              class="fab-button fab-pill"
              :disable="store.collections.length == 0"
              @click="openPhotoCapture('single')"
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
    <q-page-sticky
      v-if="
        shouldRevealFooter &&
        !showEnhancedCTA &&
        !shouldShowAddCollectionLanding
      "
      position="bottom"
      :offset="[0, 16]"
    >
      <q-btn
        unelevated
        icon="add_a_photo"
        label="Add photo"
        class="fab-button fab-pill"
        :disable="store.collections.length == 0"
        @click="openPhotoCapture('single')"
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
  transition:
    transform 0.2s ease,
    box-shadow 0.2s ease;
  background: linear-gradient(135deg, #274690, #1ca1c1, #7dd3fc);
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
  0% {
    background-position: 0% 50%;
  }
  50% {
    background-position: 100% 50%;
    box-shadow: 0 12px 28px rgba(39, 70, 144, 0.34);
  }
  100% {
    background-position: 0% 50%;
  }
}

.fab-button::after {
  content: "";
  position: absolute;
  inset: -12%;
  background:
    radial-gradient(
      10px 10px at 20% 30%,
      rgba(255, 255, 255, 0.45),
      transparent 60%
    ),
    radial-gradient(
      6px 6px at 70% 20%,
      rgba(255, 255, 255, 0.25),
      transparent 60%
    ),
    radial-gradient(
      5px 5px at 40% 70%,
      rgba(255, 255, 255, 0.25),
      transparent 60%
    );
  opacity: 0.9;
  pointer-events: none;
  mix-blend-mode: screen;
  animation: sparkleDrift 4s linear infinite;
}

@keyframes sparkleDrift {
  0% {
    transform: translateY(0);
    opacity: 0.75;
  }
  50% {
    transform: translateY(-6px);
    opacity: 1;
  }
  100% {
    transform: translateY(0);
    opacity: 0.75;
  }
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
  content: "";
  position: absolute;
  inset: -20%;
  background:
    radial-gradient(
      12px 12px at 20% 30%,
      rgba(255, 255, 255, 0.45),
      transparent 70%
    ),
    radial-gradient(
      8px 8px at 70% 25%,
      rgba(255, 255, 255, 0.3),
      transparent 65%
    ),
    radial-gradient(
      10px 10px at 40% 75%,
      rgba(255, 255, 255, 0.3),
      transparent 65%
    );
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
  background: linear-gradient(to right, #274690, #1ca1c1, #274690);
  background-size: 200% 100%;
  animation: shimmer 3s ease-in-out infinite;
}

@keyframes shimmer {
  0%,
  100% {
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
  box-shadow:
    0 18px 40px rgba(39, 70, 144, 0.18),
    0 0 0 1px rgba(39, 70, 144, 0.12);
  transition: all 0.2s ease;
  background: linear-gradient(145deg, #ffffff, #f7fbff);
  border: 2px solid rgba(39, 70, 144, 0.16);
  color: #20335d;
  position: relative;
  overflow: hidden;
}

.cta-primary-btn:hover {
  box-shadow:
    0 20px 44px rgba(39, 70, 144, 0.22),
    0 0 0 1px rgba(39, 70, 144, 0.2);
  transform: translateY(-2px);
}

.cta-primary-btn:active {
  transform: translateY(0);
  box-shadow: 0 8px 18px rgba(39, 70, 144, 0.25);
}

.cta-primary-btn::after {
  content: "";
  position: absolute;
  inset: -10%;
  background:
    radial-gradient(
      10px 10px at 25% 20%,
      rgba(255, 255, 255, 0.45),
      transparent 60%
    ),
    radial-gradient(
      7px 7px at 70% 30%,
      rgba(255, 255, 255, 0.3),
      transparent 60%
    ),
    radial-gradient(
      6px 6px at 50% 70%,
      rgba(255, 255, 255, 0.3),
      transparent 60%
    );
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

.empty-collection-landing {
  min-height: calc(100vh - 140px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 32px 24px;
}

.landing-card {
  width: 100%;
  max-width: 520px;
  border-radius: 30px;
  background: linear-gradient(145deg, #f0f6ff, #e0f3ff);
  box-shadow: 0 25px 60px rgba(39, 70, 144, 0.18);
}

.landing-card-content {
  padding: 48px 32px;
  text-align: center;
  color: #1e2a4a;
}

.landing-eyebrow {
  text-transform: uppercase;
  font-size: 0.85rem;
  letter-spacing: 0.2em;
  color: rgba(30, 42, 74, 0.6);
  margin-bottom: 12px;
}

.landing-title {
  font-size: 1.75rem;
  font-weight: 800;
  margin-bottom: 12px;
  color: #1d2f6f;
}

.landing-subtitle {
  font-size: 1rem;
  color: rgba(30, 42, 74, 0.8);
  margin-bottom: 32px;
}

.landing-primary-btn {
  width: 100%;
  max-width: 360px;
  margin: 0 auto;
  font-size: 1.05rem;
  text-transform: none;
}

.landing-secondary {
  margin-top: 20px;
  display: flex;
  align-items: center;
  gap: 8px;
  justify-content: center;
  color: rgba(30, 42, 74, 0.8);
  font-size: 0.9rem;
}

.landing-secondary :deep(.q-icon) {
  color: rgba(30, 42, 74, 0.8);
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
  background:
    radial-gradient(
      circle at 20% 20%,
      rgba(39, 70, 144, 0.08),
      transparent 35%
    ),
    radial-gradient(
      circle at 80% 10%,
      rgba(28, 161, 193, 0.07),
      transparent 30%
    ),
    #f7f8fa;
}

.inventory-card {
  border-radius: 18px;
  border: none;
  background: rgba(255, 255, 255, 0.95);
  box-shadow:
    0 15px 45px rgba(15, 23, 42, 0.08),
    0 3px 12px rgba(15, 23, 42, 0.05);
}

.rounded-select .q-field__control {
  border-radius: 12px;
  min-height: 52px;
}

.page-container {
  position: relative;
}

.empty-bg {
  background: url("https://storage.googleapis.com/widowmaker-site-images/no_items_graphic.png")
    center 40% no-repeat;
  background-size: 220px;
  min-height: 100vh;
}

.footer-fade-spacer {
  height: 20vh;
  min-height: 200px;
  background: linear-gradient(
    to bottom,
    rgba(255, 255, 255, 0) 0%,
    rgba(255, 255, 255, 0.5) 100%
  );
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
  content: "";
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  height: 18vh;
  min-height: 120px;
  background: linear-gradient(
    to bottom,
    rgba(255, 255, 255, 0) 0%,
    rgba(255, 255, 255, 1) 100%
  );
  pointer-events: none;
  z-index: 1;
}

/* Ensure FAB is above the gradient overlay */
.q-page-sticky {
  z-index: 2;
}
</style>
