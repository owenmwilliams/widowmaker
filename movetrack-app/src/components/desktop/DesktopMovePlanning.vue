<script setup lang="ts">
import { computed, ref, watch, nextTick, onMounted, onUnmounted } from 'vue';
import { inventoryStore } from '../../stores/InventoryStore';
import { storeToRefs } from 'pinia';
import { useQuasar, Notify } from 'quasar';
import axios, { type AxiosRequestHeaders } from 'axios';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import RouteMap from '../RouteMap.vue';
import DesktopMoveDay from './DesktopMoveDay.vue';
import WaypointManager from '../WaypointManager.vue';
import LocationEditorDialog from '../location/LocationEditorDialog.vue';
import QuoteShoppingModal from '../QuoteShoppingModal.vue';

// TypeScript interfaces for store items
interface InventoryItem {
  value?: string | number;
  label?: string;
  collection?: string | number;
  container?: string | number | null;
  weight_lbs?: number | string;
  length_in?: number | string | null;
  width_in?: number | string | null;
  height_in?: number | string | null;
  dimensions?: string;
  quantity?: number | string;
  fragile?: boolean;
  tags?: string[];
  picture_url?: string | null;
  description?: string;
}

interface InventoryContainer {
  value?: string | number;
  label?: string;
  location?: string | number;
  collection?: string | number;
  box_size?: string;
  length_in?: number | string | null;
  width_in?: number | string | null;
  height_in?: number | string | null;
  inner_length_in?: number | string;
  inner_width_in?: number | string;
  inner_height_in?: number | string;
  dimensions?: string | {
    length?: number | string;
    width?: number | string;
    height?: number | string;
  };
}

interface InventoryLocation {
  value?: string | number;
  label?: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  country?: string;
  lat?: number | null;
  lng?: number | null;
  fullAddress?: string;
}

interface RouteData {
  distance_miles?: number;
  route_polyline?: string;
  duration_hours?: number;
}

interface MoveLocationData {
  location_role: string;
  location_id: string | number;
  lat?: number | string | null;
  lng?: number | string | null;
  entry_type?: string | null;
  number_of_flights?: number | null;
  has_elevator?: boolean;
  elevator_type?: string | null;
  elevator_distance?: number | null;
  elevator_reservation_required?: boolean;
  parking_situation?: string | null;
  parking_distance?: number | null;
  entry_challenges?: string | string[];
  access_notes?: string | null;
}

interface UserData {
  plan?: string;
  user_id?: string;
  userId?: string;
  is_admin?: boolean;
  [key: string]: unknown;
}

interface MoveDaySession {
  id: number;
  saved_move_id?: string | number;
  session_name?: string;
  session_date?: string;
  [key: string]: unknown;
}

interface SavedMove {
  id: number;
  name?: string;
  [key: string]: unknown;
}

interface QPopupProxy {
  hide: () => void;
  show: () => void;
}

const props = defineProps({
  user: String
});

const $q = useQuasar();
const store = inventoryStore();
const { locationValues, collectionValues, containerValues } = storeToRefs(store);

// API URL based on environment
const core_url = import.meta.env.MODE == 'development' ? 'http://localhost:3050' : 'https://movetrack-api-7hwn7ggbiq-uc.a.run.app';

// Get auth headers
const getAuthHeaders = (): AxiosRequestHeaders | undefined => {
  const sessionToken = localStorage.getItem('session_token');
  return sessionToken ? { Authorization: `Bearer ${sessionToken}` } : undefined;
};

// Move configuration
const originLocation = ref<string | null>(null);
const destinationLocation = ref<string | null>(null);
const moveDate = ref<string | null>(null);
const moveEndDate = ref<string | null>(null);
const timingFlexibility = ref<'exact' | 'flexible_3days' | 'flexible_7days'>('exact');
const numHelpers = ref(2);

const formatDateLabel = (value: string | null) => {
  if (!value) return '';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
};

const moveDateRangeDisplay = computed(() => {
  if (moveDate.value && moveEndDate.value) {
    if (moveDate.value === moveEndDate.value) {
      return formatDateLabel(moveDate.value);
    }
    return `${formatDateLabel(moveDate.value)} → ${formatDateLabel(moveEndDate.value)}`;
  }
  if (moveDate.value) {
    return formatDateLabel(moveDate.value);
  }
  return 'Not set';
});

const normalizeDateInput = (value?: string | null) => {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value.slice(0, 10);
  }
  return parsed.toISOString().split('T')[0];
};

// Timing flexibility computed
const isFlexible = computed(() => {
  return timingFlexibility.value === 'flexible_3days' || timingFlexibility.value === 'flexible_7days';
});

// Warning system
interface MoveWarning {
  severity: 'error' | 'warning' | 'info';
  message: string;
}

const moveWarnings = computed<MoveWarning[]>(() => {
  const warnings: MoveWarning[] = [];

  // Continental US validation
  const originLoc = locationValues.value.find(l => l.value === originLocation.value);
  const destLoc = locationValues.value.find(l => l.value === destinationLocation.value);

  const isNonContinentalUS = (location: InventoryLocation | undefined) => {
    if (!location) return false;
    const state = location.state?.toUpperCase();
    if (!state) return false;
    const nonContinentalStates = ['AK', 'HI', 'PR', 'GU', 'VI', 'AS', 'MP'];
    return nonContinentalStates.includes(state);
  };

  if (originLoc && isNonContinentalUS(originLoc)) {
    warnings.push({
      severity: 'error',
      message: 'We currently support estimates only within the continental United States (lower 48 states). For Alaska, Hawaii, territories, or international moves, please contact movers directly.'
    });
  }

  if (destLoc && isNonContinentalUS(destLoc)) {
    warnings.push({
      severity: 'error',
      message: 'We currently support estimates only within the continental United States (lower 48 states). For Alaska, Hawaii, territories, or international moves, please contact movers directly.'
    });
  }

  // Storage gap detection
  if (moveDate.value && moveEndDate.value) {
    const startDate = new Date(moveDate.value);
    const endDate = new Date(moveEndDate.value);
    const gapDays = Math.round((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));

    if (gapDays > 7) {
      warnings.push({
        severity: 'warning',
        message: `Your move-out and move-in dates are ${gapDays} days apart. Our estimate does not include storage costs, which may be required if belongings need to be held between homes.`
      });
    }
  }

  // Van line timing flexibility warning
  const distance = estimatedDistance.value || 0;
  if (distance >= 500 && !isFlexible.value) {
    warnings.push({
      severity: 'info',
      message: 'Van line services usually require flexible delivery windows. Based on your exact dates, we\'re showing dedicated options only. If you can be flexible with your dates (±3-7 days), van lines may offer significant cost savings.'
    });
  }

  return warnings;
});

// Check if we have a blocking error
const hasBlockingError = computed(() => {
  return moveWarnings.value.some(w => w.severity === 'error');
});

// DIY Alternative Options
interface DiyOption {
  provider: string;
  label: string;
  url: string;
  description: string;
}

const diyOptions = computed<DiyOption[]>(() => {
  const distance = estimatedDistance.value || 0;

  // Only show DIY options if there's a distance calculated
  if (distance === 0) return [];

  return [
    {
      provider: 'U-Haul',
      label: 'DIY Truck Rental',
      url: 'https://www.uhaul.com/',
      description: 'Rent a truck and drive yourself. Best for those willing to handle the physical work and driving to save money.'
    },
    {
      provider: 'PODS',
      label: 'Container Service',
      url: 'https://www.pods.com/',
      description: 'You pack, they drive. Great when you need flexible timing or temporary storage between homes.'
    }
  ];
});

// Additional move details for PDF
const packingServicesRequired = ref<'none' | 'partial' | 'full'>('none');
const packingAreasSelected = ref<string[]>([]);

// Origin location details
const hasStairs = ref(false);
const numberOfFlights = ref<number | null>(null);
const hasElevator = ref(false);
const elevatorType = ref<string | null>(null);
const elevatorDistance = ref<number | null>(null);
const elevatorReservationRequired = ref(false);
const parkingSituation = ref<string | null>(null);
const parkingDistance = ref<number | null>(null);
const entryType = ref<string | null>(null);
const entryChallenges = ref<string[]>([]);
const accessNotes = ref('');

// Destination location details
const destHasStairs = ref(false);
const destNumberOfFlights = ref<number | null>(null);
const destHasElevator = ref(false);
const destElevatorType = ref<string | null>(null);
const destElevatorDistance = ref<number | null>(null);
const destElevatorReservationRequired = ref(false);
const destParkingSituation = ref<string | null>(null);
const destParkingDistance = ref<number | null>(null);
const destEntryType = ref<string | null>(null);
const destEntryChallenges = ref<string[]>([]);
const destAccessNotes = ref('');

const specialRequirements = ref('');
const estimatedSquareFootage = ref<number | null>(null);

// Tab state
const movePlanningTab = ref<'planning' | 'costs' | 'route' | 'moveday'>('planning');

// Cost details visibility toggles
const showDiyDetails = ref(false);
const showDedicatedDetails = ref(false);
const showVanLineDetails = ref(false);

watch(moveDate, (newStart) => {
  if (!newStart) {
    moveEndDate.value = null;
    return;
  }
  const startDate = new Date(newStart);
  if (!moveEndDate.value || new Date(moveEndDate.value) < startDate) {
    moveEndDate.value = newStart;
  }
});

const userData = ref<UserData>({});
if (typeof window !== 'undefined') {
  try {
    userData.value = JSON.parse(localStorage.getItem('user_data') || '{}');
  } catch (e) {
    userData.value = {};
  }
}

const planPreviewOverride = ref<'basic' | 'pro' | null>(localStorage.getItem('plan_preview') as 'basic' | 'pro' | null);
const basePlan = computed(() => (userData.value?.plan || 'basic').toLowerCase());
const isAdmin = computed(() => !!userData.value?.is_admin);
const effectivePlan = computed(() => (planPreviewOverride.value || basePlan.value) as 'basic' | 'pro');
const isPro = computed(() => effectivePlan.value === 'pro');

const selectTab = (tab: 'planning' | 'costs' | 'route' | 'moveday') => {
  if (tab === 'moveday' && !isPro.value) {
    Notify.create({
      type: 'warning',
      message: 'Move Day Mode is available on Pro plans',
      caption: 'Upgrade to unlock Move Day Mode'
    });
    return;
  }
  movePlanningTab.value = tab;
};

// Dynamic page title and subtitle based on active tab
const pageTitle = computed(() => {
  switch (movePlanningTab.value) {
    case 'planning':
      return 'Move Planning';
    case 'costs':
      return 'Cost Estimates';
    case 'route':
      return 'Route Planning';
    case 'moveday':
      return 'Move Day Mode';
    default:
      return 'Move Planning';
  }
});

const pageSubtitle = computed(() => {
  switch (movePlanningTab.value) {
    case 'planning':
      return 'Estimate materials, truck size, and timeline for your move';
    case 'costs':
      return 'Compare DIY and professional moving costs';
    case 'route':
      return 'Plan your route, add waypoints, and generate your move schedule';
    case 'moveday':
      return 'Track and manage your move in real-time';
    default:
      return 'Estimate materials, truck size, and timeline for your move';
  }
});

// Location editor dialog
const showLocationDialog = ref(false);
interface LocationEditorResult {
  name: string;
  address1: string;
  address2: string;
  city: string;
  state: string;
  zip: string;
  country: string;
  lat: number | null;
  lng: number | null;
  formattedAddress?: string | null;
}

const openLocationDialog = () => {
  showLocationDialog.value = true;
};
const moveDatePopup = ref<QPopupProxy | null>(null);
const moveEndDatePopup = ref<QPopupProxy | null>(null);
const newMoveOutPopup = ref<QPopupProxy | null>(null);
const newMoveInPopup = ref<QPopupProxy | null>(null);

// Ref for DesktopMoveDay component
const moveDayRef = ref<InstanceType<typeof DesktopMoveDay> | null>(null);
const moveDaySessions = computed<MoveDaySession[]>(() => moveDayRef.value?.moveSessions || []);
const filteredMoveDaySessions = computed(() => {
  if (!currentSavedMoveId.value) return [];
  return moveDaySessions.value.filter(session => String(session.saved_move_id) === String(currentSavedMoveId.value));
});
const moveDaySessionOptions = computed(() => filteredMoveDaySessions.value.map(session => ({
  label: session.session_name || session.session_date || `Session #${session.id}`,
  value: session.id
})));
const activeMoveDaySessionId = computed<number | null>(() => moveDayRef.value?.activeSession?.id ?? null);

const handleMoveDaySessionSelect = (sessionId: number | null) => {
  if (!sessionId) return;
  const session = moveDaySessions.value.find(s => s.id === sessionId);
  if (session) {
    moveDayRef.value?.selectSession(session);
  }
};

// Parse item dimensions helper
const parseItemDimensions = (item: InventoryItem | InventoryContainer): { length: number; width: number; height: number } | null => {
  if (
    item.length_in != null &&
    item.width_in != null &&
    item.height_in != null
  ) {
    const length = Number(item.length_in);
    const width = Number(item.width_in);
    const height = Number(item.height_in);
    if ([length, width, height].every((val) => Number.isFinite(val) && val > 0)) {
      return { length, width, height };
    }
  }
  if (typeof item.dimensions === 'string' && item.dimensions.trim().length > 0) {
    const cleaned = item.dimensions.toLowerCase().replace(/[^0-9.x×]/g, '');
    const parts = cleaned.split(/[x×]/).filter(Boolean).map(Number);
    if (parts.length === 3 && parts.every((val) => Number.isFinite(val) && val > 0)) {
      return { length: parts[0], width: parts[1], height: parts[2] };
    }
  }
  return null;
};

// Helper to get items in origin location (via their collection)
const itemsInOriginLocation = computed(() => {
  if (!originLocation.value) return store.items; // All items if no origin selected

  // Get collections in origin location
  const collectionsInOrigin = store.collections
    .filter(c => c.location === originLocation.value)
    .map(c => c.value);

  // Return items in those collections
  return store.items.filter(item => collectionsInOrigin.includes(item.collection));
});

const containerAggregatesInOrigin = computed(() => {
  if (!originLocation.value) return [];

  const aggregates = new Map<string, { container: InventoryContainer; items: InventoryItem[] }>();
  itemsInOriginLocation.value.forEach((item) => {
    if (!item.container) return;
    const normalizedId = String(item.container);
    const container = store.containers.find(
      (c) => c.value === normalizedId && c.location === originLocation.value
    );
    if (!container) return;
    if (!aggregates.has(normalizedId)) {
      aggregates.set(normalizedId, { container, items: [] });
    }
    aggregates.get(normalizedId)?.items.push(item);
  });
  return Array.from(aggregates.values());
});

const looseItemsInOrigin = computed(() =>
  itemsInOriginLocation.value.filter((item) => !item.container)
);

const getContainerDimensions = (container: InventoryContainer): { length: number; width: number; height: number } | null => {
  if (
    container?.inner_length_in &&
    container?.inner_width_in &&
    container?.inner_height_in
  ) {
    return {
      length: Number(container.inner_length_in),
      width: Number(container.inner_width_in),
      height: Number(container.inner_height_in)
    };
  }
  if (
    container?.dimensions &&
    typeof container.dimensions === 'object' &&
    container.dimensions.length &&
    container.dimensions.width &&
    container.dimensions.height
  ) {
    return {
      length: Number(container.dimensions.length),
      width: Number(container.dimensions.width),
      height: Number(container.dimensions.height)
    };
  }
  return null;
};

const containerVolumeWarnings = computed(() =>
  containerAggregatesInOrigin.value
    .filter(entry => !getContainerDimensions(entry.container))
    .map(entry => entry.container.label || entry.container.value)
);

// Calculate total volume (only for items in origin location)
const totalVolumeCuFt = computed(() => {
  const containerVolume = containerAggregatesInOrigin.value.reduce((sum, entry) => {
    const dims = getContainerDimensions(entry.container);
    if (!dims) return sum;
    const volumeCuFt = (dims.length * dims.width * dims.height) / 1728;
    return sum + volumeCuFt;
  }, 0);

  const looseVolume = looseItemsInOrigin.value.reduce((sum, item) => {
    const dims = parseItemDimensions(item);
    if (!dims) return sum;
    const volumeCubicInches = dims.length * dims.width * dims.height;
    const volumeCubicFeet = volumeCubicInches / 1728;
    const quantity = Number(item.quantity) || 1;
    return sum + (volumeCubicFeet * quantity);
  }, 0);

  return containerVolume + looseVolume;
});

// Calculate total weight (only for items in origin location)
const totalWeightLbs = computed(() => {
  const containerWeight = containerAggregatesInOrigin.value.reduce((sum, entry) => {
    const itemsWeight = entry.items.reduce((acc, item) => {
      const weight = Number(item.weight_lbs) || 0;
      const quantity = Number(item.quantity) || 1;
      return acc + (weight * quantity);
    }, 0);
    return sum + itemsWeight + 2; // add 2 lb tare weight per box
  }, 0);

  const looseWeight = looseItemsInOrigin.value.reduce((sum, item) => {
    const weight = Number(item.weight_lbs) || 0;
    const quantity = Number(item.quantity) || 1;
    return sum + (weight * quantity);
  }, 0);

  return containerWeight + looseWeight;
});

// Total item count (only for items in origin location)
const totalItems = computed(() => {
  return itemsInOriginLocation.value.reduce((sum, item) => {
    return sum + (Number(item.quantity) || 1);
  }, 0);
});

// Count current boxes (containers that are box_size) in origin location
const currentBoxCount = computed(() => {
  if (!originLocation.value) return store.containers.filter(c => c.box_size).length;

  const collectionsInOrigin = store.collections
    .filter(c => c.location === originLocation.value)
    .map(c => c.value);

  return store.containers.filter(c =>
    c.box_size && collectionsInOrigin.includes(c.collection)
  ).length;
});

// Count loose items (not in any container) in origin location
const looseItemsCount = computed(() => {
  return itemsInOriginLocation.value.filter(i => !i.container || i.container === null).length;
});

// Truck size recommendation
const truckRecommendation = computed(() => {
  const volume = totalVolumeCuFt.value;

  // Add 30% buffer for irregular packing and space between items
  const adjustedVolume = volume * 1.3;

  if (adjustedVolume <= 400) {
    return {
      size: '10 ft',
      capacity: 400,
      description: 'Small moving truck',
      suitable: 'Studio or small 1-bedroom apartment',
      utilization: (adjustedVolume / 400) * 100
    };
  } else if (adjustedVolume <= 700) {
    return {
      size: '15 ft',
      capacity: 700,
      description: 'Medium moving truck',
      suitable: '1-2 bedroom apartment',
      utilization: (adjustedVolume / 700) * 100
    };
  } else if (adjustedVolume <= 1100) {
    return {
      size: '20 ft',
      capacity: 1100,
      description: 'Large moving truck',
      suitable: '2-3 bedroom home',
      utilization: (adjustedVolume / 1100) * 100
    };
  } else {
    return {
      size: '26 ft',
      capacity: 1600,
      description: 'Extra large moving truck',
      suitable: '3-5 bedroom home',
      utilization: (adjustedVolume / 1600) * 100
    };
  }
});

// Density-based box estimates for LOOSE items only (in origin location)
const boxEstimates = computed(() => {
  // Only analyze loose (uncontained) items in origin location
  const looseItems = itemsInOriginLocation.value.filter(i => !i.container || i.container === null);

  // Box specifications with volume and weight limits
  const boxSpecs = {
    small: {
      volumeCuFt: 1.5,       // 16x12.5x12.5 inches
      maxWeightLbs: 30,
      targetDensity: 20       // lbs per cu ft (30 lbs / 1.5 cu ft)
    },
    medium: {
      volumeCuFt: 3.0,       // 18x18x16 inches
      maxWeightLbs: 40,
      targetDensity: 13.33    // lbs per cu ft (40 lbs / 3 cu ft)
    },
    large: {
      volumeCuFt: 4.5,       // 18x18x24 inches
      maxWeightLbs: 50,
      targetDensity: 11.11    // lbs per cu ft (50 lbs / 4.5 cu ft)
    }
  };

  const items = looseItems;
  let smallBoxes = 0;
  let mediumBoxes = 0;
  let largeBoxes = 0;

  // Track remaining capacity in current boxes
  let currentSmallVolume = 0;
  let currentSmallWeight = 0;
  let currentMediumVolume = 0;
  let currentMediumWeight = 0;
  let currentLargeVolume = 0;
  let currentLargeWeight = 0;

  // Keywords that indicate furniture/large items that don't need boxes
  const nonBoxableKeywords = [
    'sofa', 'couch', 'chair', 'desk', 'table', 'dresser', 'bed', 'mattress',
    'bookshelf', 'shelf', 'cabinet', 'wardrobe', 'armoire', 'bench', 'stool',
    'ottoman', 'futon', 'loveseat', 'sectional', 'recliner', 'nightstand',
    'bureau', 'chest', 'credenza', 'hutch', 'entertainment center', 'tv stand',
    'coffee table', 'end table', 'side table', 'dining table', 'kitchen table',
    'vanity', 'mirror', 'lamp', 'floor lamp', 'bike', 'bicycle', 'treadmill',
    'elliptical', 'exercise bike', 'weight bench', 'piano', 'keyboard'
  ];

  // Filter to boxable items
  const boxableItems = items.filter(item => {
    // Check if item name contains furniture keywords
    const itemName = (item.label || '').toLowerCase();
    const isFurniture = nonBoxableKeywords.some(keyword => itemName.includes(keyword));
    if (isFurniture) return false;

    const dims = parseItemDimensions(item);
    if (!dims) return true; // Assume boxable if no dimensions
    const maxDim = Math.max(dims.length, dims.width, dims.height);
    return maxDim < 30; // Items under 30 inches can likely be boxed
  });

  // Group items with their calculated properties
  const processedItems = boxableItems.map(item => {
    const dims = parseItemDimensions(item);
    const weight = Number(item.weight_lbs) || 0;
    const quantity = Number(item.quantity) || 1;

    let volumeCuFt = 0;
    let density = 0;

    if (dims) {
      volumeCuFt = (dims.length * dims.width * dims.height) / 1728;
      density = volumeCuFt > 0 ? weight / volumeCuFt : 0;
    } else {
      // Estimate: medium density items without dimensions
      volumeCuFt = 0.5; // Assume 0.5 cu ft per item
      density = weight / volumeCuFt;
    }

    return {
      label: item.label,
      volumeCuFt,
      weight,
      density,
      quantity
    };
  });

  // Sort by density (high to low) - pack heavy items first
  processedItems.sort((a, b) => b.density - a.density);

  // Pack items based on density
  processedItems.forEach(item => {
    for (let i = 0; i < item.quantity; i++) {
      let packed = false;

      // Determine box type based on density
      // High density (>20 lbs/cu ft) -> small box
      // Medium density (13-20 lbs/cu ft) -> medium box
      // Low density (<13 lbs/cu ft) -> large box

      if (item.density >= boxSpecs.small.targetDensity) {
        // High density - try small box
        if (
          currentSmallVolume + item.volumeCuFt <= boxSpecs.small.volumeCuFt &&
          currentSmallWeight + item.weight <= boxSpecs.small.maxWeightLbs
        ) {
          currentSmallVolume += item.volumeCuFt;
          currentSmallWeight += item.weight;
          packed = true;
        } else {
          // Start new small box
          smallBoxes++;
          currentSmallVolume = item.volumeCuFt;
          currentSmallWeight = item.weight;
          packed = true;
        }
      } else if (item.density >= boxSpecs.medium.targetDensity) {
        // Medium density - try medium box
        if (
          currentMediumVolume + item.volumeCuFt <= boxSpecs.medium.volumeCuFt &&
          currentMediumWeight + item.weight <= boxSpecs.medium.maxWeightLbs
        ) {
          currentMediumVolume += item.volumeCuFt;
          currentMediumWeight += item.weight;
          packed = true;
        } else {
          // Start new medium box
          mediumBoxes++;
          currentMediumVolume = item.volumeCuFt;
          currentMediumWeight = item.weight;
          packed = true;
        }
      } else {
        // Low density - try large box
        if (
          currentLargeVolume + item.volumeCuFt <= boxSpecs.large.volumeCuFt &&
          currentLargeWeight + item.weight <= boxSpecs.large.maxWeightLbs
        ) {
          currentLargeVolume += item.volumeCuFt;
          currentLargeWeight += item.weight;
          packed = true;
        } else {
          // Start new large box
          largeBoxes++;
          currentLargeVolume = item.volumeCuFt;
          currentLargeWeight = item.weight;
          packed = true;
        }
      }

      // If item couldn't be packed (too large), try to fit in best available box
      if (!packed) {
        // Try to fit in largest box that can handle it
        if (item.volumeCuFt <= boxSpecs.large.volumeCuFt && item.weight <= boxSpecs.large.maxWeightLbs) {
          largeBoxes++;
          currentLargeVolume = item.volumeCuFt;
          currentLargeWeight = item.weight;
        } else if (item.volumeCuFt <= boxSpecs.medium.volumeCuFt && item.weight <= boxSpecs.medium.maxWeightLbs) {
          mediumBoxes++;
          currentMediumVolume = item.volumeCuFt;
          currentMediumWeight = item.weight;
        } else {
          smallBoxes++;
          currentSmallVolume = item.volumeCuFt;
          currentSmallWeight = item.weight;
        }
      }
    }
  });

  // Account for partially filled boxes
  if (currentSmallVolume > 0) smallBoxes++;
  if (currentMediumVolume > 0) mediumBoxes++;
  if (currentLargeVolume > 0) largeBoxes++;

  return {
    small: smallBoxes,
    medium: mediumBoxes,
    large: largeBoxes,
    total: smallBoxes + mediumBoxes + largeBoxes,
    details: {
      smallCapacity: boxSpecs.small.volumeCuFt,
      smallMaxWeight: boxSpecs.small.maxWeightLbs,
      mediumCapacity: boxSpecs.medium.volumeCuFt,
      mediumMaxWeight: boxSpecs.medium.maxWeightLbs,
      largeCapacity: boxSpecs.large.volumeCuFt,
      largeMaxWeight: boxSpecs.large.maxWeightLbs
    }
  };
});

