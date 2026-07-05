<script setup lang="ts">

//ALL IMPORTS
  import { ref, onMounted, watch, computed } from 'vue';
  import { useRouter } from 'vue-router';
  import { inventoryStore } from '../../../stores/InventoryStore'
  import ItemTable from './ItemTable.vue';
  import CollectionsBoard from './CollectionsBoard.vue';
  import DesktopDashboard from '../../dashboard/desktop/DesktopDashboard.vue';
  import ReviewQueue from './ReviewQueue.vue';
  import DesktopMovePlanning from '../../moves/desktop/DesktopMovePlanning.vue';
  import DesktopSettings from '../../settings/desktop/DesktopSettings.vue';
  import DesktopSupport from '../../support/desktop/DesktopSupport.vue';
  import PhotoCapture from '../../capture/PhotoCapture.vue';
  import VideoInventoryScan from '../../capture/VideoInventoryScan.vue';
  import VisionProviderToggle from '../../capture/VisionProviderToggle.vue';
  import ShareInventoryButton from '../ShareInventoryButton.vue';
  import logoLockup from '../../../assets/brand/logo-lockup-light.svg';
  import { Cpu, Settings as SettingsIcon, CircleHelp, LogOut } from 'lucide-vue-next';
  import { storeToRefs } from 'pinia';
  import { useQuasar } from 'quasar';
  import { logout as serverLogout } from '../../../utils/auth';
  import { usePlan } from '../../../composables/usePlan';

  interface InventoryItem {
    id: number;
    name: string;
    qty: number;
    size: string;
    weight: string;
    image: string;
    tags: string[];
    material: string;
    primaryColor: string;
    description: string;
  }


  const pageItem = ref<'dashboard' | 'inventory' | 'move' | 'settings' | 'support'>('dashboard')
  const dashboardTab = ref<'overview' | 'attributes' | 'duplicates'>('overview')
  const inventoryTab = ref<'items' | 'collections'>('items')
  const showPhotoCapture = ref(false)
  const showVideoScan = ref(false)
  const showVisionSettings = ref(false)
  const currentVisionProvider = ref<string>('gemini')
  const search = ref('')
  const showAddOptionsDialog = ref(false)
  const photoCaptureMode = ref<'single' | 'multi' | null>(null)
  const { isAdmin, effectivePlan, setPlanPreview } = usePlan()
  const planPreviewToggle = computed({
    get: () => effectivePlan.value === 'pro',
    set: (val: boolean) => setPlanPreview(val ? 'pro' : 'basic')
  })

//ALL PROPS & EMITS
  const props = defineProps({
    user: String,
    returnLocation: String
  })

  const emits = defineEmits<{
    (e: 'app:loading', id: boolean): void
  }>()

//ALL CONSTANTS AND VARIABLES

  const store = inventoryStore()
  const { locationValues, collectionValues, containerValues } = storeToRefs(store);
  const router = useRouter();
  const $q = useQuasar();

