<script setup lang="ts">

    const props = defineProps<{
        cards: Array<any>
    }>()

</script>

<template>

  <div class="card-list">
      <q-card
          flat
          v-for="card in cards"
          :key="card.id"
          class="card"
          elevation="2"
      >
          <q-card-section class="card q-pa-none q-ma-none" vertical>
              <q-card-section class="icon-section flex flex-center q-px-none q-py-sm">              
                  <q-img
                  class="icons flex flex-center"
                  :src="card.icon"
                  />
              </q-card-section>
              <q-card-section class="q-pa-none flex flex-center">
                  <q-card-section class="title-section ">
                      <h5 class="title">{{ card.title }}</h5>
                  </q-card-section>
                  <q-card-section class="description-section q-ma-none">
                      <p class="q-ma-none">{{ card.description }}</p>
                  </q-card-section>
              </q-card-section>
          </q-card-section>
      </q-card>
  </div>

</template>

<style scoped>

  .card-list {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding-left: 5vw;
    padding-right: 5vw;
  }
  .card {
    padding: 0;
    margin: 5px;
  }
  .icons{
    height: 150px;
    width: 150px;
    text-align: center;
    /* padding: 10px; */
    border-radius: 20px;
  }
  .title {
    font-weight: 600;
    padding: 0;
    margin: 0;
  }
  .description-section {
    display: flex;
    align-items: center;
    /* padding: 10px; */
  }

</style>