<script setup lang="ts">

//ALL IMPORTS
  import { ref, onMounted, watch, computed } from 'vue';
  import { useRouter } from 'vue-router';
  import { inventoryStore } from '../../stores/InventoryStore';
  import DesktopItemTable from './DesktopItemTable.vue';
  import DesktopCollections from './DesktopCollections.vue';
  import DesktopDashboard from './DesktopDashboard.vue';
  import DesktopReviewQueue from './DesktopReviewQueue.vue';
  import DesktopMovePlanning from './DesktopMovePlanning.vue';
  import DesktopSettings from './DesktopSettings.vue';
  import DesktopSupport from './DesktopSupport.vue';
  import PhotoCapture from '../PhotoCapture.vue';
  import VisionProviderToggle from '../VisionProviderToggle.vue';
  import ReloPrepLogo from '../ReloPrepLogo.vue';
  import { storeToRefs } from 'pinia';
  import type { InventoryItem } from '../../data/inventoryItems';
  import axios from 'axios';


  const pageItem = ref<'dashboard' | 'inventory' | 'move' | 'settings' | 'support'>('dashboard')
  const dashboardTab = ref<'overview' | 'attributes' | 'duplicates'>('overview')
  const inventoryTab = ref<'items' | 'collections'>('collections')
  const showPhotoCapture = ref(false)
  const showVisionSettings = ref(false)
  const currentVisionProvider = ref<string>('gemini')
  const search = ref('')
  const showAddOptionsDialog = ref(false)
  const photoCaptureMode = ref<'single' | 'multi' | null>(null)
  const userData = ref<any>({})
  if (typeof window !== 'undefined') {
    try {
      userData.value = JSON.parse(localStorage.getItem('user_data') || '{}')
    } catch (e) {
      userData.value = {}
    }
  }

  const basePlan = computed(() => (userData.value?.plan || 'basic').toLowerCase())
  const isAdmin = computed(() => !!userData.value?.is_admin)
  const planPreview = ref<'basic' | 'pro'>(basePlan.value === 'pro' ? 'pro' : 'basic')
  const planPreviewToggle = ref(planPreview.value === 'pro')
  const effectivePlan = computed(() => {
    if (isAdmin.value) return planPreview.value
    return basePlan.value
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

//ALL FUNCTIONS

  function logoutFunction () {
    // Clear session token and user data from localStorage
    localStorage.removeItem('session_token');
    localStorage.removeItem('user_data');

    // Redirect to home page
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
    const target = localStorage.getItem('desktop_onboarding_target')
    if (!target) return
    localStorage.removeItem('desktop_onboarding_target')
    if (target === 'settings') {
      changePage('settings')
    }
  }

  const applyPlanHeader = () => {
    if (isAdmin.value) {
      axios.defaults.headers.common['x-plan-preview'] = planPreview.value
    } else {
      delete axios.defaults.headers.common['x-plan-preview']
    }
  }

  watch(planPreview, (val) => {
    planPreviewToggle.value = val === 'pro'
    applyPlanHeader()
    localStorage.setItem('plan_preview', val)
    window.dispatchEvent(new CustomEvent('plan-preview-change', { detail: val }))
  })
  watch(planPreviewToggle, (val) => {
    planPreview.value = val ? 'pro' : 'basic'
    localStorage.setItem('plan_preview', planPreview.value)
  })
  applyPlanHeader()

  onMounted(() => {
    if (props.user) {
      store.loadInventory(props.user)
    }
    applyOnboardingTarget()
  })



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

  const openAddOptions = () => {
    showAddOptionsDialog.value = true
  }

  const handleScanOption = (mode: 'single' | 'multi') => {
    photoCaptureMode.value = mode
    showAddOptionsDialog.value = false
    showPhotoCapture.value = true
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

      <q-header bordered class="temp_bg text-primary" style="z-index: 9998;">
        <q-toolbar>
          <div class="toolbar-left">
            <ReloPrepLogo :width="120" :height="32" class="brand-logo" />
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
            <q-btn unelevated color="primary" icon="add" label="Add Item" class="q-mr-sm" @click="openAddOptions" />
            <q-btn flat round dense icon="menu" class="admin-btn">
              <q-menu style="z-index: 9999;">
                <q-list style="min-width: 200px;">
                  <q-item clickable v-ripple @click="showVisionSettings = true">
                    <q-item-section avatar><q-icon name="memory" /></q-item-section>
                    <q-item-section>Vision Provider</q-item-section>
                  </q-item>
                  <q-item clickable v-ripple @click="changePage('settings')">
                    <q-item-section avatar><q-icon name="settings" /></q-item-section>
                    <q-item-section>Settings</q-item-section>
                  </q-item>
                  <q-item clickable v-ripple @click="changePage('support')">
                    <q-item-section avatar><q-icon name="help_outline" /></q-item-section>
                    <q-item-section>Support</q-item-section>
                  </q-item>
                  <q-separator />
                  <q-item clickable v-ripple @click="logoutFunction">
                    <q-item-section avatar><q-icon name="logout" /></q-item-section>
                    <q-item-section>Logout</q-item-section>
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
                  label="Review Attributes"
                  @click="dashboardTab = 'attributes'"
                />
                <q-btn
                  flat
                  dense
                  no-caps
                  :class="{ 'pill-tab-active': dashboardTab === 'duplicates' }"
                  class="pill-tab"
                  label="Review Duplicates"
                  @click="dashboardTab = 'duplicates'"
                />
              </q-btn-group>
            </div>
            <DesktopDashboard v-if="dashboardTab === 'overview'" :user="props.user!" />
            <DesktopReviewQueue
              v-else-if="dashboardTab === 'attributes'"
              :user="props.user!"
              view="attributes"
            />
            <DesktopReviewQueue
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
                  :class="{ 'pill-tab-active': inventoryTab === 'collections' }"
                  class="pill-tab"
                  label="Packing"
                  @click="inventoryTab = 'collections'"
                />
                <q-btn
                  flat
                  dense
                  no-caps
                  :class="{ 'pill-tab-active': inventoryTab === 'items' }"
                  class="pill-tab"
                  label="Items"
                  @click="inventoryTab = 'items'"
                />
              </q-btn-group>
            </div>
            <DesktopCollections
              v-if="inventoryTab === 'collections'"
              :user="props.user!"
            />
            <DesktopItemTable
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
              <div class="text-h6 text-primary">Add Items</div>
              <div v-if="effectivePlan === 'basic'" class="text-caption text-grey-7">Choose how you want to capture items. Limits reset weekly. <a href="/pricing">Upgrade to pro</a> for unlimited scans.</div>
              <div v-else class="text-caption text-grey-7">Choose how you want to capture items.</div>
              <em></em>
            </q-card-section>
            <q-card-section class="column q-gutter-sm">
              <q-btn
                unelevated
                color="primary"
                icon="photo_camera"
                label="Scan Single Item"
                :disable="store.collections.length === 0"
                @click="handleScanOption('single')"
              />
              <div class="limit-tag" v-if="effectivePlan === 'basic'"><em>(unlimited)</em></div>
              <q-btn
                unelevated
                color="primary"
                icon="view_module"
                label="Scan Multiple Items"
                :disable="store.collections.length === 0"
                @click="handleScanOption('multi')"
              />
              <div class="limit-tag" v-if="effectivePlan === 'basic'"><em>(3x / week)</em></div>
              
              <q-btn
                flat
                color="grey-7"
                label="Add Manually"
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
              <div class="text-h6">Vision AI Settings</div>
            </q-card-section>

            <q-card-section>
              <VisionProviderToggle @provider-changed="handleProviderChanged" />
            </q-card-section>

            <q-card-actions align="right">
              <q-btn flat label="Close" color="primary" v-close-popup />
            </q-card-actions>
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
.temp_bg {
  background-color: #F7F8FA;
}

/* Floating Action Button */
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

.toolbar-left {
  display: flex;
  align-items: center;
  gap: 12px;
}

.brand-logo {
  display: block;
}

.primary-nav {
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.7);
  padding: 2px;
}

.toolbar-actions {
  display: flex;
  align-items: center;
}

.header-plan-toggle {
  background: rgba(255, 255, 255, 0.18);
  padding: 4px 8px;
  border-radius: 10px;
}

.admin-btn {
  border-radius: 999px;
}

.subnav {
  padding: 12px 24px 0;
}

.pill-tabs {
  background: #F0F2F5;
  border-radius: 8px;
  padding: 4px;
  display: inline-flex;
  gap: 4px;
}

.pill-tab {
  border-radius: 6px;
  padding: 6px 16px;
  transition: all 0.2s;
  color: #5F6368;
  font-weight: 500;
}

.pill-tab:hover {
  background: rgba(0, 0, 0, 0.05);
}

.pill-tab-active {
  background: white !important;
  color: #1976D2 !important;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12);
}

.add-options-card {
  min-width: 320px;
  max-width: 400px;
}

.add-options-card .q-btn {
  width: 100%;
}

.multi-scan-note {
  font-size: 0.85rem;
  color: #374151;
  margin-top: 4px;
}

.limit-tag {
  font-size: 0.8rem;
  color: #4b5563;
  margin-top: 2px;
  text-align: center;
}

.multi-scan-footnote {
  font-size: 0.75rem;
  color: #6b7280;
  margin-top: 4px;
}

.multi-scan-footnote a {
  color: #1d4ed8;
  text-decoration: underline;
}
</style>
