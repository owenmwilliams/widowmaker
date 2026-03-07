<script setup lang="ts">
import { computed, watch } from "vue";
import { useRouter } from "vue-router";
import { inventoryStore } from "../../stores/InventoryStore";

interface SavedMove {
  id: string | number;
  name: string;
}

const props = withDefaults(
  defineProps<{
    modelValue: boolean;
    selectedLocationId: string | null;
    showLocations?: boolean;
    showMoves?: boolean;
    savedMoves?: SavedMove[];
    savedMovesLoading?: boolean;
    activeMoveId?: string | number | null;
    showDebug?: boolean;
  }>(),
  {
    showLocations: true,
    showMoves: true,
    savedMoves: () => [],
    savedMovesLoading: false,
    showDebug: false,
  },
);

const emit = defineEmits<{
  (e: "update:modelValue", value: boolean): void;
  (e: "selectLocation", value: string | number): void;
  (e: "selectMove", value: string | number): void;
}>();

const router = useRouter();
const store = inventoryStore();
const locations = computed(() => {
  const items = [...store.locations];
  items.sort((a, b) => {
    const aPrimary = a.isPrimary ? 0 : 1;
    const bPrimary = b.isPrimary ? 0 : 1;
    if (aPrimary !== bPrimary) {
      return aPrimary - bPrimary;
    }
    return a.label.localeCompare(b.label);
  });
  return items;
});
const showLocations = computed(() => props.showLocations !== false);
const showMoves = computed(() => props.showMoves !== false);

const debugInfo = computed(() => ({
  locationCount: locations.value.length,
  selectedLocationId: props.selectedLocationId,
  showLocations: showLocations.value,
  moveCount: props.savedMoves?.length ?? 0,
  showMoves: showMoves.value,
  loadingMoves: props.savedMovesLoading ?? false,
}));

watch(
  debugInfo,
  (info) => {
    console.log("[MobileNavDrawer] debug", info);
  },
  { immediate: true },
);

const closeDrawer = () => {
  emit("update:modelValue", false);
};

const handleLocationClick = (value: string | number) => {
  emit("selectLocation", value);
  closeDrawer();
};

const handleMoveClick = (value: string | number) => {
  emit("selectMove", value);
  closeDrawer();
};

const openSettings = () => {
  const query = props.selectedLocationId
    ? { location: props.selectedLocationId }
    : undefined;
  router.push({ name: "mobile-settings", query });
  closeDrawer();
};

const goTo = (path: string) => {
  router.push(path);
  closeDrawer();
};

const logout = () => {
  localStorage.removeItem("session_token");
  localStorage.removeItem("user_data");
  router.push("/login");
  closeDrawer();
};
</script>

<template>
  <q-drawer
    :model-value="props.modelValue"
    @update:model-value="emit('update:modelValue', $event)"
    class="nav-drawer"
    side="left"
    overlay
    behavior="mobile"
    elevated
  >
    <q-list padding class="rounded-borders text-primary nav-list">
      <template v-if="showLocations">
        <q-item-label header>Locations</q-item-label>
        <q-item
          v-for="location in locations"
          :key="location.value"
          clickable
          v-ripple
          :active="props.selectedLocationId === location.value"
          class="drawer-item"
          active-class="drawer-item-active"
          @click="handleLocationClick(location.value)"
        >
          <q-item-section>
            <q-item-label>{{ location.label }}</q-item-label>
          </q-item-section>
        </q-item>
      </template>

      <template v-if="showMoves">
        <q-separator class="q-my-md" />
        <q-item-label header>Saved Moves</q-item-label>
        <q-item v-if="props.savedMovesLoading" dense class="text-grey-6">
          <q-item-section>
            <q-item-label caption>Loading saved moves…</q-item-label>
          </q-item-section>
        </q-item>
        <q-item v-else-if="!props.savedMoves?.length" dense class="text-grey-6">
          <q-item-section>
            <q-item-label caption>No saved moves yet</q-item-label>
          </q-item-section>
        </q-item>
        <q-item
          v-else
          v-for="move in props.savedMoves"
          :key="move.id"
          clickable
          v-ripple
          class="drawer-item"
          :active="
            props.activeMoveId && String(props.activeMoveId) === String(move.id)
          "
          active-class="drawer-item-active"
          @click="handleMoveClick(move.id)"
        >
          <q-item-section>
            <q-item-label>{{ move.name }}</q-item-label>
          </q-item-section>
          <q-item-section side>
            <q-icon name="chevron_right" />
          </q-item-section>
        </q-item>
      </template>

      <q-separator class="q-my-md" />
      <q-item-label header>AI Assistant</q-item-label>

      <q-item clickable v-ripple class="drawer-item" @click="goTo('/mobile/nexus')">
        <q-item-section avatar>
          <q-icon name="auto_awesome" />
        </q-item-section>
        <q-item-section>Nexus</q-item-section>
      </q-item>

      <q-separator class="q-my-md" />
      <q-item-label header>Settings</q-item-label>

      <q-item clickable v-ripple class="drawer-item" @click="openSettings">
        <q-item-section>App Settings</q-item-section>
      </q-item>

      <q-item
        clickable
        v-ripple
        class="drawer-item"
        @click="goTo('/privacypolicy')"
      >
        <q-item-section>Privacy Policy</q-item-section>
      </q-item>

      <q-item clickable v-ripple class="drawer-item" @click="goTo('/terms')">
        <q-item-section>Terms of Service</q-item-section>
      </q-item>

      <q-item clickable v-ripple class="drawer-item" @click="logout">
        <q-item-section>Logout</q-item-section>
      </q-item>

      <template v-if="props.showDebug">
        <q-separator class="q-my-md" />
        <q-item-label header>Debug</q-item-label>
        <q-item dense>
          <q-item-section>
            <q-item-label caption>
              Locations: {{ debugInfo.locationCount }} · show=
              {{ debugInfo.showLocations }}
            </q-item-label>
            <q-item-label caption>
              Selected: {{ debugInfo.selectedLocationId || "none" }}
            </q-item-label>
          </q-item-section>
        </q-item>
        <q-item dense>
          <q-item-section>
            <q-item-label caption>
              Moves: {{ debugInfo.moveCount }} · show={{ debugInfo.showMoves }}
            </q-item-label>
            <q-item-label caption>
              Loading: {{ debugInfo.loadingMoves }}
            </q-item-label>
          </q-item-section>
        </q-item>
      </template>
    </q-list>
  </q-drawer>
</template>

<style scoped>
.nav-drawer {
  background: #f5f9e9;
  border-radius: 0 24px 24px 0;
  box-shadow: 16px 0 40px rgba(0, 0, 0, 0.15);
}

.nav-drawer :deep(.q-drawer__content) {
  border-right: none;
  border-radius: inherit;
}

.nav-list {
  padding-top: 12px;
}

.nav-list :deep(.q-item-label[header]) {
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  color: rgba(39, 70, 144, 0.7);
  font-size: 0.75rem;
  margin-top: 4px;
  margin-bottom: 8px;
}

.drawer-item {
  margin-bottom: 4px;
  border-radius: 12px;
  transition:
    background 0.2s ease,
    color 0.2s ease;
}

.drawer-item-active {
  background: linear-gradient(135deg, #2a449c, #1e2b66);
  color: #fff;
}

.drawer-item-active :deep(.q-item__label) {
  color: #fff;
}

.nav-list :deep(.q-separator) {
  border-color: rgba(39, 70, 144, 0.15);
}
</style>