// Packing materials estimate (for items in origin location)
const packingMaterials = computed(() => {
  const totalBoxes = boxEstimates.value.total;
  const fragileItems = itemsInOriginLocation.value.filter(item => item.fragile).length;
  const furnitureItems = Math.ceil(itemsInOriginLocation.value.length * 0.3); // Estimate 30% are furniture

  return {
    tape: {
      name: 'Packing Tape',
      quantity: Math.ceil(totalBoxes / 8), // 1 roll per 8 boxes
      unit: 'rolls',
      icon: 'content_cut'
    },
    bubbleWrap: {
      name: 'Bubble Wrap',
      quantity: Math.ceil(fragileItems / 3), // 1 roll per 3 fragile items
      unit: 'rolls',
      icon: 'bubble_chart'
    },
    packingPaper: {
      name: 'Packing Paper',
      quantity: Math.ceil(totalBoxes / 5), // 1 bundle per 5 boxes
      unit: 'bundles',
      icon: 'description'
    },
    markers: {
      name: 'Permanent Markers',
      quantity: 3,
      unit: 'markers',
      icon: 'edit'
    },
    stretchWrap: {
      name: 'Stretch Wrap',
      quantity: 2,
      unit: 'rolls',
      icon: 'wrap_text'
    },
    furniturePads: {
      name: 'Furniture Pads',
      quantity: furnitureItems,
      unit: 'pads',
      icon: 'weekend'
    },
    labels: {
      name: 'Box Labels',
      quantity: totalBoxes,
      unit: 'labels',
      icon: 'label'
    },
    dolly: {
      name: 'Hand Truck/Dolly',
      quantity: 1,
      unit: 'dolly',
      icon: 'local_shipping'
    }
  };
});

// Special handling items (in origin location)
const specialItems = computed(() => {
  return {
    fragile: itemsInOriginLocation.value.filter(item => item.fragile).length,
    heavy: itemsInOriginLocation.value.filter(item => {
      const weight = Number(item.weight_lbs) || 0;
      return weight > 50;
    }).length,
    oversized: itemsInOriginLocation.value.filter(item => {
      const dims = parseItemDimensions(item);
      if (!dims) return false;
      const maxDim = Math.max(dims.length, dims.width, dims.height);
      return maxDim > 48; // Over 4 feet
    }).length,
    highValue: itemsInOriginLocation.value.filter(item => {
      const value = Number(item.estimated_value) || 0;
      return value > 500;
    }).length,
    disassemblyRequired: itemsInOriginLocation.value.filter(item => {
      // Items that likely need disassembly (furniture keywords)
      const name = (item.label || '').toLowerCase();
      return name.includes('bed') || name.includes('desk') || name.includes('table') ||
             name.includes('shelf') || name.includes('bookcase') || name.includes('dresser');
    }).length,
    climateSensitive: itemsInOriginLocation.value.filter(item => {
      // Items sensitive to temperature/humidity
      const name = (item.label || '').toLowerCase();
      return name.includes('electronics') || name.includes('art') || name.includes('painting') ||
             name.includes('instrument') || name.includes('wine') || name.includes('records') ||
             name.includes('vinyl') || name.includes('photo');
    }).length
  };
});

// Time estimates (industry standard: 3-4 hours per bedroom equivalent)
const timeEstimates = computed(() => {
  const itemCount = totalItems.value;
  const helpers = numHelpers.value;

  // Base time: 1 item = 3 minutes average (packing/loading)
  const packingMinutes = itemCount * 3;
  const loadingMinutes = itemCount * 2;

  // Heavy items add extra time
  const heavyItems = specialItems.value.heavy;
  const heavyItemMinutes = heavyItems * 15; // 15 extra minutes per heavy item

  // Calculate each component with helpers factored in
  const packingHours = Math.ceil(packingMinutes / 60 / Math.max(helpers, 1));
  const loadingHours = Math.ceil((loadingMinutes + heavyItemMinutes) / 60 / Math.max(helpers, 1));
  const unloadingHours = Math.ceil((loadingMinutes + heavyItemMinutes) * 0.8 / 60 / Math.max(helpers, 1)); // Unloading slightly faster

  return {
    packing: packingHours,
    loading: loadingHours,
    unloading: unloadingHours,
    total: packingHours + loadingHours + unloadingHours
  };
});

// Get locations with address details
const locationsWithDetails = computed(() => {
  return store.locations.map(loc => {
    // Count items in this location (via collections), summing quantities
    const collectionsInLocation = store.collections
      .filter(c => c.location === loc.value)
      .map(c => c.value);
    const itemCount = store.items
      .filter(item => collectionsInLocation.includes(item.collection))
      .reduce((sum, item) => sum + (Number(item.quantity) || 1), 0);

    // Build full address string from components
    const addressParts: string[] = [];
    if (loc.address) addressParts.push(loc.address);
    if (loc.address_2) addressParts.push(loc.address_2);
    const cityStateZip = [loc.city, loc.state, loc.zip].filter(Boolean).join(', ');
    if (cityStateZip) addressParts.push(cityStateZip);
    const fullAddress = addressParts.join(', ') || loc.label;

    return {
      value: loc.value,
      label: `${loc.label} (${itemCount} items)`,
      name: loc.label,
      address: loc.address,
      address_2: loc.address_2,
      city: loc.city,
      state: loc.state,
      zip: loc.zip,
      lat: loc.lat ?? null,
      lng: loc.lng ?? null,
      fullAddress: fullAddress
    };
  });
});

watch(locationsWithDetails, () => {
  moveLocations.value.forEach(applyLocationDetailsToMoveLocation);
}, { deep: true });

// Get destination location name for waypoint display
const destinationDisplayName = computed(() => {
  const dest = locationsWithDetails.value.find(l => l.value === destinationLocation.value);
  return dest?.name || null;
});

const getUtilizationColor = (pct: number) => {
  if (pct < 60) return 'warning';
  if (pct > 95) return 'negative';
  return 'positive';
};

// Cost of Living multipliers by major metro areas
const colMultipliers: Record<string, number> = {
  // Very High CoL (1.4x - 1.6x)
  'san francisco': 1.6, 'sf': 1.6, 'bay area': 1.6, 'silicon valley': 1.6,
  'new york': 1.5, 'nyc': 1.5, 'manhattan': 1.5, 'brooklyn': 1.5,
  'los angeles': 1.4, 'la': 1.4, 'santa monica': 1.4, 'beverly hills': 1.4,
  'boston': 1.4, 'cambridge': 1.4,
  'seattle': 1.4, 'bellevue': 1.4,
  'washington': 1.4, 'dc': 1.4,

  // High CoL (1.2x - 1.3x)
  'san diego': 1.3, 'san jose': 1.3, 'oakland': 1.3,
  'chicago': 1.2, 'denver': 1.2, 'portland': 1.2, 'austin': 1.2,
  'miami': 1.2, 'honolulu': 1.5,

  // Medium CoL (1.0x - baseline)
  'atlanta': 1.0, 'dallas': 1.0, 'houston': 1.0, 'phoenix': 1.0,
  'philadelphia': 1.1, 'minneapolis': 1.0, 'charlotte': 1.0,

  // Low CoL (0.8x - 0.9x)
  'nashville': 0.9, 'indianapolis': 0.85, 'columbus': 0.85,
  'milwaukee': 0.85, 'kansas city': 0.8, 'oklahoma city': 0.75,
  'memphis': 0.75, 'detroit': 0.8
};

// Helper to get CoL multiplier from location name
const getColMultiplier = (locationValue: string | null): number => {
  if (!locationValue) return 1.0;

  const location = store.locations.find(l => l.value === locationValue);
  if (!location) return 1.0;

  const locationName = location.label.toLowerCase();

  // Check for matches in CoL multipliers
  for (const [city, multiplier] of Object.entries(colMultipliers)) {
    if (locationName.includes(city)) {
      return multiplier;
    }
  }

  return 1.0; // Default multiplier
};

// Calculate average CoL multiplier for origin and destination
const colAdjustment = computed(() => {
  const originCol = getColMultiplier(originLocation.value);
  const destCol = getColMultiplier(destinationLocation.value);

  // Average of origin and destination CoL
  return (originCol + destCol) / 2;
});

// Helper to format address for geocoding
const formatAddress = (location: InventoryLocation | undefined): string | null => {
  if (!location) return null;

  const parts: string[] = [];
  if (location.address) parts.push(location.address);
  if (location.city) parts.push(location.city);
  if (location.state) parts.push(location.state);
  if (location.zip) parts.push(location.zip);
  if (location.country) parts.push(location.country);

  return parts.length > 0 ? parts.join(', ') : null;
};

// Cache for distance calculations
const distanceCache = ref<Record<string, number>>({});

// Calculate distance between origin and destination using Google Maps Directions API
const estimatedDistance = ref<number | null>(null);
const isCalculatingDistance = ref(false);
const routeData = ref<RouteData | null>(null);
const useTruckRoute = ref(true);
const avoidTolls = ref(false);

// Waypoints for the journey
interface MapWaypoint {
  id: number;
  city: string;
  state?: string;
  lat?: number | string;
  lng?: number | string;
  overnight_recommended?: boolean;
  sequence_order: number;
  location_id?: number | string | null;
  is_dropoff?: boolean;
}
const journeyWaypoints = ref<MapWaypoint[]>([]);

const handleWaypointsUpdate = (waypoints: MapWaypoint[]) => {
  journeyWaypoints.value = waypoints;
};

// Handle route updates from WaypointManager (after calculating/optimizing route)
interface RouteUpdateData {
  routePolyline: string;
  waypoints: MapWaypoint[];
  totalDistanceMiles: number;
  totalDurationHours: number;
  waypointsReordered: boolean;
}

const handleRouteUpdated = (data: RouteUpdateData) => {
  console.log('[DesktopMovePlanning] Route updated:', data);

  // Update the route polyline for the map
  if (routeData.value && data.routePolyline) {
    routeData.value.route_polyline = data.routePolyline;
  }

  // Update estimated distance
  if (data.totalDistanceMiles) {
    estimatedDistance.value = data.totalDistanceMiles;
  }

  // Update waypoints (they may have been reordered)
  journeyWaypoints.value = data.waypoints;

  // Show notification if waypoints were reordered
  if (data.waypointsReordered) {
    Notify.create({
      type: 'info',
      message: 'Waypoints reordered for optimal route',
      icon: 'route',
      timeout: 3000
    });
  }
};

// Generate move schedule from calculated route
const waypointManagerRef = ref<InstanceType<typeof WaypointManager> | null>(null);
const generatingSchedule = ref(false);
const showScheduleDialog = ref(false);
const anchorDateType = ref<'move-out' | 'move-in'>('move-out');
const anchorDate = ref<string | null>(null);

const hasScheduleAnchorDate = computed(() => !!(moveDate.value || moveEndDate.value));
const generateMoveSchedule = async (clearExisting: boolean = false) => {
  if (!currentSavedMoveId.value) {
    $q.notify({
      type: 'warning',
      message: 'Please select a saved move first'
    });
    return;
  }

  // Check if waypoints exist and route is calculated
  if (!journeyWaypoints.value || journeyWaypoints.value.length === 0) {
    $q.notify({
      type: 'warning',
      message: 'Please add waypoints and calculate route first',
      caption: 'Use the waypoint manager to add stops and optimize your route'
    });
    return;
  }

  if (!anchorDate.value) {
    $q.notify({
      type: 'warning',
      message: 'Please set a move-out or move-in date in Move Details first'
    });
    return;
  }

  generatingSchedule.value = true;

  try {
    const response = await axios.post(
      `${core_url}/api/move-day/generate-from-route`,
      {
        savedMoveId: currentSavedMoveId.value,
        clearExisting,
        anchorType: anchorDateType.value,
        anchorDate: anchorDate.value
      },
      { headers: getAuthHeaders() }
    );

    const { summary } = response.data;

    // Close the dialog
    showScheduleDialog.value = false;

    $q.notify({
      type: 'positive',
      message: `Created ${summary.total_sessions} sessions!`,
      caption: `${summary.loading_sessions} loading, ${summary.driving_sessions} driving, ${summary.unloading_sessions} unloading (${summary.start_date} - ${summary.end_date})`,
      timeout: 5000,
      actions: [
        {
          label: 'View Schedule',
          color: 'white',
          handler: () => {
            movePlanningTab.value = 'moveday';
          }
        }
      ]
    });

  } catch (error: unknown) {
    console.error('Error generating schedule:', error);
    let errorMessage = 'Failed to generate schedule';
    let errorCaption: string | undefined = undefined;

    if (axios.isAxiosError(error) && error.response?.data) {
      const data = error.response.data as { error?: string; details?: string };
      errorMessage = data.error || errorMessage;
      errorCaption = data.details;
    }

    $q.notify({
      type: 'negative',
      message: errorMessage,
      caption: errorCaption
    });
  } finally {
    generatingSchedule.value = false;
  }
};

const promptGenerateSchedule = () => {
  if (!hasScheduleAnchorDate.value) {
    $q.notify({
      type: 'warning',
      message: 'Set your move-out or move-in date in the Move Details section before generating a schedule.'
    });
    return;
  }

  anchorDateType.value = moveDate.value ? 'move-out' : 'move-in';
  anchorDate.value = moveDate.value || moveEndDate.value;
  showScheduleDialog.value = true;
};
const canGenerateSchedule = computed(() => {
  return !!journeyWaypoints.value &&
    journeyWaypoints.value.length > 0 &&
    hasScheduleAnchorDate.value;
});
const anchorDateDisplay = computed(() => {
  if (!anchorDate.value) return null;
  return formatDateLabel(anchorDate.value);
});

