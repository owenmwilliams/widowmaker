<script setup lang="ts">
import { ref, reactive, computed } from 'vue';
import { useQuasar } from 'quasar';
import { inventoryStore } from '../../stores/InventoryStore';
import { storeToRefs } from 'pinia';
import VisionProviderToggle from '../VisionProviderToggle.vue';

const props = defineProps<{
  user: string;
}>();

const currentVisionProvider = ref<string>('gemini');
const locationDialogOpen = ref(false);
const editingLocationId = ref<number | null>(null);
const store = inventoryStore();
const { locations } = storeToRefs(store);
const $q = useQuasar();

const locationForm = reactive({
  name: '',
  description: '',
  address: '',
  address2: '',
  city: '',
  state: '',
  zip: '',
  isPrimary: false
});

const primaryLocationId = computed(() => {
  return locations.value.find(loc => loc.isPrimary)?.value ?? null;
});

const handleProviderChanged = (provider: string) => {
  currentVisionProvider.value = provider;
};

const resetLocationForm = () => {
  locationForm.name = '';
  locationForm.description = '';
  locationForm.address = '';
  locationForm.address2 = '';
  locationForm.city = '';
  locationForm.state = '';
  locationForm.zip = '';
  locationForm.isPrimary = false;
  editingLocationId.value = null;
};

const openAddLocation = () => {
  resetLocationForm();
  locationDialogOpen.value = true;
};

const openEditLocation = (id: number) => {
  const location = locations.value.find(loc => loc.value === id);
  if (!location) {
    return;
  }

  editingLocationId.value = id;
  locationForm.name = location.label;
  locationForm.description = location.description || '';
  locationForm.address = location.address || '';
  locationForm.address2 = location.address_2 || '';
  locationForm.city = location.city || '';
  locationForm.state = location.state || '';
  locationForm.zip = location.zip || '';
  locationForm.isPrimary = location.isPrimary || false;
  locationDialogOpen.value = true;
};

const saveLocation = async () => {
  if (!locationForm.name.trim()) {
    $q.notify({
      type: 'warning',
      message: 'Location name is required',
      position: 'bottom'
    });
    return;
  }

  try {
    $q.loading.show({ message: editingLocationId.value ? 'Updating location...' : 'Adding location...' });

    if (editingLocationId.value !== null) {
      await store.updateLocation(
        editingLocationId.value,
        props.user,
        locationForm.name,
        locationForm.description,
        locationForm.address,
        locationForm.address2,
        locationForm.city,
        locationForm.state,
        locationForm.zip,
        locationForm.isPrimary,
        { skipRedirect: true }
      );
      $q.notify({
        type: 'positive',
        message: 'Location updated',
        position: 'bottom'
      });
    } else {
      await store.createLocation(
        props.user,
        locationForm.name,
        locationForm.description,
        locationForm.address,
        locationForm.address2,
        locationForm.city,
        locationForm.state,
        locationForm.zip,
        locationForm.isPrimary
      );
      $q.notify({
        type: 'positive',
        message: 'Location added',
        position: 'bottom'
      });
    }

    locationDialogOpen.value = false;
    resetLocationForm();
  } catch (error) {
    console.error('Location save failed', error);
    $q.notify({
      type: 'negative',
      message: 'Unable to save location',
      position: 'bottom'
    });
  } finally {
    $q.loading.hide();
  }
};

const deleteLocation = async (id: number) => {
  $q.dialog({
    title: 'Delete location',
    message: 'Are you sure you want to remove this location?',
    cancel: true,
    persistent: true
  }).onOk(async () => {
    try {
      $q.loading.show({ message: 'Deleting location...' });
      await store.deleteLocation(id, props.user, { skipRedirect: true });
      $q.notify({
        type: 'positive',
        message: 'Location removed',
        position: 'bottom'
      });
    } catch (error) {
      console.error('Delete failed', error);
      $q.notify({
        type: 'negative',
        message: 'Unable to delete location',
        position: 'bottom'
      });
    } finally {
      $q.loading.hide();
    }
  });
};

const markPrimary = async (id: number | null) => {
  if (id === null || primaryLocationId.value === id) {
    return;
  }

  try {
    $q.loading.show({ message: 'Updating primary residence...' });
    await store.markPrimaryLocation(id, props.user);
    $q.notify({
      type: 'positive',
      message: 'Primary residence updated',
      position: 'bottom'
    });
  } catch (error) {
    console.error('Failed to mark primary', error);
    $q.notify({
      type: 'negative',
      message: 'Unable to update primary residence',
      position: 'bottom'
    });
  } finally {
    $q.loading.hide();
  }
};
</script>

