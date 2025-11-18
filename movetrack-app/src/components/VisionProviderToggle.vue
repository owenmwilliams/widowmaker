<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useQuasar } from 'quasar';
import axios, { type AxiosRequestHeaders } from 'axios';

const $q = useQuasar();

// To adjust url based on whether in prod or not
const core_url = import.meta.env.MODE == 'development' ? 'http://localhost:3050' : 'https://movetrack-api-7hwn7ggbiq-uc.a.run.app';

const emit = defineEmits<{
  (e: 'provider-changed', provider: string): void;
}>();

const currentProvider = ref('gemini');
const availableProviders = ref<string[]>([]);
const isLoading = ref(false);

const providerLabels: Record<string, string> = {
  gemini: 'Google Gemini 2.0',
  claude: 'Anthropic Claude 3.5',
  gpt4: 'OpenAI GPT-4o',
  scout: 'Llama Scout',
  qwen: 'Qwen Vision',
};

const freeProviders = ['scout', 'qwen'];
const premiumProviders = ['gemini', 'claude', 'gpt4'];

// Provider logo URLs (fallback to generic if missing)
const providerLogos: Record<string, string> = {
  gemini: 'https://storage.googleapis.com/widowmaker-site-images/Google_Gemini_icon_2025.svg.png',
  claude: 'https://storage.googleapis.com/widowmaker-site-images/Claude%20symbol%20-%20Clay.png',
  gpt4: 'https://storage.googleapis.com/widowmaker-site-images/OpenAI-black-monoblossom.png',
  scout: 'https://storage.googleapis.com/widowmaker-site-images/meta_png.png',
  qwen: 'https://storage.googleapis.com/widowmaker-site-images/qwen-color.png',
};

const getLabel = (provider: string) => providerLabels[provider] || provider.toUpperCase();
const getLogo = (provider: string) => providerLogos[provider] || '';

// Get auth headers
const getAuthHeaders = (): AxiosRequestHeaders | undefined => {
  const sessionToken = localStorage.getItem('session_token');
  return sessionToken ? { Authorization: `Bearer ${sessionToken}` } : undefined;
};

// Fetch current provider and available providers
const fetchProviderInfo = async () => {
  try {
    const response = await axios.get(`${core_url}/vision/provider`, {
      headers: getAuthHeaders()
    });
    currentProvider.value = response.data.current;
    availableProviders.value = response.data.available;
  } catch (error) {
    console.error('Error fetching provider info:', error);
    $q.notify({
      type: 'negative',
      message: 'Could not fetch vision provider info',
      position: 'bottom'
    });
  }
};

// Set provider
const setProvider = async (provider: string) => {
  if (provider === currentProvider.value) return;

  isLoading.value = true;

  try {
    const response = await axios.post(`${core_url}/vision/provider`, {
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

onMounted(() => {
  fetchProviderInfo();
});
</script>

<template>
  <div class="vision-provider-toggle">
    <!-- Free Tier Providers -->
    <div v-if="availableProviders.some(p => freeProviders.includes(p))" class="provider-section">
      <div class="section-label">
        <q-icon name="stars" size="18px" color="positive" class="q-mr-xs" />
        <span class="section-title">Free & Low-Cost</span>
      </div>
      <div class="provider-buttons-row">
        <q-btn
          v-for="provider in availableProviders.filter(p => freeProviders.includes(p))"
          :key="provider"
          :class="['provider-btn', 'provider-btn-free', { 'provider-btn-active': currentProvider === provider }]"
          :disable="isLoading"
          unelevated
          @click="setProvider(provider)"
        >
          <div class="provider-btn-content">
            <img v-if="getLogo(provider)" :src="getLogo(provider)" :alt="getLabel(provider)" class="provider-logo" />
            <div v-else class="provider-logo placeholder">{{ provider.slice(0, 2).toUpperCase() }}</div>
            <span class="provider-label">{{ getLabel(provider) }}</span>
          </div>
        </q-btn>
      </div>
    </div>

    <!-- Premium Providers -->
    <div v-if="availableProviders.some(p => premiumProviders.includes(p))" class="provider-section">
      <div class="section-label">
        <q-icon name="workspace_premium" size="18px" color="primary" class="q-mr-xs" />
        <span class="section-title">Premium</span>
      </div>
      <div class="provider-buttons-row">
        <q-btn
          v-for="provider in availableProviders.filter(p => premiumProviders.includes(p))"
          :key="provider"
          :class="['provider-btn', 'provider-btn-premium', { 'provider-btn-active': currentProvider === provider }]"
          :disable="isLoading"
          unelevated
          @click="setProvider(provider)"
        >
          <div class="provider-btn-content">
            <img v-if="getLogo(provider)" :src="getLogo(provider)" :alt="getLabel(provider)" class="provider-logo" />
            <div v-else class="provider-logo placeholder">{{ provider.slice(0, 2).toUpperCase() }}</div>
            <span class="provider-label">{{ getLabel(provider) }}</span>
          </div>
        </q-btn>
      </div>
    </div>

    <div v-if="availableProviders.length === 0" class="no-providers-warning">
      <q-icon name="warning" size="20px" color="warning" />
      <span>No vision providers configured.</span>
    </div>
  </div>
</template>

<style scoped>
.vision-provider-toggle {
  width: 100%;
}

.provider-section {
  margin-bottom: 20px;
}

.section-label {
  display: flex;
  align-items: center;
  margin-bottom: 10px;
  font-weight: 600;
  font-size: 0.875rem;
  color: #1f2937;
}

.section-title {
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.provider-buttons-row {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.provider-btn {
  flex: 1;
  min-width: 0;
  background: #f5f5f5;
  color: #424242;
  border: 2px solid transparent;
  padding: 12px 8px;
  transition: all 0.2s ease;
}

.provider-btn-free {
  background: #f0fdf4;
  border-color: #d1fae5;
}

.provider-btn-free:hover {
  background: #dcfce7;
}

.provider-btn-premium {
  background: #f5f5f5;
}

.provider-btn-premium:hover {
  background: #eeeeee;
}

.provider-btn-active {
  background: #e3f2fd;
  border-color: #274690;
  color: #274690;
}

.provider-btn-free.provider-btn-active {
  background: #d1fae5;
  border-color: #10b981;
  color: #047857;
}

.provider-btn-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}

.provider-logo {
  width: 32px;
  height: 32px;
  object-fit: contain;
}

.provider-logo.placeholder {
  background: #e0e7ff;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  color: #1f2a44;
  font-size: 0.8rem;
}

.provider-label {
  font-size: 0.75rem;
  font-weight: 500;
  text-align: center;
  line-height: 1.2;
}

.no-providers-warning {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 12px;
  padding: 12px;
  background: #fff3e0;
  border-radius: 6px;
  font-size: 0.875rem;
  color: #e65100;
}
</style>
