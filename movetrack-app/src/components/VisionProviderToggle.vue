<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useQuasar } from 'quasar';
import axios from 'axios';

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
  'gemini': 'Google Gemini 2.0',
  'claude': 'Anthropic Claude 3.5',
  'gpt4': 'OpenAI GPT-4o'
};

const providerIcons: Record<string, string> = {
  'gemini': 'auto_awesome',
  'claude': 'psychology',
  'gpt4': 'smart_toy'
};

// Get auth headers
const getAuthHeaders = () => {
  const sessionToken = localStorage.getItem('session_token');
  return sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {};
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
      position: 'top'
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
        message: `Vision provider changed to ${providerLabels[provider]}`,
        position: 'top',
        timeout: 2000
      });
    }
  } catch (error: any) {
    console.error('Error setting provider:', error);
    $q.notify({
      type: 'negative',
      message: 'Failed to change provider',
      caption: error.response?.data?.error || error.message,
      position: 'top'
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
    <div class="toggle-header">
      <q-icon name="camera_enhance" size="20px" color="primary" />
      <span class="toggle-label">Vision AI Provider</span>
    </div>

    <q-btn-toggle
      v-model="currentProvider"
      :options="availableProviders.map(p => ({
        label: providerLabels[p] || p,
        value: p,
        icon: providerIcons[p] || 'psychology'
      }))"
      toggle-color="primary"
      color="grey-3"
      text-color="dark"
      unelevated
      spread
      :disable="isLoading"
      class="provider-toggle-buttons"
      @update:model-value="setProvider"
    />

    <div v-if="availableProviders.length === 0" class="no-providers-warning">
      <q-icon name="warning" size="20px" color="warning" />
      <span>No vision providers configured. Add API keys to .env file.</span>
    </div>
  </div>
</template>

<style scoped>
.vision-provider-toggle {
  background: white;
  border-radius: 8px;
  padding: 16px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

.toggle-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
}

.toggle-label {
  font-size: 0.875rem;
  font-weight: 600;
  color: #424242;
}

.provider-toggle-buttons {
  width: 100%;
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
