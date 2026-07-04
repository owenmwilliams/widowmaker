<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { API_BASE_URL } from "../../config/api";
import { useQuasar } from 'quasar';
import axios, { type AxiosRequestHeaders } from 'axios';

const $q = useQuasar();

const core_url = API_BASE_URL;

const emit = defineEmits<{
  (e: 'provider-changed', provider: string): void;
}>();

const currentProvider = ref('gemini');
const isLoading = ref(false);
const plan = ref<'basic' | 'pro'>('pro');
const testingProvider = ref<string | null>(null);
const testResults = ref<Record<string, { success: boolean; elapsedTimeMs: number; error?: string; model?: string } | null>>({});

// Admin detection
const isAdmin = computed(() => {
  try {
    const raw = localStorage.getItem('user_data');
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed?.is_admin === true;
  } catch {
    return false;
  }
});

// Updated provider labels to reflect new model versions
const providerLabels: Record<string, string> = {
  gemini: 'Gemini 2.5 Flash',
  claude: 'Claude Sonnet 4.6',
  gpt4: 'OpenAI GPT-4o',
  scout: 'Llama Maverick',
  qwen: 'Qwen Vision',
  florence: 'Florence-2',
  nemotron: 'Nemotron Vision'
};

// All providers available for admins
const allProviders = ['gemini', 'claude', 'gpt4', 'scout', 'qwen', 'florence', 'nemotron'];

// Provider logo URLs
const providerLogos: Record<string, string> = {
  gemini: 'https://storage.googleapis.com/widowmaker-site-images/Google_Gemini_icon_2025.svg.png',
  claude: 'https://storage.googleapis.com/widowmaker-site-images/Claude%20symbol%20-%20Clay.png',
  gpt4: 'https://storage.googleapis.com/widowmaker-site-images/OpenAI-black-monoblossom.png',
  scout: 'https://storage.googleapis.com/widowmaker-site-images/meta_png.png',
  qwen: 'https://storage.googleapis.com/widowmaker-site-images/qwen-color.png',
};

const getLabel = (provider: string) => providerLabels[provider] || provider.toUpperCase();
const getLogo = (provider: string) => providerLogos[provider] || '';

// Computed property for assigned provider (non-admin users)
const assignedProvider = computed(() => {
  if (isAdmin.value) return null;
  return plan.value === 'pro' ? 'claude' : 'gemini';
});

// Get auth headers
const getAuthHeaders = (): AxiosRequestHeaders | undefined => {
  const sessionToken = localStorage.getItem('session_token');
  return sessionToken ? { Authorization: `Bearer ${sessionToken}` } : undefined;
};

// Fetch current provider info
const fetchProviderInfo = async () => {
  try {
    const response = await axios.get(`${core_url}/api/vision/provider`, {
      headers: getAuthHeaders()
    });
    currentProvider.value = response.data.current;
    plan.value = (response.data.plan || 'pro').toLowerCase() as 'basic' | 'pro';
  } catch (error: any) {
    console.error('Error fetching provider info:', error);

    // Set defaults if fetch fails
    currentProvider.value = plan.value === 'pro' ? 'claude' : 'gemini';

    // Only show notification if it's not a 401 (auth) error
    if (!axios.isAxiosError(error) || error.response?.status !== 401) {
      $q.notify({
        type: 'negative',
        message: 'Could not fetch vision provider info',
        caption: 'Using default settings',
        position: 'bottom'
      });
    }
  }
};

// Set provider (admin only)
const setProvider = async (provider: string) => {
  if (!isAdmin.value) return;

  if (provider === currentProvider.value) return;

  isLoading.value = true;

  try {
    const response = await axios.post(`${core_url}/api/vision/provider`, {
      provider: provider
    }, {
      headers: getAuthHeaders()
    });

    if (response.data.success) {
      currentProvider.value = response.data.provider;
      emit('provider-changed', response.data.provider);

      $q.notify({
        type: 'positive',
        message: `Vision provider changed to ${getLabel(provider)}`,
        position: 'bottom',
        timeout: 2000
      });
    }
  } catch (error: any) {
    console.error('Error setting provider:', error);
    $q.notify({
      type: 'negative',
      message: 'Failed to change provider',
      caption: error.response?.data?.error || error.message,
      position: 'bottom'
    });
  } finally {
    isLoading.value = false;
  }
};