<template>
  <div class="settings-container">
    <div class="settings-header q-pa-md">
      <h5 class="text-h5 text-primary q-my-none">Settings</h5>
      <p class="text-caption text-grey-7 q-mt-xs">Manage your preferences and account settings</p>
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
        <q-card-section class="row items-start justify-between">
          <div>
            <div class="section-header">
              <q-icon name="place" size="md" color="primary" class="q-mr-md" />
              <div class="text-h6">Manage Locations</div>
            </div>
            <div class="text-caption text-grey-7 q-mt-sm">
              Add the places you live or store belongings and pick your primary residence.
            </div>
          </div>
          <q-btn color="primary" icon="add" label="Add Location" unelevated @click="openAddLocation" />
        </q-card-section>
        <q-separator />
        <q-card-section class="q-pt-none">
          <div v-if="locations.length === 0" class="empty-locations text-grey-7">
            <q-icon name="travel_explore" size="48px" color="grey-5" class="q-mb-sm" />
            <div class="text-subtitle1">No locations yet</div>
            <div class="text-caption q-mt-xs">Add at least one location to get started.</div>
          </div>
          <q-list v-else separator>
            <q-item v-for="location in locations" :key="location.value" class="location-row">
              <q-item-section side top>
                <q-radio
                  size="sm"
                  color="primary"
                  :model-value="primaryLocationId"
                  :val="location.value"
                  @update:model-value="markPrimary"
                >
                  <q-tooltip>Mark as primary residence</q-tooltip>
                </q-radio>
              </q-item-section>
              <q-item-section>
                <q-item-label class="text-weight-medium">
                  {{ location.label }}
                  <q-chip v-if="location.isPrimary" color="primary" text-color="white" dense size="xs" class="q-ml-sm">
                    Primary
                  </q-chip>
                </q-item-label>
                <q-item-label caption class="text-grey-7">
                  {{ [location.address, location.city, location.state].filter(Boolean).join(', ') || 'No address provided' }}
                </q-item-label>
              </q-item-section>
              <q-item-section side>
                <q-btn flat round dense icon="edit" color="primary" @click="openEditLocation(location.value)">
                  <q-tooltip>Edit location</q-tooltip>
                </q-btn>
                <q-btn flat round dense icon="delete" color="negative" class="q-ml-sm" @click="deleteLocation(location.value)">
                  <q-tooltip>Delete location</q-tooltip>
                </q-btn>
              </q-item-section>
            </q-item>
          </q-list>
        </q-card-section>
      </q-card>
    </div>

    <q-dialog v-model="locationDialogOpen" persistent @hide="resetLocationForm">
      <q-card style="min-width: 520px;">
        <q-card-section>
          <div class="text-h6">
            {{ editingLocationId === null ? 'Add Location' : 'Edit Location' }}
          </div>
        </q-card-section>
        <q-card-section class="location-form q-pt-none">
          <q-input v-model="locationForm.name" label="Location Name" outlined dense autofocus />
          <q-input v-model="locationForm.description" label="Description" outlined dense />
          <q-input v-model="locationForm.address" label="Address" outlined dense />
          <q-input v-model="locationForm.address2" label="Unit / Apt" outlined dense />
          <div class="row q-col-gutter-sm">
            <div class="col-6">
              <q-input v-model="locationForm.city" label="City" outlined dense />
            </div>
            <div class="col-3">
              <q-input v-model="locationForm.state" label="State" outlined dense />
            </div>
            <div class="col-3">
              <q-input v-model="locationForm.zip" label="Zip" outlined dense />
            </div>
          </div>
          <q-toggle class="primary-toggle" v-model="locationForm.isPrimary" label="Set as primary residence" color="primary" />
        </q-card-section>
        <q-card-actions align="right">
          <q-btn flat label="Cancel" color="grey-7" v-close-popup />
          <q-btn unelevated color="primary" :label="editingLocationId === null ? 'Add location' : 'Save changes'" @click="saveLocation" />
        </q-card-actions>
      </q-card>
    </q-dialog>
  </div>
</template>

<style scoped>
.settings-container {
  max-width: 1200px;
  margin: 0 auto;
  padding: 24px;
}

.settings-header {
  background: white;
  border-bottom: 1px solid #E0E0E0;
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

.empty-locations {
  min-height: 180px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  background: var(--bg-secondary);
  border-radius: 12px;
  border: 1px dashed var(--border-light);
}

.location-row {
  align-items: center;
}

.location-form {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.location-form .q-input {
  width: 100%;
}

.location-form .row {
  margin: 0;
}

.primary-toggle {
  align-self: flex-start;
  margin-top: 4px;
}
</style>
