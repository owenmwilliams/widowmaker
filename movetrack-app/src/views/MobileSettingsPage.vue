<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import axios from 'axios'
import MobileSettings from '../components/mobile/MobileSettings.vue'

const core_url = import.meta.env.MODE === 'development'
  ? 'http://localhost:3050'
  : 'https://movetrack-api-7hwn7ggbiq-uc.a.run.app'

const userId = ref('')
const isCheckingUser = ref(true)
const router = useRouter()
const route = useRoute()

onMounted(() => {
  checkUser()
})

async function checkUser () {
  isCheckingUser.value = true
  try {
    const sessionToken = localStorage.getItem('session_token')
    if (!sessionToken) {
      router.push('/login')
      return
    }

    const response = await axios.get(`${core_url}/auth/me`, {
      headers: {
        Authorization: `Bearer ${sessionToken}`
      }
    })

    if (response.data.success) {
      userId.value = response.data.user.userId
    } else {
      localStorage.removeItem('session_token')
      localStorage.removeItem('user_data')
      router.push('/login')
    }
  } catch (error) {
    console.error('Auth error:', error)
    localStorage.removeItem('session_token')
    localStorage.removeItem('user_data')
    router.push('/login')
  } finally {
    isCheckingUser.value = false
  }
}

const currentLocationParam = computed(() => {
  const loc = route.query.location
  return typeof loc === 'string' && loc.length > 0 ? loc : null
})

const goToLocations = (options?: { action?: string }) => {
  const params = currentLocationParam.value ? { locationId: currentLocationParam.value } : undefined
  const query = options?.action ? { action: options.action } : undefined
  router.push({ name: 'mobile-locations', params, query })
}
</script>

<template>
  <div v-if="isCheckingUser" class="mobile-route-loader"></div>
  <MobileSettings
    v-else
    :user="userId"
    @close="goToLocations()"
  />
</template>

<style scoped>
.mobile-route-loader {
  min-height: 100vh;
}
</style>