// Test provider connection (admin only)
const testProvider = async (provider: string) => {
  if (!isAdmin.value) return;

  testingProvider.value = provider;
  testResults.value[provider] = null;

  try {
    const response = await axios.post(`${core_url}/api/vision/test-provider`, {
      provider: provider
    }, {
      headers: getAuthHeaders()
    });

    testResults.value[provider] = {
      success: response.data.success,
      elapsedTimeMs: response.data.elapsedTimeMs,
      error: response.data.error,
      model: response.data.model
    };

    if (response.data.success) {
      $q.notify({
        type: 'positive',
        message: `${getLabel(provider)} is working`,
        caption: `Response time: ${response.data.elapsedTimeMs}ms`,
        position: 'bottom',
        timeout: 3000
      });
    } else {
      $q.notify({
        type: 'negative',
        message: `${getLabel(provider)} test failed`,
        caption: response.data.error,
        position: 'bottom',
        timeout: 5000
      });
    }
  } catch (error: any) {
    console.error('Error testing provider:', error);
    testResults.value[provider] = {
      success: false,
      elapsedTimeMs: 0,
      error: error.response?.data?.error || error.message
    };

    $q.notify({
      type: 'negative',
      message: `${getLabel(provider)} test failed`,
      caption: error.response?.data?.error || error.message,
      position: 'bottom',
      timeout: 5000
    });
  } finally {
    testingProvider.value = null;
  }
};

onMounted(() => {
  fetchProviderInfo();
});
</script>

<template>
  <div class="vision-provider-toggle">
    <!-- Non-Admin: Read-only provider display -->
    <div v-if="!isAdmin" class="provider-readonly">
      <div class="provider-info-box">
        <div class="provider-header">
          <q-icon name="smart_toy" size="20px" color="primary" class="q-mr-sm" />
          <span class="provider-title">Vision AI Provider</span>
        </div>
        <div class="provider-display">
          <img
            v-if="getLogo(assignedProvider || 'gemini')"
            :src="getLogo(assignedProvider || 'gemini')"
            :alt="getLabel(assignedProvider || 'gemini')"
            class="provider-logo-large"
          />
          <div class="provider-details">
            <div class="provider-name">{{ getLabel(assignedProvider || 'gemini') }}</div>
            <div class="provider-plan-badge">{{ plan === 'pro' ? 'Pro Plan' : 'Free Plan' }}</div>
          </div>
        </div>
        <div class="provider-description">
          {{ plan === 'pro'
              ? 'Your Pro plan includes Claude Sonnet 4.6 for the best accuracy and detail.'
              : 'Your free plan includes Gemini 2.5 Flash. Upgrade to Pro for Claude Sonnet 4.6.'
          }}
        </div>
      </div>
    </div>

    <!-- Admin: Full provider selector with testing -->
    <div v-else class="provider-admin">
      <div class="admin-header">
        <q-icon name="admin_panel_settings" size="20px" color="primary" class="q-mr-sm" />
        <span class="admin-title">Admin: Vision Provider Controls</span>
      </div>

      <div class="provider-selector">
        <q-select
          v-model="currentProvider"
          :options="allProviders"
          :option-label="getLabel"
          label="Select Vision Provider"
          filled
          :loading="isLoading"
          @update:model-value="setProvider"
          class="provider-dropdown"
        >
          <template v-slot:prepend>
            <q-icon name="psychology" />
          </template>
          <template v-slot:option="scope">
            <q-item v-bind="scope.itemProps">
              <q-item-section avatar v-if="getLogo(scope.opt)">
                <img :src="getLogo(scope.opt)" :alt="getLabel(scope.opt)" class="provider-logo-small" />
              </q-item-section>
              <q-item-section>
                <q-item-label>{{ getLabel(scope.opt) }}</q-item-label>
              </q-item-section>
            </q-item>
          </template>
        </q-select>
      </div>

      <div class="test-section">
        <div class="test-header">
          <q-icon name="speed" size="18px" class="q-mr-xs" />
          <span>Provider Connection Tests</span>
        </div>
        <div class="test-grid">
          <div
            v-for="provider in allProviders"
            :key="provider"
            class="test-card"
          >
            <div class="test-card-header">
              <img
                v-if="getLogo(provider)"
                :src="getLogo(provider)"
                :alt="getLabel(provider)"
                class="provider-logo-small"
              />
              <div v-else class="provider-logo-small placeholder">{{ provider.slice(0, 2).toUpperCase() }}</div>
              <span class="test-provider-name">{{ getLabel(provider) }}</span>
            </div>
            <q-btn
              :loading="testingProvider === provider"
              :disable="testingProvider !== null"
              color="primary"
              size="sm"
              unelevated
              dense
              @click="testProvider(provider)"
              class="test-btn"
            >
              <q-icon name="cable" size="16px" class="q-mr-xs" />
              Test
            </q-btn>
            <div v-if="testResults[provider]" class="test-result">
              <div v-if="testResults[provider]?.success" class="test-success">
                <q-icon name="check_circle" size="16px" color="positive" />
                <span class="test-time">{{ testResults[provider]?.elapsedTimeMs }}ms</span>
              </div>
              <div v-else class="test-failure">
                <q-icon name="error" size="16px" color="negative" />
                <span class="test-error">{{ testResults[provider]?.error?.slice(0, 30) }}...</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.vision-provider-toggle {
  width: 100%;
}

