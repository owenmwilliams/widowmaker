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
  import VisionProviderToggle from '../VisionProviderToggle.vue';
  import VeriMoveLogo from '../VeriMoveLogo.vue';
  import type { InventoryItem } from '../../data/inventoryItems';

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

//ALL CONSTANTS AND VARIABLES
  const isAdd = ref(false)

  const store = inventoryStore()

  const showAdd = ref(false);
  const collectionIndex = ref(0)
  const { activeContainer, activeCollection } = storeToRefs(store)
  const showLeft = ref(false)
  const showEdit = ref(false)
  const activeId: Ref<number | undefined> = ref(undefined)
  const activeObjectType = ref(ObjectEnum.item)
  const activeEditBool = ref(false)
  const tokensDialog = ref(false)
  const reloadContainers = ref(0)
  const showPhotoCapture = ref(false)
  const showVisionSettings = ref(false)
  const currentVisionProvider = ref<string>('gemini')

  const shouldRevealHeader = computed(() => !showPhotoCapture.value);
  const shouldRevealFooter = computed(() => !showPhotoCapture.value);

  // Compute total items count for sparse inventory detection
  const totalItemsCount = computed(() => {
    if (!activeCollection.value) return 0;
    return store.items.filter(i => i.collection === activeCollection.value?.value).length;
  });

  // Show enhanced CTA when inventory is sparse (< half screen of content)
  // Estimate: Each container + items = ~60px per item, screen height ~600-800px
  // Half screen = ~300-400px = ~5-7 items
  const showEnhancedCTA = computed(() => totalItemsCount.value < 6);

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

  const onEditItem = (id: number) => {
    if (store.items.find(i => i.value == id)?.container != null) {
      store.setActiveContainer({label: store.containers.find(i => i.value == store.items.find(i => i.value == id)?.container)?.label, value: store.items.find(i => i.value == id)?.container})
    } else {
      store.activeContainer = undefined
    }

    activeId.value = id
    activeObjectType.value = ObjectEnum.item
    activeEditBool.value = true
    isAdd.value = !isAdd.value
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

  // To adjust url based on whether in prod or not
  const token_url = import.meta.env.MODE == 'development' ? 'http://localhost:5174/tokens/' : 'https://take-stock.xyz/tokens/'

  const xyzURL = ref('')
  const showTokens = ref(false)


  function binaryToBase64(buffer) {
    // Convert binary data to a string
    const binaryString = Object.values(buffer).map(byte => String.fromCharCode(byte as number)).join('');

    // Encode the binary string to base64
    const base64Data = window.btoa(binaryString);

    return base64Data;
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

    xyzURL.value = token_url + '?id=' + encodeURIComponent(encrypted) + '&iv=' + encodeURIComponent(encodedIV)
    showTokens.value = true
    tokensDialog.value = false
  }

  const copyURL = (url: string) => {
    navigator.clipboard.writeText(url)
  }

  const openInMetamask = (url: string) => {
    let fullURL = 'https://metamask.app.link/dapp/' + url
    window.location.href = fullURL;
  }

  const openInCoinbase = (url: string) => {
    let fullURL = 'https://go.cb-w.com/dapp?cb_url=' + url
    window.location.href = fullURL;
  }

  const tokenList = computed(() => {
    if (activeContainer.value != undefined) {
      return store.items.filter(i => 
        i.value != null &&
        i.picture_url != null &&
        i.container == activeContainer.value?.value)
    } else {
      return store.items.filter(i => 
        i.value != null && 
        i.picture_url != null &&
        i.collection == activeCollection.value?.value)
    }
  })

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

</script>

<template>
  <q-dialog v-model="showTokens">
    <q-card >
      <q-card-section>
        <div class="text-h6">Tokenize</div>
      </q-card-section>
      <q-card-section>
        <div class="row">
          <div class="col-3">
            <q-btn flat label="Copy" @click="copyURL(xyzURL)" />
          </div>
          <div class="col-9">
            <q-input
              dense
              v-model="xyzURL"
              filled
              disable
              />
          </div>
        </div>
      </q-card-section>
      <q-card-section class="row">
        <div class="col-6">
          <q-btn class="q-ma-sm" label="Open in Metamask" style="background: #F5841F;" @click="openInMetamask(xyzURL)" />
        </div>
        <div class="col-6">
          <q-btn class="q-ma-sm" label="Open in Coinbase" style="background: #0053FF; color: white;" @click="openInCoinbase(xyzURL)" />
        </div>
      </q-card-section>
    </q-card>
  </q-dialog>

  <q-dialog v-model="tokensDialog">
    <q-card dense >
      <q-card-section >
        <q-btn
          v-for="(item, index) in tokenList"
          
          :header-inset-level="1"
          :label="item.label"
          clickable
          
          @click="pushToToken(item.value)"
        />
      </q-card-section>
    </q-card>
  </q-dialog>

  <q-dialog v-model="showEdit">
    <q-card dense >
      <MobileEditSelect @selected="pushSelected" @close="closeEditDialog" :collection_id="Number(store.activeCollection?.value)" />
    </q-card>
  </q-dialog>

  <q-dialog v-model="isAdd">
    <MobileAdd :user="user" :edit-select="activeEditBool" :object-type="activeObjectType" :id-prop="Number(activeId)" @close="closeAddDialog" />
    <!-- <testSelect  /> -->
  </q-dialog>

  <!-- Vision Settings Dialog -->
  <q-dialog v-model="showVisionSettings">
    <q-card style="min-width: 350px;">
      <q-card-section>
        <div class="text-h6">Vision AI Provider</div>
        <VisionProviderToggle @provider-changed="handleProviderChanged" />
      </q-card-section>

      <q-card-actions align="right">
        <q-btn flat label="Close" color="primary" v-close-popup />
      </q-card-actions>
    </q-card>
  </q-dialog>

  <!-- Photo Capture Dialog -->
  <q-dialog v-model="showPhotoCapture" maximized>
    <q-card>
      <q-card-section class="q-pa-none">
        <PhotoCapture
          :vision-provider="currentVisionProvider"
          :user="props.user"
          :auto-open="true"
          @item-added="handlePhotoItemAdded"
          @close="showPhotoCapture = false"
        />
      </q-card-section>
    </q-card>
  </q-dialog>

  <q-layout view="hHh lpR fFf">

    <q-header v-if="shouldRevealHeader" reveal bordered class="bg-primary text-white">
      <q-toolbar>
        <q-btn dense flat round icon="menu" @click="showLeft = !showLeft" />

        <q-toolbar-title center>
          <q-breadcrumbs active-color="white" style="font-size: 16px">
            <q-breadcrumbs-el :label="props.user" />
            <q-breadcrumbs-el v-if="store.activeCollection" :label="store.activeCollection.label" />
          </q-breadcrumbs>
        </q-toolbar-title>

        <VeriMoveLogo :width="120" :height="32" color="white" check-color="rgba(255,255,255,0.8)" style="margin-left: 8px;" />
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

        <q-item clickable v-ripple @click="showVisionSettings = true">
          <q-item-section>Vision AI Settings</q-item-section>
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

      <!-- Collection card removed - editing collections only available on desktop -->
      <div class="q-pa-md" >
        <q-list class="text-primary text-weight-medium">
          
          <!-- Expansion item for each container in the collection -->
          <q-expansion-item
            v-for="(container, index) in store.containers.filter((i) => i.collection == store.activeCollection?.value)"            
            expand-separator
            group="Containers"
            v-model="container.active"
            icon="filter_none"
            header-class="text-h6 font-weight-medium"
            :label="container.label"
            :caption="store.items.filter((i) => i.container == container.value).length + ' items(s)'"
            @show="store.activeContainer = { label: container.label, value: container.value }"
            @hide="() => {
              if (store.activeContainer?.value == container.value) {
                store.activeContainer = undefined
              }
            }"
            >
            <ItemToggleCard
              v-for="(item, index) in store.items.filter((i) => i.container == container.value)"
              :id="item.value"
              :picture_url="item.picture_url"
              :label="item.label"
              :description="item.description"
              @edit="onEditItem" 
              @tokenize="pushToToken(item.value)"
              />
          </q-expansion-item>

          <ItemToggleCard
            v-if="store.items.filter((i) => i.collection == store.activeCollection?.value && i.container == null).length > 0" 
            v-for="(item, index) in store.items.filter((i) => i.collection == store.activeCollection?.value && i.container == null)"
              :id="item.value"
              :picture_url="item.picture_url"
              :label="item.label"
              :description="item.description"
              @edit="onEditItem"
              @tokenize="pushToToken(item.value)"
              />
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

</style>