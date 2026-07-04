<script setup lang="ts">
import { ref, computed } from 'vue';
import { API_BASE_URL } from "../../config/api";
import { useQuasar } from 'quasar';
import axios from 'axios';

const props = defineProps<{
  locationId: number | string;
  locationName: string;
  modelValue: boolean;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void;
  (e: 'deleted'): void;
}>();

const $q = useQuasar();

const core_url = API_BASE_URL;

interface DeletionPreview {
  location: {
    id: number;
    name: string;
    location_type: string;
  };
  affectedData: {
    collections: number;
    items: number;
    containers: number;
    moves: number;
  };
  affectedMoves: Array<{ id: number; name: string }>;
  availableDestinations: Array<{
    id: number;
    name: string;
    location_type: string;
    address?: string;
    city?: string;
    state?: string;
  }>;
  deletionStrategies: Array<{
    id: string;
    name: string;
    description: string;
    moveBehavior: string;
    recommended: boolean;
    requiresDestination: boolean;
    requiresConfirmation?: boolean;
  }>;
}

const deletionPreview = ref<DeletionPreview | null>(null);
const selectedStrategy = ref<string>('reassign');
const selectedDestination = ref<number | null>(null);
const deleteConfirmation = ref('');
const isLoading = ref(false);
const isDeleting = ref(false);

const showDialog = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value)
});

const canDelete = computed(() => {
  if (!deletionPreview.value) return false;

  // For reassign strategy, must select a destination
  if (selectedStrategy.value === 'reassign' && !selectedDestination.value) {
    return false;
  }

  // For delete_all strategy, must type DELETE
  if (selectedStrategy.value === 'delete_all' && deleteConfirmation.value !== 'DELETE') {
    return false;
  }

  return !isDeleting.value;
});

const strategyOptions = computed(() => {
  if (!deletionPreview.value) return [];

  return deletionPreview.value.deletionStrategies.map(s => ({
    label: s.name,
    value: s.id,
    caption: s.moveBehavior
  }));
});

const destinationOptions = computed(() => {
  if (!deletionPreview.value) return [];

  return deletionPreview.value.availableDestinations.map(d => ({
    label: `${d.name}${d.city ? ' - ' + d.city : ''}`,
    value: d.id
  }));
});

async function loadPreview() {
  isLoading.value = true;

  try {
    const sessionToken = localStorage.getItem('session_token');
    const { data } = await axios.get(`${core_url}/locations/delete/preview`, {
      params: { location_id: props.locationId },
      headers: { Authorization: `Bearer ${sessionToken}` }
    });

    deletionPreview.value = data;

    // Auto-select recommended strategy
    const recommended = data.deletionStrategies.find((s: any) => s.recommended);
    selectedStrategy.value = recommended?.id || 'unassigned';

    // Auto-select first destination if available
    if (data.availableDestinations.length > 0) {
      selectedDestination.value = data.availableDestinations[0].id;
    }
  } catch (error: any) {
    console.error('Failed to load deletion preview:', error);
    $q.notify({
      type: 'negative',
      message: error.response?.data?.error || 'Failed to load deletion preview',
      position: 'bottom'
    });
    showDialog.value = false;
  } finally {
    isLoading.value = false;
  }
}

async function executeDelete() {
  if (!canDelete.value) {
    $q.notify({
      type: 'warning',
      message: 'Please complete all required fields',
      position: 'bottom'
    });
    return;
  }

  isDeleting.value = true;
  $q.loading.show({ message: 'Deleting location...' });

  try {
    const sessionToken = localStorage.getItem('session_token');
    const { data } = await axios.delete(`${core_url}/locations/delete/execute`, {
      data: {
        location_id: props.locationId,
        strategy: selectedStrategy.value,
        destination_location_id: selectedDestination.value
      },
      headers: { Authorization: `Bearer ${sessionToken}` }
    });

    $q.loading.hide();
    showDialog.value = false;

    // Show success message based on strategy
    let message = '';
    const destName = deletionPreview.value?.availableDestinations.find(
      d => d.id === selectedDestination.value
    )?.name;

    if (selectedStrategy.value === 'reassign' && data.deletedCounts.movesUpdated > 0) {
      message = `Location deleted. ${data.deletedCounts.moved} collection(s) and ${data.deletedCounts.movesUpdated} move(s) moved to ${destName}.`;
    } else if (selectedStrategy.value === 'reassign') {
      message = `Location deleted. ${data.deletedCounts.moved} collection(s) moved to ${destName}.`;
    } else if (selectedStrategy.value === 'unassigned' && data.deletedCounts.movesDeleted > 0) {
      message = `Location deleted. ${data.deletedCounts.moved} collection(s) moved to Unassigned Items. ${data.deletedCounts.movesDeleted} move(s) deleted.`;
    } else if (selectedStrategy.value === 'unassigned') {
      message = `Location deleted. ${data.deletedCounts.moved} collection(s) moved to Unassigned Items.`;
    } else {
      message = `Location deleted. ${data.deletedCounts.collections} collection(s), ${data.deletedCounts.items} item(s), ${data.deletedCounts.containers} container(s)${data.deletedCounts.movesDeleted > 0 ? `, and ${data.deletedCounts.movesDeleted} move(s)` : ''} permanently deleted.`;
    }

    $q.notify({
      type: 'positive',
      message,
      position: 'bottom',
      timeout: 5000
    });

    emit('deleted');
  } catch (error: any) {
    console.error('Failed to delete location:', error);
    $q.loading.hide();
    $q.notify({
      type: 'negative',
      message: error.response?.data?.error || 'Failed to delete location',
      position: 'bottom'
    });
  } finally {
    isDeleting.value = false;
  }
}