const calculateDistance = async () => {
  if (!originLocation.value || !destinationLocation.value) {
    estimatedDistance.value = null;
    routeData.value = null;
    return;
  }

  const originLoc = store.locations.find(l => l.value === originLocation.value);
  const destLoc = store.locations.find(l => l.value === destinationLocation.value);

  if (!originLoc || !destLoc) {
    estimatedDistance.value = null;
    routeData.value = null;
    return;
  }

  const originAddress = formatAddress(originLoc);
  const destAddress = formatAddress(destLoc);

  if (!originAddress || !destAddress) {
    estimatedDistance.value = null;
    routeData.value = null;
    return;
  }

  // Get intermediate/drop-off locations from moveLocations
  const waypointAddresses: string[] = [];
  moveLocations.value
    .filter(loc => loc.role === 'intermediate' && loc.location)
    .forEach(loc => {
      const locationData = store.locations.find(l => l.value === loc.location);
      if (locationData) {
        const address = formatAddress(locationData);
        if (address) {
          waypointAddresses.push(address);
        }
      }
    });

  // Check cache first (include routing preferences and waypoints in cache key)
  const waypointsKey = waypointAddresses.join('|');
  const cacheKey = `${originAddress}|${waypointsKey}|${destAddress}|${useTruckRoute.value}|${avoidTolls.value}`;
  if (distanceCache.value[cacheKey]) {
    estimatedDistance.value = distanceCache.value[cacheKey];
    // Note: We're not caching full route data, only distance for now
  }

  try {
    isCalculatingDistance.value = true;

    // Call backend API to calculate distance with route geometry
    const response = await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/calculate-distance`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        origin: originAddress,
        destination: destAddress,
        waypoints: waypointAddresses,
        truckRoute: useTruckRoute.value,
        avoidTolls: avoidTolls.value
      }),
    });

    if (!response.ok) {
      throw new Error('Distance calculation request failed');
    }

    const data = await response.json();

    if (data.distance_miles) {
      // Cache the distance result
      distanceCache.value[cacheKey] = data.distance_miles;
      estimatedDistance.value = data.distance_miles;
      routeData.value = data; // Store full route data including polyline
    } else {
      console.warn('Distance calculation failed:', data);
      estimatedDistance.value = null;
      routeData.value = null;
    }
  } catch (error) {
    console.error('Error calculating distance:', error);
    estimatedDistance.value = null;
    routeData.value = null;
  } finally {
    isCalculatingDistance.value = false;
  }
};

// Watch for location changes and recalculate distance
watch([originLocation, destinationLocation], () => {
  calculateDistance();
});

// Watch for routing preference changes
watch([useTruckRoute, avoidTolls], () => {
  if (originLocation.value && destinationLocation.value) {
    calculateDistance();
  }
});

// Dedicated movers pricing calculation
interface DedicatedMoversPricingParams {
  distance: number;
  totalHours: number;
  weight: number;
  volume: number;
  colMultiplier: number;
  totalPackingHours: number;
  professionalMaterialsCost: number;
  furnitureBreakdownTime: number;
  furniturePadsCost: number;
  shrinkWrapCost: number;
  cornerProtectorsCost: number;
  packingServicesRequired: 'none' | 'partial' | 'full';
}

interface DedicatedMoversPricingResult {
  professionalLow: number;
  professionalHigh: number;
  packingCostLow: number;
  packingCostHigh: number;
  adjustedPackingCostLow: number;
  adjustedPackingCostHigh: number;
  partialPackingMaterials: number;
}

const calculateDedicatedMoversCost = (params: DedicatedMoversPricingParams): DedicatedMoversPricingResult => {
  const {
    distance,
    totalHours,
    weight,
    volume,
    colMultiplier,
    totalPackingHours,
    professionalMaterialsCost,
    furnitureBreakdownTime,
    furniturePadsCost,
    shrinkWrapCost,
    cornerProtectorsCost,
    packingServicesRequired
  } = params;

  let professionalLow, professionalHigh, packingCostLow, packingCostHigh;

  if (distance < 100) {
    // Local move: hourly rate
    const hourlyRate = 150; // $150/hour for 2-person crew (2024 rates)
    professionalLow = hourlyRate * totalHours * 0.9 * colMultiplier;
    professionalHigh = hourlyRate * totalHours * 1.4 * colMultiplier;

    // Packing service: $50-75/hour per packer + materials (with 110% upcharge)
    packingCostLow = (totalPackingHours * 50) + professionalMaterialsCost;
    packingCostHigh = (totalPackingHours * 75) + professionalMaterialsCost;
  } else {
    // Long distance: More realistic formula based on distance + weight/volume
    // Base rate: $2-3 per pound for cross-country
    const baseCostPerPound = distance > 2000 ? 2.5 : (distance > 1000 ? 1.5 : 1.0);

    // Volume-based alternative (whichever is higher)
    const volumeCostMultiplier = distance > 2000 ? 12 : (distance > 1000 ? 10 : 8);

    const weightBased = weight * baseCostPerPound;
    const volumeBased = volume * volumeCostMultiplier;
    const baseCost = Math.max(weightBased, volumeBased);

    // Add distance-based surcharge for very long moves
    const distanceSurcharge = distance > 2000 ? 1500 : (distance > 1000 ? 800 : 0);

    professionalLow = (baseCost + distanceSurcharge) * 0.85 * colMultiplier;
    professionalHigh = (baseCost + distanceSurcharge) * 1.25 * colMultiplier;

    // Packing for long distance: labor + materials (with 110% upcharge)
    // $60-85/hour per packer for long distance (higher skilled)
    packingCostLow = (totalPackingHours * 60) + professionalMaterialsCost;
    packingCostHigh = (totalPackingHours * 85) + professionalMaterialsCost;
  }

  // Adjust packing costs based on packingServicesRequired toggle
  let adjustedPackingCostLow = 0;
  let adjustedPackingCostHigh = 0;
  let partialPackingMaterials = 0;

  if (packingServicesRequired === 'full') {
    // Full packing: all labor + all materials
    adjustedPackingCostLow = packingCostLow;
    adjustedPackingCostHigh = packingCostHigh;
  } else if (packingServicesRequired === 'partial') {
    // Partial packing: furniture protection only (no box packing labor)
    // Only include furniture protection materials + minimal labor for wrapping
    partialPackingMaterials = (furniturePadsCost + shrinkWrapCost + cornerProtectorsCost) * 1.10;
    const furnitureWrappingHours = furnitureBreakdownTime; // Just furniture wrapping, no box packing

    if (distance < 100) {
      adjustedPackingCostLow = (furnitureWrappingHours * 50) + partialPackingMaterials;
      adjustedPackingCostHigh = (furnitureWrappingHours * 75) + partialPackingMaterials;
    } else {
      adjustedPackingCostLow = (furnitureWrappingHours * 60) + partialPackingMaterials;
      adjustedPackingCostHigh = (furnitureWrappingHours * 85) + partialPackingMaterials;
    }
  }
  // else 'none': packing costs remain 0

  return {
    professionalLow,
    professionalHigh,
    packingCostLow,
    packingCostHigh,
    adjustedPackingCostLow,
    adjustedPackingCostHigh,
    partialPackingMaterials
  };
};

// Van line pricing calculation
interface VanLinePricingParams {
  distance: number;
  weight: number;
  volume: number;
  colMultiplier: number;
  adjustedPackingCostLow: number;
  adjustedPackingCostHigh: number;
  totalDifficultyPremium: number;
  professionalLow: number;
  professionalHigh: number;
  miscCosts: number;
  multiStopPremium: number;
  isFlexible: boolean;
  intermediateStops: number;
}

interface VanLinePricingResult {
  vanLineTotalLow: number;
  vanLineTotalHigh: number;
  adjustedVanLineLow: number;
  adjustedVanLineHigh: number;
  chargeableWeight: number;
  deliveryWindow: string;
  breakdown: {
    linehaul: number;
    fuelSurcharge: number;
    destinationLabor: number;
    shuttleFee: number;
  };
}

const calculateVanLineCost = (params: VanLinePricingParams): VanLinePricingResult => {
  const {
    distance,
    weight,
    volume,
    colMultiplier,
    adjustedPackingCostLow,
    adjustedPackingCostHigh,
    totalDifficultyPremium,
    professionalLow,
    professionalHigh,
    miscCosts,
    multiStopPremium,
    isFlexible,
    intermediateStops
  } = params;

  // 1. Chargeable Weight: Greater of actual weight or volumetric weight (7 lbs/cu ft)
  const chargeableWeight = Math.max(weight, volume * 7);

  // 2. Linehaul Rate: Lower tariff for shared load, tiered by distance
  // Rates: >2000mi: $0.75/lb, >1000mi: $0.85/lb, <1000mi: $1.00/lb
  const vanLineRatePerLb = distance > 2000 ? 0.75 : (distance > 1000 ? 0.85 : 1.00);
  const linehaul = chargeableWeight * vanLineRatePerLb;

  // 3. Mandatory Fees
  const fuelSurcharge = linehaul * 0.12; // 12% Fuel Surcharge
  const destinationLabor = chargeableWeight * 0.25; // $0.25/lb for destination services

  // 4. Shuttle / Access Fees for High CoL Areas
  // If CoL multiplier > 1.3 (e.g. SF, NYC), assume shuttle or long carry is needed
  const shuttleFee = colMultiplier > 1.3 ? 750 : 0;

  // 5. Delivery Window Calculation
  const deliveryWindowMin = Math.max(5, Math.ceil(distance / 500) + 2);
  const deliveryWindowMax = Math.max(14, Math.ceil(distance / 300) + 5);
  const deliveryWindow = `${deliveryWindowMin}-${deliveryWindowMax} days`;

  // Total Van Line Cost
  const vanLineBase = linehaul + fuelSurcharge + destinationLabor + shuttleFee;
  // Apply CoL multiplier to the base cost as well to reflect local labor rates
  const vanLineTotalLow = (vanLineBase * colMultiplier) + adjustedPackingCostLow + (totalDifficultyPremium * 1.2);
  const vanLineTotalHigh = (vanLineBase * 1.25 * colMultiplier) + adjustedPackingCostHigh + (totalDifficultyPremium * 1.2);

  // Van line vs dedicated cost guardrail
  // For long-distance, heavy, flexible moves, ensure van lines are cheaper
  let adjustedVanLineLow = vanLineTotalLow;
  let adjustedVanLineHigh = vanLineTotalHigh;

  const shouldVanLinesBeCheaper = distance >= 500 && weight >= 2000 && isFlexible && intermediateStops === 0;

  if (shouldVanLinesBeCheaper) {
    const dedicatedMid = (professionalLow + adjustedPackingCostLow + miscCosts + totalDifficultyPremium + multiStopPremium +
                          professionalHigh + adjustedPackingCostHigh + miscCosts + totalDifficultyPremium + multiStopPremium) / 2;
    const vanMid = (vanLineTotalLow + vanLineTotalHigh) / 2;
    const ratio = vanMid / dedicatedMid;

    // If van lines are more expensive than 95% of dedicated, adjust them down
    if (ratio > 0.95) {
      const adjustmentFactor = 0.95 / ratio;
      adjustedVanLineLow = vanLineTotalLow * adjustmentFactor;
      adjustedVanLineHigh = vanLineTotalHigh * adjustmentFactor;
    }
  }

  return {
    vanLineTotalLow,
    vanLineTotalHigh,
    adjustedVanLineLow,
    adjustedVanLineHigh,
    chargeableWeight,
    deliveryWindow,
    breakdown: {
      linehaul,
      fuelSurcharge,
      destinationLabor,
      shuttleFee
    }
  };
};

// Cost estimates
const costEstimates = computed(() => {
  // Return empty estimates if we have a blocking error
  if (hasBlockingError.value) {
    return {
      diy: { total: 0, breakdown: {} },
      professional: {
        movingOnly: { low: 0, high: 0, average: 0 },
        packing: { low: 0, high: 0, average: 0, hours: 0, breakdown: {} },
        misc: { tolls: 0, hotels: 0, total: 0 },
        difficulty: { origin: {}, destination: {}, total: 0 },
        multiStop: { stops: 0, premium: 0 },
        additionalBoxCost: { low: 0, high: 0 },
        furnitureAssembly: { low: 0, high: 0 },
        total: { low: 0, high: 0, average: 0 },
        dedicated: { available: false, low: 0, high: 0 },
        vanLine: { available: false, low: 0, high: 0, chargeableWeight: 0, deliveryWindow: '', breakdown: {} }
      },
      reloprep: { low: 0, high: 0, average: 0, savings: 0 },
      comparison: { diyVsProfessional: 0, reloprepVsProfessional: 0 },
      packingLevel: 'none'
    };
  }

  const weight = totalWeightLbs.value;
  const volume = totalVolumeCuFt.value;
  const distance = estimatedDistance.value || 0;
  const helpers = numHelpers.value;
  const totalHours = timeEstimates.value.total;
  const totalBoxes = boxEstimates.value.total;

  // Packing materials cost (including boxes)
  const smallBoxCost = boxEstimates.value.small * 2.50;
  const mediumBoxCost = boxEstimates.value.medium * 3.50;
  const largeBoxCost = boxEstimates.value.large * 4.50;
  const boxCost = smallBoxCost + mediumBoxCost + largeBoxCost;

  const tapeCost = Math.ceil(totalBoxes / 8) * 6; // 1 roll per 8 boxes, $6/roll
  const bubbleWrapCost = (specialItems.value.fragile * 8); // $8 per fragile item
  const paperCost = totalBoxes * 2; // $2 worth of packing paper per box
  const markersCost = 5; // Sharpies

  // Furniture protection materials
  const furniturePadsCount = Math.ceil(itemsInOriginLocation.value.length * 0.3); // ~30% of items are furniture
  const furniturePadsCost = furniturePadsCount * 3; // $3 per furniture pad
  const shrinkWrapCost = Math.ceil(furniturePadsCount / 2) * 15; // $15 per roll, 1 roll per 2 furniture items
  const cornerProtectorsCost = furniturePadsCount * 2; // $2 per corner protector set

  const packingMaterialsCost = boxCost + tapeCost + bubbleWrapCost + paperCost + markersCost +
                                furniturePadsCost + shrinkWrapCost + cornerProtectorsCost;

  // DIY Move Costs
  const truckRentalPerDay = distance > 100 ? 200 : 120; // Long distance vs local
  const daysNeeded = distance > 100 ? Math.ceil(distance / 450) + 1 : 1; // 450 miles/day realistic for long distance
  const truckRental = truckRentalPerDay * daysNeeded;

  const fuelCostPerGallon = 4.50; // Average diesel
  const mpg = 8; // Typical moving truck MPG
  const fuel = (distance / mpg) * fuelCostPerGallon; // One-way move

  const equipmentRental = 75; // Dolly, blankets, straps, hand truck

  // Calculate tolls and hotel costs for long distance moves
  const estimatedTolls = distance > 100 ? Math.round(distance * 0.15) : 0;
  const overnightStops = distance > 500 ? Math.ceil(distance / 500) - 1 : 0;
  const hotelCosts = overnightStops * 150;

  const diyTotal = truckRental + fuel + packingMaterialsCost + equipmentRental + estimatedTolls + hotelCosts;

  // Calculate packing time based on box sizes and furniture
  // Time benchmarks: 10 min/small, 20 min/medium, 30 min/large box
  const smallBoxTime = boxEstimates.value.small * (10 / 60); // hours
  const mediumBoxTime = boxEstimates.value.medium * (20 / 60); // hours
  const largeBoxTime = boxEstimates.value.large * (30 / 60); // hours

  // Furniture breakdown and protection time: ~15 min per furniture item
  const furnitureBreakdownTime = furniturePadsCount * (15 / 60); // hours

  const totalPackingHours = smallBoxTime + mediumBoxTime + largeBoxTime + furnitureBreakdownTime;

  // Professional Move Costs (more realistic for 2024)
  const colMultiplier = colAdjustment.value;

  // Professional movers upcharge 110% on materials
  const professionalMaterialsCost = packingMaterialsCost * 1.10;

  // Calculate difficulty premiums based on access details
  // Research: Stairs: $50-70 per flight beyond first, Elevator out: $75, Long carry: $90-120 per 75ft
  const difficultyPremiums = {
    origin: {
      stairs: 0,
      elevator: 0,
      parking: 0,
      total: 0
    },
    destination: {
      stairs: 0,
      elevator: 0,
      parking: 0,
      total: 0
    }
  };

  // Origin difficulty premiums
  if (numberOfFlights.value && numberOfFlights.value > 1) {
    // Charge $60 per flight beyond the first
    difficultyPremiums.origin.stairs = (numberOfFlights.value - 1) * 60;
  }
  if (numberOfFlights.value && numberOfFlights.value > 0 && !hasElevator.value) {
    // No elevator with stairs: add $75 elevator fee
    difficultyPremiums.origin.elevator = 75;
  }
  if (parkingDistance.value && parkingDistance.value > 100) {
    // Long carry: $100 per 75ft beyond 100ft
    const extraDistance = parkingDistance.value - 100;
    difficultyPremiums.origin.parking = Math.ceil(extraDistance / 75) * 100;
  }
  difficultyPremiums.origin.total = difficultyPremiums.origin.stairs +
                                     difficultyPremiums.origin.elevator +
                                     difficultyPremiums.origin.parking;

  // Destination difficulty premiums
  if (destNumberOfFlights.value && destNumberOfFlights.value > 1) {
    difficultyPremiums.destination.stairs = (destNumberOfFlights.value - 1) * 60;
  }
  if (destNumberOfFlights.value && destNumberOfFlights.value > 0 && !destHasElevator.value) {
    difficultyPremiums.destination.elevator = 75;
  }
  if (destParkingDistance.value && destParkingDistance.value > 100) {
    const extraDistance = destParkingDistance.value - 100;
    difficultyPremiums.destination.parking = Math.ceil(extraDistance / 75) * 100;
  }
  difficultyPremiums.destination.total = difficultyPremiums.destination.stairs +
                                          difficultyPremiums.destination.elevator +
                                          difficultyPremiums.destination.parking;

  const totalDifficultyPremium = difficultyPremiums.origin.total + difficultyPremiums.destination.total;

  // Calculate multi-stop premium
  // Research: ~$150-200 per additional stop (increased from $80)
  const intermediateStops = moveLocations.value.filter(loc => loc.role === 'intermediate' && loc.location).length;
  const multiStopPremium = intermediateStops * 175;

  // Calculate dedicated movers pricing using separate function
  const dedicatedPricing = calculateDedicatedMoversCost({
    distance,
    totalHours,
    weight,
    volume,
    colMultiplier,
    totalPackingHours,
    professionalMaterialsCost,
    furnitureBreakdownTime,
    furniturePadsCost,
    shrinkWrapCost,
    cornerProtectorsCost,
    packingServicesRequired: packingServicesRequired.value
  });

  const { professionalLow, professionalHigh, packingCostLow, packingCostHigh, adjustedPackingCostLow, adjustedPackingCostHigh, partialPackingMaterials } = dedicatedPricing;

  // Market average (moving + packing based on selection + tolls/hotels + difficulty + multi-stop)
  const marketMovingAverage = (professionalLow + professionalHigh) / 2;
  const marketPackingAverage = (adjustedPackingCostLow + adjustedPackingCostHigh) / 2;
  const miscCosts = estimatedTolls + hotelCosts;
  const marketTotalAverage = marketMovingAverage + marketPackingAverage + miscCosts + totalDifficultyPremium + multiStopPremium;

  // Calculate van line pricing using separate function
  const vanLinePricing = calculateVanLineCost({
    distance,
    weight,
    volume,
    colMultiplier,
    adjustedPackingCostLow,
    adjustedPackingCostHigh,
    totalDifficultyPremium,
    professionalLow,
    professionalHigh,
    miscCosts,
    multiStopPremium,
    isFlexible: isFlexible.value,
    intermediateStops
  });

  const { adjustedVanLineLow, adjustedVanLineHigh, chargeableWeight, deliveryWindow: deliveryWindowStr, breakdown: vanLineBreakdown } = vanLinePricing;

  // ReloPrep estimate: Range from 80%-95% based on CoL adjustment
  // Lower CoL (colMultiplier < 1) = better savings (closer to 80%)
  // Higher CoL (colMultiplier > 1) = less savings (closer to 95%)
  const reloprepDiscountLow = 0.80 + (colMultiplier - 1) * 0.10; // 80% in low CoL, 95% in high CoL
  const reloprepDiscountHigh = 0.85 + (colMultiplier - 1) * 0.10; // 85% in low CoL, 100% in high CoL

  // Clamp to reasonable bounds
  const effectiveDiscountLow = Math.max(0.80, Math.min(0.95, reloprepDiscountLow));
  const effectiveDiscountHigh = Math.max(0.85, Math.min(1.00, reloprepDiscountHigh));

  const reloprepLow = marketTotalAverage * effectiveDiscountLow;
  const reloprepHigh = marketTotalAverage * effectiveDiscountHigh;
  const reloprepAverage = (reloprepLow + reloprepHigh) / 2;

  return {
    diy: {
      total: diyTotal,
      breakdown: {
        truckRental,
        fuel,
        materials: packingMaterialsCost,
        equipment: equipmentRental,
        tolls: estimatedTolls,
        hotels: hotelCosts,
        days: daysNeeded,
        boxes: boxCost,
        tape: tapeCost,
        bubbleWrap: bubbleWrapCost,
        paper: paperCost
      }
    },
    professional: {
      movingOnly: {
        low: professionalLow,
        high: professionalHigh,
        average: marketMovingAverage
      },
      packing: {
        low: adjustedPackingCostLow,
        high: adjustedPackingCostHigh,
        average: marketPackingAverage,
        hours: packingServicesRequired.value === 'full' ? totalPackingHours :
               packingServicesRequired.value === 'partial' ? furnitureBreakdownTime : 0,
        breakdown: {
          labor: marketPackingAverage - (packingServicesRequired.value === 'full' ? professionalMaterialsCost :
                 packingServicesRequired.value === 'partial' ? partialPackingMaterials : 0),
          materials: packingServicesRequired.value === 'full' ? professionalMaterialsCost :
                    packingServicesRequired.value === 'partial' ? partialPackingMaterials : 0,
          boxes: packingServicesRequired.value === 'full' ? boxCost * 1.10 : 0,
          furnitureProtection: (furniturePadsCost + shrinkWrapCost + cornerProtectorsCost) * 1.10,
          supplies: packingServicesRequired.value === 'full' ? (tapeCost + bubbleWrapCost + paperCost + markersCost) * 1.10 : 0
        }
      },
      misc: {
        tolls: estimatedTolls,
        hotels: hotelCosts,
        total: miscCosts
      },
      difficulty: {
        origin: difficultyPremiums.origin,
        destination: difficultyPremiums.destination,
        total: totalDifficultyPremium
      },
      multiStop: {
        stops: intermediateStops,
        premium: multiStopPremium
      },
      additionalBoxCost: {
        low: 20,
        high: 50
      },
      furnitureAssembly: {
        low: 150,
        high: 200
      },
      total: {
        low: professionalLow + adjustedPackingCostLow + miscCosts + totalDifficultyPremium + multiStopPremium,
        high: professionalHigh + adjustedPackingCostHigh + miscCosts + totalDifficultyPremium + multiStopPremium,
        average: marketTotalAverage
      },
      // Separate dedicated movers from van lines (van lines only for non-multi-stop long distance)
      dedicated: {
        available: true,
        low: professionalLow + adjustedPackingCostLow + miscCosts + totalDifficultyPremium + multiStopPremium,
        high: professionalHigh + adjustedPackingCostHigh + miscCosts + totalDifficultyPremium + multiStopPremium
      },
      vanLine: {
        available: distance >= 250 && intermediateStops === 0 && (distance < 500 || isFlexible.value),
        low: distance >= 250 && intermediateStops === 0 && (distance < 500 || isFlexible.value) ? adjustedVanLineLow : 0,
        high: distance >= 250 && intermediateStops === 0 && (distance < 500 || isFlexible.value) ? adjustedVanLineHigh : 0,
        chargeableWeight: chargeableWeight,
        deliveryWindow: deliveryWindowStr,
        breakdown: vanLineBreakdown
      }
    },
    reloprep: {
      low: reloprepLow,
      high: reloprepHigh,
      average: reloprepAverage,
      savings: marketTotalAverage - reloprepHigh // Savings based on high end (conservative)
    },
    comparison: {
      diyVsProfessional: ((marketTotalAverage - diyTotal) / marketTotalAverage) * 100,
      reloprepVsProfessional: ((marketTotalAverage - reloprepAverage) / marketTotalAverage) * 100
    },
    packingLevel: packingServicesRequired.value
  };
});

// Helper function to load image as base64
const loadImageAsBase64 = async (url: string): Promise<string | null> => {
  try {
    const response = await fetch(url);
    const blob = await response.blob();
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch (error) {
    console.warn('Failed to load image:', url, error);
    return null;
  }
};

// Helper to build location access paragraph
const buildAccessParagraph = (
  entryType: string | null,
  numFlights: number | null,
  hasElev: boolean,
  elevType: string | null,
  parking: string | null,
  challenges: string[],
  notes: string
): string => {
  const parts: string[] = [];

  if (entryType) parts.push(`${entryType}`);
  if (numFlights && numFlights > 0) parts.push(`${numFlights} flight${numFlights > 1 ? 's' : ''} of stairs`);

  // Always include elevator status
  if (hasElev) {
    parts.push(`Elevator: Yes (${elevType || 'Standard'})`);
  } else {
    parts.push('Elevator: No');
  }

  if (parking) parts.push(`Parking: ${parking}`);
  if (challenges.length > 0) parts.push(`Challenges: ${challenges.join(', ')}`);
  if (notes) parts.push(notes);

  return parts.length > 0 ? parts.join('. ') + '.' : 'No additional access details provided.';
};

const downloadInventoryPdf = async () => {
  if (!estimatedDistance.value) {
    Notify.create({
      type: 'warning',
      message: 'Please select origin and destination locations first',
      timeout: 3000
    });
    return;
  }

  try {
    // Get all required data
    const origin = locationsWithDetails.value.find(l => l.value === originLocation.value);
    const destination = locationsWithDetails.value.find(l => l.value === destinationLocation.value);

    if (!origin || !destination) {
      throw new Error('Origin or destination location not found');
    }

    // Get full addresses from location objects
    const originAddress = origin.fullAddress;
    const destAddress = destination.fullAddress;

    // Create PDF
    const doc = new jsPDF();
    let yPos = 20;

    // Helper function to add section header
    const addSectionHeader = (text: string) => {
      doc.setFontSize(14);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(25, 118, 210);
      doc.text(text, 15, yPos);
      yPos += 2;
      doc.setLineWidth(0.5);
      doc.setDrawColor(25, 118, 210);
      doc.line(15, yPos, 195, yPos);
      yPos += 8;
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(0, 0, 0);
    };

    // Load ReloPrep logo
    const logoUrl = 'https://storage.googleapis.com/widowmaker-site-images/reloprep_color.png';
    let logoData: string | null = null;
    try {
      logoData = await loadImageAsBase64(logoUrl);
    } catch (error) {
      console.warn('Failed to load logo:', error);
    }

    // Title and logo badge
    doc.setFontSize(20);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(25, 118, 210);
    doc.text('Moving Inventory', 15, yPos);

    // ReloPrep logo in top right
    if (logoData) {
      try {
        doc.addImage(logoData, 'PNG', 160, yPos - 5, 35, 10);
      } catch (error) {
        console.warn('Failed to add logo to PDF:', error);
        // Fallback to text
        doc.setFontSize(9);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(100, 100, 100);
        doc.text('Prepared with ReloPrep', 195, yPos, { align: 'right' });
      }
    } else {
      // Fallback to text if logo didn't load
      doc.setFontSize(9);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(100, 100, 100);
      doc.text('Prepared with ReloPrep', 195, yPos, { align: 'right' });
    }

    yPos += 8;
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(100, 100, 100);
    doc.text(`Generated: ${new Date().toLocaleDateString()}`, 15, yPos);
    yPos += 12;

    // SECTION 1: MOVE DETAILS
    addSectionHeader('Move Details');

    const moveDetails = [
      ['Starting Address', originAddress],
      ['Ending Address', destAddress],
      ['Move Window', moveDateRangeDisplay.value],
      ['Total Items', totalItems.value.toString()],
      ['Total Weight', `${totalWeightLbs.value.toFixed(0)} lbs`],
      ['Total Volume', `${totalVolumeCuFt.value.toFixed(1)} cu ft`]
    ];

    autoTable(doc, {
      startY: yPos,
      head: [],
      body: moveDetails,
      theme: 'plain',
      styles: { fontSize: 10, cellPadding: 2 },
      columnStyles: {
        0: { fontStyle: 'bold', cellWidth: 60 },
        1: { cellWidth: 120 }
      }
    });

    yPos = (doc as any).lastAutoTable.finalY + 10;

    // Origin Location Access Details
    if (yPos > 240) {
      doc.addPage();
      yPos = 20;
    }

    addSectionHeader('Origin Location Details');

    const originAccessText = buildAccessParagraph(
      entryType.value,
      numberOfFlights.value,
      hasElevator.value,
      elevatorType.value,
      parkingSituation.value,
      entryChallenges.value,
      accessNotes.value
    );

    doc.setFontSize(10);
    const splitOriginAccess = doc.splitTextToSize(originAccessText, 180);
    doc.text(splitOriginAccess, 15, yPos);
    yPos += splitOriginAccess.length * 5 + 10;

    // Destination Location Access Details
    if (yPos > 240) {
      doc.addPage();
      yPos = 20;
    }

    addSectionHeader('Destination Location Details');

    const destAccessText = buildAccessParagraph(
      destEntryType.value,
      destNumberOfFlights.value,
      destHasElevator.value,
      destElevatorType.value,
      destParkingSituation.value,
      destEntryChallenges.value,
      destAccessNotes.value
    );

    doc.setFontSize(10);
    const splitDestAccess = doc.splitTextToSize(destAccessText, 180);
    doc.text(splitDestAccess, 15, yPos);
    yPos += splitDestAccess.length * 5 + 10;

    // SECTION 2: INVENTORY TABLE
    if (yPos > 220) {
      doc.addPage();
      yPos = 20;
    }

    addSectionHeader('Complete Inventory');

    const inventoryItems = itemsInOriginLocation.value.map(item => {
      const dims = parseItemDimensions(item);
      const size = dims ? `${dims.length}"×${dims.width}"×${dims.height}"` : 'N/A';
      const weight = item.weight_lbs ? `${item.weight_lbs} lbs` : 'N/A';
      const qty = item.quantity || 1;
      const description = item.description || '';

      return [
        item.label || 'Unnamed',
        description.substring(0, 40), // Truncate long descriptions
        qty.toString(),
        size,
        weight,
        item.fragile ? 'Yes' : 'No'
      ];
    });

    autoTable(doc, {
      startY: yPos,
      head: [['Item', 'Description', 'Qty', 'Dimensions', 'Weight', 'Fragile']],
      body: inventoryItems,
      theme: 'striped',
      styles: { fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: [25, 118, 210], textColor: 255 },
      columnStyles: {
        0: { cellWidth: 40 },
        1: { cellWidth: 50 },
        2: { cellWidth: 15, halign: 'center' },
        3: { cellWidth: 30 },
        4: { cellWidth: 20 },
        5: { cellWidth: 20, halign: 'center' }
      }
    });

    yPos = (doc as any).lastAutoTable.finalY + 10;

    // SECTION 3: ITEMS WITH IMAGES (loose items + larger items)
    const itemsWithImages = itemsInOriginLocation.value.filter(item => {
      if (!item.picture_url) return false;

      // Include loose items
      const isLoose = Array.isArray(item.tags) && item.tags.some((tag: string) =>
        tag.toLowerCase() === 'loose'
      );
      if (isLoose) return true;

      // Include larger items (10+ cu ft)
      const dims = parseItemDimensions(item);
      if (dims) {
        const volumeCuFt = (dims.length * dims.width * dims.height) / 1728;
        if (volumeCuFt >= 10) return true;
      }

      return false;
    });

    if (itemsWithImages.length > 0) {
      if (yPos > 240) {
        doc.addPage();
        yPos = 20;
      }

      addSectionHeader('Large & Loose Items');

      doc.setFontSize(9);
      doc.text('Photos of furniture, large items, and other notable pieces:', 15, yPos);
      yPos += 10;

      // Display images in a grid (2 per row)
      let itemIndex = 0;
      for (const item of itemsWithImages) {
        if (!item.picture_url) continue;

        const imageData = await loadImageAsBase64(item.picture_url);
        if (!imageData) continue;

        // Position in grid (2 columns)
        const col = itemIndex % 2;
        const xPos = 15 + (col * 90);

        // Check if we need a new page
        if (yPos > 220) {
          doc.addPage();
          yPos = 20;
        }

        // Add image (max 80x60)
        try {
          doc.addImage(imageData, 'PNG', xPos, yPos, 80, 60);

          // Add item name below image
          doc.setFontSize(8);
          doc.setFont('helvetica', 'bold');
          const itemName = (item.label || 'Unnamed').substring(0, 30);
          doc.text(itemName, xPos + 40, yPos + 65, { align: 'center' });

          // Add dimensions if available
          const dims = parseItemDimensions(item);
          if (dims) {
            doc.setFont('helvetica', 'normal');
            doc.setFontSize(7);
            doc.text(`${dims.length}"×${dims.width}"×${dims.height}"`, xPos + 40, yPos + 70, { align: 'center' });
          }

          doc.setFont('helvetica', 'normal');
        } catch (imgError) {
          console.warn('Failed to add image to PDF:', imgError);
        }

        // Move to next row after 2 items
        if (col === 1) {
          yPos += 75;
        }

        itemIndex++;
      }

      // Adjust yPos if we ended on first column
      if (itemIndex % 2 === 1) {
        yPos += 75;
      }
    }

    // Footer on all pages
    const pageCount = (doc as any).internal.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      doc.setFontSize(8);
      doc.setTextColor(150, 150, 150);
      doc.text(`Page ${i} of ${pageCount}`, 105, 285, { align: 'center' });
      doc.text('Moving Inventory • Generated by ReloPrep', 105, 290, { align: 'center' });
    }

    // Save PDF
    doc.save(`Moving-Inventory-${new Date().toISOString().split('T')[0]}.pdf`);

    Notify.create({
      type: 'positive',
      message: 'Inventory PDF downloaded successfully',
      caption: 'Share this with moving companies for accurate quotes',
      timeout: 3000
    });
  } catch (error) {
    console.error('Error generating inventory PDF:', error);
    Notify.create({
      type: 'negative',
      message: 'Failed to generate inventory PDF',
      caption: 'Please make sure you have items in your origin location',
      timeout: 3000
    });
  }
};

