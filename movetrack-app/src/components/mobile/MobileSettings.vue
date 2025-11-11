<script setup lang="ts">
import { ref } from 'vue';
import VisionProviderToggle from '../VisionProviderToggle.vue';

const props = defineProps<{
  user: string;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'addCollection'): void;
  (e: 'addLocation'): void;
}>();

const currentVisionProvider = ref<string>('gemini');

const handleProviderChanged = (provider: string) => {
  currentVisionProvider.value = provider;
};
</script>

<template>
  <q-card class="mobile-settings-card">
    <q-card-section class="bg-primary text-white">
      <div class="row items-center">
        <q-btn flat dense round icon="arrow_back" @click="emit('close')" />
        <div class="text-h6 q-ml-md">Settings</div>
      </div>
    </q-card-section>

    <q-card-section>
      <!-- Vision AI Section -->
      <div class="settings-section">
        <div class="section-header">
          <q-icon name="camera_enhance" size="md" color="primary" />
          <div class="text-h6 q-ml-sm">Vision AI Provider</div>
        </div>
        <div class="text-caption text-grey-7 q-mt-sm q-mb-md">
          Choose which AI provider to use for analyzing photos of your items
        </div>
        <VisionProviderToggle @provider-changed="handleProviderChanged" />
      </div>

      <q-separator class="q-my-lg" />

      <!-- Locations Section -->
      <div class="settings-section">
        <div class="section-header">
          <q-icon name="place" size="md" color="primary" />
          <div class="text-h6 q-ml-sm">Manage Locations</div>
        </div>
        <div class="text-caption text-grey-7 q-mt-sm q-mb-md">
          Add and manage locations where your items are stored
        </div>
        <q-btn 
          color="primary" 
          label="Add Location" 
          icon="add" 
          outline 
          class="full-width"
          @click="emit('addLocation')"
        />
      </div>

      <q-separator class="q-my-lg" />

      <!-- Collections Section -->
      <div class="settings-section">
        <div class="section-header">
          <q-icon name="collections_bookmark" size="md" color="primary" />
          <div class="text-h6 q-ml-sm">Manage Collections</div>
        </div>
        <div class="text-caption text-grey-7 q-mt-sm q-mb-md">
          Add and organize your collections
        </div>
        <q-btn 
          color="primary" 
          label="Add Collection" 
          icon="add" 
          outline 
          class="full-width"
          @click="emit('addCollection')"
        />
      </div>
    </q-card-section>
  </q-card>
</template>

<style scoped>
.mobile-settings-card {
  min-height: 100vh;
}

.settings-section {
  margin-bottom: 24px;
}

.section-header {
  display: flex;
  align-items: center;
}
</style>
