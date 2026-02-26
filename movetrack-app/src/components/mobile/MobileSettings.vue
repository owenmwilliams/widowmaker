<script setup lang="ts">
import { computed, ref } from 'vue';
import { useQuasar } from 'quasar';
import { useRouter } from 'vue-router';
import VisionProviderToggle from '../VisionProviderToggle.vue';
import MobileAdd from './MobileAdd.vue';
import LocationDeleteDialog from '../location/LocationDeleteDialog.vue';
import { inventoryStore } from '../../stores/InventoryStore';

const props = defineProps<{
  user: string;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
}>();

const store = inventoryStore();
const $q = useQuasar();
const router = useRouter();

const currentVisionProvider = ref<string>('gemini');

const manageDialogOpen = ref(false);
const manageObjectType = ref<'location' | 'collection'>('location');
const manageEditMode = ref(false);
const manageId = ref<string | number | undefined>(undefined);

const locationDeleteDialog = ref(false);
const locationToDelete = ref<{ id: number; name: string } | null>(null);

const handleProviderChanged = (provider: string) => {
  currentVisionProvider.value = provider;
};

const locationList = computed(() => store.locations);
const collectionList = computed(() =>
  store.collections.map((collection) => ({
    ...collection,
    locationLabel:
      store.locations.find((loc) => loc.value === collection.location)?.label ||
      'No location'
  }))
);

const openManageDialog = (type: 'location' | 'collection', options?: { id?: string | number; edit?: boolean }) => {
  manageObjectType.value = type;
  manageEditMode.value = options?.edit ?? false;
  manageId.value = options?.id;
  manageDialogOpen.value = true;
};

const closeManageDialog = () => {
  manageDialogOpen.value = false;
  manageId.value = undefined;
  manageEditMode.value = false;
};

const formatLocationSubtitle = (location: any) => {
  const parts = [
    location.address,
    location.city,
    location.state,
    location.zip
  ].filter(Boolean);
  return parts.join(', ');
};

const confirmDelete = (type: 'location' | 'collection', id: string | number, name: string) => {
  if (type === 'location') {
    // Use the new deletion dialog for locations
    locationToDelete.value = { id: Number(id), name };
    locationDeleteDialog.value = true;
  } else {
    // Keep simple dialog for collections
    $q.dialog({
      title: 'Delete Collection',
      message: `Are you sure you want to delete "${name}"?`,
      cancel: true,
      persistent: true
    }).onOk(async () => {
      await store.deleteCollection(id, props.user);
    });
  }
};

const handleLocationDeleted = async () => {
  // Refresh inventory after location deletion
  await store.loadInventory(props.user);
  locationDeleteDialog.value = false;
  locationToDelete.value = null;
};

const isAdmin = computed(() => {
  try {
    const raw = localStorage.getItem('user_data');
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed?.is_admin === true;
  } catch {
    return false;
  }
});

const adminFeatures = [
  {
    name: 'Mobile Live Scan',
    description: 'Real-time object detection with MediaPipe and AI classification',
    icon: 'camera_enhance',
    route: '/mobile-live-scan',
    badge: 'Experimental'
  },
  {
    name: 'Twelve Labs Video',
    description: 'Full video analysis using Twelve Labs Pegasus model for inventory extraction',
    icon: 'video_library',
    route: '/vision-lab-12labs',
    badge: 'Experimental'
  },
  {
    name: 'Frame-based Vision',
    description: 'Client-side frame extraction with blur/entropy scoring and Claude analysis',
    icon: 'movie_filter',
    route: '/vision-lab-video',
    badge: 'Dev Only'
  },
  {
    name: 'Vision Lab',
    description: 'Admin testing interface for image analysis experiments',
    icon: 'science',
    route: '/vision-lab',
    badge: 'Admin Only'
  }
];