// Saved moves functionality
const savedMoves = ref<SavedMove[]>([]);
const currentSavedMoveId = ref<number | null>(null);
const showNewMoveDialog = ref(false);
const newMoveForm = ref({
  origin: null as string | null,
  destination: null as string | null,
  moveOut: null as string | null,
  moveIn: null as string | null
});
const showSaveMoveDialog = ref(false);
const showLoadMoveDialog = ref(false);
const saveMoveFormModel = ref({
  name: ''
});

// Multi-location move support
interface MoveLocation {
  id: number;
  role: 'origin' | 'intermediate' | 'destination';
  location: string | number | null;
  lat: number | null;
  lng: number | null;
  // Access details
  entryType: string | null;
  numberOfFlights: number | null;
  hasElevator: boolean;
  elevatorType: string | null;
  elevatorDistance: number | null;
  elevatorReservationRequired: boolean;
  parkingSituation: string | null;
  parkingDistance: number | null;
  entryChallenges: string[];
  accessNotes: string;
}

let moveLocationIdCounter = 1;

const createEmptyMoveLocation = (role: 'origin' | 'intermediate' | 'destination' = 'intermediate'): MoveLocation => ({
  id: moveLocationIdCounter++,
  role,
  location: null,
  lat: null,
  lng: null,
  entryType: null,
  numberOfFlights: null,
  hasElevator: false,
  elevatorType: null,
  elevatorDistance: null,
  elevatorReservationRequired: false,
  parkingSituation: null,
  parkingDistance: null,
  entryChallenges: [],
  accessNotes: ''
});

const moveLocations = ref<MoveLocation[]>([]);

const normalizeCoordinate = (value: unknown): number | null => {
  if (value === null || value === undefined) return null;
  const numeric = typeof value === 'string' ? parseFloat(value) : Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const applyLocationDetailsToMoveLocation = (moveLoc: MoveLocation) => {
  if (!moveLoc) return;
  if (!moveLoc.location) {
    moveLoc.lat = null;
    moveLoc.lng = null;
    return;
  }

  const record = store.locations.find(l => String(l.value) === String(moveLoc.location));
  const latSource = record?.lat ?? moveLoc.lat;
  const lngSource = record?.lng ?? moveLoc.lng;

  moveLoc.lat = normalizeCoordinate(latSource);
  moveLoc.lng = normalizeCoordinate(lngSource);
};

// Watch for intermediate location changes and recalculate distance
watch(
  () => moveLocations.value.map(loc => ({ role: loc.role, location: loc.location })),
  () => {
    if (originLocation.value && destinationLocation.value) {
      calculateDistance();
    }
  },
  { deep: true }
);

// Extended time estimates including driving, intermediate stops, and overhead
const fullTimeEstimates = computed(() => {
  const base = timeEstimates.value;

  // Calculate driving time from route data or estimated distance
  let drivingHours = 0;
  if (routeData.value && routeData.value.duration_seconds) {
    // Use API-provided duration
    drivingHours = Math.ceil(routeData.value.duration_seconds / 3600);
  } else if (estimatedDistance.value) {
    // Estimate: assume average 50 mph (accounting for breaks, traffic, etc.)
    drivingHours = Math.ceil(estimatedDistance.value / 50);
  }

  // Count intermediate stops (drop-off locations)
  const intermediateStops = moveLocations.value.filter(loc => loc.role === 'intermediate' && loc.location).length;

  // Each intermediate stop adds time:
  // - 30 minutes minimum for partial unload
  // - Plus 25% overhead per stop for logistics (finding parking, access, etc.)
  const intermediateUnloadMinutes = intermediateStops * 30;
  const intermediateUnloadHours = intermediateUnloadMinutes / 60;

  // Apply overhead percentage: 25% per additional stop (only to loading/unloading)
  const overheadMultiplier = 1 + (intermediateStops * 0.25);

  // Base work time for loading/unloading only (overhead applies here)
  const loadUnloadHours = base.loading + base.unloading + intermediateUnloadHours;
  const adjustedLoadUnloadHours = loadUnloadHours * overheadMultiplier;

  // Total work hours: packing (no overhead) + adjusted loading/unloading
  const adjustedWorkHours = Math.ceil(base.packing + adjustedLoadUnloadHours);

  return {
    ...base,
    driving: drivingHours,
    intermediateStops: intermediateStops,
    intermediateUnload: Math.ceil(intermediateUnloadHours * 10) / 10, // Round to 1 decimal
    overheadPercent: Math.round((overheadMultiplier - 1) * 100),
    total: adjustedWorkHours + drivingHours
  };
});

// Computed property for intermediate drop-off locations to pass to RouteMap
const intermediateDropoffLocations = computed(() => {
  const dropoffWaypoints = (journeyWaypoints.value || []).filter(wp => wp?.is_dropoff);

  return moveLocations.value
    .filter(loc => loc.role === 'intermediate' && loc.location)
    .map((loc, index) => {
      const locationData = store.locations.find(l => l.value === loc.location);

      const waypointMatchById = dropoffWaypoints.find(wp =>
        wp.location_id != null &&
        loc.location != null &&
        String(wp.location_id) === String(loc.location)
      );

      const waypointMatchByCity = !waypointMatchById && locationData?.city
       

        ? dropoffWaypoints.find(wp => wp.city?.toLowerCase() === locationData.city.toLowerCase())
        : undefined;

      const waypoint = waypointMatchById || waypointMatchByCity;

      const lat = normalizeCoordinate(waypoint?.lat ?? loc.lat ?? locationData?.lat ?? null);
      const lng = normalizeCoordinate(waypoint?.lng ?? loc.lng ?? locationData?.lng ?? null);

      return {
        id: loc.id,
        name: locationData?.label || `Drop-off ${index + 1}`,
        address: locationData ? formatAddress(locationData) : undefined,
        lat: lat ?? undefined,
        lng: lng ?? undefined
      };
    });
});

// Smart rounding for route display
const roundedMiles = computed(() => {
  if (!estimatedDistance.value) return null;
  // Round to nearest 10
  return Math.round(estimatedDistance.value / 10) * 10;
});

const decimalHours = computed(() => {
  if (!routeData.value || !routeData.duration_seconds) return null;
  // Convert seconds to hours with 1 decimal place
  const hours = routeData.duration_seconds / 3600;
  return hours.toFixed(1);
});

const roundedTolls = computed(() => {
  if (!routeData.value || !routeData.estimated_tolls) return null;
  // Round to nearest 10
  return Math.round(routeData.estimated_tolls / 10) * 10;
});

const addMoveLocation = (role: 'origin' | 'intermediate' | 'destination' = 'intermediate') => {
  if (role === 'intermediate' && moveLocations.value.length >= 5) {
    Notify.create({
      type: 'warning',
      message: 'Maximum of 5 locations allowed',
      timeout: 2000
    });
    return;
  }
  moveLocations.value.push(createEmptyMoveLocation(role));
  syncLegacyLocations();
};

const handleLocationDialogSave = async (payload: LocationEditorResult) => {
  if (!props.user) {
    Notify.create({
      type: 'negative',
      message: 'Please log in again.'
    });
    return;
  }

  try {
    await store.createLocation(
      props.user,
      payload.name.trim(),
      payload.formattedAddress || '',
      payload.address1.trim(),
      payload.address2.trim(),
      payload.city.trim(),
      payload.state.trim(),
      payload.zip.trim(),
      false,
      payload.lat ?? null,
      payload.lng ?? null,
      payload.country
    );

    await store.loadInventory(props.user);

    Notify.create({
      type: 'positive',
      message: `Location "${payload.name}" added successfully`
    });
  } catch (error) {
    console.error('[MovePlanning] Failed to add location', error);
    Notify.create({
      type: 'negative',
      message: 'Failed to add location'
    });
  }
};

const removeMoveLocation = (index: number) => {
  const target = moveLocations.value[index]
  if (target?.role === 'origin' || target?.role === 'destination') {
    Notify.create({
      type: 'warning',
      message: 'Cannot remove the starting or ending location',
      timeout: 2000
    });
    return;
  }
  if (moveLocations.value.filter(loc => loc.role === 'intermediate').length <= 1) {
    Notify.create({
      type: 'warning',
      message: 'Add another drop-off before removing this one',
      timeout: 2000
    });
    return;
  }
  moveLocations.value.splice(index, 1);
  syncLegacyLocations();
};

// Sync moveLocations with legacy originLocation/destinationLocation refs
const syncLegacyLocations = () => {
  const origin = moveLocations.value.find(loc => loc.role === 'origin');
  const destination = moveLocations.value.find(loc => loc.role === 'destination');

  originLocation.value = origin?.location || null;
  destinationLocation.value = destination?.location || null;

  // Sync origin access details
  if (origin) {
    entryType.value = origin.entryType;
    numberOfFlights.value = origin.numberOfFlights;
    hasElevator.value = origin.hasElevator;
    elevatorType.value = origin.elevatorType;
    elevatorDistance.value = origin.elevatorDistance;
    elevatorReservationRequired.value = origin.elevatorReservationRequired;
    parkingSituation.value = origin.parkingSituation;
    parkingDistance.value = origin.parkingDistance;
    entryChallenges.value = origin.entryChallenges;
    accessNotes.value = origin.accessNotes;
  }

  // Sync destination access details
  if (destination) {
    destEntryType.value = destination.entryType;
    destNumberOfFlights.value = destination.numberOfFlights;
    destHasElevator.value = destination.hasElevator;
    destElevatorType.value = destination.elevatorType;
    destElevatorDistance.value = destination.elevatorDistance;
    destElevatorReservationRequired.value = destination.elevatorReservationRequired;
    destParkingSituation.value = destination.parkingSituation;
    destParkingDistance.value = destination.parkingDistance;
    destEntryChallenges.value = destination.entryChallenges;
    destAccessNotes.value = destination.accessNotes;
  }

  moveLocations.value.forEach(applyLocationDetailsToMoveLocation);
};

// Watch moveLocations for changes and sync
watch(moveLocations, () => {
  syncLegacyLocations();
}, { deep: true });

const getAlternateLocationId = (excludeId?: string | null) => {
  const available = store.locations.find(loc => String(loc.value) !== String(excludeId));
  return available ? String(available.value) : null;
};

// Reset form for new move
const resetMoveForm = () => {
  const fallbackOrigin = originLocation.value
    ? String(originLocation.value)
    : (store.locations[0] ? String(store.locations[0].value) : null);
  const fallbackDestination = destinationLocation.value
    ? String(destinationLocation.value)
    : getAlternateLocationId(fallbackOrigin) || fallbackOrigin;

  newMoveForm.value = {
    origin: fallbackOrigin,
    destination: fallbackDestination,
    moveOut: moveDate.value,
    moveIn: moveEndDate.value
  };

  showNewMoveDialog.value = true;
};

const newMoveFormReady = computed(() => {
  return !!(
    newMoveForm.value.origin &&
    newMoveForm.value.destination &&
    (newMoveForm.value.moveOut || newMoveForm.value.moveIn)
  );
});

const shiftDate = (dateStr: string | null, days: number): string | null => {
  if (!dateStr) return null;
  const base = new Date(dateStr);
  if (Number.isNaN(base.getTime())) return null;
  base.setDate(base.getDate() + days);
  return base.toISOString().split('T')[0];
};

const confirmNewMove = () => {
  const { origin, destination } = newMoveForm.value;
  let moveOut = newMoveForm.value.moveOut;
  let moveIn = newMoveForm.value.moveIn;

  if (!origin || !destination) {
    Notify.create({
      type: 'warning',
      message: 'Select both a starting and ending location to begin a new move.'
    });
    return;
  }

  if (origin === destination) {
    Notify.create({
      type: 'warning',
      message: 'Please choose different locations for the start and end of the move.'
    });
    return;
  }

  if (!moveOut && !moveIn) {
    Notify.create({
      type: 'warning',
      message: 'Please provide at least a move-out or move-in date.'
    });
    return;
  }

  if (moveOut && !moveIn) {
    moveIn = shiftDate(moveOut, 14) || moveOut;
  } else if (!moveOut && moveIn) {
    moveOut = shiftDate(moveIn, -14) || moveIn;
  }

  newMoveForm.value.moveOut = moveOut;
  newMoveForm.value.moveIn = moveIn;

  // Clear current move ID
  currentSavedMoveId.value = null;
  saveMoveFormModel.value.name = '';

  // Clear multi-location array
  moveLocationIdCounter = 1;
  const originEntry = createEmptyMoveLocation('origin');
  originEntry.location = origin;
  const destinationEntry = createEmptyMoveLocation('destination');
  destinationEntry.location = destination;
  moveLocations.value = [originEntry, destinationEntry];
  moveLocations.value.forEach(applyLocationDetailsToMoveLocation);

  // Clear move configuration (legacy)
  originLocation.value = null;
  destinationLocation.value = null;
  moveDate.value = moveOut || moveIn || null;
  moveEndDate.value = moveIn || moveOut || null;
  numHelpers.value = 2;
  packingServicesRequired.value = 'none';
  packingAreasSelected.value = [];

  // Clear origin location details
  hasStairs.value = false;
  numberOfFlights.value = null;
  hasElevator.value = false;
  elevatorType.value = null;
  elevatorDistance.value = null;
  elevatorReservationRequired.value = false;
  parkingSituation.value = null;
  parkingDistance.value = null;
  entryType.value = null;
  entryChallenges.value = [];
  accessNotes.value = '';

  // Clear destination location details
  destHasStairs.value = false;
  destNumberOfFlights.value = null;
  destHasElevator.value = false;
  destElevatorType.value = null;
  destElevatorDistance.value = null;
  destElevatorReservationRequired.value = false;
  destParkingSituation.value = null;
  destParkingDistance.value = null;
  destEntryType.value = null;
  destEntryChallenges.value = [];
  destAccessNotes.value = '';

  // Clear other fields
  specialRequirements.value = '';
  estimatedSquareFootage.value = null;

  syncLegacyLocations();
  showNewMoveDialog.value = false;

  Notify.create({
    type: 'info',
    message: 'Started new move with your selected locations and dates'
  });
};

// Fetch saved moves
const fetchSavedMoves = async () => {
  if (!props.user) return;

  try {
    const sessionToken = localStorage.getItem('session_token');
    if (!sessionToken) {
      console.error('No session token found');
      return;
    }

    const response = await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/saved-moves`, {
      headers: {
        'Authorization': `Bearer ${sessionToken}`
      }
    });

    if (!response.ok) throw new Error('Failed to fetch saved moves');

    savedMoves.value = await response.json();
  } catch (error) {
    console.error('Error fetching saved moves:', error);
    Notify.create({
      type: 'negative',
      message: 'Failed to load saved moves'
    });
  }
};

// Save current move
const saveMove = async () => {
  if (!props.user || !saveMoveFormModel.value.name.trim()) {
    Notify.create({
      type: 'warning',
      message: 'Please enter a name for this move'
    });
    return;
  }

  if (!originLocation.value || !destinationLocation.value) {
    Notify.create({
      type: 'warning',
      message: 'Please select origin and destination locations'
    });
    return;
  }

  try {
    const moveData = {
      name: saveMoveFormModel.value.name.trim(),
      originLocationId: originLocation.value,
      destinationLocationId: destinationLocation.value,
      moveDate: moveDate.value,
      desiredStartDate: moveDate.value,
      desiredEndDate: moveEndDate.value || moveDate.value,
      numHelpers: numHelpers.value,
      packingServicesRequired: packingServicesRequired.value,
      // Origin details
      hasStairs: hasStairs.value,
      numberOfFlights: numberOfFlights.value,
      hasElevator: hasElevator.value,
      elevatorType: elevatorType.value,
      elevatorDistance: elevatorDistance.value,
      elevatorReservationRequired: elevatorReservationRequired.value,
      parkingSituation: parkingSituation.value,
      parkingDistance: parkingDistance.value,
      entryType: entryType.value,
      entryChallenges: entryChallenges.value,
      accessNotes: accessNotes.value,
      // Destination details
      destHasStairs: destHasStairs.value,
      destNumberOfFlights: destNumberOfFlights.value,
      destHasElevator: destHasElevator.value,
      destElevatorType: destElevatorType.value,
      destElevatorDistance: destElevatorDistance.value,
      destElevatorReservationRequired: destElevatorReservationRequired.value,
      destParkingSituation: destParkingSituation.value,
      destParkingDistance: destParkingDistance.value,
      destEntryType: destEntryType.value,
      destEntryChallenges: destEntryChallenges.value,
      destAccessNotes: destAccessNotes.value,
      // Additional
      specialRequirements: specialRequirements.value,
      estimatedSquareFootage: estimatedSquareFootage.value,
      useTruckRoute: useTruckRoute.value,
      avoidTolls: avoidTolls.value,
      // Calculated metrics
      totalItems: totalItems.value,
      totalWeightLbs: totalWeightLbs.value,
      totalVolumeCuFt: totalVolumeCuFt.value,
      estimatedDistanceMiles: estimatedDistance.value,
      costCalculations: costEstimates.value,
      routeData: routeData.value,
      // Include all move locations (origin, intermediate, destination)
      moveLocations: moveLocations.value.map((loc, index) => ({
        locationId: loc.location,
        locationRole: loc.role,
        sequenceOrder: index,
        hasLoading: loc.role === 'origin' || loc.role === 'intermediate',
        hasUnloading: loc.role === 'destination' || loc.role === 'intermediate'
      }))
    };

    const url = currentSavedMoveId.value
      ? `${import.meta.env.VITE_API_BASE_URL}/api/saved-moves/${currentSavedMoveId.value}`
      : `${import.meta.env.VITE_API_BASE_URL}/api/saved-moves`;

    const method = currentSavedMoveId.value ? 'PUT' : 'POST';

    const sessionToken = localStorage.getItem('session_token');
    if (!sessionToken) {
      throw new Error('No session token found. Please log in again.');
    }

    const response = await fetch(url, {
      method,
      headers: {
        'Authorization': `Bearer ${sessionToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(moveData)
    });

    if (!response.ok) throw new Error('Failed to save move');

    const savedMove = await response.json();
    currentSavedMoveId.value = Number(savedMove.id);

    Notify.create({
      type: 'positive',
      message: currentSavedMoveId.value ? 'Move updated successfully' : 'Move saved successfully',
      icon: 'save'
    });

    showSaveMoveDialog.value = false;
    await fetchSavedMoves();
    if (waypointManagerRef.value && typeof waypointManagerRef.value.fetchWaypoints === 'function') {
      try {
        await waypointManagerRef.value.fetchWaypoints();
      } catch (waypointError) {
        console.warn('[DesktopMovePlanning] Unable to refresh waypoints after save', waypointError);
      }
    }
  } catch (error) {
    console.error('Error saving move:', error);
    Notify.create({
      type: 'negative',
      message: 'Failed to save move'
    });
  }
};