/* Non-Admin Read-only Display */
.provider-readonly {
  width: 100%;
}

.provider-info-box {
  background: linear-gradient(135deg, #f5f7fa 0%, #ffffff 100%);
  border: 2px solid #e3e8ef;
  border-radius: 12px;
  padding: 20px;
}

.provider-header {
  display: flex;
  align-items: center;
  margin-bottom: 16px;
}

.provider-title {
  font-size: 0.875rem;
  font-weight: 600;
  color: #1f2937;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.provider-display {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 12px;
  padding: 16px;
  background: white;
  border-radius: 8px;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);
}

.provider-logo-large {
  width: 48px;
  height: 48px;
  object-fit: contain;
}

.provider-details {
  flex: 1;
}

.provider-name {
  font-size: 1.125rem;
  font-weight: 600;
  color: #1f2937;
  margin-bottom: 4px;
}

.provider-plan-badge {
  display: inline-block;
  padding: 2px 8px;
  background: #e3f2fd;
  color: #1565c0;
  border-radius: 4px;
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
}

.provider-description {
  font-size: 0.875rem;
  color: #6b7280;
  line-height: 1.5;
}

/* Admin Controls */
.provider-admin {
  width: 100%;
}

.admin-header {
  display: flex;
  align-items: center;
  margin-bottom: 16px;
  padding: 12px;
  background: #fef3c7;
  border-radius: 8px;
  border-left: 4px solid #f59e0b;
}

.admin-title {
  font-size: 0.875rem;
  font-weight: 600;
  color: #92400e;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.provider-selector {
  margin-bottom: 24px;
}

.provider-dropdown {
  max-width: 400px;
}

.provider-logo-small {
  width: 24px;
  height: 24px;
  object-fit: contain;
}

.provider-logo-small.placeholder {
  background: #e0e7ff;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  color: #1f2a44;
  font-size: 0.7rem;
}

.test-section {
  background: #f9fafb;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 16px;
}

.test-header {
  display: flex;
  align-items: center;
  margin-bottom: 12px;
  font-size: 0.875rem;
  font-weight: 600;
  color: #1f2937;
}

.test-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 12px;
}

.test-card {
  background: white;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.test-card-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}

.test-provider-name {
  font-size: 0.875rem;
  font-weight: 600;
  color: #1f2937;
}

.test-btn {
  width: 100%;
}

.test-result {
  padding-top: 8px;
  border-top: 1px solid #e5e7eb;
}

.test-success {
  display: flex;
  align-items: center;
  gap: 6px;
  color: #059669;
  font-size: 0.8rem;
  font-weight: 500;
}

.test-time {
  font-weight: 600;
}

.test-failure {
  display: flex;
  align-items: center;
  gap: 6px;
  color: #dc2626;
  font-size: 0.75rem;
}

.test-error {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
