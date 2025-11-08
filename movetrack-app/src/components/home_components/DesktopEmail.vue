<script setup>
  import { ref } from 'vue';
  import { useQuasar } from 'quasar';
  import axios from 'axios';

  const props = defineProps({
    isMobile: {
      type: Boolean,
      default: false
    }
  });
  
  const core_url = import.meta.env.MODE == 'development' ? 'http://localhost:3050' : 'https://movetrack-api-7hwn7ggbiq-uc.a.run.app'
  
  const $q = useQuasar();
  
  const name = ref('');
  const email = ref('');
  const message = ref('');
  
  const onSubmit = async () => {
    const requestData = {
      name: name.value,
      email: email.value,
      message: message.value
    };
  
    try {
      await axios.post(`${core_url}/email/send`, requestData);
      $q.notify('Message sent successfully');
      name.value = '';
      email.value = '';
      message.value = '';
    } catch (error) {
      console.error('Error sending message:', error);
      $q.notify('Error sending message');
    }
  };
  </script>

<template>
    <q-form class="q-pa-md" @submit.prevent="onSubmit">
        <div class="row" v-if="!props.isMobile">
            <q-input class="col-6 q-pa-sm" filled v-model="name" label="Your Name" />
            <q-input class="col-6 q-pa-sm" filled v-model="email" label="Your Email" type="email" />
        </div>
        <div v-else>
            <q-input class="row q-pa-sm" filled v-model="name" label="Your Name" />
            <q-input class="row q-pa-sm" filled v-model="email" label="Your Email" type="email" />
        </div>
        <div class="row q-ma-sm">
            <q-input class="col-12" filled v-model="message" label="Message" type="textarea" />
        </div>
      <q-btn  class="q-ma-sm" label="Send Message" type="submit" color="primary" />
    </q-form>
  </template>
  
  
  
  <style scoped>
  /* Add your styles here */
  </style>
  