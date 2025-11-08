<script setup lang="ts">

//ALL IMPORTS
  import { Ref, ref, watch, toRaw, onMounted, computed } from 'vue';
  import { useRoute } from 'vue-router';
  import { inventoryStore } from '../../stores/InventoryStore';
  import { HfInference } from "@huggingface/inference";
  import axios from 'axios';
  import TagList from '../TagList.vue';
  import { windowWidth } from 'vant/lib/utils';
  import { Camera, CameraResultType } from '@capacitor/camera';
  import { useQuasar } from 'quasar';
//STORE
  const store = inventoryStore();
  const core_url = import.meta.env.MODE == 'development' ? 'http://localhost:3050' : 'https://movetrack-api-7hwn7ggbiq-uc.a.run.app';

  // const $q = useQuasar()

//ALL PROPS & EMITS
  const props = defineProps({
    user: {type: String, required: true},
    imageBlob: {type: Blob, required: true},
    image_base64: {type: String, required: true},
    style: {type: String, required: true},
  })

  const emits = defineEmits<{
    (e: 'app:loading', id: boolean): void
    (e: 'close'): void
  }>()

//ALL CONSTANTS AND VARIABLES

  // These are the user constants that we use for data storage
  const user = ref(props.user)

  // These are constants that are use-inputs from popover to add another item
  const name = ref('');
  const originalName = ref('');
  const description = ref('');
  const quantity: Ref<number | undefined> = ref();
  const image_url = ref('');
  const image: Ref<any | undefined> = ref();
  const isLoading = ref(false)
  const tempDescription = ref(new Set);
  const booksArray: Ref<any[]> = ref([])

  // These are constants that populate the drop-down select menu to allow choosing a location and room
  const location: Ref<number | undefined> = ref();
  // const locationOptions: Ref<{label: string, value: number}[]> = ref([]);

  const locationOptions = computed(() => {
    return store.locations.map(i => {return {label: i.label, value: i.value}})
  })

  // const collection: Ref<number | undefined> = ref();
  // const collectionOptions: Ref<{label: string, value: number}[]> = ref([]);


  // const container: Ref<number | undefined> = ref();
  // const containerOptions: Ref<{label: string, value: number}[]> = ref([]);

//ALL FUNCTIONS

  function cancelFunction () {

  }

  async function analyzeImage(imageFile) {
    const formData = new FormData();
    formData.append('file', imageFile);

    try {
      const sessionToken = localStorage.getItem('session_token');

      let data = await axios.post(core_url + '/vision/analyze', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
          'Authorization': 'Bearer ' + sessionToken
        },
      });
      console.log(data)

      return data.data;
    } catch (error) {
      console.error('Error analyzing image:', error);
      throw error;
    }
  }

  onMounted(async () => {
    isLoading.value = true

    // collection.value = store.activeCollection
    // container.value = store.activeContainer

    // Define the collection
    // collection.value = Number(store.activeCollection) ?? 0
    // // Define the collection options
    // collectionOptions.value = store.collections.map(i => {return {label: i.label, value: i.value}})
    
    // // Define the container
    // container.value = Number(store.activeContainer) ?? undefined
    // containerOptions.value = store.containers.filter(i => i.collection_id == collection.value ?? 0).map(i => {return {label: i.label, value: i.value}})

    

    try {
      const data = {
        file: props.image_base64,
        style: props.style,
      }

      const sessionToken = localStorage.getItem('session_token');

      axios.post(`${core_url}/gpt/object`, data, {
        headers: {
          Authorization: `Bearer ${sessionToken}`,
          'Content-Type': 'application/json',
        },
        maxContentLength: 1000000000,
        maxBodyLength: 10000000000
      })
      .then(response => {

          name.value = response.data.titleResponse.choices[0].message.content.replace(/\./g, '')

          description.value = response.data.descriptionResponse.choices[0].message.content
          
          if (!isNaN(response.data.quantityResponse.choices[0].message.content)) {
            quantity.value = Number(response.data.quantityResponse.choices[0].message.content)
          } else {
            quantity.value = 0
          }
        })
        .catch(error => {
          // Handle errors
          description.value = error
          isLoading.value = false;
        })
        .finally(() => {
          isLoading.value = false
        })

    } catch (error) {
      console.log(error)
      isLoading.value = false
      emits('close')
    }
  })

  // store.createItem(user.value, name.value, description.value, quantity.value ?? 1, store.activeCollection!.value, store.activeContainer?.value, loca)
  // This function calls post function to add a container to a room and *** SHOULD *** navigate to the room added to
  const onSubmit = async () => {
    store.createItem(
      props.user, 
      name.value, 
      description.value, 
      quantity.value ?? 1, 
      store.activeCollection!.value,
      store.activeContainer?.value,
      undefined,
      props.imageBlob
    )
    emits('close')
  }

  function handleTagChanged(value) {
    tempDescription.value = new Set(value);
  }

  function handleTagSwiped(value) {
    if (name.value == originalName.value) {
      name.value = value
    } else {
      name.value = name.value + ' ' + value
    }
  }

  watch(() => store.activeCollection, (newCollection, oldCollection) => {
    store.activeContainer = undefined
  });

  const consoleLog = () => {
    console.log('log here to debug')
  }