//ALL FUNCTIONS

  async function logoutFunction () {
    await serverLogout();
    router.push('/');
  }

  // onMounted(async() => {
  //   emits("app:loading", true)
  //   await store.loadInventory(props.user!)
  //   emits("app:loading", false)
  // })

  watch(() => props.user, (newUser, oldUser) => {
    if (props.user) {
      store.loadInventory(props.user!)
    }
  });

  watch(collectionValues, (newCollection, oldCollection) => {
    containerValues.value = []

    newCollection.forEach(i => {
      store.containers.forEach(j => {
        if (j.collection == i) {
          containerValues.value?.push(j.value)
        }
      })
    })
  });

  const leftDrawerOpen = ref(false)

  const changePage = (newPage: typeof pageItem.value) => {
    pageItem.value = newPage
  }

  const applyOnboardingTarget = () => {
    if (typeof window === 'undefined') return
    const target = localStorage.getItem('desktop_nav_target') || localStorage.getItem('desktop_onboarding_target')
    if (!target) return
    localStorage.removeItem('desktop_nav_target')
    localStorage.removeItem('desktop_onboarding_target')
    if (target === 'settings' || target === 'support') {
      changePage(target as typeof pageItem.value)
    }
  }

  onMounted(() => {
    if (props.user) {
      store.loadInventory(props.user)
    }
    applyOnboardingTarget()
  })



  // Handle photo item added
  const handlePhotoItemAdded = async (item: InventoryItem) => {
    console.log('Photo item added:', item);

    // Reload inventory to show the newly added item
    await store.loadInventory(props.user!);

    showPhotoCapture.value = false;

    $q.notify({
      type: 'positive',
      message: `${item.label || item.name || 'Item'} added to inventory!`,
      position: 'bottom',
      timeout: 2000,
    });
  }

  // Handle vision provider changed
  const handleProviderChanged = (provider: string) => {
    currentVisionProvider.value = provider;
  }

  const openAddOptions = () => {
    if (store.collections.length === 0) {
      $q.notify({
        type: 'info',
        message: 'Set up your space first',
        caption: 'Add a location and at least one room in Settings before adding items.',
        position: 'top',
        timeout: 0,
        actions: [
          { label: 'Go to settings', color: 'white', handler: () => changePage('settings') },
          { label: 'Dismiss', color: 'white' },
        ],
      })
      return
    }
    showAddOptionsDialog.value = true
  }

  const handleScanOption = (mode: 'single' | 'multi') => {
    photoCaptureMode.value = mode
    showAddOptionsDialog.value = false
    showPhotoCapture.value = true
  }

  const handleVideoScanOption = () => {
    showAddOptionsDialog.value = false
    showVideoScan.value = true
  }

  const handleVideoItemsAdded = async () => {
    showVideoScan.value = false
    await store.loadInventory(props.user)
    $q.notify({ type: 'positive', message: 'Inventory updated from video scan!', position: 'bottom', timeout: 3000 })
  }

  const handleManualAdd = () => {
    showAddOptionsDialog.value = false
    if (props.user) {
      store.startNewItem(props.user)
    }
  }

  const consoleLog = () => {
    console.log('log here to debug')
    console.log('store.items', store.items)
    console.log('store.locations', store.locations)
    console.log('store.containers', store.containers)
    console.log('store.collections', store.collections)
    console.log('store.activeCollection', store.activeCollection)
    console.log('store.activeContainer', store.activeContainer)
    console.log('user is: ', props.user)
    console.log('store.locationValues', store.locationValues)
    console.log('store.collectionValues', store.collectionValues)
    console.log('store.containerValues', store.containerValues)
  }
</script>

