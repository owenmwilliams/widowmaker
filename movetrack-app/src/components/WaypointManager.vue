<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { useQuasar } from 'quasar';
import axios, { type AxiosRequestHeaders } from 'axios';

// API URL based on environment
const core_url = import.meta.env.MODE == 'development' ? 'http://localhost:3050' : 'https://movetrack-api-7hwn7ggbiq-uc.a.run.app';

// Get auth headers
const getAuthHeaders = (): AxiosRequestHeaders | undefined => {
  const sessionToken = localStorage.getItem('session_token');
  return sessionToken ? { Authorization: `Bearer ${sessionToken}` } : undefined;
};

interface Waypoint {
  id: number;
  saved_move_id: number;
  city: string;
  state: string;
  country: string;
  lat?: number;
  lng?: number;
  location_id?: number | null;
  source: string;
  distance_from_origin_miles?: number;
  typical_drive_hours_from_origin?: number;
  segment_distance_miles?: number;
  segment_duration_hours?: number;
  distance_source?: 'estimated' | 'calculated' | 'polyline';
  notes?: string;
  overnight_recommended: boolean;
  is_dropoff: boolean;
  sequence_order: number;
}

const props = defineProps<{
  moveId: number | null;
  routePolyline?: string | null;
  totalDistanceMiles?: number | null;
  destinationName?: string | null;
}>();

interface RouteUpdateData {
  routePolyline: string;
  waypoints: Waypoint[];
  totalDistanceMiles: number;
  totalDurationHours: number;
  waypointsReordered: boolean;
  finalLegDistanceMiles?: number;
  finalLegDurationHours?: number;
}

const emit = defineEmits<{
  (e: 'update', waypoints: Waypoint[]): void;
  (e: 'route-updated', data: RouteUpdateData): void;
}>();

const $q = useQuasar();

const waypoints = ref<Waypoint[]>([]);
const loading = ref(false);
const suggesting = ref(false);
const calculating = ref(false);
const showAddDialog = ref(false);
const editingWaypoint = ref<Waypoint | null>(null);
const isCollapsed = ref(false);
const finalLegDistanceMiles = ref<number | null>(null);
const finalLegDurationHours = ref<number | null>(null);

// Check if we can suggest stops (need route data and distance > 600 miles)
const canSuggestStops = computed(() => {
  return props.routePolyline && props.totalDistanceMiles && props.totalDistanceMiles > 600;
});

const suggestedStopsCount = computed(() => {
  if (!props.totalDistanceMiles) return 0;
  return Math.ceil(props.totalDistanceMiles / 600) - 1;
});

// Form fields
const newCity = ref('');
const newState = ref('');
const newNotes = ref('');
const newOvernightRecommended = ref(false);
const newIsDropoff = ref(false);

const stateOptions = [
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA',
  'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD',
  'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
  'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
  'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY'
];

const sortedWaypoints = computed(() => {
  return [...waypoints.value].sort((a, b) => a.sequence_order - b.sequence_order);
});

const fetchWaypoints = async () => {
  if (!props.moveId) return;

  loading.value = true;
  try {
    const response = await axios.get(`${core_url}/api/waypoints/${props.moveId}`, {
      headers: getAuthHeaders()
    });
    waypoints.value = response.data;
    emit('update', waypoints.value);
  } catch (error) {
    console.error('Error fetching waypoints:', error);
    $q.notify({
      type: 'negative',
      message: 'Failed to load waypoints'
    });
  } finally {
    loading.value = false;
  }
};

const resetForm = () => {
  newCity.value = '';
  newState.value = '';
  newNotes.value = '';
  newOvernightRecommended.value = false;
  newIsDropoff.value = false;
  editingWaypoint.value = null;
};

const openAddDialog = () => {
  resetForm();
  showAddDialog.value = true;
};

const openEditDialog = (waypoint: Waypoint) => {
  editingWaypoint.value = waypoint;
  newCity.value = waypoint.city;
  newState.value = waypoint.state || '';
  newNotes.value = waypoint.notes || '';
  newOvernightRecommended.value = waypoint.overnight_recommended;
  newIsDropoff.value = waypoint.is_dropoff || false;
  showAddDialog.value = true;
};

