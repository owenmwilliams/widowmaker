<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue';
import { useQuasar } from 'quasar';
import { inventoryStore } from '../../stores/InventoryStore';
import { storeToRefs } from 'pinia';
import VisionProviderToggle from '../VisionProviderToggle.vue';
import axios from 'axios';

const props = defineProps<{
  user: string;
}>();

const core_url = import.meta.env.MODE == 'development' ? 'http://localhost:3050' : 'https://movetrack-api-7hwn7ggbiq-uc.a.run.app';

const currentVisionProvider = ref<string>('gemini');
const locationDialogOpen = ref(false);
const editingLocationId = ref<number | null>(null);
const store = inventoryStore();
const { locations } = storeToRefs(store);
const $q = useQuasar();

// Truck management state
interface Truck {
  id: number;
  name: string;
  truck_identifier: string | null;
  truck_sequence: number | null;
  truck_size: string | null;
  session_count: string;
  zone_count: string;
}

const trucks = ref<Truck[]>([]);
const loadingTrucks = ref(false);
const truckDialogOpen = ref(false);
const editingTruckId = ref<number | null>(null);
const truckForm = reactive({
  name: '',
  truck_identifier: '',
  truck_size: ''
});

const truckSizeOptions = [
  { label: 'Van', value: 'van' },
  { label: '10 ft', value: '10ft' },
  { label: '12 ft', value: '12ft' },
  { label: '15 ft', value: '15ft' },
  { label: '17 ft', value: '17ft' },
  { label: '20 ft', value: '20ft' },
  { label: '22 ft', value: '22ft' },
  { label: '24 ft', value: '24ft' },
  { label: '26 ft', value: '26ft' }
];

const getAuthHeaders = () => {
  const token = localStorage.getItem('session_token');
  return { Authorization: `Bearer ${token}` };
};

const fetchTrucks = async () => {
  loadingTrucks.value = true;
  try {
    const response = await axios.get(`${core_url}/api/move-day/trucks`, {
      headers: getAuthHeaders()
    });
    trucks.value = response.data;
  } catch (error) {
    console.error('Failed to fetch trucks:', error);
  } finally {
    loadingTrucks.value = false;
  }
};

onMounted(() => {
  fetchTrucks();
});

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

// Truck management functions
const resetTruckForm = () => {
  truckForm.name = '';
  truckForm.truck_identifier = '';
  truckForm.truck_size = '';
  editingTruckId.value = null;
};

const openEditTruck = (truck: Truck) => {
  editingTruckId.value = truck.id;
  truckForm.name = truck.name;
  truckForm.truck_identifier = truck.truck_identifier || '';
  truckForm.truck_size = truck.truck_size || '';
  truckDialogOpen.value = true;
};

const saveTruck = async () => {
  if (editingTruckId.value === null) {
    return;
  }

  try {
    $q.loading.show({ message: 'Updating truck...' });
    await axios.put(`${core_url}/api/move-day/trucks/${editingTruckId.value}`, {
      truck_identifier: truckForm.truck_identifier || null,
      truck_size: truckForm.truck_size || null
    }, {
      headers: getAuthHeaders()
    });

    $q.notify({
      type: 'positive',
      message: 'Truck updated',
      position: 'bottom'
    });

    truckDialogOpen.value = false;
    resetTruckForm();
    await fetchTrucks();
  } catch (error) {
    console.error('Failed to update truck:', error);
    $q.notify({
      type: 'negative',
      message: 'Unable to update truck',
      position: 'bottom'
    });
  } finally {
    $q.loading.hide();
  }
};

const deleteTruck = async (truck: Truck) => {
  const sessionCount = parseInt(truck.session_count || '0');
  const zoneCount = parseInt(truck.zone_count || '0');

  let warningMessage = 'Are you sure you want to delete this truck?';
  if (sessionCount > 0 || zoneCount > 0) {
    warningMessage = `This truck has ${sessionCount} session(s) and ${zoneCount} zone(s) associated with it. Deleting will unlink these associations. Are you sure?`;
  }

  $q.dialog({
    title: 'Delete Truck',
    message: warningMessage,
    cancel: true,
    persistent: true
  }).onOk(async () => {
    try {
      $q.loading.show({ message: 'Deleting truck...' });
      await axios.delete(`${core_url}/api/move-day/trucks/${truck.id}`, {
        headers: getAuthHeaders()
      });

      $q.notify({
        type: 'positive',
        message: 'Truck deleted',
        position: 'bottom'
      });

      await fetchTrucks();
    } catch (error) {
      console.error('Failed to delete truck:', error);
      $q.notify({
        type: 'negative',
        message: 'Unable to delete truck',
        position: 'bottom'
      });
    } finally {
      $q.loading.hide();
    }
  });
};

