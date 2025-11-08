<script setup lang="ts">

//ALL IMPORTS
  import { computed, ref, defineEmits } from 'vue';

  import DesktopItemsVue from './desktop/DesktopItems.vue';
  import MobileItemsVue from './mobile/MobileItems.vue';
  import { onMounted } from 'vue';
  import router from '../router';

  import axios from 'axios';

  // To adjust url based on whether in prod or not
  const core_url = import.meta.env.MODE == 'development' ? 'http://localhost:3050' : 'https://movetrack-api-7hwn7ggbiq-uc.a.run.app'

  const username = ref('')

  const emits = defineEmits<{
    (e: 'app:loading', id: boolean): void
  }>()

  onMounted(() => {
    checkUser()
  })

  async function checkUser() {
    emits('app:loading', true)
    var timer = 0

    // TEMPORARY: Development bypass for Auth0 - REMOVE BEFORE PRODUCTION!
    if (import.meta.env.MODE === 'development') {
      const devUser = localStorage.getItem('dev_user');
      if (devUser) {
        console.log('Using dev user:', devUser);
        username.value = devUser;
        emits('app:loading', false);
        return;
      }
    }

    // This has to do the login first, then check the user...

    try {
        if (timer == 0) {
            await getAccessTokenSilently()
            .then(token => {
                const data = axios({
                method: 'get',
                url: core_url + '/users/',
                params: {
                    user_id: user.value.sub
                },
                headers: {
                    Authorization: 'Bearer ' + token
                }
                })
                return data
            })
            .then(response => {
                if (response.data == 'nodata') {
                  emits('app:loading', false)
                  router.push({ path: '/profile' })
                } else {
                  username.value = response.data.user_name
                  emits('app:loading', false)
                }
            })
        } else {
            setTimeout(() => {
            timer--
            }, 1000)
        }

    } catch (error) {
        console.error('Auth error (expected in dev mode):', error)
        // In development mode, fall back to dev_user if Auth0 fails
        if (import.meta.env.MODE === 'development') {
          const devUser = localStorage.getItem('dev_user');
          if (devUser) {
            console.log('Auth failed, using dev user:', devUser);
            username.value = devUser;
          }
        }
    } finally {
        emits('app:loading', false)
        timer = 10
    }
  };

  const isMobile = computed(() => {
    const minWidth = 768; // Minimum width for desktop devices
    return window.innerWidth < minWidth || screen.width < minWidth;
  });

  // const consoleLog = () => {
  //   console.log('log here to debug')
  // }


</script>

<template>
  <div v-if="isMobile">
    <MobileItemsVue :user="username" />
  </div>

  <div v-else>
    <DesktopItemsVue :user="username" />
  </div>
    
</template>

<style scoped>

</style>