const saveWaypoint = async () => {
  if (!props.moveId || !newCity.value) return;

  try {
    if (editingWaypoint.value) {
      // Update existing
      await axios.put(`${core_url}/api/waypoints/${editingWaypoint.value.id}`, {
        city: newCity.value,
        state: newState.value || null,
        notes: newNotes.value || null,
        overnightRecommended: newOvernightRecommended.value,
        isDropoff: newIsDropoff.value
      }, {
        headers: getAuthHeaders()
      });
      $q.notify({
        type: 'positive',
        message: 'Waypoint updated'
      });
    } else {
      // Create new
      await axios.post(`${core_url}/api/waypoints/${props.moveId}`, {
        city: newCity.value,
        state: newState.value || null,
        notes: newNotes.value || null,
        overnightRecommended: newOvernightRecommended.value,
        isDropoff: newIsDropoff.value
      }, {
        headers: getAuthHeaders()
      });
      $q.notify({
        type: 'positive',
        message: 'Waypoint added'
      });
    }

    showAddDialog.value = false;
    resetForm();
    await fetchWaypoints();
  } catch (error) {
    console.error('Error saving waypoint:', error);
    $q.notify({
      type: 'negative',
      message: 'Failed to save waypoint'
    });
  }
};

const deleteWaypoint = async (waypoint: Waypoint) => {
  $q.dialog({
    title: 'Delete Waypoint',
    message: `Are you sure you want to delete ${waypoint.city}, ${waypoint.state}?\n\nDeleting this waypoint will also remove any move sessions that reference it. Consider regenerating your move schedule afterward to ensure your plan stays up to date.`,
    cancel: true,
    persistent: true,
    html: false
  }).onOk(async () => {
    try {
      const response = await axios.delete(`${core_url}/api/waypoints/${waypoint.id}`, {
        headers: getAuthHeaders()
      });

      const sessionsDeleted = response.data?.sessionsDeleted || 0;
      let notificationMessage = 'Waypoint deleted';
      if (sessionsDeleted > 0) {
        notificationMessage += ` (${sessionsDeleted} session${sessionsDeleted !== 1 ? 's' : ''} removed)`;
      }

      $q.notify({
        type: 'positive',
        message: notificationMessage
      });

      // Suggest regenerating schedule if sessions were affected
      if (sessionsDeleted > 0) {
        setTimeout(() => {
          $q.notify({
            type: 'info',
            message: 'Tip: Regenerate your move schedule to update your plan',
            timeout: 5000,
            position: 'top'
          });
        }, 1000);
      }

      await fetchWaypoints();
    } catch (error: any) {
      console.error('Error deleting waypoint:', error);
      const message = error.response?.data?.error || 'Failed to delete waypoint';
      $q.notify({
        type: 'negative',
        message
      });
    }
  });
};

const moveWaypointUp = async (index: number) => {
  if (index <= 0) return;

  const newOrder = sortedWaypoints.value.map(w => w.id);
  [newOrder[index - 1], newOrder[index]] = [newOrder[index], newOrder[index - 1]];

  try {
    await axios.post(`${core_url}/api/waypoints/${props.moveId}/reorder`, {
      waypointIds: newOrder
    }, {
      headers: getAuthHeaders()
    });
    await fetchWaypoints();
  } catch (error) {
    console.error('Error reordering waypoints:', error);
    $q.notify({
      type: 'negative',
      message: 'Failed to reorder waypoints'
    });
  }
};

const moveWaypointDown = async (index: number) => {
  if (index >= sortedWaypoints.value.length - 1) return;

  const newOrder = sortedWaypoints.value.map(w => w.id);
  [newOrder[index], newOrder[index + 1]] = [newOrder[index + 1], newOrder[index]];

  try {
    await axios.post(`${core_url}/api/waypoints/${props.moveId}/reorder`, {
      waypointIds: newOrder
    }, {
      headers: getAuthHeaders()
    });
    await fetchWaypoints();
  } catch (error) {
    console.error('Error reordering waypoints:', error);
    $q.notify({
      type: 'negative',
      message: 'Failed to reorder waypoints'
    });
  }
};