// Load a saved move
const loadMove = async (moveId: number) => {
  if (!props.user) return;

  try {
    const sessionToken = localStorage.getItem('session_token');
    if (!sessionToken) {
      throw new Error('No session token found. Please log in again.');
    }

    const response = await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/saved-moves/${moveId}`, {
      headers: {
        'Authorization': `Bearer ${sessionToken}`
      }
    });

    if (!response.ok) throw new Error('Failed to load move');

    const move = await response.json();

    // Load basic move data
    moveDate.value = normalizeDateInput(move.desired_start_date || move.move_date);
    moveEndDate.value = normalizeDateInput(move.desired_end_date || move.desired_start_date || move.move_date);
    numHelpers.value = move.num_helpers;
    packingServicesRequired.value = move.packing_services_required;

    // Populate moveLocations array for the UI
    // This is the new multi-location model that displays the location cards
    moveLocations.value = [];

    // Check if we have move_locations data from the API (new multi-location model)
    if (move.move_locations && move.move_locations.length > 0) {
      // Use move_locations data - this includes intermediate locations
      move.move_locations.forEach((ml: MoveLocationData) => {
        // Parse entry_challenges if it's a string
        let entryChallenges: string[] = [];
        if (typeof ml.entry_challenges === 'string') {
          try {
            entryChallenges = JSON.parse(ml.entry_challenges);
          } catch {
            entryChallenges = [];
          }
        } else if (Array.isArray(ml.entry_challenges)) {
          entryChallenges = ml.entry_challenges;
        }

        moveLocations.value.push({
          id: moveLocationIdCounter++,
          role: ml.location_role as 'origin' | 'intermediate' | 'destination',
          location: ml.location_id,
          lat: normalizeCoordinate(ml.lat),
          lng: normalizeCoordinate(ml.lng),
          entryType: ml.entry_type ?? null,
          numberOfFlights: ml.number_of_flights ?? null,
          hasElevator: ml.has_elevator ?? false,
          elevatorType: ml.elevator_type ?? null,
          elevatorDistance: ml.elevator_distance ?? null,
          elevatorReservationRequired: ml.elevator_reservation_required ?? false,
          parkingSituation: ml.parking_situation ?? null,
          parkingDistance: ml.parking_distance ?? null,
          entryChallenges: entryChallenges,
          accessNotes: ml.access_notes ?? ''
        });

        // Also set legacy refs for origin/destination
        if (ml.location_role === 'origin') {
          originLocation.value = String(ml.location_id);
        } else if (ml.location_role === 'destination') {
          destinationLocation.value = String(ml.location_id);
        }
      });
    } else {
      // Set legacy refs from move data
      originLocation.value = move.origin_location_id;
      destinationLocation.value = move.destination_location_id;
      // Fallback to legacy origin/destination fields for backward compatibility
      // Add origin location
      if (move.origin_location_id) {
        const originRecord = store.locations.find(l => String(l.value) === String(move.origin_location_id));
        moveLocations.value.push({
          id: moveLocationIdCounter++,
          role: 'origin',
          location: move.origin_location_id,
          lat: normalizeCoordinate(originRecord?.lat),
          lng: normalizeCoordinate(originRecord?.lng),
          entryType: move.entry_type,
          numberOfFlights: move.number_of_flights,
          hasElevator: move.has_elevator,
          elevatorType: move.elevator_type,
          elevatorDistance: move.elevator_distance,
          elevatorReservationRequired: move.elevator_reservation_required,
          parkingSituation: move.parking_situation,
          parkingDistance: move.parking_distance,
          entryChallenges: move.entry_challenges || [],
          accessNotes: move.access_notes || ''
        });
      }

      // Add destination location
      if (move.destination_location_id) {
        const destinationRecord = store.locations.find(l => String(l.value) === String(move.destination_location_id));
        moveLocations.value.push({
          id: moveLocationIdCounter++,
          role: 'destination',
          location: move.destination_location_id,
          lat: normalizeCoordinate(destinationRecord?.lat),
          lng: normalizeCoordinate(destinationRecord?.lng),
          entryType: move.dest_entry_type,
          numberOfFlights: move.dest_number_of_flights,
          hasElevator: move.dest_has_elevator,
          elevatorType: move.dest_elevator_type,
          elevatorDistance: move.dest_elevator_distance,
          elevatorReservationRequired: move.dest_elevator_reservation_required,
          parkingSituation: move.dest_parking_situation,
          parkingDistance: move.dest_parking_distance,
        entryChallenges: move.dest_entry_challenges || [],
        accessNotes: move.dest_access_notes || ''
      });
    }
  }

    moveLocations.value.forEach(applyLocationDetailsToMoveLocation);

    // Origin details
    hasStairs.value = move.has_stairs;
    numberOfFlights.value = move.number_of_flights;
    hasElevator.value = move.has_elevator;
    elevatorType.value = move.elevator_type;
    elevatorDistance.value = move.elevator_distance;
    elevatorReservationRequired.value = move.elevator_reservation_required;
    parkingSituation.value = move.parking_situation;
    parkingDistance.value = move.parking_distance;
    entryType.value = move.entry_type;
    entryChallenges.value = move.entry_challenges || [];
    accessNotes.value = move.access_notes;

    // Destination details
    destHasStairs.value = move.dest_has_stairs;
    destNumberOfFlights.value = move.dest_number_of_flights;
    destHasElevator.value = move.dest_has_elevator;
    destElevatorType.value = move.dest_elevator_type;
    destElevatorDistance.value = move.dest_elevator_distance;
    destElevatorReservationRequired.value = move.dest_elevator_reservation_required;
    destParkingSituation.value = move.dest_parking_situation;
    destParkingDistance.value = move.dest_parking_distance;
    destEntryType.value = move.dest_entry_type;
    destEntryChallenges.value = move.dest_entry_challenges || [];
    destAccessNotes.value = move.dest_access_notes;

    // Additional
    specialRequirements.value = move.special_requirements;
    estimatedSquareFootage.value = move.estimated_square_footage;
    useTruckRoute.value = move.use_truck_route;
    avoidTolls.value = move.avoid_tolls;

    // Set current saved move ID (convert to number for prop type matching)
    currentSavedMoveId.value = Number(moveId);
    saveMoveFormModel.value.name = move.name;

    // Check if costs are stale (older than 2 weeks)
    if (move.cost_calculations_stale) {
      Notify.create({
        type: 'info',
        message: 'Cost estimates are being recalculated',
        caption: 'Saved costs were more than 2 weeks old'
      });
      // Distance calculation will trigger automatically via watchers
    } else {
      // Use cached values
      estimatedDistance.value = move.estimated_distance_miles;
      routeData.value = move.route_data;
    }

    showLoadMoveDialog.value = false;

    Notify.create({
      type: 'positive',
      message: 'Move loaded successfully',
      icon: 'folder_open'
    });
  } catch (error) {
    console.error('Error loading move:', error);
    Notify.create({
      type: 'negative',
      message: 'Failed to load move'
    });
  }
};

// Delete a saved move
const deleteSavedMove = async (moveId: number, moveName: string) => {
  if (!props.user) return;

  // Confirm deletion
  if (!confirm(`Delete "${moveName}"? This cannot be undone.`)) {
    return;
  }

  try {
    const sessionToken = localStorage.getItem('session_token');
    if (!sessionToken) {
      throw new Error('No session token found. Please log in again.');
    }

    const response = await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/saved-moves/${moveId}`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${sessionToken}`
      }
    });

    if (!response.ok) throw new Error('Failed to delete move');

    Notify.create({
      type: 'positive',
      message: 'Move deleted successfully',
      icon: 'delete'
    });

    if (currentSavedMoveId.value === moveId) {
      currentSavedMoveId.value = null;
      saveMoveFormModel.value.name = '';
    }

    await fetchSavedMoves();
  } catch (error) {
    console.error('Error deleting move:', error);
    Notify.create({
      type: 'negative',
      message: 'Failed to delete move'
    });
  }
};

// Load saved moves on mount
watch(() => props.user, (newUser) => {
  if (newUser) {
    fetchSavedMoves();
  }
}, { immediate: true });

const downloadPdfEstimate = async () => {
  if (!estimatedDistance.value) {
    Notify.create({
      type: 'warning',
      message: 'Please select origin and destination locations first',
      timeout: 3000
    });
    return;
  }

  try {
    // Get all required data
    const origin = locationsWithDetails.value.find(l => l.value === originLocation.value);
    const destination = locationsWithDetails.value.find(l => l.value === destinationLocation.value);
    const costs = costEstimates.value;
    const distance = estimatedDistance.value;

    // Validate all required data is present
    if (!costs || !distance || !origin || !destination) {
      throw new Error('Missing required data for quote');
    }

    // Create PDF
    const doc = new jsPDF();
    let yPos = 20;

    // Helper function to add section header
    const addSectionHeader = (text: string) => {
      doc.setFontSize(14);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(25, 118, 210);
      doc.text(text, 15, yPos);
      yPos += 2;
      doc.setLineWidth(0.5);
      doc.setDrawColor(25, 118, 210);
      doc.line(15, yPos, 195, yPos);
      yPos += 8;
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(0, 0, 0);
    };

    // Load ReloPrep logo
    const logoUrl = 'https://storage.googleapis.com/widowmaker-site-images/reloprep_color.png';
    let logoData: string | null = null;
    try {
      logoData = await loadImageAsBase64(logoUrl);
    } catch (error) {
      console.warn('Failed to load logo:', error);
    }

    // Title and logo badge
    doc.setFontSize(20);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(25, 118, 210);
    doc.text('ReloPrep Moving Quote', 15, yPos);

    // ReloPrep logo in top right
    if (logoData) {
      try {
        doc.addImage(logoData, 'PNG', 160, yPos - 5, 35, 10);
      } catch (error) {
        console.warn('Failed to add logo to PDF:', error);
        // Fallback to text
        doc.setFontSize(9);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(100, 100, 100);
        doc.text('Prepared with ReloPrep', 195, yPos, { align: 'right' });
      }
    } else {
      // Fallback to text if logo didn't load
      doc.setFontSize(9);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(100, 100, 100);
      doc.text('Prepared with ReloPrep', 195, yPos, { align: 'right' });
    }

    yPos += 8;
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(100, 100, 100);
    doc.text(`Generated: ${new Date().toLocaleDateString()}`, 15, yPos);
    yPos += 12;

    // SECTION 1: MOVE DETAILS (matching Inventory PDF)
    addSectionHeader('Move Details');

    // Get full addresses from location objects
    const originAddress = origin.fullAddress;
    const destAddress = destination.fullAddress;

    // Calculate totals safely
    const totalWeight = Number(itemsInOriginLocation.value.reduce((sum, item) => sum + (Number(item.weight_lbs) || 0), 0));
    const totalVolume = Number(itemsInOriginLocation.value.reduce((sum, item) => {
      const dims = parseItemDimensions(item);
      if (!dims) return sum;
      return sum + (dims.length * dims.width * dims.height) / 1728;
    }, 0));

    const moveDetails = [
      ['Origin Address', originAddress],
      ['Destination Address', destAddress],
      ['Desired Move Window', moveDateRangeDisplay.value],
      ['Distance', `${distance.toLocaleString()} miles`],
      ['Total Items', itemsInOriginLocation.value.length.toString()],
      ['Total Weight', `${totalWeight.toFixed(0)} lbs`],
      ['Total Volume', `${totalVolume.toFixed(1)} cu ft`]
    ];

    autoTable(doc, {
      startY: yPos,
      head: [],
      body: moveDetails,
      theme: 'plain',
      styles: { fontSize: 10, cellPadding: 2 },
      columnStyles: {
        0: { fontStyle: 'bold', cellWidth: 60 },
        1: { cellWidth: 120 }
      }
    });

    yPos = (doc as any).lastAutoTable.finalY + 10;

    // SECTION 2: ORIGIN LOCATION DETAILS
    if (yPos > 250) {
      doc.addPage();
      yPos = 20;
    }

    addSectionHeader('Origin Location Details');

    const originAccessPara = buildAccessParagraph(
      entryType.value,
      numberOfFlights.value,
      hasElevator.value,
      elevatorType.value,
      parkingSituation.value,
      entryChallenges.value,
      accessNotes.value
    );

    doc.setFontSize(10);
    const splitOriginAccess = doc.splitTextToSize(originAccessPara, 180);
    doc.text(splitOriginAccess, 15, yPos);
    yPos += splitOriginAccess.length * 5 + 10;

    // SECTION 3: DESTINATION LOCATION DETAILS
    if (yPos > 250) {
      doc.addPage();
      yPos = 20;
    }

    addSectionHeader('Destination Location Details');

    const destAccessPara = buildAccessParagraph(
      destEntryType.value,
      destNumberOfFlights.value,
      destHasElevator.value,
      destElevatorType.value,
      destParkingSituation.value,
      destEntryChallenges.value,
      destAccessNotes.value
    );

    doc.setFontSize(10);
    const splitDestAccess = doc.splitTextToSize(destAccessPara, 180);
    doc.text(splitDestAccess, 15, yPos);
    yPos += splitDestAccess.length * 5 + 10;

    // SECTION 4: COMPLETE INVENTORY
    if (yPos > 240) {
      doc.addPage();
      yPos = 20;
    }

    addSectionHeader('Complete Inventory');

    const inventoryItems = itemsInOriginLocation.value.map(item => {
      const dims = parseItemDimensions(item);
      const size = dims ? `${dims.length}"×${dims.width}"×${dims.height}"` : 'N/A';
      const weight = item.weight_lbs ? `${item.weight_lbs} lbs` : 'N/A';
      const qty = item.quantity || 1;
      const desc = item.description || '';

      return [
        item.label || 'Unnamed',
        desc.substring(0, 40) + (desc.length > 40 ? '...' : ''),
        qty.toString(),
        size,
        weight,
        item.fragile ? 'Yes' : 'No'
      ];
    });

    autoTable(doc, {
      startY: yPos,
      head: [['Name', 'Description', 'Qty', 'Dimensions', 'Weight', 'Fragile']],
      body: inventoryItems,
      theme: 'striped',
      styles: { fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: [25, 118, 210], textColor: 255 },
      columnStyles: {
        0: { cellWidth: 35 },
        1: { cellWidth: 50 },
        2: { cellWidth: 15, halign: 'center' },
        3: { cellWidth: 35 },
        4: { cellWidth: 25 },
        5: { cellWidth: 20, halign: 'center' }
      }
    });

    yPos = (doc as any).lastAutoTable.finalY + 10;

    // SECTION 5: LOOSE ITEMS (with images)
    const looseItems = itemsInOriginLocation.value.filter(item =>
      Array.isArray(item.tags) && item.tags.some((tag: string) => tag.toLowerCase() === 'loose')
    );

    if (looseItems.length > 0) {
      if (yPos > 240) {
        doc.addPage();
        yPos = 20;
      }

      addSectionHeader('Loose Items (Furniture & Large Items)');

      // Display images in a grid (2 per row)
      let itemIndex = 0;
      for (const item of looseItems) {
        if (!item.picture_url) continue;

        const imageData = await loadImageAsBase64(item.picture_url);
        if (!imageData) continue;

        // Position in grid (2 columns)
        const col = itemIndex % 2;
        const xPos = 15 + (col * 90);

        // Check if we need a new page
        if (yPos > 220) {
          doc.addPage();
          yPos = 20;
        }

        // Add image (max 80x60)
        try {
          doc.addImage(imageData, 'PNG', xPos, yPos, 80, 60);

          // Add item name below image
          doc.setFontSize(8);
          doc.setFont('helvetica', 'bold');
          const itemName = (item.label || 'Unnamed').substring(0, 30);
          doc.text(itemName, xPos + 40, yPos + 65, { align: 'center' });

          // Add dimensions if available
          const dims = parseItemDimensions(item);
          if (dims) {
            doc.setFont('helvetica', 'normal');
            doc.setFontSize(7);
            doc.text(`${dims.length}"×${dims.width}"×${dims.height}"`, xPos + 40, yPos + 70, { align: 'center' });
          }

          doc.setFont('helvetica', 'normal');
        } catch (imgError) {
          console.warn('Failed to add image to PDF:', imgError);
        }

        // Move to next row after 2 items
        if (col === 1) {
          yPos += 75;
        }

        itemIndex++;
      }

      // Adjust yPos if we ended on first column
      if (itemIndex % 2 === 1) {
        yPos += 75;
      }

      yPos += 10;
    }

    // SECTION 6: QUOTE BREAKDOWN
    if (yPos > 200) {
      doc.addPage();
      yPos = 20;
    }

    addSectionHeader('ReloPrep Quote Breakdown');

    // ReloPrep All-In Quote (highlighted box)
    doc.setFillColor(227, 242, 253); // Light blue
    doc.rect(15, yPos, 180, 30, 'F');
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(25, 118, 210);
    doc.text('All-In Quote (Binding Not-to-Exceed)', 20, yPos + 10);
    doc.setFontSize(20);
    doc.text(`$${Math.round(costs.reloprep?.high || 0).toLocaleString()}`, 20, yPos + 22);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(100, 100, 100);
    doc.text('Includes moving, packing, materials, fuel, and all other costs', 20, yPos + 27);
    yPos += 38;

    doc.setTextColor(0, 0, 0);

    // Cost Breakdown - Market Rate Components
    const distanceMiles = distance;

    // Extract and round all cost components
    const movingLabor = Math.round(costs.professional?.movingOnly?.average || 0);
    const packingLabor = Math.round((costs.professional?.packing?.breakdown?.labor || 0));
    const fuelCost = Math.round(costs.diy?.breakdown?.fuel || 0);
    const materialsCost = Math.round(costs.professional?.packing?.breakdown?.materials || 0);

    // Calculate misc costs (tolls + hotels for long distance)
    const estimatedTolls = distanceMiles > 100 ? Math.round(distanceMiles * 0.15) : 0;
    const overnightStops = distanceMiles > 500 ? Math.ceil(distanceMiles / 500) - 1 : 0;
    const hotelCosts = overnightStops * 150;
    const miscCost = estimatedTolls + hotelCosts;

    // Calculate market subtotal
    const marketSubtotal = movingLabor + packingLabor + fuelCost + materialsCost + miscCost;

    // Calculate ReloPrep discount
    const reloprepQuote = Math.round(costs.reloprep?.high || 0);
    const discountAmount = marketSubtotal - reloprepQuote;
    const discountPercent = marketSubtotal > 0 ? Math.round((discountAmount / marketSubtotal) * 100) : 0;

    // Build cost breakdown table with assumptions
    const costBreakdown: [string, string][] = [];

    if (movingLabor > 0) {
      let assumption = '';
      let serviceLabel = '';
      if (distanceMiles < 100) {
        // Local move: show crew size, hours, and hourly rate
        serviceLabel = 'Moving Services';
        // Calculate CoL-adjusted hourly rate and round to nearest $5
        const baseHourlyRate = 150;
        const adjustedHourlyRate = Math.round((baseHourlyRate * colAdjustment.value) / 5) * 5;
        const totalHours = Math.round(costs.professional?.movingOnly?.average / adjustedHourlyRate);
        const crewSize = numHelpers.value;
        const daysNeeded = Math.ceil(totalHours / 8); // 8-hour workday
        assumption = `${crewSize} movers, ${daysNeeded} day${daysNeeded > 1 ? 's' : ''} (~${totalHours} hrs @ $${adjustedHourlyRate}/hr)`;
      } else {
        // Long distance: show weight, distance, and calculation method
        serviceLabel = 'Transportation & Moving Services';
        assumption = `${Math.round(totalWeightLbs.value).toLocaleString()} lbs, ${distanceMiles.toLocaleString()} mi`;
      }
      costBreakdown.push([`${serviceLabel}\n  ${assumption}`, `$${movingLabor.toLocaleString()}`]);
    }

    if (packingLabor > 0) {
      const packingHours = Math.round(costs.professional?.packing?.hours || 0);
      const packingLevel = costs.packingLevel || 'none';
      let packingDescription = '';

      if (packingLevel === 'full') {
        packingDescription = `~${packingHours} hrs full packing (boxes + furniture)`;
      } else if (packingLevel === 'partial') {
        packingDescription = `~${packingHours} hrs furniture protection only`;
      } else {
        packingDescription = `~${packingHours} hrs packing`;
      }

      costBreakdown.push([`Packing Labor\n  ${packingDescription}`, `$${packingLabor.toLocaleString()}`]);
    }

    if (fuelCost > 0) {
      costBreakdown.push([`Fuel\n  ${distanceMiles.toLocaleString()} mi one-way @ 8 mpg`, `$${fuelCost.toLocaleString()}`]);
    }

    if (materialsCost > 0) {
      const packingLevel = costs.packingLevel || 'none';
      let materialsDescription = '';

      if (packingLevel === 'full') {
        const boxCount = boxEstimates.value.total;
        materialsDescription = `${boxCount} boxes + furniture protection`;
      } else if (packingLevel === 'partial') {
        materialsDescription = 'Furniture pads, wrap, corner protectors';
      } else {
        const boxCount = boxEstimates.value.total;
        materialsDescription = `${boxCount} boxes + supplies`;
      }

      costBreakdown.push([`Packing Materials\n  ${materialsDescription}`, `$${materialsCost.toLocaleString()}`]);
    }

    if (miscCost > 0) {
      let miscDetail = '';
      if (estimatedTolls > 0) miscDetail += `$${estimatedTolls.toLocaleString()} tolls`;
      if (hotelCosts > 0) {
        if (miscDetail) miscDetail += ', ';
        miscDetail += `$${hotelCosts.toLocaleString()} hotels (${overnightStops} night${overnightStops > 1 ? 's' : ''})`;
      }
      costBreakdown.push([`Miscellaneous\n  ${miscDetail}`, `$${miscCost.toLocaleString()}`]);
    }

    autoTable(doc, {
      startY: yPos,
      head: [['Service', 'Market Rate']],
      body: costBreakdown,
      theme: 'striped',
      styles: { fontSize: 9, cellPadding: 3 },
      headStyles: { fillColor: [25, 118, 210], textColor: 255 },
      columnStyles: {
        0: { cellWidth: 120 },
        1: { cellWidth: 60, halign: 'right', fontStyle: 'bold' }
      }
    });

    yPos = (doc as any).lastAutoTable.finalY + 5;

    // Subtotal, Discount, and Final Total
    const summaryRows = [
      ['Market Rate Subtotal', `$${marketSubtotal.toLocaleString()}`],
      [`ReloPrep Discount (${discountPercent}%)`, `-$${discountAmount.toLocaleString()}`],
    ];

    autoTable(doc, {
      startY: yPos,
      head: [],
      body: summaryRows,
      theme: 'plain',
      styles: { fontSize: 10, cellPadding: 2 },
      columnStyles: {
        0: { cellWidth: 120, halign: 'right', fontStyle: 'bold' },
        1: { cellWidth: 60, halign: 'right', fontStyle: 'bold' }
      }
    });

    yPos = (doc as any).lastAutoTable.finalY + 2;

    // Final Total line
    doc.setLineWidth(0.5);
    doc.setDrawColor(25, 118, 210);
    doc.line(60, yPos, 180, yPos);
    yPos += 5;

    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(25, 118, 210);
    doc.text('Your ReloPrep Quote (Binding)', 60, yPos);
    doc.text(`$${Math.round(reloprepQuote).toLocaleString()}`, 180, yPos, { align: 'right' });
    yPos += 10;

    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(100, 100, 100);
    doc.text('All-inclusive, binding not-to-exceed price', 60, yPos);
    yPos += 15;

    // Quote Validity Disclaimer
    if (yPos > 240) {
      doc.addPage();
      yPos = 20;
    }

    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(0, 0, 0);
    doc.text('Quote Valid Upon Scheduling:', 15, yPos);
    yPos += 5;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(60, 60, 60);
    const disclaimerText = `These estimates are based on ${routeData.value.source === 'estimated' ? 'estimated' : 'calculated'} distances and current market rates. Quote is honored if scheduled within the next 10 business days, subject only to significant unforeseen circumstances (e.g., inaccessible roads, major inventory changes). Fuel surcharges may apply for moves scheduled 30+ days out.`;
    const splitDisclaimer = doc.splitTextToSize(disclaimerText, 180);
    doc.text(splitDisclaimer, 15, yPos);
    yPos += splitDisclaimer.length * 4 + 10;

    // SECTION 7: SPECIAL REQUIREMENTS / NOTES
    if (specialRequirements.value) {
      if (yPos > 250) {
        doc.addPage();
        yPos = 20;
      }

      addSectionHeader('Special Requirements');

      doc.setFontSize(10);
      const splitReq = doc.splitTextToSize(specialRequirements.value, 180);
      doc.text(splitReq, 15, yPos);
      yPos += splitReq.length * 5 + 10;
    }

    // Footer on all pages
    const pageCount = (doc as any).internal.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      doc.setFontSize(8);
      doc.setTextColor(150, 150, 150);
      doc.text(`Page ${i} of ${pageCount}`, 105, 285, { align: 'center' });
      doc.text('ReloPrep • For questions or to book: contact@reloprep.com', 105, 290, { align: 'center' });
    }

    // Save PDF
    doc.save(`ReloPrep-Quote-${new Date().toISOString().split('T')[0]}.pdf`);

    Notify.create({
      type: 'positive',
      message: 'Quote PDF downloaded successfully',
      caption: 'Complete quote with pricing breakdown',
      timeout: 3000
    });
  } catch (error) {
    console.error('Error generating PDF quote:', error);
    Notify.create({
      type: 'negative',
      message: 'Failed to generate quote',
      caption: 'Please make sure all move details are filled in',
      timeout: 3000
    });
  }
};