const navigateToFeature = (route: string) => {
  router.push(route);
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

    <q-card-section class="settings-content">
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
          Add, edit, or remove the locations where your items live.
        </div>
        <q-btn 
          color="primary" 
          label="Add Location" 
          icon="add" 
          outline 
          class="full-width q-mb-md"
          @click="openManageDialog('location')"
        />
        <q-list bordered class="manage-list">
          <q-item v-for="location in locationList" :key="location.value">
            <q-item-section>
              <q-item-label>{{ location.label }}</q-item-label>
              <q-item-label caption>
                {{ formatLocationSubtitle(location) || 'No address on file' }}
              </q-item-label>
            </q-item-section>
            <q-item-section side top>
              <q-btn
                flat
                round
                color="primary"
                icon="edit"
                @click="openManageDialog('location', { id: location.value, edit: true })"
              />
            </q-item-section>
            <q-item-section side top>
              <q-btn
                flat
                round
                color="negative"
                icon="delete"
                @click="confirmDelete('location', location.value, location.label)"
              />
            </q-item-section>
          </q-item>
        </q-list>
      </div>

      <q-separator class="q-my-lg" />

      <!-- Collections Section -->
      <div class="settings-section">
        <div class="section-header">
          <q-icon name="collections_bookmark" size="md" color="primary" />
          <div class="text-h6 q-ml-sm">Manage Collections</div>
        </div>
        <div class="text-caption text-grey-7 q-mt-sm q-mb-md">
          Add, rename, or delete collections across your locations.
        </div>
        <q-btn
          color="primary"
          label="Add Collection"
          icon="add"
          outline
          class="full-width q-mb-md"
          @click="openManageDialog('collection')"
        />
        <q-list bordered class="manage-list">
          <q-item v-for="collection in collectionList" :key="collection.value">
            <q-item-section>
              <q-item-label>{{ collection.label }}</q-item-label>
              <q-item-label caption>{{ collection.locationLabel }}</q-item-label>
            </q-item-section>
            <q-item-section side top>
              <q-btn
                flat
                round
                color="primary"
                icon="edit"
                @click="openManageDialog('collection', { id: collection.value, edit: true })"
              />
            </q-item-section>
            <q-item-section side top>
              <q-btn
                flat
                round
                color="negative"
                icon="delete"
                @click="confirmDelete('collection', collection.value, collection.label)"
              />
            </q-item-section>
          </q-item>
        </q-list>
      </div>

      <!-- Admin Features Section (only visible to admins) -->
      <template v-if="isAdmin">
        <q-separator class="q-my-lg" />

        <div class="settings-section">
          <div class="section-header">
            <q-icon name="engineering" size="md" color="deep-orange" />
            <div class="text-h6 q-ml-sm">Admin Features</div>
          </div>
          <div class="text-caption text-grey-7 q-mt-sm q-mb-md">
            Experimental vision analysis tools for testing and development.
          </div>
          <q-list bordered class="manage-list">
            <q-item
              v-for="feature in adminFeatures"
              :key="feature.route"
              clickable
              @click="navigateToFeature(feature.route)"
            >
              <q-item-section avatar>
                <q-icon :name="feature.icon" color="primary" />
              </q-item-section>
              <q-item-section>
                <q-item-label>{{ feature.name }}</q-item-label>
                <q-item-label caption class="text-caption">
                  {{ feature.description }}
                </q-item-label>
              </q-item-section>
              <q-item-section side>
                <q-badge :color="feature.badge === 'Experimental' ? 'orange' : 'deep-orange'" :label="feature.badge" />
              </q-item-section>
            </q-item>
          </q-list>
        </div>
      </template>
    </q-card-section>
  </q-card>

  <q-dialog v-model="manageDialogOpen">
    <MobileAdd
      :user="props.user"
      :edit-select="manageEditMode"
      :object-type="manageObjectType"
      :id-prop="manageId"
      @close="closeManageDialog"
    />
  </q-dialog>

  <!-- Location Delete Dialog with Move Handling -->
  <LocationDeleteDialog
    v-if="locationToDelete"
    v-model="locationDeleteDialog"
    :location-id="locationToDelete.id"
    :location-name="locationToDelete.name"
    @deleted="handleLocationDeleted"
  />
</template>

<style scoped>
.mobile-settings-card {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

.settings-section {
  margin-bottom: 24px;
}

.section-header {
  display: flex;
  align-items: center;
}

.manage-list {
  border-radius: 12px;
  overflow: hidden;
}

.settings-content {
  flex: 1;
  overflow-y: auto;
}
</style>