watch(() => props.moveId, () => {
  if (props.moveId) {
    fetchWaypoints();
  } else {
    waypoints.value = [];
  }
}, { immediate: true });

const suggestStops = async () => {
  if (!props.moveId || !props.routePolyline || !props.totalDistanceMiles) return;

  // Confirm if waypoints already exist
  if (waypoints.value.length > 0) {
    $q.dialog({
      title: 'Replace Existing Waypoints?',
      message: 'This will replace your current waypoints with auto-suggested stops. Continue?',
      cancel: true,
      persistent: true
    }).onOk(async () => {
      await performSuggestStops(true);
    });
  } else {
    await performSuggestStops(false);
  }
};

const performSuggestStops = async (clearExisting: boolean) => {
  suggesting.value = true;
  try {
    const response = await axios.post(`${core_url}/api/waypoints/${props.moveId}/suggest-and-save`, {
      routePolyline: props.routePolyline,
      totalDistanceMiles: props.totalDistanceMiles,
      maxDailyMiles: 600,
      clearExisting
    }, {
      headers: getAuthHeaders()
    });

    const count = response.data.waypoints?.length || 0;
    $q.notify({
      type: 'positive',
      message: `Added ${count} suggested stop${count !== 1 ? 's' : ''} along your route`
    });

    await fetchWaypoints();
  } catch (error: any) {
    console.error('Error suggesting stops:', error);
    const message = error.response?.data?.error || 'Failed to suggest stops';
    $q.notify({
      type: 'negative',
      message
    });
  } finally {
    suggesting.value = false;
  }
};

const calculateRoute = async () => {
  if (!props.moveId || waypoints.value.length === 0) return;

  calculating.value = true;
  try {
    const response = await axios.post(`${core_url}/api/waypoints/${props.moveId}/calculate-route`, {}, {
      headers: getAuthHeaders()
    });

    const {
      totalDistanceMiles,
      totalDurationHours,
      waypoints: updatedWaypoints,
      routePolyline,
      waypointsReordered,
      finalLegDistanceMiles: finalLegDist,
      finalLegDurationHours: finalLegDur
    } = response.data;

    // Store final leg data
    finalLegDistanceMiles.value = finalLegDist ?? null;
    finalLegDurationHours.value = finalLegDur ?? null;

    // Build notification message
    let message = `Route optimized: ${totalDistanceMiles} mi, ~${totalDurationHours} hrs`;
    if (waypointsReordered) {
      message += ' (waypoints reordered)';
    }

    $q.notify({
      type: 'positive',
      message
    });

    // Refresh waypoints to get updated order and distances
    await fetchWaypoints();

    // Emit route-updated event so parent can update the map
    if (routePolyline) {
      emit('route-updated', {
        routePolyline,
        waypoints: waypoints.value,
        totalDistanceMiles,
        totalDurationHours,
        waypointsReordered,
        finalLegDistanceMiles: finalLegDist,
        finalLegDurationHours: finalLegDur
      });
    }
  } catch (error: any) {
    console.error('Error calculating route:', error);
    const message = error.response?.data?.error || 'Failed to calculate route distances';
    $q.notify({
      type: 'negative',
      message
    });
  } finally {
    calculating.value = false;
  }
};

defineExpose({
  waypoints,
  fetchWaypoints,
  calculateRoute
});
</script>