// Send confirmation email with PDF attachment
const sendConfirmationEmail = async (depositAmount: number, totalAmount: number) => {
  try {
    const origin = locationsWithDetails.value.find(l => l.value === originLocation.value);
    const destination = locationsWithDetails.value.find(l => l.value === destinationLocation.value);

    if (!origin || !destination || !userData.value?.email) {
      console.error('Missing required data for confirmation email');
      return;
    }

    const bookingData = {
      depositAmount,
      totalAmount,
      remainingBalance: totalAmount - depositAmount,
      origin: origin.label || 'Origin',
      destination: destination.label || 'Destination',
      moveDate: moveDate.value || 'TBD',
      userName: userData.value.name || ''
    };

    // Generate PDF as base64 for attachment
    // We'll generate the PDF and convert to base64
    const pdfDoc = await generateInventoryPdfDocument();
    const pdfBase64 = pdfDoc.output('datauristring').split(',')[1]; // Get base64 part only

    const response = await fetch(`${core_url}/reloprep/send-confirmation`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...getAuthHeaders()
      },
      body: JSON.stringify({
        email: userData.value.email,
        bookingData,
        pdfBase64
      })
    });

    const result = await response.json();

    if (result.success) {
      console.log('Confirmation email sent successfully');
    } else {
      console.error('Failed to send confirmation email:', result.error);
      Notify.create({
        type: 'warning',
        message: 'Email sending failed',
        caption: 'Your booking is confirmed, but we couldn\'t send the confirmation email. Please contact support.',
        timeout: 5000
      });
    }
  } catch (error) {
    console.error('Error sending confirmation email:', error);
    // Don't show error to user - email failure shouldn't block the booking
  }
};

// Helper function to generate PDF document (returns jsPDF instance instead of downloading)
const generateInventoryPdfDocument = async () => {
  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();

  // Title
  doc.setFontSize(20);
  doc.setFont('helvetica', 'bold');
  doc.text('Move Inventory', pageWidth / 2, 20, { align: 'center' });

  // Move Details
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  const origin = locationsWithDetails.value.find(l => l.value === originLocation.value);
  const destination = locationsWithDetails.value.find(l => l.value === destinationLocation.value);

  let yPos = 35;
  doc.text(`From: ${origin?.label || 'N/A'}`, 15, yPos);
  yPos += 7;
  doc.text(`To: ${destination?.label || 'N/A'}`, 15, yPos);
  yPos += 7;
  doc.text(`Move Date: ${moveDate.value || 'TBD'}`, 15, yPos);
  yPos += 7;
  doc.text(`Distance: ${estimatedDistance.value} miles`, 15, yPos);
  yPos += 10;

  // Inventory Table
  const inventoryData = containerValues.value.map(container => {
    const items = collectionValues.value.filter(c => c.container_id === container.id);
    return [
      container.name || 'Unnamed Container',
      items.length.toString(),
      items.map(i => i.name).join(', ') || 'No items'
    ];
  });

  autoTable(doc, {
    startY: yPos,
    head: [['Container', 'Items', 'Contents']],
    body: inventoryData,
    theme: 'grid',
    headStyles: { fillColor: [25, 118, 210] }
  });

  return doc;
};

// Initiate Stripe Checkout for ReloPrep booking
const initiateStripeCheckout = async () => {
  if (!estimatedDistance.value || !costEstimates.value) {
    Notify.create({
      type: 'warning',
      message: 'Please select origin and destination locations first',
      timeout: 3000
    });
    return;
  }

  const depositAmount = Math.round(costEstimates.value.reloprep.high * 0.15);
  const totalAmount = costEstimates.value.reloprep.high;

  // TODO: Integrate with Stripe Checkout
  // This is a placeholder for now
  console.log('Stripe Checkout Details:', {
    depositAmount,
    totalAmount,
    originLocation: originLocation.value,
    destinationLocation: destinationLocation.value,
    moveDate: moveDate.value
  });

  // Placeholder: Show confirmation dialog
  $q.dialog({
    title: 'Stripe Checkout (Placeholder)',
    message: `
      <div class="q-mb-md"><strong>ReloPrep Move Booking</strong></div>
      <div class="q-mb-sm">Total Move Cost: $${totalAmount.toLocaleString()}</div>
      <div class="q-mb-sm">Deposit (15%): $${depositAmount.toLocaleString()}</div>
      <div class="q-mb-md">Remaining Balance: $${(totalAmount - depositAmount).toLocaleString()}</div>
      <div class="text-caption text-grey-7">
        In production, this will redirect to Stripe Checkout.
        After payment, you'll be redirected to a confirmation page with:
        <ul class="q-mt-sm">
          <li>Move booking confirmation</li>
          <li>PDF download of your inventory</li>
          <li>Email receipt with PDF attached</li>
        </ul>
      </div>
    `,
    html: true,
    ok: {
      label: 'Simulate Payment Success',
      color: 'primary'
    },
    cancel: {
      label: 'Cancel',
      color: 'grey-7',
      flat: true
    }
  }).onOk(async () => {
    // Simulate successful payment
    Notify.create({
      type: 'positive',
      message: 'Payment Successful!',
      caption: 'Downloading your inventory PDF and sending confirmation email...',
      timeout: 4000,
      actions: [
        {
          label: 'Download PDF',
          color: 'white',
          handler: () => {
            downloadInventoryPdf();
          }
        }
      ]
    });

    // Send confirmation email
    await sendConfirmationEmail(depositAmount, totalAmount);

    // TODO: In production:
    // 1. Create Stripe checkout session via API
    // 2. Redirect to Stripe
    // 3. Handle webhook for successful payment
    // 4. Redirect back to confirmation page
    // 5. Store booking in database
  });
};

// Initiate Quote Shopping Service Checkout
const initiateQuoteShoppingCheckout = async () => {
  if (!estimatedDistance.value || !costEstimates.value) {
    Notify.create({
      type: 'warning',
      message: 'Please select origin and destination locations first',
      timeout: 3000
    });
    return;
  }

  // Show quote shopping modal using the component
  $q.dialog({
    component: QuoteShoppingModal,
    componentProps: {
      isPro: isPro.value
    }
  }).onOk(({ tier, price }: { tier: string; price: number }) => {
    // Show confirmation dialog
    $q.dialog({
      title: 'Confirm Your Order',
      message: `
        <div class="q-mb-md" style="font-size: 1.05rem;">
          <div style="margin-bottom: 12px;">
            <strong style="color: #3b82f6;">${tier.charAt(0).toUpperCase() + tier.slice(1)} Quote Shopping</strong>
          </div>
          <div style="margin-bottom: 8px;">
            <strong>Price:</strong> $${price}${isPro.value ? ' <span style="color: #10b981; font-weight: 600;">(Pro discount)</span>' : ''}
          </div>
          <div style="margin-bottom: 8px;">
            <strong>Move:</strong> ${originLocation.value?.nickname || 'Origin'} → ${destinationLocation.value?.nickname || 'Destination'}
          </div>
        </div>
        <div class="text-caption text-grey-7">
          <strong>What you'll receive:</strong>
          <ul class="q-mt-sm">
            <li>Instant service confirmation email</li>
            <li>Quotes delivered within the turnaround time</li>
            <li>Direct email support throughout the process</li>
          </ul>
          <div style="margin-top: 12px; font-style: italic;">
            In production, clicking below will redirect to secure Stripe checkout.
          </div>
        </div>
      `,
      html: true,
      ok: {
        label: 'Proceed to Checkout',
        color: 'primary'
      },
      cancel: {
        label: 'Go Back',
        flat: true
      }
    }).onOk(async () => {
      // Simulate successful payment
      const tierLabels: { [key: string]: { quotes: string | number; turnaround: string } } = {
        'basic': { quotes: 3, turnaround: '48 hours' },
        'premium': { quotes: 5, turnaround: '24 hours' },
        'white glove': { quotes: 'unlimited', turnaround: '12 hours' }
      };

      const tierInfo = tierLabels[tier];

      Notify.create({
        type: 'positive',
        message: 'Quote Shopping Service Activated!',
        caption: `We'll start shopping for quotes immediately. Expect ${tierInfo.quotes} quotes within ${tierInfo.turnaround}.`,
        timeout: 5000
      });

      // TODO: In production:
      // 1. Create Stripe checkout session via API with quote shopping service
      // 2. Include service tier and pricing
      // 3. After payment, generate confirmation PDF using pdfGenerator service
      // 4. Generate RFQ PDF for moving companies (mover-bidding type)
      // 5. Send RFQ to vetted moving companies
      // 6. Email customer with confirmation and service details
    }).onCancel(() => {
      // Reopen the pricing dialog
      initiateQuoteShoppingCheckout();
    });
  });
};

// Listen for plan preview changes
onMounted(() => {
  const handleStorage = (event: StorageEvent) => {
    if (event.key === 'plan_preview') {
      planPreviewOverride.value = (event.newValue as 'basic' | 'pro' | null) || null;
    }
  };
  const handleCustom = (event: Event) => {
    planPreviewOverride.value = ((event as CustomEvent).detail as 'basic' | 'pro' | null) || null;
  };
  window.addEventListener('storage', handleStorage);
  window.addEventListener('plan-preview-change', handleCustom);

  onUnmounted(() => {
    window.removeEventListener('storage', handleStorage);
    window.removeEventListener('plan-preview-change', handleCustom);
  });
});
</script>

