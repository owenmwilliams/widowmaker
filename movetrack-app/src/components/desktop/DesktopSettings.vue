<script setup lang="ts">
import { ref } from 'vue';
import VisionProviderToggle from '../VisionProviderToggle.vue';
import DesktopLocationCards from './DesktopLocationCards.vue';

const props = defineProps<{
  user: string;
}>();

const currentVisionProvider = ref<string>('gemini');

const handleProviderChanged = (provider: string) => {
  currentVisionProvider.value = provider;
};
</script>

<template>
  <div class="settings-container">
    <div class="settings-header">
      <h2 class="text-h4 text-primary">Settings</h2>
    </div>

    <div class="settings-content">
      <!-- Vision AI Section -->
      <q-card class="settings-card">
        <q-card-section>
          <div class="section-header">
            <q-icon name="camera_enhance" size="md" color="primary" class="q-mr-md" />
            <div class="text-h6">Vision AI Provider</div>
          </div>
          <div class="text-caption text-grey-7 q-mt-sm q-mb-md">
            Choose which AI provider to use for analyzing photos of your items
          </div>
          <VisionProviderToggle @provider-changed="handleProviderChanged" />
        </q-card-section>
      </q-card>

      <!-- Locations Section -->
      <q-card class="settings-card">
        <q-card-section>
          <div class="section-header">
            <q-icon name="place" size="md" color="primary" class="q-mr-md" />
            <div class="text-h6">Manage Locations</div>
          </div>
          <div class="text-caption text-grey-7 q-mt-sm q-mb-md">
            Set up locations for tracking where your items are stored
          </div>
        </q-card-section>
        <q-card-section class="q-pt-none">
          <DesktopLocationCards :user="props.user" search="" />
        </q-card-section>
      </q-card>
    </div>
  </div>
</template>

<style scoped>
.settings-container {
  max-width: 1200px;
  margin: 0 auto;
  padding: 24px;
}

.settings-header {
  margin-bottom: 32px;
}

.settings-content {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.settings-card {
  border-radius: 12px;
  box-shadow: var(--shadow-sm);
  border: 1px solid var(--border-light);
}

.section-header {
  display: flex;
  align-items: center;
}
</style>