</script>

<template>
  <q-spinner-grid class="loading" v-if="isLoading" size="50px" color="positive" />
  
  <div v-if="(props.style != 'bookshelf')" class="form-container">
    <q-btn flat round dense class="q-pa-md fixed-top-left"  @click="emits('close')">
      <q-icon name="close" />
    </q-btn>
    <q-input
      borderless
      square
      :input-style="{
      textAlign: 'center',
      paddingTop: '20px',
      paddingBottom: '20px',
      width: '100vw',
      fontWeight: '1000',
      textShadow: '2px 2px 0px #26577c',
      fontSize: '28px',
      color: '#ffffff'}"
      v-model="quantity"
    />

    <q-input
      square
      borderless
      autogrow
      :input-style="{
      textAlign: 'center',
      paddingTop: '20px',
      paddingBottom: '20px',
      width: '100vw',
      fontWeight: '1000',
      textShadow: '2px 2px 0px #26577c',
      fontSize: '28px',
      color: '#ffffff'
      }"
      v-model="name"
    />

    <q-input
      square
      borderless
      type="textarea"
      :input-style="{
      textAlign: 'left',
      paddingTop: '20px',
      paddingBottom: '20px',
      width: '100vw',
      fontWeight: '600',
      textShadow: '1px 1px 0px #26577c',
      fontSize: '14px',
      color: '#ffffff',
      maxWidth: '90vw',
      height: '50vh',}"
      v-model="description"
    />

    <!-- <q-scroll-area style="height: 40vh; min-width: 90vw; align-content: center; align-self: center; padding-top: 10vh; padding-bottom: 10vh; z-index: 1000;">
      <TagList :tags-array="tagsArray" @tag-changed="handleTagChanged" @tag-swiped="handleTagSwiped" />
    </q-scroll-area> -->

    <!-- <div class="q-pa-md">
      <TagList :tags-array="tagsArray" />
    </div> -->

    <div class="inlineSelect">
      <q-select
        style="width: 50vw;"
        borderless
        v-model="store.activeCollection"
        :options="store.collections.map(i => {return {label: i.label, value: i.value}})"
        label="Collection"
      />

      <q-select
        style="width: 50vw;"
        borderless
        v-model="store.activeContainer"
        :options="store.containers.filter(i => i.collection == store.activeCollection?.value).map(i => {return {label: i.label, value: i.value}})"
        bottom-slots
        clearable
        label="Container"
      />
    </div>
    

    <q-btn flat filled dense class="bg-positive q-pa-sm fixed-bottom-center" style="width: 85vw;" label="submit" icon="add_circle" @click="onSubmit" />
  </div>
</template>

<style scoped>
/* loading class with a centered position that takes up 1/3 of the screen */
.loading {
  position: absolute; /* Fixed/sticky position */
  z-index: 999; /* Sit on top */
  left: 35%;
  top: 35%;
  width: 30%; /* Full width */
  height: 30%; /* Full height */
  overflow: auto; /* Enable scroll if needed */
}

.q-field__control {
     max-height: 24px;
     &::after {
      max-height: 24px;
      color: orange;
    }
}
.form-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  width: 100%;
  overflow: hidden;
  padding: 0;
}
.inlineSelect {
  display: inline-block;
}
</style>
