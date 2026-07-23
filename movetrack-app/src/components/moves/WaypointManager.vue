<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { API_BASE_URL } from "../../config/api";
import { useQuasar } from 'quasar';
import { PackageOpen, MapPin, BedDouble, Flag } from 'lucide-vue-next';
import axios, { type AxiosRequestHeaders } from 'axios';

// API URL based on environment
const core_url = API_BASE_URL;

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

const proposeWaypoints = async () => {
  if (!props.moveId || !props.routePolyline || !props.totalDistanceMiles) return;

  // Confirm if waypoints already exist
  if (waypoints.value.length > 0) {
    $q.dialog({
      title: 'Propose New Waypoints?',
      message: 'This will replace your current suggested stops with new optimized waypoints based on your route segments. Drop-off locations will be preserved. Continue?',
      cancel: true,
      persistent: true
    }).onOk(async () => {
      await performProposeWaypoints(true);
    });
  } else {
    await performProposeWaypoints(false);
  }
};

const performProposeWaypoints = async (clearExisting: boolean) => {
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

    await fetchWaypoints();

    // Auto-recalculate route distances after suggesting waypoints
    if (count > 0) {
      await reroute();
    }

    $q.notify({
      type: 'positive',
      message: `Proposed ${count} optimized waypoint${count !== 1 ? 's' : ''}`
    });
  } catch (error: any) {
    console.error('Error proposing waypoints:', error);
    const message = error.response?.data?.error || 'Failed to propose waypoints';
    $q.notify({
      type: 'negative',
      message
    });
  } finally {
    suggesting.value = false;
  }
};

const reroute = async () => {
  if (!props.moveId || waypoints.value.length === 0) return;

  calculating.value = true;
  try {
    const response = await axios.post(`${core_url}/api/waypoints/${props.moveId}/recalculate-route`, {}, {
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
    let message = `Route recalculated: ${totalDistanceMiles} mi, ~${totalDurationHours} hrs`;
    
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
  calculateRoute: reroute
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
          color="grey-7"
          icon="replay"
          :loading="calculating"
          :disable="!moveId || calculating"
          @click="reroute"
        >
          <q-tooltip>Reroute: Recalculate route for current waypoints</q-tooltip>
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
          @click="proposeWaypoints"
        >
          <q-tooltip>Propose Waypoints: Optimize route segments</q-tooltip>
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
            <span v-if="waypoint.is_dropoff" class="stop-tag stop-tag--dropoff">
              <PackageOpen :size="12" />
              <q-tooltip>Drop-off location (unloading stop)</q-tooltip>
            </span>
            <span v-else-if="waypoint.source === 'manual'" class="stop-tag stop-tag--manual">
              <MapPin :size="12" />
              <q-tooltip>Manual waypoint (won't be reordered)</q-tooltip>
            </span>
            <span
              v-else-if="waypoint.overnight_recommended || waypoint.source === 'suggested'"
              class="stop-tag stop-tag--overnight"
            >
              <BedDouble :size="12" />
              <q-tooltip>Suggested overnight stop</q-tooltip>
            </span>
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
            <span class="stop-tag stop-tag--destination">
              <Flag :size="12" />
              <q-tooltip>Final destination</q-tooltip>
            </span>{{ destinationName || 'Destination' }}
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
          <div class="text-h6 waypoint-dialog-title">{{ editingWaypoint ? 'Edit waypoint' : 'Add waypoint' }}</div>
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
/* Floating panel over the map: card recipe with a translucent surface */
.waypoint-manager {
  background: color-mix(in oklab, var(--surface-card) 82%, transparent);
  border: 1px solid var(--border-soft);
  border-radius: var(--r-lg);
  box-shadow: var(--shadow-sm);
  max-width: 320px; /* fixed layout dimension */
  overflow: hidden;
}

.waypoint-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--sp-3) var(--sp-4);
  cursor: pointer;
  user-select: none;
  border-bottom: 1px solid var(--border);
  transition: background-color var(--dur-fast) var(--ease-standard);
}

.waypoint-header:hover {
  background: var(--surface-hover);
}

.waypoint-header:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring);
}

.waypoint-content {
  max-height: 200px; /* fixed layout dimension */
  overflow-y: auto;
}

.waypoint-list {
  padding: var(--sp-2) 0;
}

.waypoint-row {
  display: flex;
  align-items: center;
  padding: var(--sp-3) var(--sp-4);
  gap: var(--sp-4);
  font-size: var(--fs-label);
  color: var(--text-primary);
  border-bottom: 1px solid var(--border-soft);
  transition: background-color var(--dur-fast) var(--ease-standard);
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
  font-family: var(--font-mono);
  font-size: var(--fs-micro);
  flex-shrink: 0;
}

.waypoint-actions {
  display: flex;
  flex-shrink: 0;
  margin-left: auto;
}

.waypoint-actions .q-btn {
  opacity: 0.6;
  transition: opacity var(--dur-fast) var(--ease-standard);
}

.waypoint-row:hover .waypoint-actions .q-btn {
  opacity: 1;
}

/* Stop-type tags: token pills (icon + tooltip) */
.stop-tag {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  vertical-align: middle;
  padding: var(--sp-1) var(--sp-2);
  margin-right: var(--sp-2);
  border-radius: var(--r-pill);
}

.stop-tag--dropoff {
  background: color-mix(in oklab, var(--beacon) 14%, transparent);
  color: var(--beacon);
}

.stop-tag--manual {
  background: var(--surface-hover);
  color: var(--text-secondary);
}

.stop-tag--overnight {
  background: var(--accent-quiet);
  color: var(--accent);
}

.stop-tag--destination {
  background: color-mix(in oklab, var(--beacon) 14%, transparent);
  color: var(--beacon);
}

/* Drop-off rows: quiet tint, no colored left-border (banned pattern) */
.dropoff-waypoint {
  background: color-mix(in oklab, var(--beacon) 8%, transparent);
  font-weight: var(--fw-medium);
}

.waypoint-row.final-leg {
  background: var(--surface-sunk);
  border-top: 1px dashed var(--border);
  font-style: italic;
}

.waypoint-dialog-title {
  font-family: var(--font-display);
  letter-spacing: var(--ls-title);
}
</style>