<template>

  <div>
    <q-layout view="hHh LpR lff">

      <q-header bordered class="workspace-header text-primary" style="z-index: 9998;">
        <q-toolbar>
          <div class="toolbar-left">
            <div class="nexus-logo-btn" @click="router.push('/nexus')">
              <img
                :src="logoLockup"
                alt="Nexus Moves"
                height="28"
                class="brand-lockup"
              />
            </div>
            <q-btn-group flat class="primary-nav">
              <q-btn
                flat
                dense
                padding="xs md"
                no-caps
                class="text-weight-medium"
                :color="pageItem === 'dashboard' ? 'primary' : 'grey-7'"
                label="Dashboard"
                @click="changePage('dashboard')"
              />
              <q-btn
                flat
                dense
                padding="xs md"
                no-caps
                class="text-weight-medium"
                :color="pageItem === 'inventory' ? 'primary' : 'grey-7'"
                label="Inventory"
                @click="changePage('inventory')"
              />
              <q-btn
                flat
                dense
                padding="xs md"
                no-caps
                class="text-weight-medium"
                :color="pageItem === 'move' ? 'primary' : 'grey-7'"
                label="Move"
                @click="changePage('move')"
              />
            </q-btn-group>
          </div>

            <q-toolbar-title />

            <div v-if="isAdmin" class="header-plan-toggle row items-center q-gutter-xs">
              <q-chip dense color="primary" text-color="white" class="text-weight-bold">
                Admin
              </q-chip>
              <q-toggle
                v-model="planPreviewToggle"
                color="primary"
                size="sm"
                dense
                keep-color
                aria-label="Admin plan preview"
              />
            </div>

          <div class="toolbar-actions">
            <ShareInventoryButton class="q-mr-sm" />
            <q-btn flat round dense icon="menu" class="admin-btn">
              <q-menu style="z-index: 9999;">
                <q-list style="min-width: 200px;">
                  <q-item clickable v-ripple @click="showVisionSettings = true">
                    <q-item-section avatar><Cpu :size="20" class="menu-icon" /></q-item-section>
                    <q-item-section>Vision provider</q-item-section>
                  </q-item>
                  <q-item clickable v-ripple @click="changePage('settings')">
                    <q-item-section avatar><SettingsIcon :size="20" class="menu-icon" /></q-item-section>
                    <q-item-section>Settings</q-item-section>
                  </q-item>
                  <q-item clickable v-ripple @click="changePage('support')">
                    <q-item-section avatar><CircleHelp :size="20" class="menu-icon" /></q-item-section>
                    <q-item-section>Support</q-item-section>
                  </q-item>
                  <q-separator />
                  <q-item clickable v-ripple @click="logoutFunction">
                    <q-item-section avatar><LogOut :size="20" class="menu-icon" /></q-item-section>
                    <q-item-section>Log out</q-item-section>
                  </q-item>
                </q-list>
              </q-menu>
            </q-btn>
          </div>
        </q-toolbar>
      </q-header>

      <q-page-container>
          <div v-if="pageItem === 'dashboard'">
            <div class="subnav">
              <q-btn-group flat class="pill-tabs">
                <q-btn
                  flat
                  dense
                  no-caps
                  :class="{ 'pill-tab-active': dashboardTab === 'overview' }"
                  class="pill-tab"
                  label="Overview"
                  @click="dashboardTab = 'overview'"
                />
                <q-btn
                  flat
                  dense
                  no-caps
                  :class="{ 'pill-tab-active': dashboardTab === 'attributes' }"
                  class="pill-tab"
                  label="Review attributes"
                  @click="dashboardTab = 'attributes'"
                />
                <q-btn
                  flat
                  dense
                  no-caps
                  :class="{ 'pill-tab-active': dashboardTab === 'duplicates' }"
                  class="pill-tab"
                  label="Review duplicates"
                  @click="dashboardTab = 'duplicates'"
                />
              </q-btn-group>
            </div>
            <DesktopDashboard v-if="dashboardTab === 'overview'" :user="props.user!" />
            <ReviewQueue
              v-else-if="dashboardTab === 'attributes'"
              :user="props.user!"
              view="attributes"
            />
            <ReviewQueue
              v-else
              :user="props.user!"
              view="duplicates"
            />
          </div>

          <div v-else-if="pageItem === 'inventory'">
            <div class="subnav">
              <q-btn-group flat class="pill-tabs">
                <q-btn
                  flat
                  dense
                  no-caps
                  :class="{ 'pill-tab-active': inventoryTab === 'items' }"
                  class="pill-tab"
                  label="Items"
                  @click="inventoryTab = 'items'"
                />
                <q-btn
                  flat
                  dense
                  no-caps
                  :class="{ 'pill-tab-active': inventoryTab === 'collections' }"
                  class="pill-tab"
                  label="Packing"
                  @click="inventoryTab = 'collections'"
                />
              </q-btn-group>
            </div>
            <CollectionsBoard
              v-if="inventoryTab === 'collections'"
              :user="props.user!"
            />
            <ItemTable
              v-else
              :user="props.user!"
              @addAction="openAddOptions"
            />
          </div>

          <div v-else-if="pageItem === 'move'">
            <DesktopMovePlanning :user="props.user!" />
          </div>

          <div v-else-if="pageItem == 'settings'">
            <DesktopSettings :user="props.user!" />
          </div>
          <div v-else-if="pageItem == 'support'">
            <DesktopSupport />
          </div>

      </q-page-container>

        <q-dialog v-model="showAddOptionsDialog" persistent>
          <q-card class="add-options-card">
            <q-card-section>
              <div class="text-h6 text-primary">Add items</div>
              <div v-if="effectivePlan === 'basic'" class="text-caption text-grey-7">Choose how you want to capture items. Limits reset weekly. <a href="/pricing">Upgrade to pro</a> for unlimited scans.</div>
              <div v-else class="text-caption text-grey-7">Choose how you want to capture items.</div>
              <em></em>
            </q-card-section>
            <q-card-section class="column q-gutter-sm">
              <q-btn
                unelevated
                color="primary"
                icon="photo_camera"
                label="Scan single item"
                :disable="store.collections.length === 0"
                @click="handleScanOption('single')"
              />
              <div class="limit-tag" v-if="effectivePlan === 'basic'"><em>(unlimited)</em></div>
              <q-btn
                unelevated
                color="primary"
                icon="view_module"
                label="Scan multiple items"
                :disable="store.collections.length === 0"
                @click="handleScanOption('multi')"
              />
              <div class="limit-tag" v-if="effectivePlan === 'basic'"><em>(3x / week)</em></div>

              <q-btn
                unelevated
                color="primary"
                icon="videocam"
                label="Scan by video"
                :disable="store.collections.length === 0 || effectivePlan !== 'pro'"
                @click="handleVideoScanOption"
              />
              <div class="limit-tag" v-if="effectivePlan !== 'pro'"><em>(Pro plan)</em></div>

              <q-btn
                flat
                color="grey-7"
                label="Add manually"
                :disable="!props.user"
                @click="handleManualAdd"
              />
            </q-card-section>
            <q-card-actions align="right">
              <q-btn flat color="grey-7" label="Cancel" v-close-popup />
            </q-card-actions>
          </q-card>
        </q-dialog>

        <!-- Vision Settings Dialog -->
        <q-dialog v-model="showVisionSettings">
          <q-card style="min-width: 400px;">
            <q-card-section>
              <div class="text-h6">Vision AI settings</div>
            </q-card-section>

            <q-card-section>
              <VisionProviderToggle @provider-changed="handleProviderChanged" />
            </q-card-section>

            <q-card-actions align="right">
              <q-btn flat label="Close" color="primary" v-close-popup />
            </q-card-actions>
          </q-card>
        </q-dialog>

        <!-- Video Inventory Scan Dialog -->
        <q-dialog v-model="showVideoScan" persistent>
          <q-card style="min-width: 520px; max-width: 720px;">
            <q-card-section class="q-pb-sm">
              <div class="row items-center justify-between">
                <div class="text-h6 text-primary">Scan by video</div>
                <q-btn flat round dense icon="close" color="grey-6" @click="showVideoScan = false" />
              </div>
            </q-card-section>
            <q-separator />
            <q-card-section>
              <VideoInventoryScan
                :user="props.user"
                :effective-plan="effectivePlan"
                :vision-provider="currentVisionProvider"
                @close="showVideoScan = false"
                @items-added="handleVideoItemsAdded"
              />
            </q-card-section>
          </q-card>
        </q-dialog>

        <!-- Photo Capture Dialog -->
        <q-dialog v-model="showPhotoCapture" persistent @hide="photoCaptureMode = null">
          <q-card style="min-width: 600px; max-width: 800px;">
            <q-card-section>
              <PhotoCapture
                :vision-provider="currentVisionProvider"
                :user="props.user"
                :default-capture-mode="photoCaptureMode || undefined"
                @item-added="handlePhotoItemAdded"
                @close="showPhotoCapture = false"
              />
            </q-card-section>
          </q-card>
        </q-dialog>


    </q-layout>


  </div>

    <!-- <q-btn fab round color="primary" label="ConsoleLog" icon="add" class="q-ma-md" @click="consoleLog()" /> -->
