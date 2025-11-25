<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import axios from 'axios'
import MobileItems from '../components/mobile/MobileItems.vue'

const core_url = import.meta.env.MODE === 'development'
  ? 'http://localhost:3050'
  : 'https://movetrack-api-7hwn7ggbiq-uc.a.run.app'

const userId = ref('')
const isCheckingUser = ref(true)
const router = useRouter()

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
</script>

<template>
  <div v-if="isCheckingUser" class="mobile-route-loader"></div>
  <MobileItems v-else :user="userId" />
</template>

<style scoped>
.mobile-route-loader {
  min-height: 100vh;
}
</style>