const getTruckDisplayName = (truck: Truck) => {
  if (truck.truck_identifier) {
    return truck.truck_identifier;
  }
  if (truck.truck_sequence) {
    return `Truck ${truck.truck_sequence}`;
  }
  return truck.name;
};

const getTruckSizeLabel = (size: string | null) => {
  if (!size) return null;
  const option = truckSizeOptions.find(opt => opt.value === size);
  return option ? option.label : size;
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

      <!-- Trucks Section -->
      <q-card class="settings-card">
        <q-card-section>
          <div class="section-header">
            <q-icon name="local_shipping" size="md" color="primary" class="q-mr-md" />
            <div class="text-h6">Manage Trucks</div>
          </div>
          <div class="text-caption text-grey-7 q-mt-sm">
            View and manage trucks created during your move sessions. Trucks are created automatically when you start a new session with a truck.
          </div>
        </q-card-section>
        <q-separator />
        <q-card-section class="q-pt-none">
          <div v-if="loadingTrucks" class="text-center q-pa-md">
            <q-spinner color="primary" size="32px" />
            <div class="text-caption text-grey-7 q-mt-sm">Loading trucks...</div>
          </div>
          <div v-else-if="trucks.length === 0" class="empty-locations text-grey-7">
            <q-icon name="local_shipping" size="48px" color="grey-5" class="q-mb-sm" />
            <div class="text-subtitle1">No trucks yet</div>
            <div class="text-caption q-mt-xs">Trucks will appear here when you create move sessions that use trucks.</div>
          </div>
          <q-list v-else separator>
            <q-item v-for="truck in trucks" :key="truck.id" class="location-row">
              <q-item-section avatar>
                <q-icon name="local_shipping" color="primary" />
              </q-item-section>
              <q-item-section>
                <q-item-label class="text-weight-medium">
                  {{ getTruckDisplayName(truck) }}
                  <q-chip v-if="truck.truck_size" color="grey-3" text-color="grey-8" dense size="xs" class="q-ml-sm">
                    {{ getTruckSizeLabel(truck.truck_size) }}
                  </q-chip>
                </q-item-label>
                <q-item-label caption class="text-grey-7">
                  {{ truck.session_count }} session(s), {{ truck.zone_count }} zone(s)
                </q-item-label>
              </q-item-section>
              <q-item-section side>
                <q-btn flat round dense icon="edit" color="primary" @click="openEditTruck(truck)">
                  <q-tooltip>Edit truck</q-tooltip>
                </q-btn>
                <q-btn flat round dense icon="delete" color="negative" class="q-ml-sm" @click="deleteTruck(truck)">
                  <q-tooltip>Delete truck</q-tooltip>
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

    <!-- Truck Edit Dialog -->
    <q-dialog v-model="truckDialogOpen" persistent @hide="resetTruckForm">
      <q-card style="min-width: 450px;">
        <q-card-section>
          <div class="text-h6">Edit Truck</div>
        </q-card-section>
        <q-card-section class="location-form q-pt-none">
          <q-input
            v-model="truckForm.truck_identifier"
            label="Truck Name"
            outlined
            dense
            autofocus
            hint="Give your truck a custom name (e.g., 'Big Blue', 'U-Haul #1')"
          />
          <q-select
            v-model="truckForm.truck_size"
            :options="truckSizeOptions"
            label="Truck Size"
            outlined
            dense
            emit-value
            map-options
            clearable
            hint="Select the size of the truck"
          />
        </q-card-section>
        <q-card-actions align="right">
          <q-btn flat label="Cancel" color="grey-7" v-close-popup />
          <q-btn unelevated color="primary" label="Save changes" @click="saveTruck" />
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
