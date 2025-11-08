<script setup lang="ts">

//ALL IMPORTS
  import { Ref, computed, ref, watch } from 'vue';
  import { useRouter } from 'vue-router';
  import FooterVue from '../Footer.vue';
  import { inventoryStore } from '../../stores/InventoryStore';
  import { storeToRefs } from 'pinia';
  import { useQuasar } from 'quasar';
  import MobileAdd from './MobileAdd.vue';
  import PhotoAdd from './PhotoAdd.vue';
  import BookcaseAdd from './BookcaseAdd.vue';
  import { Camera, CameraResultType } from '@capacitor/camera';
  import MobileEditSelect from './MobileEditSelect.vue';
  import axios from 'axios';
  import ItemToggleCard from '../ItemToggleCard.vue';

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

  const $q = useQuasar()

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
  const imageAdd = ref(false)
  const imageAddMultiple = ref('single')
  const image_url = ref('')
  const image_base64 = ref('')
  const imageBlob: Ref<Blob | null> = ref(null)
  const showCamera = ref(false)
  const reloadContainers = ref(0)

  const styles = [
    'plain description',
    'embellished description',
    'e-commerce post',
    'instruction manual',
    'artwork statement',
    'book synopsis',
    'billboard or newspaper advertisement',
    'breaking news bulletin',
    'explanation for the blind or visually impaired',
    'poem, haiku, or limerick',
  ]

  const chosenStyle = ref('plain description')

  const shouldRevealHeader = computed(() => !showCamera.value);
  const shouldRevealFooter = computed(() => !showCamera.value);

  const computedAddThings = computed(() => {
    if (store.collections.length == 0) {
      return [
        { label: 'Add Collection', img: 'https://storage.googleapis.com/take-stock-design-assets/icons/collection_icon.png', color: 'primary', id: 'collection' },
        { label: 'Add Location', img: 'https://storage.googleapis.com/take-stock-design-assets/icons/location_icon.png', color: 'primary', id: 'location' },
        // { label: 'Edit Inventory', img: 'https://storage.googleapis.com/take-stock-design-assets/icons/edit_icon.png', color: 'primary', id: 'edit' },
        // {},
        // { label: 'Bookshelf', img: 'https://storage.googleapis.com/take-stock-design-assets/icons/books_icon.png', color: 'primary', id: 'bookshelf-disabled' },
      ]
    } else {
      return [
        { label: 'Collection', img: 'https://storage.googleapis.com/take-stock-design-assets/icons/collection_icon.png', color: 'primary', id: 'collection' },
        { label: 'Item', img: 'https://storage.googleapis.com/take-stock-design-assets/icons/item_icon.png', color: 'primary', id: 'item'},
        { label: 'Container', img: 'https://storage.googleapis.com/take-stock-design-assets/icons/container_icon.png', color: 'primary', id: 'container'},
        { label: 'Location', img: 'https://storage.googleapis.com/take-stock-design-assets/icons/location_icon.png', color: 'primary', id: 'location' },
        {},
        
        { label: 'Image Add', img: 'https://storage.googleapis.com/take-stock-design-assets/icons/camera_icon.png', color: 'primary', id: 'image' },
        { label: 'Bookshelf Add', img: 'https://storage.googleapis.com/take-stock-design-assets/icons/books_icon.png', color: 'primary', id: 'bookshelf' },
        {},
        { label: 'Edit Inventory', img: 'https://storage.googleapis.com/take-stock-design-assets/icons/edit_icon.png', color: 'primary', id: 'edit' },
      ]
    }
  })

  const show = (grid: any) => {
    $q.bottomSheet({
        style: 'background-color: #f5f9e9; margin-left: 5vw; margin-right: 5vw;',
        actions: computedAddThings.value,
    })
    .onOk(action => {
      if (action.id == 'edit') {
        showEdit.value = true
      } else if (action.id == 'bookshelf') {
        imageAddMultiple.value = 'plural'
        takePicture()
      } else if (action.id == 'image') {
        // imageAddMultiple.value = 'plural'
        addItemPhoto()
      } else if (action.id == 'bookshelf-disabled') {
          $q.notify({
            message: 'Bookshelf add is disabled for this location because there are no containers; navigate to a location with containers to continue.',
            color: 'negative',
            position: 'bottom',
            icon: 'report_problem'
          })
      } else if (action.id == 'image-disabled') {
          $q.notify({
            message: 'Image add is disabled for this location because there are no containers; navigate to a location with containers to continue.',
            color: 'negative',
            position: 'bottom',
            icon: 'report_problem'
          })
      } else if (action.id == 'token-disabled') {
          $q.notify({
            message: 'Tokenization is disabled for this location because there are no items to tokenize; navigate to a new location to continue.',
            color: 'negative',
            position: 'bottom',
            icon: 'report_problem'
          })
      } else {
        onSelectThing(action.id)
      }
    }).onCancel(() => {
      console.log('Dismissed')
    }).onDismiss(() => {

      console.log('I am triggered on both OK and Cancel')
    })
  }

  const addItemPhoto = () => {
    imageAddMultiple.value = 'single'
    addItem()
  }

  // Set the style to the desired style in a popup
  const showSetStyle = ref(false)
    
  const takePicture = async () => {
    showSetStyle.value = false
    showCamera.value = true
    const image = await Camera.getPhoto({
      quality: 100,
      allowEditing: true,
      height: 2000,
      resultType: CameraResultType.Base64,
    });

    showCamera.value = false
    
    const targetSizeInBytes = 90000; // Adjust the target size as needed
    const compressedBase64 = await compressBase64(image.base64String, targetSizeInBytes);

    image_url.value = generateURL(image);
    image_base64.value = compressedBase64;
    imageBlob.value = base64ToBlob(compressedBase64, 'image/jpeg');

    imageAdd.value = true;
  };

  function base64ToBlob(base64String: string, mimeType: string = ''): Blob {
    const byteCharacters = atob(base64String);
    const byteNumbers = new Array(byteCharacters.length);

    for (let i = 0; i < byteCharacters.length; i++) {
      byteNumbers[i] = byteCharacters.charCodeAt(i);
    }

    const byteArray = new Uint8Array(byteNumbers);

    return new Blob([byteArray], { type: mimeType });
  }

  async function compressBase64(base64String, targetSizeInBytes) {
    let quality = 0.9; // Starting quality

    while (true) {
      const compressedBase64 = await attemptCompression(base64String, quality);

      // Check if the compressed image size is within the target range
      if ((compressedBase64 as string).length <= targetSizeInBytes) {
        return compressedBase64;
      }

      // Adjust the quality for the next iteration
      quality -= 0.1;

      // Ensure we don't go below 0.1 (minimum quality)
      if (quality < 0.1) {
        break;
      }
    }

    // If we couldn't meet the target size, return the original base64
    return base64String;
  }

  async function attemptCompression(base64String, quality) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.src = `data:image/jpeg;base64,${base64String}`;

      img.onload = function () {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');

        const maxWidth = 800; // Adjust the maximum width as needed
        const maxHeight = 800; // Adjust the maximum height as needed

        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > maxWidth) {
            height *= maxWidth / width;
            width = maxWidth;
          }
        } else {
          if (height > maxHeight) {
            width *= maxHeight / height;
            height = maxHeight;
          }
        }

        canvas.width = width;
        canvas.height = height;

        if (ctx) {
          ctx.drawImage(img, 0, 0, width, height);
        }

        const compressedBase64 = canvas.toDataURL('image/jpeg', quality).split(',')[1];
        resolve(compressedBase64);
      };

      img.onerror = function (error) {
        reject(error);
      };
    });
  }

  const generateURL = (image: any, mimeType = 'image/jpeg') => {
    //MARK: come back to this to update the atob function
    const byteCharacters = atob(image.base64String);
    const byteNumbers = new Array(byteCharacters.length);

    for (let i = 0; i < byteCharacters.length; i++) {
      byteNumbers[i] = byteCharacters.charCodeAt(i);
    }

    const byteArray = new Uint8Array(byteNumbers);
    const blob = new Blob([byteArray], { type: mimeType });
    return URL.createObjectURL(blob);
  };

  const addItem = () => {
    showSetStyle.value = true
  }

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

  const onEditCollection = (id: number) => {
    activeId.value = id
    activeObjectType.value = ObjectEnum.collection
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
  <q-dialog v-model="showSetStyle">
    <q-card >
      <q-card-section>
        <div class="text-h6">Choose a style</div>
      </q-card-section>
      <q-card-section>
        <q-select
          
          filled
          v-model="chosenStyle"
          :options="styles"
          emit-value
          map-options
          dense
        />
      </q-card-section>
      <q-card-section>
        <q-btn label="Take Picture" flat color="positive" @click="takePicture" />
      </q-card-section>
    </q-card>
  </q-dialog>


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

  <q-dialog class="fullscreen-popover" v-model="imageAdd" self-contained full-width full-height maximized>
      <div class="imageScreen">
        <q-img  v-if="(imageAddMultiple == 'single')" fit="cover" class="image" :src="image_url">
          <PhotoAdd :style="chosenStyle" :user=props.user! :image_base64="image_base64" :image-blob="imageBlob!" @close="imageAdd = false" />  
        </q-img>
        <div class="bg-info">
          <BookcaseAdd v-if="(imageAddMultiple == 'plural')" :user=props.user! :image_base64="image_base64" :image-blob="imageBlob!" @close="imageAdd = false" />
        </div>
          
      </div>
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
  

  <q-layout view="hHh lpR fFf">

    <q-header v-if="shouldRevealHeader" reveal bordered class="bg-primary text-white">
      <q-toolbar>
        <q-btn dense flat round icon="menu" @click="showLeft = !showLeft" />

        <q-toolbar-title center>
          <q-breadcrumbs active-color="white" style="font-size: 16px">
            <q-breadcrumbs-el label="skwurlit" img="https://storage.googleapis.com/take-stock-design-assets/icon_small" />
            <q-breadcrumbs-el :label="props.user" />
          </q-breadcrumbs>
        </q-toolbar-title>
      </q-toolbar>
    </q-header>

    <q-drawer  v-model="showLeft" style="background-color: #f5f9e9;" side="left" overlay behavior="mobile" elevated>
      <q-list  padding class="rounded-borders text-primary">
        <q-item
          v-for="(collection, index) in store.collections"
          clickable
          v-ripple
          :active="(index == collectionIndex)"
          
          @click="changeCollection(index)"
          active-class="bg-primary text-white"
        >
          <q-item-section  avatar>
            <q-icon name="home" />
          </q-item-section>

          <q-item-section >{{ collection.label }}</q-item-section>
        </q-item>
        
        <q-item >
          <q-btn
            style="width: 100%;"
            class="bg-negative text-white"
            type="danger"
            label="LOG OUT"
            @click="logoutFunction"
          />
        </q-item>
        <q-item >
          <footer-vue class="footer" />
        </q-item>
      </q-list>
    </q-drawer>

    <q-page-container>

      <q-card clickable @click="onEditCollection(store.activeCollection!.value)" class="q-ma-sm bg-primary text-white">
        <q-card-section>
          <q-item>
            <q-item-section>
              <q-item-label class="text-h4">{{ store.activeCollection?.label }}</q-item-label>
              <q-item-label class="text-subtitle">{{ store.collections.find((i) => i.value == store.activeCollection?.value)?.description ?? '' }}</q-item-label>
            </q-item-section>

          </q-item>
        </q-card-section>
        <q-card-section>
          <q-img
            v-if="store.collections.find((i) => i.value == store.activeCollection?.value)?.picture_url != null"
            :src="store.collections.find((i) => i.value == store.activeCollection?.value)?.picture_url"
            style="width: 100%; height: 100%;"
            />
        </q-card-section>
      </q-card>
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

    <q-footer v-if="shouldRevealFooter" reveal  bordered style="height: 10vh;" class="bg-primary text-white">
      <q-btn size="lg" class="addButton" color="primary" icon="add" label="create new" @click="show(true)" />
    </q-footer>

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
.addButton {
  width: 100%;
  height: 100%;
}
/* .logOutButton {
  position: relative;
  width: 100%;
  font-weight: bolder;
  align-self: center;
  border: none;
} */
/* .logOutButton {
  position: relative;
  width: 100%;
  font-weight: bolder;
  align-self: center;
  border: none;
} */

/* Content scroll */

 .footer {
  margin: 0;
  left: 0;
  position: relative;
}

</style>