<template>
  <div class="move-planning-container">
    <!-- Tab Navigation -->
    <div class="subnav">
      <q-btn-group flat class="pill-tabs">
        <q-btn
          flat
          dense
          no-caps
          :class="{ 'pill-tab-active': movePlanningTab === 'planning' }"
          class="pill-tab"
          label="Planning"
          @click="selectTab('planning')"
        />
        <q-btn
          flat
          dense
          no-caps
          :class="{ 'pill-tab-active': movePlanningTab === 'costs' }"
          class="pill-tab"
          label="Costs"
          @click="selectTab('costs')"
        />
        <q-btn
          flat
          dense
          no-caps
          :class="{ 'pill-tab-active': movePlanningTab === 'route' }"
          class="pill-tab"
          label="Route"
          @click="selectTab('route')"
        />
        <q-btn
          flat
          dense
          no-caps
          :class="{ 'pill-tab-active': movePlanningTab === 'moveday' }"
          class="pill-tab"
          label="Move Day"
          @click="selectTab('moveday')"
        />
      </q-btn-group>
    </div>

    <div class="move-planning-header q-pa-md">
      <div class="row items-center justify-between">
        <div>
          <h5 class="text-h5 text-primary q-my-none">{{ pageTitle }}</h5>
          <p class="text-caption text-grey-7 q-mt-xs">{{ pageSubtitle }}</p>
        </div>
        <div class="row q-gutter-sm">
          <q-btn
            flat
            dense
            color="primary"
            icon="add"
            label="New Move"
            @click="resetMoveForm"
          >
            <q-tooltip>Start a new move</q-tooltip>
          </q-btn>
          <q-btn
            flat
            dense
            color="primary"
            icon="folder_open"
            label="Load Move"
            @click="showLoadMoveDialog = true"
          >
            <q-badge v-if="savedMoves.length > 0" color="positive" floating>{{ savedMoves.length }}</q-badge>
            <q-tooltip>Load a previously saved move</q-tooltip>
          </q-btn>
          <q-btn
            flat
            dense
            color="primary"
            icon="save"
            label="Save Move"
            @click="showSaveMoveDialog = true"
            :disable="!originLocation || !destinationLocation"
          >
            <q-tooltip>Save current move planning details</q-tooltip>
          </q-btn>
        </div>
      </div>
    </div>

    <!-- Planning Tab -->
    <div v-if="movePlanningTab === 'planning'">
    <!-- Row 1: Move Details Card -->
    <div class="q-pa-md q-pb-none">
      <q-card flat bordered>
        <q-card-section>
          <div class="text-h6 text-primary q-mb-md">Move Details</div>
          <div class="row q-col-gutter-md">
            <div class="col-12 col-md-3">
              <q-input
                v-model="moveDate"
                label="Desired Start Date"
                outlined
                dense
                readonly
                clearable
                hint="Earliest date you can start loading"
                class="cursor-pointer"
              >
                <template v-slot:prepend>
                  <q-icon name="event" class="cursor-pointer" />
                </template>
                <q-popup-proxy ref="moveDatePopup" cover transition-show="scale" transition-hide="scale">
                  <q-date
                    v-model="moveDate"
                    mask="YYYY-MM-DD"
                    @update:model-value="moveDatePopup?.hide()"
                  />
                </q-popup-proxy>
              </q-input>
            </div>
            <div class="col-12 col-md-3">
              <q-input
                v-model="moveEndDate"
                label="Desired End Date"
                outlined
                dense
                readonly
                clearable
                hint="Latest date you need to finish unloading"
                class="cursor-pointer"
              >
                <template v-slot:prepend>
                  <q-icon name="event_available" class="cursor-pointer" />
                </template>
                <q-popup-proxy ref="moveEndDatePopup" cover transition-show="scale" transition-hide="scale">
                  <q-date
                    v-model="moveEndDate"
                    mask="YYYY-MM-DD"
                    @update:model-value="moveEndDatePopup?.hide()"
                  />
                </q-popup-proxy>
              </q-input>
            </div>
            <div class="col-12 col-md-3">
              <q-select
                v-model="timingFlexibility"
                :options="[
                  { label: 'Exact dates only', value: 'exact' },
                  { label: 'Flexible ±3 days', value: 'flexible_3days' },
                  { label: 'Flexible ±7 days', value: 'flexible_7days' }
                ]"
                option-label="label"
                option-value="value"
                emit-value
                map-options
                label="Date Flexibility"
                outlined
                dense
                hint="Flexibility can reduce costs for long-distance moves"
              >
                <template v-slot:prepend>
                  <q-icon name="date_range" />
                </template>
              </q-select>
            </div>
            <div class="col-12 col-md-2">
              <q-input
                v-model.number="numHelpers"
                type="number"
                label="Helpers"
                outlined
                dense
                :min="1"
                :max="10"
              >
                <template v-slot:prepend>
                  <q-icon name="group" />
                </template>
              </q-input>
            </div>
            <div class="col-12 col-md-4">
              <q-select
                v-model="packingServicesRequired"
                :options="[
                  { label: 'No Packing Services', value: 'none' },
                  { label: 'Partial Packing', value: 'partial' },
                  { label: 'Full Service', value: 'full' }
                ]"
                option-label="label"
                option-value="value"
                emit-value
                map-options
                label="Packing Services"
                outlined
                dense
              >
                <template v-slot:prepend>
                  <q-icon name="inventory" />
                </template>
              </q-select>
            </div>
            <div class="col-12">
              <q-input
                v-model="specialRequirements"
                label="Notes & Special Requirements"
                outlined
                dense
                type="textarea"
                rows="2"
                placeholder="Piano moving, antique furniture, white glove service, etc."
              >
                <template v-slot:prepend>
                  <q-icon name="notes" />
                </template>
              </q-input>
            </div>
          </div>
        </q-card-section>
      </q-card>

      <!-- Warnings Section -->
      <div v-if="moveWarnings.length > 0" class="q-mt-md">
        <q-banner
          v-for="(warning, index) in moveWarnings"
          :key="index"
          :class="{
            'bg-red-1 text-red-9': warning.severity === 'error',
            'bg-orange-1 text-orange-9': warning.severity === 'warning',
            'bg-blue-1 text-blue-9': warning.severity === 'info'
          }"
          dense
          rounded
          class="q-mb-sm"
        >
          <template v-slot:avatar>
            <q-icon
              :name="warning.severity === 'error' ? 'error' : warning.severity === 'warning' ? 'warning' : 'info'"
              :color="warning.severity === 'error' ? 'red' : warning.severity === 'warning' ? 'orange' : 'blue'"
            />
          </template>
          {{ warning.message }}
        </q-banner>
      </div>
    </div>

    <!-- Row 2: Locations Cards -->
    <div class="q-pa-md">
      <div class="row items-center justify-between q-mb-sm">
        <div class="text-h6 text-primary">Locations</div>
        <q-btn
          unelevated
          dense
          color="primary"
          icon="add_location_alt"
          label="Add Drop-Off"
          :disable="moveLocations.length >= 5"
          @click="addMoveLocation('intermediate')"
        >
          <q-tooltip v-if="moveLocations.length >= 5">Maximum 5 locations</q-tooltip>
          <q-tooltip v-else>Add another drop-off stop</q-tooltip>
        </q-btn>
      </div>

      <div class="locations-row">
        <div
          v-for="(loc, index) in moveLocations"
          :key="loc.id || index"
          :class="[
            'location-card-wrapper',
            {
              'location-start-wrapper': loc.role === 'origin',
              'location-dropoff-wrapper': loc.role === 'intermediate',
              'location-end-wrapper': loc.role === 'destination'
            }
          ]"
        >
          <q-card flat bordered class="location-card" :class="{ 'location-start': loc.role === 'origin', 'location-dropoff': loc.role === 'intermediate', 'location-end': loc.role === 'destination' }">
            <q-card-section class="q-pb-sm">
              <div class="row items-center justify-between q-mb-sm">
                <q-btn-toggle
                  v-model="loc.role"
                  toggle-color="primary"
                  text-color="grey-7"
                  :options="[
                    { value: 'origin', label: 'Starting', icon: 'trip_origin' },
                    { value: 'intermediate', label: 'Drop-off', icon: 'local_shipping' },
                    { value: 'destination', label: 'Final', icon: 'flag' }
                  ]"
                  dense
                  unelevated
                  rounded
                  size="sm"
                  class="location-role-toggle"
                />
                <q-btn
                  flat
                  dense
                  round
                  icon="close"
                  size="sm"
                  color="negative"
                  @click="removeMoveLocation(index)"
                  :disable="moveLocations.length <= 2"
                >
                  <q-tooltip>Remove location</q-tooltip>
                </q-btn>
              </div>

              <q-select
                v-model="loc.location"
                :options="locationsWithDetails"
                option-value="value"
                option-label="label"
                emit-value
                map-options
                label="Location"
                outlined
                dense
                use-input
                input-debounce="300"
              >
                <template v-slot:prepend>
                  <q-icon name="my_location" />
                </template>
              </q-select>
            </q-card-section>

            <q-expansion-item
              dense
              dense-toggle
              label="Access Details"
              header-class="text-caption text-grey-7"
              default-opened
            >
              <q-card-section class="q-pt-none">
                <div class="row q-col-gutter-sm">
                  <div class="col-6">
                    <q-select
                      v-model="loc.entryType"
                      :options="['House', 'Apartment', 'Office', 'Storage', 'Other']"
                      label="Entry Type"
                      outlined
                      dense
                      clearable
                    />
                  </div>
                  <div class="col-6">
                    <q-input
                      v-model.number="loc.numberOfFlights"
                      type="number"
                      label="Stair Flights"
                      outlined
                      dense
                      :min="0"
                      :max="10"
                    />
                  </div>
                  <div class="col-12">
                    <q-checkbox
                      v-model="loc.hasElevator"
                      label="Elevator available"
                      dense
                    />
                  </div>
                  <template v-if="loc.hasElevator">
                    <div class="col-6">
                      <q-select
                        v-model="loc.elevatorType"
                        :options="['Passenger', 'Freight', 'Service']"
                        label="Elevator Type"
                        outlined
                        dense
                        clearable
                      />
                    </div>
                    <div class="col-6">
                      <q-checkbox
                        v-model="loc.elevatorReservationRequired"
                        label="Needs reservation"
                        dense
                      />
                    </div>
                  </template>
                  <div class="col-6">
                    <q-select
                      v-model="loc.parkingSituation"
                      :options="['Street', 'Driveway', 'Loading Zone', 'Garage']"
                      label="Parking"
                      outlined
                      dense
                      clearable
                    />
                  </div>
                  <div class="col-6">
                    <q-input
                      v-model.number="loc.parkingDistance"
                      type="number"
                      label="Walk Distance (ft)"
                      outlined
                      dense
                      :min="0"
                    />
                  </div>
                  <div class="col-12">
                    <q-select
                      v-model="loc.entryChallenges"
                      :options="['Narrow Hallway', 'Long Carry', 'Tight Corners', 'Low Clearance', 'Gated']"
                      label="Challenges"
                      outlined
                      dense
                      multiple
                      use-chips
                    />
                  </div>
                  <div class="col-12">
                    <q-input
                      v-model="loc.accessNotes"
                      label="Access Notes"
                      outlined
                      dense
                      type="textarea"
                      rows="2"
                    />
                  </div>
                </div>
              </q-card-section>
            </q-expansion-item>
          </q-card>
        </div>
      </div>
    </div>

    <!-- Prompt to add locations -->
    <div v-if="moveLocations.length === 0" class="q-pa-md">
      <q-banner rounded class="bg-blue-1 text-primary">
        <template v-slot:avatar>
          <q-icon name="info" color="primary" size="lg" />
        </template>
        <div class="text-body1 text-weight-medium q-mb-xs">Get started with your move planning</div>
        <div class="text-body2">Add locations above to see truck recommendations, time estimates, and packing requirements for your move. You need at least an origin and destination.</div>
      </q-banner>
    </div>

    <!-- Show dashboard only when origin location is selected -->
    <div v-if="originLocation">

    <!-- Row 2: Truck Recommendation & Time Estimates -->
    <div class="truck-time-grid q-pa-md">
      <!-- Truck Sizing -->
      <q-card flat bordered class="content-card">
        <q-card-section>
          <div class="text-h6 text-primary q-mb-md">Truck Recommendation</div>
          <q-banner
            v-if="containerVolumeWarnings.length"
            dense
            rounded
            class="bg-warning text-white q-mb-md"
          >
            Missing box dimensions for:
            {{ containerVolumeWarnings.join(', ') }}.
            Add length/width/height to improve accuracy.
          </q-banner>

          <div class="truck-details">
            <div class="text-h4 text-weight-bold text-primary q-mb-xs">{{ truckRecommendation.size }}</div>
            <div class="text-subtitle1 text-grey-8 q-mb-sm">{{ truckRecommendation.description }}</div>
            <div class="text-body2 text-grey-7 q-mb-md">
              <q-icon name="home" size="xs" class="q-mr-xs" />
              {{ truckRecommendation.suitable }}
            </div>

            <div class="q-mb-sm">
              <div class="row items-center justify-between q-mb-xs">
                <span class="text-caption text-grey-7">Capacity Utilization</span>
                <span class="text-caption text-weight-bold">{{ truckRecommendation.utilization.toFixed(0) }}%</span>
              </div>
              <q-linear-progress
                :value="truckRecommendation.utilization / 100"
                :color="getUtilizationColor(truckRecommendation.utilization)"
                size="12px"
                rounded
              />
            </div>

            <q-banner v-if="truckRecommendation.utilization < 60" rounded class="bg-warning text-white q-mt-md">
              <template v-slot:avatar>
                <q-icon name="info" />
              </template>
              Low utilization - consider a smaller truck to save costs
            </q-banner>

            <q-banner v-else-if="truckRecommendation.utilization > 95" rounded class="bg-negative text-white q-mt-md">
              <template v-slot:avatar>
                <q-icon name="warning" />
              </template>
              Very tight fit - consider a larger truck or multiple trips
            </q-banner>
          </div>
        </q-card-section>
      </q-card>

      <!-- Time Estimates -->
      <q-card flat bordered class="content-card">
        <q-card-section>
          <div class="text-h6 text-primary q-mb-md">Time Estimates</div>
          <div class="text-caption text-grey-6 q-mb-sm">Based on {{ numHelpers }} helper{{ numHelpers > 1 ? 's' : '' }}</div>
          <div v-if="fullTimeEstimates.intermediateStops > 0" class="text-caption text-orange q-mb-md">
            +{{ fullTimeEstimates.overheadPercent }}% overhead for {{ fullTimeEstimates.intermediateStops }} drop-off{{ fullTimeEstimates.intermediateStops > 1 ? 's' : '' }}
          </div>

          <div class="time-breakdown-horizontal">
            <div class="time-item-horizontal">
              <q-icon name="inventory" size="sm" color="primary" class="q-mb-xs" />
              <div class="text-body1 text-weight-medium">{{ fullTimeEstimates.packing }} hrs</div>
              <div class="text-caption text-grey-7">Packing</div>
            </div>

            <q-separator vertical class="time-separator" />

            <div class="time-item-horizontal">
              <q-icon name="publish" size="sm" color="secondary" class="q-mb-xs" />
              <div class="text-body1 text-weight-medium">{{ fullTimeEstimates.loading }} hrs</div>
              <div class="text-caption text-grey-7">Loading</div>
            </div>

            <q-separator vertical class="time-separator" />

            <div v-if="fullTimeEstimates.driving > 0" class="time-item-horizontal">
              <q-icon name="directions_car" size="sm" color="info" class="q-mb-xs" />
              <div class="text-body1 text-weight-medium">{{ fullTimeEstimates.driving }} hrs</div>
              <div class="text-caption text-grey-7">Driving</div>
            </div>

            <q-separator v-if="fullTimeEstimates.driving > 0" vertical class="time-separator" />

            <div class="time-item-horizontal">
              <q-icon name="get_app" size="sm" color="accent" class="q-mb-xs" />
              <div class="text-body1 text-weight-medium">{{ fullTimeEstimates.unloading }} hrs</div>
              <div class="text-caption text-grey-7">Unloading</div>
            </div>

            <q-separator vertical class="time-separator" />

            <div class="time-item-horizontal total-time-horizontal">
              <q-icon name="schedule" size="sm" color="positive" class="q-mb-xs" />
              <div class="text-h6 text-positive">{{ fullTimeEstimates.total }} hrs</div>
              <div class="text-caption text-grey-7">Total</div>
            </div>
          </div>
        </q-card-section>
      </q-card>
    </div>

    <!-- Row 3: Packing Status | Packing Materials | Special Handling -->
    <div class="packing-grid q-pa-md">
      <!-- Box Requirements Summary -->
      <q-card flat bordered class="content-card">
        <q-card-section>
          <div class="text-h6 text-primary q-mb-md">Packing Status</div>

          <q-banner class="bg-blue-1 text-primary q-mb-md">
            <template v-slot:avatar>
              <q-icon name="info" color="primary" />
            </template>
            <div class="text-body2">
              Generate boxes at the collection level for better organization by room.
            </div>
          </q-banner>

          <div class="box-list">
            <div class="box-item">
              <div class="row items-center justify-between">
                <div>
                  <div class="text-body1 text-weight-medium">Current Boxes</div>
                  <div class="text-caption text-grey-6">Boxes already in inventory</div>
                </div>
                <div class="text-h6 text-primary">{{ currentBoxCount }}</div>
              </div>
            </div>

            <q-separator class="q-my-sm" />

            <div class="box-item">
              <div class="row items-center justify-between">
                <div>
                  <div class="text-body1 text-weight-medium">Loose Items</div>
                  <div class="text-caption text-grey-6">Items not yet in containers</div>
                </div>
                <div class="text-h6 text-warning">{{ looseItemsCount }}</div>
              </div>
            </div>

            <q-separator class="q-my-sm" />

            <div class="box-item">
              <div class="row items-center justify-between">
                <div>
                  <div class="text-body1 text-weight-medium">Estimated Additional Boxes</div>
                  <div class="text-caption text-grey-6">For remaining loose items</div>
                </div>
                <div class="text-h6 text-secondary">{{ boxEstimates.total }}</div>
              </div>
            </div>

            <q-separator class="q-my-md" />

            <div class="box-item total-boxes">
              <div class="row items-center justify-between">
                <div class="text-subtitle1 text-weight-bold">Anticipated Total Boxes</div>
                <div class="text-h5 text-positive">{{ currentBoxCount + boxEstimates.total }}</div>
              </div>
            </div>
          </div>
        </q-card-section>
      </q-card>

      <!-- Packing Materials -->
      <q-card flat bordered class="content-card packing-materials-card">
        <q-card-section class="packing-materials-section">
          <div class="text-h6 text-primary q-mb-md">Packing Materials</div>

          <q-list dense>
            <q-item v-for="(material, key) in packingMaterials" :key="key" class="q-px-none">
              <q-item-section avatar>
                <q-icon :name="material.icon" color="primary" />
              </q-item-section>
              <q-item-section>
                <q-item-label>{{ material.name }}</q-item-label>
                <q-item-label caption>{{ material.unit }}</q-item-label>
              </q-item-section>
              <q-item-section side>
                <q-badge color="primary" :label="material.quantity" />
              </q-item-section>
            </q-item>
          </q-list>
        </q-card-section>
      </q-card>

      <!-- Special Handling -->
      <q-card flat bordered class="content-card special-handling-card">
        <q-card-section>
          <div class="text-h6 text-primary q-mb-md">Special Handling</div>

          <div class="special-items-grid">
            <div class="special-item">
              <q-icon name="warning" size="lg" color="orange" />
              <div class="text-h6 q-mt-sm">{{ specialItems.fragile }}</div>
              <div class="text-caption text-grey-7">Fragile Items</div>
            </div>

            <div class="special-item">
              <q-icon name="fitness_center" size="lg" color="negative" />
              <div class="text-h6 q-mt-sm">{{ specialItems.heavy }}</div>
              <div class="text-caption text-grey-7">Heavy Items (50+ lbs)</div>
            </div>

            <div class="special-item">
              <q-icon name="photo_size_select_large" size="lg" color="secondary" />
              <div class="text-h6 q-mt-sm">{{ specialItems.oversized }}</div>
              <div class="text-caption text-grey-7">Oversized Items</div>
            </div>

            <div class="special-item">
              <q-icon name="star" size="lg" color="positive" />
              <div class="text-h6 q-mt-sm">{{ specialItems.highValue }}</div>
              <div class="text-caption text-grey-7">High Value ($500+)</div>
            </div>

            <div class="special-item">
              <q-icon name="build" size="lg" color="info" />
              <div class="text-h6 q-mt-sm">{{ specialItems.disassemblyRequired }}</div>
              <div class="text-caption text-grey-7">Disassembly Required</div>
            </div>

            <div class="special-item">
              <q-icon name="thermostat" size="lg" color="accent" />
              <div class="text-h6 q-mt-sm">{{ specialItems.climateSensitive }}</div>
              <div class="text-caption text-grey-7">Climate Sensitive</div>
            </div>
          </div>
        </q-card-section>
      </q-card>
    </div>

    </div><!-- Close v-if="originLocation" -->
    </div><!-- Close Planning Tab -->

    <!-- Costs & Route Tab -->
    <!-- Costs Tab -->
    <div v-else-if="movePlanningTab === 'costs'">
      <div v-if="estimatedDistance" class="costs-grid q-pa-md">
        <!-- Left Column: Cost Breakouts -->
        <div class="costs-breakouts">
          <!-- DIY Move -->
          <div class="cost-section cost-section-diy">
            <div class="text-overline text-black text-weight-bold" style="margin-bottom: 5px;">DIY MOVE</div>
            <div class="text-caption text-grey-6 q-mb-sm">
              For the most cost-effective option, you handle everything: renting equipment from providers like U-Haul or PODS, driving the truck, and doing all the packing, loading, and unloading yourself.
              <q-btn flat dense no-caps size="sm" color="primary" @click="showDiyDetails = !showDiyDetails" :label="showDiyDetails ? 'Hide details' : 'Show details'" class="q-ml-xs" />
            </div>
            <div class="cost-total" style="margin-bottom: 15px;">
              ${{ costEstimates.diy.total.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 }) }}
            </div>
            <q-slide-transition>
              <div v-show="showDiyDetails" class="cost-breakdown">
                <div class="cost-line-item">
                  <span>Truck rental <span class="text-grey-8">({{ costEstimates.diy.breakdown.days }} day{{ costEstimates.diy.breakdown.days > 1 ? 's' : '' }})</span></span>
                  <span class="cost-value">${{ costEstimates.diy.breakdown.truckRental.toFixed(0) }}</span>
                </div>
             

                <div class="cost-line-item">
                  <span>Fuel</span>
                  <span class="cost-value">${{ costEstimates.diy.breakdown.fuel.toFixed(0) }}</span>
                </div>

                <div class="cost-line-item">
                  <span>Packing materials & equipment</span>
                  <span class="cost-value">${{ (costEstimates.diy.breakdown.materials + costEstimates.diy.breakdown.equipment).toFixed(0) }}</span>
                </div>

                <div v-if="costEstimates.diy.breakdown.tolls > 0" class="cost-line-item">
                  <span>Tolls</span>
                  <span class="cost-value">${{ costEstimates.diy.breakdown.tolls.toFixed(0) }}</span>
                </div>

                <div v-if="costEstimates.diy.breakdown.hotels > 0" class="cost-line-item">
                  <span>Hotels</span>
                  <span class="cost-value">${{ costEstimates.diy.breakdown.hotels.toFixed(0) }}</span>
                </div>
              </div>
            </q-slide-transition>
          </div>

          <!-- Dotted Separator -->
          <div class="cost-separator"></div>

          <!-- Professional Movers (Dedicated) -->
          <div class="cost-section cost-section-professional">
            <div class="row items-center justify-between" style="margin-bottom: 5px;">
              <div class="text-overline text-black text-weight-bold">DEDICATED MOVERS</div>
            </div>

            <div class="text-caption text-grey-6 q-mb-sm">
              A professional moving company provides a dedicated truck and crew just for your belongings, ensuring a fixed schedule and direct transport from origin to destination.
              <q-btn flat dense no-caps size="sm" color="primary" @click="showDedicatedDetails = !showDedicatedDetails" :label="showDedicatedDetails ? 'Hide details' : 'Show details'" class="q-ml-xs" />
            </div>

            <!-- Dedicated Movers -->
            <div class="professional-tier">
              <div class="cost-total" style="margin-bottom: 15px;">
                ${{ costEstimates.professional.dedicated.low.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 }) }} -
                ${{ costEstimates.professional.dedicated.high.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 }) }}
              </div>
              <q-slide-transition>
                <div v-show="showDedicatedDetails" class="cost-breakdown">
                  <div class="cost-line-item">
                    <span>Labor & Transport</span>
                    <span class="cost-value">${{ costEstimates.professional.movingOnly.low.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 }) }} -
                    ${{ costEstimates.professional.movingOnly.high.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 }) }}</span>
                  </div>

                  <div v-if="costEstimates.professional.packing.low > 0" class="cost-line-item">
                    <span>Packing Services</span>
                    <span class="cost-value">${{ costEstimates.professional.packing.low.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 }) }} -
                    ${{ costEstimates.professional.packing.high.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 }) }}</span>
                  </div>

                  <div v-if="costEstimates.professional.difficulty.origin.stairs > 0" class="cost-line-item">
                    <span>Potential fee: Origin stairs</span>
                    <span class="cost-value">${{ costEstimates.professional.difficulty.origin.stairs.toFixed(0) }}</span>
                  </div>

                  <div v-if="costEstimates.professional.difficulty.origin.elevator > 0" class="cost-line-item">
                    <span>Potential fee: No elevator at origin</span>
                                       <span class="cost-value">${{ costEstimates.professional.difficulty.origin.elevator.toFixed(0) }}</span>
                  </div>

                  <div v-if="costEstimates.professional.difficulty.origin.parking > 0" class="cost-line-item">
                    <span>Potential fee: Long carry at origin</span>
                    <span class="cost-value">${{ costEstimates.professional.difficulty.origin.parking.toFixed(0) }}</span>
                  </div>

                  <div v-if="costEstimates.professional.difficulty.destination.stairs > 0" class="cost-line-item">
                    <span>Potential fee: Destination stairs</span>
                    <span class="cost-value">${{ costEstimates.professional.difficulty.destination.stairs.toFixed(0) }}</span>
                  </div>

                  <div v-if="costEstimates.professional.difficulty.destination.elevator > 0" class="cost-line-item">
                    <span>Potential fee: No elevator at destination</span>
                    <span class="cost-value">${{ costEstimates.professional.difficulty.destination.elevator.toFixed(0) }}</span>
                  </div>

                  <div v-if="costEstimates.professional.difficulty.destination.parking > 0" class="cost-line-item">
                    <span>Potential fee: Long carry at destination</span>
                    <span class="cost-value">${{ costEstimates.professional.difficulty.destination.parking.toFixed(0) }}</span>
                  </div>

                  <div v-if="costEstimates.professional.multiStop.premium > 0" class="cost-line-item">
                    <span>Potential fee: Multi-stop service ({{ costEstimates.professional.multiStop.stops }} stop{{ costEstimates.professional.multiStop.stops > 1 ? 's' : '' }})</span>
                    <span class="cost-value">${{ costEstimates.professional.multiStop.premium.toFixed(0) }}</span>
                  </div>

                  <div class="cost-line-item">
                    <span>Est. cost per box or medium-sized item not in inventory</span>
                    <span class="cost-value">${{ costEstimates.professional.additionalBoxCost.low }} - ${{ costEstimates.professional.additionalBoxCost.high }}</span>
                  </div>

                  <div class="cost-line-item">
                    <span>Est. cost for furniture assembly/disassembly</span>
                    <span class="cost-value">${{ costEstimates.professional.furnitureAssembly.low }} - ${{ costEstimates.professional.furnitureAssembly.high }}</span>
                  </div>
                </div>
              </q-slide-transition>
            </div>
          </div>

          <!-- Dotted Separator -->
          <div v-if="costEstimates.professional.vanLine.available" class="cost-separator"></div>

          <!-- Van Lines -->
          <div v-if="costEstimates.professional.vanLine.available" class="cost-section cost-section-vanline">
            <div class="text-overline text-black text-weight-bold" style="margin-bottom: 5px;">VAN LINES</div>

            <div class="text-caption text-grey-6 q-mb-sm">
              Your items are transported on a large, shared truck with other moves. This is a budget-friendly option for long-distance moves if you have a flexible delivery window.
              <q-btn flat dense no-caps size="sm" color="primary" @click="showVanLineDetails = !showVanLineDetails" :label="showVanLineDetails ? 'Hide details' : 'Show details'" class="q-ml-xs" />
            </div>

            <div class="professional-tier">
              <div class="cost-total q-mb-xs">
                ${{ costEstimates.professional.vanLine.low.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 }) }} -
                ${{ costEstimates.professional.vanLine.high.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 }) }}
              </div>
              
              <q-slide-transition>
                <div v-show="showVanLineDetails" class="cost-breakdown q-mt-sm">
                  <div class="cost-line-item">
                    <span>Chargeable Weight <q-icon name="help" size="xs" color="grey-6"><q-tooltip>Greater of actual weight or 7 lbs/cu ft</q-tooltip></q-icon></span>
                    <span class="cost-value">{{ Math.round(costEstimates.professional.vanLine.chargeableWeight).toLocaleString() }} lbs</span>
                  </div>
                  <div class="cost-line-item">
                    <span>Delivery Window</span>
                    <span class="cost-value">{{ costEstimates.professional.vanLine.deliveryWindow }}</span>
                  </div>
                  <div class="cost-line-item text-grey-7">
                    <span>Includes Fuel Surcharge</span>
                    <span class="cost-value">${{ Math.round(costEstimates.professional.vanLine.breakdown.fuelSurcharge).toLocaleString() }}</span>
                  </div>
                  <div class="cost-line-item text-grey-7">
                    <span>Includes Destination Labor</span>
                    <span class="cost-value">${{ Math.round(costEstimates.professional.vanLine.breakdown.destinationLabor).toLocaleString() }}</span>
                  </div>
                  <div v-if="costEstimates.professional.vanLine.breakdown.shuttleFee > 0" class="cost-line-item text-grey-7">
                    <span>Includes Shuttle/Access Fee</span>
                    <span class="cost-value">${{ Math.round(costEstimates.professional.vanLine.breakdown.shuttleFee).toLocaleString() }}</span>
                  </div>
                </div>
              </q-slide-transition>
            </div>
          </div>

          <!-- Download Inventory Button -->
          <div class="q-mt-md">
            <q-btn
              v-if="isPro"
              flat
              color="primary"
              icon="download"
              label="Share your inventory with movers (Download PDF)"
              class="full-width"
              @click="downloadInventoryPdf"
            />
            <q-btn
              v-else
              flat
              disable
              icon="lock"
              label="Share your inventory with movers (Download PDF)"
              class="full-width"
              color="grey-7"
            >
              <q-tooltip>Upgrade to Pro to download inventory PDF for quotes</q-tooltip>
            </q-btn>
          </div>
        </div>

        <!-- Right Column: ReloPrep Quote Card -->
        <div class="reloprep-quote-container">
          <q-card flat bordered class="reloprep-quote-card">
            <q-card-section class="text-center">
              <div class="text-h5 text-weight-bold text-primary q-mb-md">
                ReloPrep Estimated Quote
              </div>

              <div class="text-h3 text-weight-bold text-primary q-mb-md">
                ${{ costEstimates.reloprep.high.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 }) }}
              </div>

              <!-- Savings Badge -->
              <div class="savings-badge q-mb-lg">
                <q-icon name="savings" size="sm" class="q-mr-xs" />
                <span class="text-weight-bold">
                  Save ${{ costEstimates.reloprep.savings.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 }) }}
                </span>
                <span class="text-caption q-ml-xs">vs. market average</span>
              </div>

              <q-separator class="q-my-md" />

              <!-- Get Quotes Button -->
              <q-btn
                unelevated
                icon="search"
                label="Get Quotes ASAP"
                class="full-width q-mb-md download-quote-btn"
                size="lg"
                @click="initiateQuoteShoppingCheckout"
              >
                <q-tooltip>Have ReloPrep shop for the best quotes{{ isPro ? ' (Pro discount available)' : '' }}</q-tooltip>
              </q-btn>

              <!-- Quote Validity Note -->
              <div class="text-caption text-grey-6 q-mt-md text-left">
                <strong>Price Guarantee:</strong> ReloPrep connects you with a 
                licensed, vetted moving partner. With White Glove Service, this quoted price is guaranteed 
                based exclusively on the inventory detailed in your PDF and the 
                access conditions you described. Your deposit secures this 
                service and is ReloPrep's non-refundable brokerage fee. The 
                remaining balance for the move and any additional 
                charges—resulting from changes to inventory or access 
                conditions—are paid directly to the licensed moving partner 
                at the time of service.
              </div>

              
            </q-card-section>
          </q-card>
        </div>
      </div>

      <!-- Static Disclaimer -->
      <div v-if="estimatedDistance" class="q-pa-md">
        <q-card flat bordered class="bg-grey-1">
          <q-card-section class="q-pa-md">
            <div class="text-caption text-grey-8">
              <strong>Important:</strong> These prices are estimates for standard residential moves within the continental U.S. Final quotes may differ based on your exact inventory, building access (stairs, elevators, long walks), parking/permits, specialty items (pianos, safes, etc.), and any storage needed between homes.
            </div>
          </q-card-section>
        </q-card>
      </div>

      <!-- DIY Options Section -->
      <div v-if="estimatedDistance && diyOptions.length > 0" class="q-pa-md">
        <div class="text-h6 text-grey-8 q-mb-md">Looking to save more? DIY options</div>
        <div class="row q-col-gutter-md">
          <div v-for="option in diyOptions" :key="option.provider" class="col-12 col-md-6">
            <q-card flat bordered class="cursor-pointer" @click="window.open(option.url, '_blank')">
              <q-card-section>
                <div class="text-subtitle1 text-weight-bold text-primary q-mb-xs">
                  {{ option.label }}
                  <q-icon name="open_in_new" size="xs" class="q-ml-xs" />
                </div>
                <div class="text-caption text-grey-7 q-mb-sm">{{ option.provider }}</div>
                <div class="text-body2">{{ option.description }}</div>
                <div class="text-caption text-grey-6 q-mt-sm">
                  We may earn a referral fee if you book through this link. This doesn't change your price.
                </div>
              </q-card-section>
            </q-card>
          </div>
        </div>
      </div>

      <!-- Placeholder when no locations selected -->
      <div v-else class="q-pa-md">
        <div class="text-center text-grey-5 q-py-lg">
          <q-icon name="location_off" size="xl" />
          <div class="text-body2 q-mt-md">Select origin and destination locations</div>
          <div class="text-caption">to see cost estimates</div>
        </div>
      </div>
    </div>

    <!-- Route Planning Tab -->
    <div v-else-if="movePlanningTab === 'route'">
      <div class="q-pa-md">
      <q-card flat bordered class="content-card">
        <q-card-section class="q-pb-none">
          <div class="text-h5 text-weight-bold q-mb-md">
            Distance & Route
          </div>
        </q-card-section>

        <q-card-section v-if="estimatedDistance && routeData" class="q-pt-sm">
          <!-- Map with Waypoints Overlay -->
          <div class="route-map-wrapper">
            <!-- The Map -->
            <div class="route-map-container">
              <RouteMap
                v-if="routeData.route_polyline"
                :route-polyline="routeData.route_polyline"
                :origin-address="routeData.origin_address"
                :destination-address="routeData.destination_address"
                :waypoints="journeyWaypoints"
                :dropoff-locations="intermediateDropoffLocations"
                height="500px"
              />

              <!-- Fallback Estimate Warning (when no polyline) -->
              <q-banner v-else-if="routeData.source === 'estimated'" dense class="bg-orange-1 text-warning">
                <template v-slot:avatar>
                  <q-icon name="warning" color="warning" />
                </template>
                <div v-for="(warning, idx) in routeData.warnings" :key="idx" class="text-caption">
                  {{ warning }}
                </div>
              </q-banner>
            </div>

            <!-- Waypoints Overlay Panel (positioned on map) -->
            <div v-if="currentSavedMoveId" class="waypoints-overlay">
              <WaypointManager
                ref="waypointManagerRef"
                :move-id="currentSavedMoveId"
                :route-polyline="routeData.route_polyline"
                :total-distance-miles="estimatedDistance"
                :destination-name="destinationDisplayName"
                @update="handleWaypointsUpdate"
                @route-updated="handleRouteUpdated"
              />
            </div>
          </div>

          <!-- Route Stats - Compact Cards Row -->
          <div class="route-stats-row q-mt-md">
            <div class="stat-card">
              <q-icon name="straighten" size="sm" color="primary" class="q-mb-xs" />
              <div class="stat-value text-primary">{{ roundedMiles?.toLocaleString() || estimatedDistance?.toLocaleString() || 0 }}</div>
              <div class="stat-label">miles</div>
            </div>
            <div class="stat-card">
              <q-icon name="schedule" size="sm" color="secondary" class="q-mb-xs" />
              <div class="stat-value text-secondary">{{ decimalHours || (routeData.duration_seconds ? (routeData.duration_seconds / 3600).toFixed(1) : '0.0') }}</div>
              <div class="stat-label">drive hrs</div>
            </div>
            <div v-if="routeData.estimated_tolls > 0" class="stat-card">
              <q-icon name="toll" size="sm" color="warning" />
              <div class="stat-value text-warning">${{ roundedTolls || routeData.estimated_tolls }}</div>
              <div class="stat-label">est. tolls</div>
            </div>
            <div v-if="routeData.overnight_stops > 0" class="stat-card">
              <q-icon name="hotel" size="sm" color="accent" />
              <div class="stat-value text-accent">{{ routeData.overnight_stops }}</div>
              <div class="stat-label">stops</div>
            </div>
          </div>


          <!-- Warnings -->
          <div v-if="routeData.warnings && routeData.warnings.length > 0" class="q-mt-md">
            <q-banner dense class="bg-orange-1 text-orange-9">
              <template v-slot:avatar>
                <q-icon name="warning" color="orange" />
              </template>
              <div v-for="(warning, idx) in routeData.warnings" :key="idx" class="text-caption">
                {{ warning }}
              </div>
            </q-banner>
          </div>

          <!-- Route Planning Actions - Outside Map -->
          <div v-if="currentSavedMoveId" class="route-actions-section q-mt-md">
            <!-- Generate Move Schedule Button -->
            <q-btn
              unelevated
              color="positive"
              icon="event_note"
              label="Generate Move Schedule"
              :loading="generatingSchedule"
              :disable="!canGenerateSchedule"
              @click="promptGenerateSchedule"
              class="full-width"
            >
              <q-tooltip v-if="!journeyWaypoints || journeyWaypoints.length === 0">
                Add waypoints and calculate route first
              </q-tooltip>
              <q-tooltip v-else-if="!hasScheduleAnchorDate">
                Add a move-out or move-in date in the Move Details card to enable scheduling
              </q-tooltip>
              <q-tooltip v-else>
                Create loading, driving, and unloading sessions from your planned route
              </q-tooltip>
            </q-btn>
            <div class="text-caption text-grey-7 q-mt-xs">
              Use the Waypoint Manager (on the map) to add stops, suggest waypoints, and calculate your optimized route.
              Then click "Generate Move Schedule" to create sessions.
            </div>
          </div>
        </q-card-section>

        <!-- Generate Schedule Confirmation Dialog -->
        <q-dialog v-model="showScheduleDialog">
          <q-card style="min-width: 500px">
            <q-card-section>
              <div class="text-h6">Generate Move Schedule</div>
              <div class="text-caption text-grey-7 q-mt-xs">
                Sessions will auto-schedule based on your route and move dates.
              </div>
            </q-card-section>

            <q-card-section class="q-pt-none">
              <p>This will create a complete move schedule with:</p>
              <ul class="q-ml-md">
                <li>1 loading session at origin</li>
                <li>{{ journeyWaypoints?.length || 0 }} driving session(s) between waypoints</li>
                <li>1 unloading session at destination</li>
              </ul>

              <div class="q-mt-md">
                <div class="text-subtitle2 q-mb-sm">Scheduling anchor</div>
                <q-banner dense class="bg-blue-1 text-primary">
                  <template v-slot:avatar>
                    <q-icon name="calendar_month" color="primary" />
                  </template>
                  Sessions will be anchored to your
                  {{ anchorDateType === 'move-out' ? 'move-out' : 'move-in' }} date
                  <span v-if="anchorDateDisplay"><strong>{{ anchorDateDisplay }}</strong></span>.
                </q-banner>
                <div class="row q-col-gutter-md q-mt-sm text-caption text-grey-7">
                  <div class="col-12 col-sm-6" v-if="moveDate">
                    <q-icon name="logout" size="16px" class="q-mr-xs" /> Move-out:
                    {{ formatDateLabel(moveDate) }}
                  </div>
                  <div class="col-12 col-sm-6" v-if="moveEndDate">
                    <q-icon name="login" size="16px" class="q-mr-xs" /> Move-in:
                    {{ formatDateLabel(moveEndDate) }}
                  </div>
                </div>
              </div>

              <p class="text-caption text-grey-7 q-mt-md">
                Sessions will be automatically scheduled with realistic spacing based on driving time and overnight stops.
                You can adjust individual session dates after generation.
              </p>
            </q-card-section>

            <q-card-actions align="right">
              <q-btn flat label="Cancel" color="grey" @click="showScheduleDialog = false" />
              <q-btn
                flat
                label="Generate Schedule"
                color="positive"
                :loading="generatingSchedule"
                :disable="generatingSchedule"
                @click="generateMoveSchedule(true)"
              />
            </q-card-actions>
          </q-card>
        </q-dialog>

        <!-- Placeholder when no locations selected -->
        <q-card-section
          v-if="!originLocation || !destinationLocation"
          class="text-center text-grey-5 q-py-lg"
        >
          <q-icon name="map" size="xl" />
          <div class="text-body2 q-mt-md">Select origin and destination locations</div>
          <div class="text-caption">to view route and distance</div>
        </q-card-section>
      </q-card>
      </div>
    </div>

    <!-- Move Day Tab -->
    <div v-else-if="movePlanningTab === 'moveday'">
      <div v-if="isPro" class="moveday-pro-wrapper">
        <DesktopMoveDay
          ref="moveDayRef"
          :user="user"
          :current-saved-move-id="currentSavedMoveId"
          :saved-moves="savedMoves"
          :origin-location="originLocation"
          :destination-location="destinationLocation"
          :move-date="moveDate"
          :move-date-end="moveEndDate"
          :recommended-truck-size="truckRecommendation.size"
        />
      </div>
      <div v-else class="moveday-locked q-pa-lg">
        <q-card flat bordered class="bg-blue-1">
          <q-card-section>
            <div class="row items-center q-gutter-md">
              <q-icon name="lock" color="primary" size="md" />
              <div>
                <div class="text-subtitle1 text-primary">Move Day Mode is a Pro feature</div>
                <div class="text-caption text-grey-7">Upgrade to unlock live scanning and tracking—or use admin preview to test.</div>
              </div>
            </div>
          </q-card-section>
        </q-card>
      </div>
    </div>

    <LocationEditorDialog
      v-model="showLocationDialog"
      mode="add"
      @save="handleLocationDialogSave"
    />

    <!-- New Move Dialog -->
    <q-dialog v-model="showNewMoveDialog">
      <q-card style="min-width: 480px; max-width: 620px">
        <q-card-section>
          <div class="text-h6">Start a New Move</div>
          <div class="text-caption text-grey-7 q-mt-xs">
            Choose your starting/ending locations and key dates to begin planning.
          </div>
        </q-card-section>

        <q-card-section class="q-pt-none">
          <div class="row q-col-gutter-md q-mb-md">
            <div class="col-12 col-md-6">
              <q-select
                v-model="newMoveForm.origin"
                :options="locationsWithDetails"
                option-value="value"
                option-label="label"
                emit-value
                map-options
                label="Starting location"
                outlined
                dense
                use-input
                input-debounce="0"
                clearable
              >
                <template v-slot:prepend>
                  <q-icon name="my_location" />
                </template>
              </q-select>
            </div>
            <div class="col-12 col-md-6">
              <q-select
                v-model="newMoveForm.destination"
                :options="locationsWithDetails"
                option-value="value"
                option-label="label"
                emit-value
                map-options
                label="Ending location"
                outlined
                dense
                use-input
                input-debounce="0"
                clearable
              >
                <template v-slot:prepend>
                  <q-icon name="flag" />
                </template>
              </q-select>
            </div>
          </div>

          <div class="row q-col-gutter-md">
            <div class="col-12 col-md-6">
              <q-input
                v-model="newMoveForm.moveOut"
                label="Move-out date"
                outlined
                dense
                readonly
                clearable
                class="cursor-pointer"
              >
                <template v-slot:prepend>
                  <q-icon name="event" class="cursor-pointer" />
                </template>
                <q-popup-proxy ref="newMoveOutPopup" cover transition-show="scale" transition-hide="scale">
                  <q-date
                    v-model="newMoveForm.moveOut"
                    mask="YYYY-MM-DD"
                    @update:model-value="newMoveOutPopup?.hide()"
                  />
                </q-popup-proxy>
              </q-input>
            </div>
            <div class="col-12 col-md-6">
              <q-input
                v-model="newMoveForm.moveIn"
                label="Move-in date"
                outlined
                dense
                readonly
                clearable
                class="cursor-pointer"
              >
                <template v-slot:prepend>
                  <q-icon name="event_available" class="cursor-pointer" />
                </template>
                <q-popup-proxy ref="newMoveInPopup" cover transition-show="scale" transition-hide="scale">
                  <q-date
                    v-model="newMoveForm.moveIn"
                    mask="YYYY-MM-DD"
                    @update:model-value="newMoveInPopup?.hide()"
                  />
                </q-popup-proxy>
              </q-input>
            </div>
          </div>

          <q-banner
            v-if="locationsWithDetails.length === 0"
            class="bg-orange-1 text-orange-8 q-mt-md"
            rounded
            dense
          >
            <q-icon name="info" class="q-mr-sm" />
            Add at least one location to your account to get started.
          </q-banner>

          <q-banner
            v-if="!newMoveFormReady"
            class="bg-orange-1 text-orange-8 q-mt-md"
            rounded
            dense
          >
            <q-icon name="info" class="q-mr-sm" />
            Select both locations and at least one date to start planning.
          </q-banner>
        </q-card-section>

        <q-card-actions align="right">
          <q-btn flat label="Cancel" color="grey-7" v-close-popup />
          <q-btn flat label="Start Planning" color="primary" @click="confirmNewMove" :disable="!newMoveFormReady" />
        </q-card-actions>
      </q-card>
    </q-dialog>

    <!-- Save Move Dialog -->
    <q-dialog v-model="showSaveMoveDialog">
      <q-card style="min-width: 400px">
        <q-card-section>
          <div class="text-h6">Save Move</div>
        </q-card-section>

        <q-card-section class="q-pt-none">
          <q-input
            v-model="saveMoveFormModel.name"
            label="Move Name"
            hint="e.g., 'Philadelphia to San Francisco - June 2025'"
            outlined
            dense
            autofocus
            @keyup.enter="saveMove"
          />
          <div class="text-caption text-grey-7 q-mt-md">
            This will save all your move details and cost calculations. Cost estimates remain valid for 2 weeks.
          </div>
        </q-card-section>

        <q-card-actions align="right">
          <q-btn flat label="Cancel" color="grey-7" v-close-popup />
          <q-btn flat label="Save" color="primary" @click="saveMove" :disable="!saveMoveFormModel.name.trim()" />
        </q-card-actions>
      </q-card>
    </q-dialog>

    <!-- Load Move Dialog -->
    <q-dialog v-model="showLoadMoveDialog">
      <q-card style="min-width: 500px; max-width: 600px">
        <q-card-section>
          <div class="text-h6">Load Move</div>
        </q-card-section>

        <q-card-section class="q-pt-none" style="max-height: 400px; overflow-y: auto">
          <div v-if="savedMoves.length === 0" class="text-center text-grey-6 q-pa-lg">
            <q-icon name="folder_open" size="48px" color="grey-5" />
            <div class="q-mt-md">No saved moves yet</div>
            <div class="text-caption">Save your first move to see it here</div>
          </div>

          <q-list v-else separator>
            <q-item
              v-for="move in savedMoves"
              :key="move.id"
              clickable
              v-ripple
              @click="loadMove(move.id)"
            >
              <q-item-section>
                <q-item-label>{{ move.name }}</q-item-label>
                <q-item-label caption>
                  {{ move.origin_location_name }} → {{ move.destination_location_name }}
                </q-item-label>
                <q-item-label caption class="text-grey-6">
                  <q-icon name="event" size="12px" class="q-mr-xs" /> {{ new Date(move.move_date).toLocaleDateString() }}
                  <span class="q-ml-sm">
                    <q-icon name="inventory_2" size="12px" class="q-mr-xs" /> {{ move.total_items }} items
                  </span>
                  <span class="q-ml-sm">
                    <q-icon name="straighten" size="12px" class="q-mr-xs" /> {{ move.estimated_distance_miles }} mi
                  </span>
                </q-item-label>
                <q-item-label caption class="text-grey-5">
                  Saved {{ new Date(move.updated_at).toLocaleDateString() }}
                </q-item-label>
              </q-item-section>

              <q-item-section side>
                <q-btn
                  flat
                  dense
                  round
                  icon="delete"
                  color="negative"
                  size="sm"
                  @click.stop="deleteSavedMove(move.id, move.name)"
                >
                  <q-tooltip>Delete this saved move</q-tooltip>
                </q-btn>
              </q-item-section>
            </q-item>
          </q-list>
        </q-card-section>

        <q-card-actions align="right">
          <q-btn flat label="Close" color="grey-7" v-close-popup />
        </q-card-actions>
      </q-card>
    </q-dialog>

  </div>
