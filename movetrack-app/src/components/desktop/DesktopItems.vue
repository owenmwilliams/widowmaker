<script setup lang="ts">

//ALL IMPORTS
  import { ref, onMounted, watch, computed } from 'vue';
  import { useRouter } from 'vue-router';
  import { inventoryStore } from '../../stores/InventoryStore';
  import DesktopAdd from './DesktopAdd.vue';
  import DesktopItemTable from './DesktopItemTable.vue';
  import DesktopLocationCards from './DesktopLocationCards.vue';
  import DesktopCollections from './DesktopCollections.vue';
  import DesktopSettings from './DesktopSettings.vue';
  import DesktopSupport from './DesktopSupport.vue';
  import PhotoCapture from '../PhotoCapture.vue';
  import VisionProviderToggle from '../VisionProviderToggle.vue';
  import VeriMoveLogo from '../VeriMoveLogo.vue';
  import { storeToRefs } from 'pinia';
  import type { InventoryItem } from '../../data/inventoryItems';


  const pageItem = ref('itemTable')
  const addItemDialog = ref(false)
  const showPhotoCapture = ref(false)
  const showVisionSettings = ref(false)
  const currentVisionProvider = ref<string>('gemini')
  const search = ref('')

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
    store.loadInventory(props.user!)
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

  const changePage = (newPage: string) => {
    pageItem.value = newPage
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
          <!-- <q-toolbar-title center> -->
            <!-- <q-item-section> -->
              <q-btn-group flat class="q-ma-sm">
                <q-btn flat no-caps class="text-weight-medium" label="My Items" @click="changePage('itemTable')" />
                <q-btn flat no-caps class="text-weight-medium" label="My Collections" @click="changePage('locationCards')" />
              </q-btn-group>

              <!-- Add Item with Photo Button -->
              <q-btn
                v-if="pageItem === 'itemTable'"
                unelevated
                color="primary"
                icon="photo_camera"
                label="Add Item"
                class="q-ml-md"
                :disable="store.collections.length == 0"
                @click="showPhotoCapture = true"
              />

              <q-toolbar-title />
              <q-btn flat round dense>
                <VeriMoveLogo class="q-ma-xs" />
                <q-menu style="z-index: 9999;">

                  <q-item clickable v-ripple @click="changePage('settings')">
                    <q-item-section class="text-primary" avatar>
                      <q-icon name="settings" />
                    </q-item-section>
                    <q-item-section class="text-primary">
                      Settings
                    </q-item-section>
                  </q-item>

                  <q-separator />

                  <q-item clickable v-ripple @click="changePage('support')">
                    <q-item-section class="text-primary" avatar>
                      <q-icon name="help_outline" />
                    </q-item-section>
                    <q-item-section class="text-primary">
                      Support
                    </q-item-section>
                  </q-item>

                  <q-separator />

                  <q-item clickable v-ripple @click="logoutFunction">
                    <q-item-section class="text-primary" avatar>
                      <q-icon name="logout" />
                    </q-item-section>
                    <q-item-section class="text-primary">
                      Logout
                    </q-item-section>
                  </q-item>

                </q-menu>

              </q-btn>
        </q-toolbar>
      </q-header>

      <!-- <q-header elevated>
        <q-toolbar>
          <q-btn dense flat round icon="menu" @click="leftDrawerOpen = !leftDrawerOpen" />

          <q-toolbar-title>
            skwurlit
          </q-toolbar-title>
          <q-btn color="secondary" :disable="store.collections.length == 0" label="Add Item" icon="add" @click="addItemDialog = true" />
        </q-toolbar>
      </q-header> -->

      <q-page-container>
          <div v-if="pageItem == 'itemTable'">
            <DesktopItemTable :user="props.user!" @addItem="addItemDialog = true" />
          </div>
          <div v-else-if="pageItem == 'locationCards'">
            <DesktopCollections :user="props.user!" />
          </div>
          <div v-else-if="pageItem == 'settings'">
            <DesktopSettings :user="props.user!" />
          </div>
          <div v-else-if="pageItem == 'support'">
            <DesktopSupport />
          </div>

      </q-page-container>

        <q-dialog  v-model="addItemDialog" persistent>
          <DesktopAdd :user="props.user!" addType="Item"  />
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
        <q-dialog v-model="showPhotoCapture" persistent>
          <q-card style="min-width: 600px; max-width: 800px;">
            <q-card-section>
              <PhotoCapture
                :vision-provider="currentVisionProvider"
                :user="props.user"
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
</style>