<template>
  <div class="waypoint-manager">
    <!-- Collapsible Header -->
    <div class="waypoint-header" @click="isCollapsed = !isCollapsed">
      <div class="row items-center">
        <q-icon :name="isCollapsed ? 'chevron_right' : 'expand_more'" size="sm" class="q-mr-xs" />
        <span class="text-subtitle2 text-weight-medium">Waypoints</span>
        <span v-if="sortedWaypoints.length > 0" class="text-caption text-grey-6 q-ml-xs">({{ sortedWaypoints.length }})</span>
      </div>
      <div class="row q-gutter-xs" @click.stop>
        <q-btn
          v-if="sortedWaypoints.length > 0 && !isCollapsed"
          dense
          flat
          size="sm"
          color="positive"
          icon="route"
          :loading="calculating"
          :disable="!moveId || calculating"
          @click="calculateRoute"
        >
          <q-tooltip>Update route (optimize waypoint order)</q-tooltip>
        </q-btn>
        <q-btn
          v-if="canSuggestStops && !isCollapsed"
          dense
          flat
          size="sm"
          color="secondary"
          icon="auto_awesome"
          :loading="suggesting"
          :disable="!moveId || suggesting"
          @click="suggestStops"
        >
          <q-tooltip>Suggest {{ suggestedStopsCount }} stop{{ suggestedStopsCount !== 1 ? 's' : '' }}</q-tooltip>
        </q-btn>
        <q-btn
          v-if="!isCollapsed"
          dense
          flat
          size="sm"
          color="primary"
          icon="add"
          :disable="!moveId"
          @click="openAddDialog"
        >
          <q-tooltip>Add waypoint</q-tooltip>
        </q-btn>
      </div>
    </div>

    <!-- Collapsible Content -->
    <div v-show="!isCollapsed" class="waypoint-content">
      <div v-if="loading" class="text-center q-pa-sm">
        <q-spinner color="primary" size="1.5em" />
      </div>

      <div v-else-if="sortedWaypoints.length === 0" class="text-center text-grey-6 q-pa-sm">
        <div class="text-caption">No waypoints yet</div>
      </div>

      <div v-else class="waypoint-list">
        <div
          v-for="(waypoint, index) in sortedWaypoints"
          :key="waypoint.id"
          :class="['waypoint-row', { 'dropoff-waypoint': waypoint.is_dropoff }]"
        >
          <span class="waypoint-name">
            <q-icon
              v-if="waypoint.is_dropoff"
              name="unarchive"
              size="xs"
              class="q-mr-xs text-orange-7"
            >
              <q-tooltip>Drop-off location (unloading stop)</q-tooltip>
            </q-icon>
            <q-icon
              v-else-if="waypoint.source === 'manual'"
              name="place"
              size="xs"
              class="q-mr-xs text-purple-6"
            >
              <q-tooltip>Manual waypoint (won't be reordered)</q-tooltip>
            </q-icon>
            <q-icon
              v-else-if="waypoint.overnight_recommended || waypoint.source === 'suggested'"
              name="hotel"
              size="xs"
              class="q-mr-xs text-blue-6"
            >
              <q-tooltip>Suggested overnight stop</q-tooltip>
            </q-icon>
            {{ waypoint.city }}<span v-if="waypoint.state">, {{ waypoint.state }}</span>
          </span>
          <span v-if="waypoint.segment_distance_miles" class="waypoint-dist text-grey-6">
            {{ Math.round(waypoint.segment_distance_miles / 10) * 10 }} mi, {{ Number(waypoint.segment_duration_hours || 0).toFixed(1) }}h
            <q-tooltip>Distance from {{ index === 0 ? 'origin' : 'previous stop' }}</q-tooltip>
          </span>
          <span v-else-if="waypoint.distance_from_origin_miles" class="waypoint-dist text-grey-6">
            <span v-if="waypoint.distance_source === 'estimated'">~</span>{{ Math.round(waypoint.distance_from_origin_miles) }} mi
            <q-tooltip v-if="waypoint.distance_source === 'estimated'">Estimated distance from origin (straight-line calculation)</q-tooltip>
          </span>
          <div class="waypoint-actions">
            <q-btn flat dense round icon="arrow_upward" size="xs" :disable="index === 0 || waypoint.is_dropoff || waypoint.source === 'manual'" @click="moveWaypointUp(index)">
              <q-tooltip v-if="waypoint.is_dropoff">Cannot reorder drop-off locations</q-tooltip>
              <q-tooltip v-else-if="waypoint.source === 'manual'">Cannot reorder manual waypoints (use Optimize to adjust suggested stops)</q-tooltip>
            </q-btn>
            <q-btn flat dense round icon="arrow_downward" size="xs" :disable="index === sortedWaypoints.length - 1 || waypoint.is_dropoff || waypoint.source === 'manual'" @click="moveWaypointDown(index)">
              <q-tooltip v-if="waypoint.is_dropoff">Cannot reorder drop-off locations</q-tooltip>
              <q-tooltip v-else-if="waypoint.source === 'manual'">Cannot reorder manual waypoints (use Optimize to adjust suggested stops)</q-tooltip>
            </q-btn>
            <q-btn flat dense round icon="delete" size="xs" color="negative" :disable="waypoint.is_dropoff" @click="deleteWaypoint(waypoint)">
              <q-tooltip v-if="waypoint.is_dropoff">Cannot delete drop-off locations (remove from move plan instead)</q-tooltip>
            </q-btn>
          </div>
        </div>
        <!-- Destination row (final leg from last waypoint to destination) -->
        <div v-if="finalLegDistanceMiles" class="waypoint-row final-leg">
          <span class="waypoint-name">
            <q-icon name="flag" size="xs" class="q-mr-xs text-red" />{{ destinationName || 'Destination' }}
          </span>
          <span class="waypoint-dist text-grey-6">
            {{ Math.round(finalLegDistanceMiles / 10) * 10 }} mi, {{ Number(finalLegDurationHours || 0).toFixed(1) }}h
            <q-tooltip>Distance from last stop to destination</q-tooltip>
          </span>
          <div class="waypoint-actions"></div>
        </div>
      </div>
    </div>

    <!-- Add/Edit Dialog -->
    <q-dialog v-model="showAddDialog" persistent>
      <q-card style="min-width: 350px">
        <q-card-section>
          <div class="text-h6">{{ editingWaypoint ? 'Edit Waypoint' : 'Add Waypoint' }}</div>
        </q-card-section>

        <q-card-section class="q-pt-none">
          <q-input
            v-model="newCity"
            label="City *"
            dense
            outlined
            class="q-mb-md"
            :rules="[val => !!val || 'City is required']"
          />

          <q-select
            v-model="newState"
            label="State"
            dense
            outlined
            :options="stateOptions"
            class="q-mb-md"
            clearable
          />

          <q-input
            v-model="newNotes"
            label="Notes"
            dense
            outlined
            type="textarea"
            rows="2"
            class="q-mb-md"
          />

          <q-toggle
            v-model="newOvernightRecommended"
            label="Overnight stop recommended"
          />

          <q-toggle
            v-model="newIsDropoff"
            label="Drop-off location (unload items here)"
          />
        </q-card-section>

        <q-card-actions align="right">
          <q-btn flat label="Cancel" color="grey" @click="showAddDialog = false" />
          <q-btn
            flat
            label="Save"
            color="primary"
            :disable="!newCity"
            @click="saveWaypoint"
          />
        </q-card-actions>
      </q-card>
    </q-dialog>
  </div>
</template>

<style scoped>
.waypoint-manager {
  background: rgba(255, 255, 255, 0.65);
  border-radius: 8px;
  box-shadow: 0 2px 8px rgba(0,0,0,0.12);
  max-width: 320px;
}

.waypoint-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  cursor: pointer;
  user-select: none;
  border-bottom: 1px solid #e0e0e0;
}

.waypoint-header:hover {
  background: rgba(0,0,0,0.03);
}

.waypoint-content {
  max-height: 200px;
  overflow-y: auto;
}

.waypoint-list {
  padding: 4px 0;
}

.waypoint-row {
  display: flex;
  align-items: center;
  padding: 8px 12px;
  gap: 12px;
  font-size: 13px;
  border-bottom: 1px solid #f0f0f0;
}

.waypoint-row:last-child {
  border-bottom: none;
}

.waypoint-name {
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.waypoint-dist {
  font-size: 11px;
  flex-shrink: 0;
}

.waypoint-actions {
  display: flex;
  flex-shrink: 0;
  margin-left: auto;
}

.waypoint-actions .q-btn {
  opacity: 0.6;
}

.waypoint-row:hover .waypoint-actions .q-btn {
  opacity: 1;
}

.dropoff-waypoint {
  background: rgba(255, 152, 0, 0.08);
  border-left: 3px solid #ff9800;
  font-weight: 500;
}

.waypoint-row.final-leg {
  background: #f5f5f5;
  border-top: 1px dashed #ccc;
  font-style: italic;
}
</style>
