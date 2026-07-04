<script setup lang="ts">

//ALL IMPORTS
  import { computed, ref, defineEmits } from 'vue';

  import DesktopItemsVue from '../components/inventory/desktop/Workspace.vue';
  import MobileItemsVue from '../components/inventory/mobile/Items.vue';
  import { onMounted } from 'vue';
  import router from '../router';

  import axios from 'axios';
  import { API_BASE_URL } from '../config/api';
  import { isMobileViewport } from '../utils/viewport';

  const core_url = API_BASE_URL;

  const username = ref('')
  const userId = ref('')
  const redirectedToMobile = ref(false)

  const emits = defineEmits<{
    (e: 'app:loading', id: boolean): void
  }>()

  onMounted(() => {
    checkUser()
  })

  async function checkUser() {
    emits('app:loading', true)

    try {
        // Check for magic link session
        const sessionToken = localStorage.getItem('session_token');

        if (!sessionToken) {
          // No session, redirect to login
          emits('app:loading', false);
          router.push('/login');
          return;
        }

        // Verify session is still valid with the API
        const response = await axios.get(`${core_url}/auth/me`, {
          headers: {
            Authorization: `Bearer ${sessionToken}`
          }
        });

        if (response.data.success) {
          if (response.data.user) {
            localStorage.setItem('user_data', JSON.stringify(response.data.user));
          }
          username.value = response.data.user.username || response.data.user.email;
          userId.value = response.data.user.user_id || response.data.user.userId;
          emits('app:loading', false);
          if (isMobile.value) {
            redirectedToMobile.value = true;
            router.replace({ name: 'mobile-locations' });
          }
        } else {
          // Session expired, redirect to login
          localStorage.removeItem('session_token');
          localStorage.removeItem('user_data');
          emits('app:loading', false);
          router.push('/login');
        }

    } catch (error) {
        console.error('Auth error:', error);
        // Clear invalid session and redirect to login
        localStorage.removeItem('session_token');
        localStorage.removeItem('user_data');
        emits('app:loading', false);
        router.push('/login');
    }
  };

  const isMobile = computed(() => isMobileViewport());

  // const consoleLog = () => {
  //   console.log('log here to debug')
  // }


</script>

<template>
  <div v-if="isMobile && !redirectedToMobile">
    <MobileItemsVue :user="userId" />
  </div>

  <div v-else>
    <DesktopItemsVue :user="userId" />
  </div>

</template>

<style scoped>

</style>