</template>

<style scoped>
.workspace-header {
  background: var(--surface);
  border-bottom: 1px solid var(--border);
}

/* Floating Action Button */
.fab-button {
  box-shadow: var(--shadow-md);
  transition: transform var(--dur-base) var(--ease-standard);
}

.fab-button:hover {
  transform: scale(1.1);
}

.fab-button:active {
  transform: scale(0.95);
}

.toolbar-left {
  display: flex;
  align-items: center;
  gap: var(--sp-4);
}

.nexus-logo-btn {
  display: flex;
  align-items: center;
  cursor: pointer;
  padding: var(--sp-2) var(--sp-3);
  border-radius: var(--r-xs);
  transition: background var(--dur-base) var(--ease-standard);
}
.nexus-logo-btn:hover {
  background: var(--surface-hover);
}

.brand-lockup {
  display: block;
  height: 28px;
  width: auto;
}

.primary-nav {
  border-radius: var(--r-pill);
  background: var(--surface-hover);
  padding: var(--sp-1);
}

.toolbar-actions {
  display: flex;
  align-items: center;
}

.header-plan-toggle {
  background: var(--surface-hover);
  padding: var(--sp-2) var(--sp-3);
  border-radius: var(--r-sm);
}

.admin-btn {
  border-radius: var(--r-pill);
}

.menu-icon {
  color: var(--text-secondary);
}

.subnav {
  padding: var(--sp-4) var(--sp-7) 0;
}

.pill-tabs {
  background: var(--surface-hover);
  border-radius: var(--r-xs);
  padding: var(--sp-2);
  display: inline-flex;
  gap: var(--sp-2);
}

.pill-tab {
  border-radius: var(--r-xs);
  padding: var(--sp-3) var(--sp-5);
  transition: all var(--dur-base) var(--ease-standard);
  color: var(--text-secondary);
  font-weight: var(--fw-medium);
}

.pill-tab:hover {
  background: var(--surface-sunk);
}

.pill-tab:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring);
}

.pill-tab-active {
  background: var(--surface-card) !important;
  color: var(--accent) !important;
  box-shadow: var(--shadow-xs);
}

.add-options-card {
  min-width: 320px;
  max-width: 400px;
}

.add-options-card .q-btn {
  width: 100%;
}

.multi-scan-note {
  font-size: var(--fs-label);
  color: var(--text-secondary);
  margin-top: var(--sp-2);
}

.limit-tag {
  font-size: var(--fs-label);
  color: var(--text-secondary);
  margin-top: var(--sp-1);
  text-align: center;
}

.multi-scan-footnote {
  font-size: var(--fs-micro);
  color: var(--text-tertiary);
  margin-top: var(--sp-2);
}

.multi-scan-footnote a {
  color: var(--accent);
  text-decoration: underline;
}
</style>
