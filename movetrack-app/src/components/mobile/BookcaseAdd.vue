<script setup lang="ts">

//ALL IMPORTS
  import { Ref, ref, watch, onMounted, computed } from 'vue';
  import { inventoryStore } from '../../stores/InventoryStore';
  import axios from 'axios';

  //STORE
  const store = inventoryStore();
  const core_url = import.meta.env.MODE == 'development' ? 'http://localhost:3050' : 'https://movetrack-api-7hwn7ggbiq-uc.a.run.app';

//ALL PROPS & EMITS
  const props = defineProps({
    user: {type: String, required: true},
    location: {type: String, required: false},
    imageBlob: {type: Blob, required: true},
    image_base64: {type: String, required: true},
  })

  const emits = defineEmits<{
    (e: 'close'): void
  }>()

//ALL CONSTANTS AND VARIABLES

  // These are constants that are use-inputs from popover to add another item
  const isLoading = ref(false)
  const booksArray: Ref<any[]> = ref([])

  const location: Ref<{label: string, value: number} | undefined> = ref();

//ALL FUNCTIONS

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

    console.log('active collection is: ', store.activeCollection?.value)
    console.log((store.containers.filter(i => i.collection == store.activeCollection?.value).length))

    try {
      const dataViz = await analyzeImage(props.imageBlob)
      console.log('vision data is: ', dataViz)

      const data = {
        string: dataViz.detectedText,
      }

      const sessionToken = localStorage.getItem('session_token');

      axios.post(`${core_url}/gpt/bookshelf`, data, {
        headers: {
          Authorization: `Bearer ${sessionToken}`,
          'Content-Type': 'application/json',
        },
        maxContentLength: 1000000000,
        maxBodyLength: 10000000000
      })
        .then(response => {
          // Handle the response

          // Convert the json string to an object
          const booksJSON = JSON.parse(response.data.booksResponse.choices[0].message.content)
          console.log(booksJSON)

          booksArray.value = Object.keys(booksJSON).map((key) => ({
            title: booksJSON[key].title,
            author: booksJSON[key].author,
            publisher: booksJSON[key].publisher,
          }));

          console.log('booksArray after first attempt: ', booksArray.value)

          if (Array.from(new Set(booksArray.value.map(i => i.title))).length == 1 && new Set(booksArray.value.map(i => i.title))[0] == undefined && booksJSON.books) {
            booksArray.value = Object.keys(booksJSON.books).map((key) => ({
              title: booksJSON.books[key].title,
              author: booksJSON.books[key].author,
              publisher: booksJSON.books[key].publisher,
            }));
            console.log('booksArray after second attempt: ', booksArray.value)
          }

          
        })
        .then(() => {
          booksArray.value.forEach(async(item, index) => {
            if (item.title == undefined) {
              return
            } else {
              await axios.post(`${core_url}/google/search-books`, { query: item.title }, { //+ ' , ' + item.author + ' , ' + item.publisher }, {
                headers: {
                  Authorization: `Bearer ${sessionToken}`,
                  'Content-Type': 'application/json',
                },
              })
              .then(response => {
                if (response.data.length == 0) {
                  return
                } else {
                  // console.log('response.data is: ', response.data.books.map(i => i.volumeInfo.imageLinks?.smallThumbnail))
                  booksArray.value[index].image_url = response.data.books.map(i => i.volumeInfo.imageLinks?.smallThumbnail).filter(i => i != undefined)
                  booksArray.value[index].image_number = 0
                }
              })
            }
          })
        })
        .then(() => {
          if (store.activeContainer == undefined) {
            return
          } else {
            booksArray.value.forEach(item => {
              item.container = store.activeContainer
            })
          }
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

  const consoleLog = () => {
    console.log('log here to debug')
  }

  const onDelete = (index: number) => {
    booksArray.value.splice(index, 1)

    if (booksArray.value.filter(i => i.title != undefined).length == 0) {
      emits('close')
    }
  }

  const onSubmit = async (index: number) => {
    store.createItemOutsideUrl(
      props.user, 
      booksArray.value[index].title, 
      booksArray.value[index].author + '\n' + booksArray.value[index].publisher,
      1, 
      store.activeCollection!.value, 
      store.activeContainer?.value, 
      location.value?.value,
      booksArray.value[index].image_url[booksArray.value[index].image_number] ?? ''
    )
    booksArray.value.splice(index, 1)

    if (booksArray.value.filter(i => i.title != undefined).length == 0) {
      emits('close')
    }
  }

  watch(() => store.activeCollection, (newCollection, oldCollection) => {
    store.activeContainer = undefined
    booksArray.value.forEach(item => {
      item.container = undefined
    })
  });

  
</script>

<template>


  <q-spinner-grid class="loading" v-if="isLoading" size="50px" color="positive" />

  <div v-else class="form-container">
    <div class="fixed-top row bg-white" style="width: 100vw; z-index: 9999;">
      
      <div class="col-9">
        <div class="row q-pa-sm">
          <q-select
            borderless
            dense
            v-model="store.activeCollection"
            :options="store.collections.map(i => {return {label: i.label, value: i.value}})"
          >
            <template v-slot:prepend>
              <q-icon name="category" />
            </template>
          </q-select>
        </div>
      </div>
      <div class="col-3 q-pa-sm">
        <q-btn filled dense label="Cancel" color="warning" text-color="black" class="q-pa-sm" v-close-popup />
          <!-- <q-icon name="close" />
        </q-btn> -->
      </div>
    </div>
    
    
    <q-list class="q-px-md q-mt-md q-pt-xl">
        <q-card class="q-mt-md" v-for="(item, index) in booksArray?.filter(i => i.title != undefined)" :key="index" style="width: 100%;" flat bordered>
          <q-card-section class="q-pa-none" borderless horizontal style="height: 35vh;">
            <q-card-section class="col-4 q-pa-none">
                <q-carousel
                  vertical
                  control-type="flat"
                  control-color="primary"
                  style="height: 100%;"
                  v-model="item.image_number"
                  arrows
                  infinite
                  class="bg-grey-2"
                >
                  <q-carousel-slide class="carousel" v-for="(image, index) in item.image_url" :name="index">
                      <q-img
                        style="width: 85%; box-shadow: 5px 5px 0px 0px #26577c;  border-color: #26577c; border-width: 1px; border-style: solid;"
                        fit="contain"
                        :src="image"
                      />
                  </q-carousel-slide>
                </q-carousel>
            </q-card-section>
            
            <q-card-section vertical class="q-pl-md col-8">
            <!-- <q-card-section vertical > -->
              <q-input
                square
                dense
                borderless
                type="textarea"
                class="title-card"
                style="max-height: 50%; overflow: hidden; text-overflow: ellipsis;"
                :input-style="{
                  fontWeight: '500',
                  letterSpacing: '1.5px',
                  lineHeight: '25px',
                  fontSize: '20px',
                  color: '#26577c'
                }"
                v-model="item.title"
                label="Title"
              />
              <q-input
                square
                dense
                borderless
                type="textarea"
                autogrow
                :input-style="{
                  fontWeight: '400',
                  letterSpacing: '1px',
                  lineHeight: '16px',
                  fontSize: '14px',
                  color: '#26577c'
                }"
                v-model="item.author"
                label="Author"
              />
              <q-input
                square
                dense
                borderless
                type="textarea"
                autogrow
                :input-style="{
                  fontWeight: '300',
                  letterSpacing: '0.5px',
                  lineHeight: '11px',
                  fontSize: '10px',
                  color: '#26577c'
                }"
                v-model="item.publisher"
                label="Publisher"
              />
              <q-select
                borderless
                dense
                filled
                class="row"
                v-model="item.container"
                :options="store.containers.filter(i => i.collection == store.activeCollection?.value).map(i => {return {label: i.label, value: i.value}})"
                label="Container"
              />
            </q-card-section>
          </q-card-section>
          
          <q-card-actions borderless horizontal class="justify-around q-px-md bg-grey-2">
            <q-btn flat color="positive" label="add" icon="add_circle" @click="onSubmit(index)" />
            <q-btn flat color="negative" label="remove" icon="cancel" @click="onDelete(index)" />
          </q-card-actions>
        </q-card>
    </q-list>
  </div>
</template>

<style scoped>
.title-card {
  font-size: 1em;
  container-name: title;
}
.carousel {
  /* height: 100%; */
  width: 100%;
  display: flex;
  justify-content: center; /* Center horizontally */
  align-items: center; /* Center vertically */
}
.loading {
  position: absolute; /* Fixed/sticky position */
  z-index: 999; /* Sit on top */
  left: 35%;
  top: 35%;
  width: 30%; /* Full width */
  height: 30%; /* Full height */
  overflow: auto; /* Enable scroll if needed */
}
.form-container {
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: 100%;
  padding: 0;
}
</style>