// Load preview when dialog opens
const onDialogShow = () => {
  loadPreview();
};

const onDialogHide = () => {
  deletionPreview.value = null;
  selectedStrategy.value = 'reassign';
  selectedDestination.value = null;
  deleteConfirmation.value = '';
};
</script>

<template>
  <q-dialog
    v-model="showDialog"
    persistent
    @show="onDialogShow"
    @hide="onDialogHide"
  >
    <q-card style="min-width: 500px">
      <q-card-section>
        <div class="text-h6">Delete Location</div>
        <div class="text-subtitle2 text-grey-7">{{ locationName }}</div>
      </q-card-section>

      <q-separator />

      <q-card-section v-if="isLoading">
        <q-spinner color="primary" size="3em" />
        <div class="text-caption q-mt-md">Loading deletion preview...</div>
      </q-card-section>

      <q-card-section v-else-if="deletionPreview">
        <div class="text-body1 q-mb-md">
          This location contains:
        </div>
        <ul class="text-body2">
          <li>{{ deletionPreview.affectedData.collections }} collection(s)</li>
          <li>{{ deletionPreview.affectedData.items }} item(s)</li>
          <li>{{ deletionPreview.affectedData.containers }} container(s)</li>
          <li v-if="deletionPreview.affectedData.moves > 0" class="text-warning">
            {{ deletionPreview.affectedData.moves }} saved move(s)
          </li>
        </ul>

        <!-- Show affected moves if any -->
        <q-banner
          v-if="deletionPreview.affectedData.moves > 0"
          class="bg-warning text-dark q-mt-md"
          rounded
        >
          <template v-slot:avatar>
            <q-icon name="warning" color="warning" />
          </template>
          <div class="text-subtitle2 q-mb-xs">Affected Moves:</div>
          <ul class="text-body2">
            <li v-for="move in deletionPreview.affectedMoves" :key="move.id">
              {{ move.name }}
            </li>
          </ul>
        </q-banner>

        <div class="text-body1 q-mt-md q-mb-sm">
          What would you like to do with this inventory?
        </div>

        <!-- Strategy Selection -->
        <q-option-group
          v-model="selectedStrategy"
          :options="strategyOptions"
          color="primary"
        />

        <!-- Destination Selection (for reassign) -->
        <div v-if="selectedStrategy === 'reassign'" class="q-mt-md">
          <q-select
            v-model="selectedDestination"
            :options="destinationOptions"
            label="Select destination location"
            outlined
            dense
            emit-value
            map-options
          />
        </div>

        <!-- Delete Confirmation (for unassigned/delete_all with moves) -->
        <div
          v-if="(selectedStrategy === 'unassigned' || selectedStrategy === 'delete_all') &&
                deletionPreview.affectedData.moves > 0"
          class="q-mt-md"
        >
          <q-banner class="bg-red-1 text-negative" rounded>
            <template v-slot:avatar>
              <q-icon name="warning" color="negative" />
            </template>
            This will permanently delete {{ deletionPreview.affectedData.moves }} saved move(s).
            This action cannot be undone.
          </q-banner>
        </div>

        <!-- DELETE confirmation for delete_all -->
        <div v-if="selectedStrategy === 'delete_all'" class="q-mt-md">
          <q-input
            v-model="deleteConfirmation"
            label="Type DELETE to confirm"
            outlined
            dense
            :rules="[val => val === 'DELETE' || 'Please type DELETE to confirm']"
          />
        </div>
      </q-card-section>

      <q-separator />

      <q-card-actions align="right">
        <q-btn
          flat
          label="Cancel"
          color="grey-7"
          @click="showDialog = false"
          :disable="isDeleting"
        />
        <q-btn
          :label="selectedStrategy === 'delete_all' ? 'Delete All' : 'Delete Location'"
          :color="selectedStrategy === 'delete_all' ? 'negative' : 'primary'"
          :disable="!canDelete"
          :loading="isDeleting"
          @click="executeDelete"
        />
      </q-card-actions>
    </q-card>
  </q-dialog>
</template>

<style scoped>
ul {
  margin: 0;
  padding-left: 1.5rem;
}
</style>