</template>

<style scoped>
.move-planning-container {
  max-width: 100%;
  background: #F7F8FA;
  min-height: 100vh;
}

.move-planning-header {
  background: white;
  border-bottom: 1px solid #E0E0E0;
}

.subnav {
  padding: 12px 24px;
  background: white;
}

.pill-tabs {
  background: #F0F2F5;
  border-radius: 8px;
  padding: 4px;
  display: inline-flex;
  gap: 4px;
}

.pill-tab {
  border-radius: 6px;
  padding: 6px 16px;
  transition: all 0.2s;
  color: #5F6368;
  font-weight: 500;
}

.pill-tab:hover {
  background: rgba(0, 0, 0, 0.05);
}

.pill-tab-active {
  background: white !important;
  color: #1976D2 !important;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12);
}

/* Row 2: Truck & Time Grid */
.truck-time-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 16px;
  margin-top: -8px;
  align-items: stretch;
}

.truck-time-grid > .content-card {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.truck-time-grid > .content-card > .q-card__section {
  flex: 1;
  display: flex;
  flex-direction: column;
}

/* Row 3: Packing Grid (Status, Materials, Special Handling) */
.packing-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16px;
  margin-top: -8px;
  align-items: stretch;
}

/* Costs Grid (2 columns: breakouts + quote card) */
.costs-grid {
  display: grid;
  grid-template-columns: 1fr 30vw;
  gap: 30px;
  align-items: start;
}

.costs-breakouts {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.cost-section {
  padding: 4px 0;
}

.cost-section-diy,
.cost-section-professional,
.cost-section-vanline {
  padding-left: 32px;
}

.cost-separator {
  border-top: 2px dotted #BDBDBD;
  margin: 4px 0;
  margin-left: 32px;
}

.cost-total {
  font-size: 22px;
  font-weight: 700;
  color: #212121;
  line-height: 1.0;
}

.cost-breakdown {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.cost-line-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  color: #616161;
  font-size: 14px;
  line-height: 1.2;
  padding: 3px;
}

.cost-line-item > span:first-child {
  flex: 1;
}

.cost-value {
  font-weight: 600;
  color: #424242;
  white-space: nowrap;
  margin-left: 16px;
  font-size: 12px;
}

.cost-line-subtext {
  font-size: 10px;
  color: #9E9E9E;
  margin-top: -1px;
  margin-left: 0;
  margin-bottom: 0;
}

.professional-tier {
  margin-bottom: 6px;
}

.tier-label {
  font-size: 11px;
  font-weight: 600;
  color: #757575;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.cost-premium-item {
  background: #FFF3E0;
  padding: 10px;
  border-radius: 6px;
  border-left: 3px solid #FF9800;
}

.premium-label {
  color: #E65100;
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 13px;
}

.premium-value {
  color: #E65100;
  font-weight: 700;
  font-size: 13px;
}

.premium-feature-notice {
  display: inline-flex;
  align-items: center;
  padding: 8px 12px;
  background: #F5F5F5;
  border-radius: 6px;
  border: 1px solid #E0E0E0;
  font-size: 12px;
}

.reloprep-quote-container {
  position: sticky;
  top: 24px;
}

.reloprep-quote-card {
  background: linear-gradient(135deg, #E3F2FD 0%, #FFFFFF 100%);
  border: 2px solid #1976D2 !important;
  box-shadow: 0 8px 24px rgba(25, 118, 210, 0.15) !important;
  border-radius: 12px !important;
  overflow: hidden;
}

.reloprep-quote-card .q-card__section {
  padding: 20px !important;
}

.savings-badge {
  background: linear-gradient(135deg, #4CAF50 0%, #45A049 100%);
  color: white;
  padding: 10px 16px;
  border-radius: 20px;
  display: inline-flex;
  align-items: center;
  box-shadow: 0 3px 10px rgba(76, 175, 80, 0.3);
  font-size: 0.9em;
}

/* Shimmer button effect (from onboarding) */
.download-quote-btn {
  box-shadow: 0 10px 24px rgba(39, 70, 144, 0.28);
  transition:
    transform 0.2s ease,
    box-shadow 0.2s ease;
  background: linear-gradient(135deg, #274690, #1ca1c1, #7dd3fc) !important;
  background-size: 240% 240%;
  animation: fabShimmer 2.8s ease-in-out infinite;
  position: relative;
  overflow: hidden;
  color: white !important;
  font-weight: 700;
  letter-spacing: 0.5px;
}

.download-quote-btn:hover {
  transform: scale(1.05);
  box-shadow: 0 12px 28px rgba(39, 70, 144, 0.32);
}

.download-quote-btn:active {
  transform: scale(0.96);
  box-shadow: 0 8px 18px rgba(39, 70, 144, 0.25);
}

@keyframes fabShimmer {
  0% {
    background-position: 0% 50%;
  }
  50% {
    background-position: 100% 50%;
    box-shadow: 0 12px 28px rgba(39, 70, 144, 0.34);
  }
  100% {
    background-position: 0% 50%;
  }
}

.download-quote-btn::after {
  content: "";
  position: absolute;
  inset: -12%;
  background:
    radial-gradient(
      10px 10px at 20% 30%,
      rgba(255, 255, 255, 0.6),
      transparent
    ),
    radial-gradient(
      6px 6px at 60% 40%,
      rgba(255, 255, 255, 0.4),
      transparent
    );
  opacity: 0.6;
  pointer-events: none;
}

/* Costs & Route Grid (2 columns) - Legacy */
.costs-route-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 16px;
  margin-top: -8px;
  align-items: stretch;
}

.costs-route-grid > .content-card {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.costs-route-grid > .content-card > .q-card__section {
  flex: 1;
  display: flex;
  flex-direction: column;
}

.packing-grid > .content-card {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.packing-grid > .content-card > .q-card__section {
  flex: 1;
  display: flex;
  flex-direction: column;
}

.content-card {
  background: white;
}

.truck-details {
  padding: 12px;
  background: #F7F8FA;
  border-radius: 8px;
}

/* Horizontal time breakdown */
.time-breakdown-horizontal {
  display: flex;
  align-items: stretch;
  justify-content: space-around;
  padding: 16px 8px;
  gap: 16px;
}

.time-item-horizontal {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  flex: 1;
  padding: 8px;
}

.time-separator {
  height: auto;
  align-self: stretch;
}

.total-time-horizontal {
  background: rgba(76, 175, 80, 0.05);
  border-radius: 8px;
}

/* Old vertical time breakdown (keeping for backwards compatibility) */
.time-breakdown {
  padding: 8px;
}

.time-item {
  padding: 8px 0;
}

.total-time {
  background: rgba(76, 175, 80, 0.05);
  padding: 12px;
  border-radius: 8px;
}

.box-list {
  padding: 8px 0;
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: space-evenly;
}

.box-item {
  padding: 12px 0;
}

.total-boxes {
  background: rgba(76, 175, 80, 0.05);
  padding: 12px;
  border-radius: 8px;
}

.special-items-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 16px;
  flex: 1;
  align-content: space-evenly;
}

.special-item {
  text-align: center;
  padding: 16px;
  background: #F7F8FA;
  border-radius: 8px;
}

/* Packing Materials Card - Match Packing Status Height */
.packing-materials-card .packing-materials-section {
  min-height: 250px;
  display: flex;
  flex-direction: column;
}

.packing-materials-card .q-item {
  padding: 12px 0;
  min-height: 56px;
}

.placeholder-card {
  opacity: 0.7;
}

.placeholder-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 32px;
  text-align: center;
}

/* Responsive Grid Layouts */
@media (max-width: 1200px) {
  .packing-grid {
    grid-template-columns: repeat(2, 1fr);
  }

  .special-items-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}

@media (max-width: 900px) {
  .truck-time-grid,
  .packing-grid,
  .costs-route-grid,
  .costs-grid {
    grid-template-columns: 1fr;
  }

  .reloprep-quote-container {
    position: static;
  }

  .special-items-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}

@media (max-width: 600px) {
  .special-items-grid {
    grid-template-columns: 1fr;
  }

}

/* Form Section Styling */
.form-section {
  margin-bottom: 8px;
}

.section-header {
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  font-size: 0.75rem;
  color: #274690;
  padding-bottom: 4px;
  border-bottom: 2px solid #E8EAF6;
}

/* Route Stats Styling */
.route-stats .stat-box {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px;
  background: #F7F8FA;
  border-radius: 8px;
  border: 1px solid #E0E0E0;
}

.route-map-wrapper {
  position: relative;
}


.route-map-container {
  border-radius: 8px;
  overflow: hidden;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

.waypoints-overlay {
  position: absolute;
  top: 12px;
  right: 12px;
  z-index: 10;
  max-width: 360px;
  max-height: calc(100% - 24px);
  overflow-y: auto;
  background: rgba(255, 255, 255, 0.95);
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
}

.waypoints-overlay :deep(.waypoint-manager) {
  padding: 12px;
  background: transparent;
}

.waypoints-overlay :deep(.text-subtitle1) {
  font-size: 14px;
}

.waypoints-overlay :deep(.waypoint-list) {
  max-height: 280px;
  overflow-y: auto;
}

/* Compact stat cards row below map */
.route-stats-row {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}

.stat-card {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 16px;
  background: #F7F8FA;
  border-radius: 8px;
  border: 1px solid #E0E0E0;
  flex: 1;
  min-width: 120px;
}

.stat-card .stat-value {
  font-size: 18px;
  font-weight: 600;
  line-height: 1.2;
}

.stat-card .stat-label {
  font-size: 11px;
  color: #666;
  line-height: 1.2;
}

@media (max-width: 768px) {
  .waypoints-overlay {
    position: relative;
    top: auto;
    right: auto;
    max-width: 100%;
    margin-top: 12px;
  }

  .stat-card {
    min-width: calc(50% - 6px);
    flex: 0 0 calc(50% - 6px);
  }
}

/* Locations row - full-width horizontal flex layout */
.locations-row {
  display: flex;
  flex-direction: row;
  gap: 12px;
  width: 100%;
}

.location-card-wrapper {
  flex: 1 1 0;
  min-width: 0; /* Allow cards to shrink below content size for equal distribution */
}
.location-card-wrapper.location-start-wrapper {
  order: 0;
}
.location-card-wrapper.location-dropoff-wrapper {
  order: 1;
}
.location-card-wrapper.location-end-wrapper {
  order: 2;
}

/* Location card styles */
.location-card {
  transition: border-color 0.2s, box-shadow 0.2s;
  border: 2px solid #e0e0e0;
  height: 100%;
}

.location-card.location-start {
  border-color: #4CAF50;
  background: linear-gradient(to bottom, #E8F5E9 0%, #fff 15%);
}

.location-card.location-dropoff {
  border-color: #FF9800;
  background: linear-gradient(to bottom, #FFF3E0 0%, #fff 15%);
}

.location-card.location-end {
  border-color: #F44336;
  background: linear-gradient(to bottom, #FFEBEE 0%, #fff 15%);
}

.location-role-toggle {
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  overflow: hidden;
}

.location-role-toggle .q-btn {
  font-size: 11px;
  padding: 4px 8px;
}

.location-role-toggle .q-btn--active {
  font-weight: 600;
}
</style>
