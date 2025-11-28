<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import axios from 'axios'
import MobileMoveSession from '../components/mobile/MobileMoveSession.vue'

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
      if (response.data.user) {
        localStorage.setItem('user_data', JSON.stringify(response.data.user))
      }
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

const isReady = computed(() => !!userId.value && !isCheckingUser.value)
</script>

<template>
  <div v-if="!isReady" class="move-session-loader"></div>
  <MobileMoveSession v-else :user="userId" />
</template>

<style scoped>
.move-session-loader {
  min-height: 100vh;
}
</style>
