<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { API_BASE_URL } from "../config/api";
import { useRouter } from 'vue-router'
import axios from 'axios'
import NexusChat from '../components/nexus/NexusChat.vue'
import ReloPrepLogo from '../components/brand/ReloPrepLogo.vue'
import logoLockupLight from '../assets/brand/logo-lockup-light.svg'
import { logout as serverLogout } from '../utils/auth'

const core_url = API_BASE_URL;

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
              <ReloPrepLogo
                :width="120"
                :height="30"
                :logo-src="logoLockupLight"
              />
            </div>
            <q-btn-group flat class="primary-nav">
              <q-btn
                flat dense padding="xs md" no-caps
                class="nav-btn"
                label="Dashboard"
                @click="navigateTo('/items')"
              />
              <q-btn
                flat dense padding="xs md" no-caps
                class="nav-btn"
                label="Inventory"
                @click="navigateTo('/items')"
              />
              <q-btn
                flat dense padding="xs md" no-caps
                class="nav-btn"
                label="Move"
                @click="navigateTo('/items')"
              />
            </q-btn-group>
          </div>
          <q-toolbar-title />
          <div class="toolbar-actions">
            <q-btn flat round dense icon="menu" aria-label="Menu" class="menu-btn">
              <q-menu style="z-index: 9999;">
                <q-list style="min-width: 200px;">
                  <q-item clickable v-ripple @click="navigateToSettings('vision')">
                    <q-item-section avatar><q-icon name="memory" /></q-item-section>
                    <q-item-section>Vision provider</q-item-section>
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
  background: var(--bg);
}

.desktop-nexus-layout {
  background: var(--bg);
  font-family: var(--font-ui);
}

.desktop-nexus-header {
  background: var(--surface);
  color: var(--text-primary);
  border-bottom: 1px solid var(--border);
  box-shadow: var(--shadow-xs);
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
  cursor: pointer;
  padding: 4px 8px;
  border-radius: var(--r-sm);
  transition: background var(--dur-base) var(--ease-standard);
}
.nexus-logo-btn:hover {
  background: var(--surface-hover);
}

.menu-btn {
  min-width: var(--tap-min);
  min-height: var(--tap-min);
  color: var(--text-secondary);
  transition: color var(--dur-base) var(--ease-standard);
}
.menu-btn:hover {
  color: var(--text-primary);
}

.primary-nav {
  gap: 4px;
}
.nav-btn {
  min-height: var(--tap-min);
  color: var(--text-secondary);
  font-size: var(--fs-body);
  font-weight: var(--fw-bold);
  border-radius: var(--r-md);
  transition:
    color var(--dur-base) var(--ease-standard),
    background var(--dur-base) var(--ease-standard);
}
.nav-btn:hover {
  color: var(--accent);
  background: var(--surface-hover);
}

.nexus-container {
  max-width: 800px;
  margin: 0 auto;
  height: calc(100vh - 50px);
}
</style>
