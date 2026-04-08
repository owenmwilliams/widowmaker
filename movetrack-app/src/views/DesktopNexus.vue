<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import axios from 'axios'
import NexusChat from '../components/nexus/NexusChat.vue'
import { logout as serverLogout } from '../utils/auth'

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
      userId.value = response.data.user.user_id || response.data.user.userId
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

const navigateTo = (page: string) => {
  router.push(page)
}

const navigateToSettings = (target: string) => {
  if (target === 'vision') {
    // Vision provider is Workspace-specific; route to settings
    target = 'settings'
  }
  localStorage.setItem('desktop_nav_target', target)
  router.push('/items')
}

const logout = async () => {
  await serverLogout()
  router.push('/login')
}
</script>

<template>
  <div v-if="isCheckingUser" class="desktop-route-loader"></div>
  <div v-else class="desktop-nexus-layout">
    <q-layout view="hHh LpR lff">
      <q-header bordered class="desktop-nexus-header">
        <q-toolbar>
          <div class="toolbar-left">
            <div class="nexus-logo-btn" @click="navigateTo('/nexus')">
              <div class="nexus-logo-icon">
                <q-icon name="auto_awesome" size="20px" color="white" />
              </div>
              <span class="nexus-logo-text">Nexus</span>
            </div>
            <q-btn-group flat class="primary-nav">
              <q-btn
                flat dense padding="xs md" no-caps
                class="text-weight-medium"
                color="grey-5"
                label="Dashboard"
                @click="navigateTo('/items')"
              />
              <q-btn
                flat dense padding="xs md" no-caps
                class="text-weight-medium"
                color="grey-5"
                label="Inventory"
                @click="navigateTo('/items')"
              />
              <q-btn
                flat dense padding="xs md" no-caps
                class="text-weight-medium"
                color="grey-5"
                label="Move"
                @click="navigateTo('/items')"
              />
            </q-btn-group>
          </div>
          <q-toolbar-title />
          <div class="toolbar-actions">
            <q-btn flat round dense icon="menu" class="menu-btn">
              <q-menu style="z-index: 9999;">
                <q-list style="min-width: 200px;">
                  <q-item clickable v-ripple @click="navigateToSettings('vision')">
                    <q-item-section avatar><q-icon name="memory" /></q-item-section>
                    <q-item-section>Vision Provider</q-item-section>
                  </q-item>
                  <q-item clickable v-ripple @click="navigateToSettings('settings')">
                    <q-item-section avatar><q-icon name="settings" /></q-item-section>
                    <q-item-section>Settings</q-item-section>
                  </q-item>
                  <q-item clickable v-ripple @click="navigateToSettings('support')">
                    <q-item-section avatar><q-icon name="help_outline" /></q-item-section>
                    <q-item-section>Support</q-item-section>
                  </q-item>
                  <q-separator />
                  <q-item clickable v-ripple @click="logout">
                    <q-item-section avatar><q-icon name="logout" /></q-item-section>
                    <q-item-section>Logout</q-item-section>
                  </q-item>
                </q-list>
              </q-menu>
            </q-btn>
          </div>
        </q-toolbar>
      </q-header>

      <q-page-container>
        <div class="nexus-container">
          <NexusChat :user="userId" />
        </div>
      </q-page-container>
    </q-layout>
  </div>
</template>

<style scoped>
.desktop-route-loader {
  min-height: 100vh;
  background: #1e1e1e;
}

.desktop-nexus-layout {
  background: #1e1e1e;
}

.desktop-nexus-header {
  background: #1a1a1a;
  border-bottom: 1px solid #2a2a2a;
  z-index: 9998;
}

.toolbar-left {
  display: flex;
  align-items: center;
  gap: 24px;
}

.nexus-logo-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 8px;
  transition: background 0.2s ease;
}
.nexus-logo-btn:hover {
  background: rgba(255, 255, 255, 0.06);
}
.nexus-logo-icon {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #274690, #1ca1c1, #7dd3fc);
  background-size: 240% 240%;
  animation: logoShimmer 2.8s ease-in-out infinite;
}
.nexus-logo-text {
  font-size: 16px;
  font-weight: 700;
  color: #e0e0e0;
  letter-spacing: 0.02em;
}

@keyframes logoShimmer {
  0% { background-position: 0% 50%; }
  50% { background-position: 100% 50%; }
  100% { background-position: 0% 50%; }
}

.menu-btn {
  color: #999;
}
.menu-btn:hover {
  color: #e0e0e0;
}

.primary-nav {
  gap: 4px;
}

.nexus-container {
  max-width: 800px;
  margin: 0 auto;
  height: calc(100vh - 50px);
}
</style>
