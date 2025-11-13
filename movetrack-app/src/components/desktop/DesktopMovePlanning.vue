<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { inventoryStore } from '../../stores/InventoryStore';
import { storeToRefs } from 'pinia';
import { Notify } from 'quasar';

const props = defineProps({
  user: String
});

const store = inventoryStore();
const { locationValues, collectionValues, containerValues } = storeToRefs(store);

// Move configuration
const originLocation = ref<string | null>(null);
const destinationLocation = ref<string | null>(null);
const moveDate = ref<string | null>(null);
const numHelpers = ref(2);

// Tab state
const movePlanningTab = ref<'planning' | 'costs'>('planning');

// Dialog states
const showAddLocationDialog = ref(false);
const newLocationName = ref('');
const newLocationAddress = ref('');

// Parse item dimensions helper
const parseItemDimensions = (item: any) => {
  if (item.length_in != null && item.width_in != null && item.height_in != null) {
    const length = Number(item.length_in);
    const width = Number(item.width_in);
    const height = Number(item.height_in);
    if (length && width && height) {
      return { length, width, height };
    }
  }
  if (item.dimensions) {
    const parts = item.dimensions.split('x').map((p: string) => Number(p.trim()));
    if (parts.length === 3 && !parts.some(isNaN)) {
      return { length: parts[0], width: parts[1], height: parts[2] };
    }
  }
  return null;
};

// Calculate total volume
const totalVolumeCuFt = computed(() => {
  return store.items.reduce((sum, item) => {
    const dims = parseItemDimensions(item);
    if (!dims) return sum;
    const volumeCubicInches = dims.length * dims.width * dims.height;
    const volumeCubicFeet = volumeCubicInches / 1728;
    const quantity = Number(item.quantity) || 1;
    return sum + (volumeCubicFeet * quantity);
  }, 0);
});

// Calculate total weight
const totalWeightLbs = computed(() => {
  return store.items.reduce((sum, item) => {
    const weight = Number(item.weight_lbs) || 0;
    const quantity = Number(item.quantity) || 1;
    return sum + (weight * quantity);
  }, 0);
});

// Total item count
const totalItems = computed(() => {
  return store.items.reduce((sum, item) => {
    return sum + (Number(item.quantity) || 1);
  }, 0);
});

// Count current boxes (containers that are box_size)
const currentBoxCount = computed(() => {
  return store.containers.filter(c => c.box_size).length;
});

// Count loose items (not in any container)
const looseItemsCount = computed(() => {
  return store.items.filter(i => !i.container || i.container === null).length;
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

// Density-based box estimates for LOOSE items only
const boxEstimates = computed(() => {
  // Only analyze loose (uncontained) items
  const looseItems = store.items.filter(i => !i.container || i.container === null);

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

// Packing materials estimate
const packingMaterials = computed(() => {
  const totalBoxes = boxEstimates.value.total;
  const fragileItems = store.items.filter(item => item.fragile).length;

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
    }
  };
});

// Special handling items
const specialItems = computed(() => {
  return {
    fragile: store.items.filter(item => item.fragile).length,
    heavy: store.items.filter(item => {
      const weight = Number(item.weight_lbs) || 0;
      return weight > 50;
    }).length,
    oversized: store.items.filter(item => {
      const dims = parseItemDimensions(item);
      if (!dims) return false;
      const maxDim = Math.max(dims.length, dims.width, dims.height);
      return maxDim > 48; // Over 4 feet
    }).length,
    highValue: store.items.filter(item => {
      const value = Number(item.estimated_value) || 0;
      return value > 500;
    }).length
  };
});

// Time estimates (industry standard: 3-4 hours per bedroom equivalent)
const timeEstimates = computed(() => {
  const itemCount = totalItems.value;
  const weight = totalWeightLbs.value;
  const helpers = numHelpers.value;

  // Base time: 1 item = 3 minutes average (packing/loading)
  const packingMinutes = itemCount * 3;
  const loadingMinutes = itemCount * 2;

  // Heavy items add extra time
  const heavyItems = specialItems.value.heavy;
  const heavyItemMinutes = heavyItems * 15; // 15 extra minutes per heavy item

  const totalMinutesPerPerson = packingMinutes + loadingMinutes + heavyItemMinutes;
  const totalMinutes = totalMinutesPerPerson / Math.max(helpers, 1);

  return {
    packing: Math.ceil(packingMinutes / 60 / Math.max(helpers, 1)),
    loading: Math.ceil((loadingMinutes + heavyItemMinutes) / 60 / Math.max(helpers, 1)),
    unloading: Math.ceil((loadingMinutes + heavyItemMinutes) * 0.8 / 60 / Math.max(helpers, 1)), // Unloading slightly faster
    total: Math.ceil(totalMinutes / 60)
  };
});

// Collection breakdown for move planning
const collectionBreakdown = computed(() => {
  return store.collections.map(collection => {
    const items = store.items.filter(item => item.collection === collection.value);
    const volume = items.reduce((sum, item) => {
      const dims = parseItemDimensions(item);
      if (!dims) return sum;
      return sum + (dims.length * dims.width * dims.height / 1728);
    }, 0);

    return {
      name: collection.label,
      itemCount: items.length,
      volume: volume,
      percentage: totalVolumeCuFt.value > 0 ? (volume / totalVolumeCuFt.value) * 100 : 0
    };
  }).filter(c => c.itemCount > 0).sort((a, b) => b.volume - a.volume);
});

// Get locations with address details
const locationsWithDetails = computed(() => {
  return store.locations.map(loc => ({
    value: loc.value,
    label: loc.label
  }));
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
const formatAddress = (location: any): string | null => {
  if (!location) return null;

  const parts = [];
  if (location.address) parts.push(location.address);
  if (location.city) parts.push(location.city);
  if (location.state) parts.push(location.state);
  if (location.zip) parts.push(location.zip);
  if (location.country) parts.push(location.country);

  return parts.length > 0 ? parts.join(', ') : null;
};

// Cache for distance calculations
const distanceCache = ref<Record<string, number>>({});

// Calculate distance between origin and destination using Google Maps Distance Matrix API
const estimatedDistance = ref<number | null>(null);
const isCalculatingDistance = ref(false);

const calculateDistance = async () => {
  if (!originLocation.value || !destinationLocation.value) {
    estimatedDistance.value = null;
    return;
  }

  const originLoc = store.locations.find(l => l.value === originLocation.value);
  const destLoc = store.locations.find(l => l.value === destinationLocation.value);

  if (!originLoc || !destLoc) {
    estimatedDistance.value = null;
    return;
  }

  const originAddress = formatAddress(originLoc);
  const destAddress = formatAddress(destLoc);

  if (!originAddress || !destAddress) {
    estimatedDistance.value = null;
    return;
  }

  // Check cache first
  const cacheKey = `${originAddress}|${destAddress}`;
  if (distanceCache.value[cacheKey]) {
    estimatedDistance.value = distanceCache.value[cacheKey];
    return;
  }

  try {
    isCalculatingDistance.value = true;

    // Call backend API to calculate distance
    const response = await fetch('/api/calculate-distance', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        origin: originAddress,
        destination: destAddress,
      }),
    });

    if (!response.ok) {
      throw new Error('Distance calculation request failed');
    }

    const data = await response.json();

    if (data.distance_miles) {
      // Cache the result
      distanceCache.value[cacheKey] = data.distance_miles;
      estimatedDistance.value = data.distance_miles;
    } else {
      console.warn('Distance calculation failed:', data);
      estimatedDistance.value = null;
    }
  } catch (error) {
    console.error('Error calculating distance:', error);
    estimatedDistance.value = null;
  } finally {
    isCalculatingDistance.value = false;
  }
};

// Watch for location changes and recalculate distance
watch([originLocation, destinationLocation], () => {
  calculateDistance();
});

// Cost estimates
const costEstimates = computed(() => {
  const weight = totalWeightLbs.value;
  const volume = totalVolumeCuFt.value;
  const distance = estimatedDistance.value || 0;
  const helpers = numHelpers.value;
  const totalHours = timeEstimates.value.total;

  // DIY Move Costs
  const truckRentalPerDay = distance > 100 ? 150 : 100; // Long distance vs local
  const daysNeeded = distance > 100 ? Math.ceil(distance / 500) + 1 : 1; // 500 miles/day for long distance
  const truckRental = truckRentalPerDay * daysNeeded;

  const fuelCostPerGallon = 4.50; // Average diesel
  const mpg = 8; // Typical moving truck MPG
  const fuel = (distance / mpg) * fuelCostPerGallon * 2; // Round trip

  const packingMaterialsCost = boxEstimates.value.total * 2.50; // $2.50 per box average
  const equipmentRental = 50; // Dolly, blankets, straps

  const diyTotal = truckRental + fuel + packingMaterialsCost + equipmentRental;

  // Professional Move Costs (industry averages, adjusted for cost of living)
  let professionalLow, professionalHigh;
  const colMultiplier = colAdjustment.value;

  if (distance < 100) {
    // Local move: hourly rate
    const hourlyRate = 120; // $120/hour for 2-person crew
    professionalLow = hourlyRate * totalHours * 0.9 * colMultiplier;
    professionalHigh = hourlyRate * totalHours * 1.3 * colMultiplier;
  } else {
    // Long distance: weight/volume based
    const costPerPound = 0.50; // Industry average
    const costPerCubicFoot = 7; // Industry average
    const weightBased = weight * costPerPound;
    const volumeBased = volume * costPerCubicFoot;
    const baseCost = Math.max(weightBased, volumeBased);

    professionalLow = baseCost * 0.8 * colMultiplier;
    professionalHigh = baseCost * 1.5 * colMultiplier;
  }

  // VeriMove estimate: 80-90% of market range
  const marketAverage = (professionalLow + professionalHigh) / 2;
  const veriMoveLow = marketAverage * 0.80;
  const veriMoveHigh = marketAverage * 0.90;

  return {
    diy: {
      total: diyTotal,
      breakdown: {
        truckRental,
        fuel,
        materials: packingMaterialsCost,
        equipment: equipmentRental,
        days: daysNeeded
      }
    },
    professional: {
      low: professionalLow,
      high: professionalHigh,
      average: marketAverage
    },
    veriMove: {
      low: veriMoveLow,
      high: veriMoveHigh,
      savings: marketAverage - ((veriMoveLow + veriMoveHigh) / 2)
    },
    comparison: {
      diyVsProfessional: ((marketAverage - diyTotal) / marketAverage) * 100,
      veriMoveVsProfessional: (((marketAverage - ((veriMoveLow + veriMoveHigh) / 2)) / marketAverage) * 100)
    }
  };
});

// Add new location
const addLocation = async () => {
  if (!newLocationName.value.trim()) {
    Notify.create({
      type: 'warning',
      message: 'Please enter a location name'
    });
    return;
  }

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
      newLocationName.value.trim(),
      '',
      newLocationAddress.value.trim(),
      '',
      '',
      '',
      ''
    );

    await store.loadInventory(props.user);

    Notify.create({
      type: 'positive',
      message: `Location "${newLocationName.value}" added successfully`
    });

    newLocationName.value = '';
    newLocationAddress.value = '';
    showAddLocationDialog.value = false;
  } catch (error) {
    Notify.create({
      type: 'negative',
      message: 'Failed to add location'
    });
  }
};

const requestOtherQuotes = () => {
  // Placeholder for future implementation
  // This would integrate with a moving quote aggregation service
  Notify.create({
    type: 'info',
    message: 'Quote request feature coming soon! This will connect you with multiple moving companies.',
    timeout: 3000
  });
};
</script>

<template>
  <div class="move-planning-container">
    <div class="move-planning-header q-pa-md">
      <h5 class="text-h5 text-primary q-my-none">Move Planning</h5>
      <p class="text-caption text-grey-7 q-mt-xs">Estimate materials, truck size, and timeline for your move</p>
    </div>

    <!-- Tab Navigation -->
    <div class="subnav">
      <q-btn-group flat>
        <q-btn
          flat
          dense
          no-caps
          :color="movePlanningTab === 'planning' ? 'primary' : 'grey-7'"
          label="Planning"
          @click="movePlanningTab = 'planning'"
        />
        <q-btn
          flat
          dense
          no-caps
          :color="movePlanningTab === 'costs' ? 'primary' : 'grey-7'"
          label="Costs & Route"
          @click="movePlanningTab = 'costs'"
        />
      </q-btn-group>
    </div>

    <!-- Planning Tab -->
    <div v-if="movePlanningTab === 'planning'">
    <!-- Move Configuration -->
    <div class="q-pa-md">
      <q-card flat bordered>
        <q-card-section>
          <div class="text-h6 text-primary q-mb-md">Move Details</div>
          <div class="row q-col-gutter-md">
            <div class="col-12 col-md-3">
              <q-select
                v-model="originLocation"
                :options="locationsWithDetails"
                option-value="value"
                option-label="label"
                emit-value
                map-options
                label="Origin Location"
                outlined
                dense
              >
                <template v-slot:prepend>
                  <q-icon name="location_on" />
                </template>
                <template v-slot:after>
                  <q-btn
                    round
                    dense
                    flat
                    icon="add"
                    color="primary"
                    @click="showAddLocationDialog = true"
                  >
                    <q-tooltip>Add new location</q-tooltip>
                  </q-btn>
                </template>
              </q-select>
            </div>
            <div class="col-12 col-md-3">
              <q-select
                v-model="destinationLocation"
                :options="locationsWithDetails"
                option-value="value"
                option-label="label"
                emit-value
                map-options
                label="Destination Location"
                outlined
                dense
              >
                <template v-slot:prepend>
                  <q-icon name="place" />
                </template>
                <template v-slot:after>
                  <q-btn
                    round
                    dense
                    flat
                    icon="add"
                    color="primary"
                    @click="showAddLocationDialog = true"
                  >
                    <q-tooltip>Add new location</q-tooltip>
                  </q-btn>
                </template>
              </q-select>
            </div>
            <div class="col-12 col-md-3">
              <q-input
                v-model="moveDate"
                type="date"
                label="Move Date"
                outlined
                dense
              >
                <template v-slot:prepend>
                  <q-icon name="event" />
                </template>
              </q-input>
            </div>
            <div class="col-12 col-md-3">
              <q-input
                v-model.number="numHelpers"
                type="number"
                label="Number of Helpers"
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
          </div>
        </q-card-section>
      </q-card>
    </div>

    <!-- Key Stats -->
    <div class="stats-grid q-pa-md">
      <q-card flat bordered class="stat-card">
        <q-card-section>
          <div class="row items-center q-mb-sm">
            <q-icon name="inventory_2" size="md" color="primary" />
            <span class="text-h6 text-primary q-ml-sm">{{ totalItems }}</span>
          </div>
          <div class="text-subtitle2 text-grey-8">Total Items</div>
          <div class="text-caption text-grey-6">To pack and move</div>
        </q-card-section>
      </q-card>

      <q-card flat bordered class="stat-card">
        <q-card-section>
          <div class="row items-center q-mb-sm">
            <q-icon name="view_in_ar" size="md" color="secondary" />
            <span class="text-h6 text-primary q-ml-sm">{{ totalVolumeCuFt.toFixed(1) }}</span>
          </div>
          <div class="text-subtitle2 text-grey-8">Cubic Feet</div>
          <div class="text-caption text-grey-6">Total volume</div>
        </q-card-section>
      </q-card>

      <q-card flat bordered class="stat-card">
        <q-card-section>
          <div class="row items-center q-mb-sm">
            <q-icon name="scale" size="md" color="accent" />
            <span class="text-h6 text-primary q-ml-sm">{{ totalWeightLbs.toFixed(0) }}</span>
          </div>
          <div class="text-subtitle2 text-grey-8">Pounds</div>
          <div class="text-caption text-grey-6">Total weight</div>
        </q-card-section>
      </q-card>

      <q-card flat bordered class="stat-card">
        <q-card-section>
          <div class="row items-center q-mb-sm">
            <q-icon name="local_shipping" size="md" color="positive" />
            <span class="text-h6 text-primary q-ml-sm">{{ truckRecommendation.size }}</span>
          </div>
          <div class="text-subtitle2 text-grey-8">Truck Size</div>
          <div class="text-caption text-grey-6">Recommended</div>
        </q-card-section>
      </q-card>
    </div>

    <!-- Main Content Grid -->
    <div class="content-grid q-pa-md">
      <!-- Truck Sizing -->
      <q-card flat bordered class="content-card">
        <q-card-section>
          <div class="text-h6 text-primary q-mb-md">Truck Recommendation</div>

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
          <div class="text-caption text-grey-6 q-mb-md">Based on {{ numHelpers }} helper{{ numHelpers > 1 ? 's' : '' }}</div>

          <div class="time-breakdown">
            <div class="time-item">
              <div class="row items-center q-mb-xs">
                <q-icon name="inventory" size="sm" color="primary" class="q-mr-sm" />
                <span class="text-body1 text-weight-medium">{{ timeEstimates.packing }} hours</span>
              </div>
              <div class="text-caption text-grey-7">Packing Time</div>
            </div>

            <q-separator class="q-my-md" />

            <div class="time-item">
              <div class="row items-center q-mb-xs">
                <q-icon name="publish" size="sm" color="secondary" class="q-mr-sm" />
                <span class="text-body1 text-weight-medium">{{ timeEstimates.loading }} hours</span>
              </div>
              <div class="text-caption text-grey-7">Loading Time</div>
            </div>

            <q-separator class="q-my-md" />

            <div class="time-item">
              <div class="row items-center q-mb-xs">
                <q-icon name="get_app" size="sm" color="accent" class="q-mr-sm" />
                <span class="text-body1 text-weight-medium">{{ timeEstimates.unloading }} hours</span>
              </div>
              <div class="text-caption text-grey-7">Unloading Time</div>
            </div>

            <q-separator class="q-my-md" />

            <div class="time-item total-time">
              <div class="row items-center q-mb-xs">
                <q-icon name="schedule" size="sm" color="positive" class="q-mr-sm" />
                <span class="text-h6 text-positive">{{ timeEstimates.total }} hours</span>
              </div>
              <div class="text-caption text-grey-7">Estimated Total</div>
            </div>
          </div>
        </q-card-section>
      </q-card>

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
      <q-card flat bordered class="content-card">
        <q-card-section>
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
      <q-card flat bordered class="content-card">
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
          </div>
        </q-card-section>
      </q-card>

      <!-- Collection Breakdown -->
      <q-card flat bordered class="content-card">
        <q-card-section>
          <div class="text-h6 text-primary q-mb-md">Space by Collection</div>

          <div v-if="collectionBreakdown.length > 0">
            <div v-for="collection in collectionBreakdown" :key="collection.name" class="collection-item q-mb-md">
              <div class="row items-center justify-between q-mb-xs">
                <div class="text-subtitle2 text-weight-medium">{{ collection.name }}</div>
                <div class="text-caption text-grey-7">{{ collection.volume.toFixed(1) }} cu ft</div>
              </div>
              <q-linear-progress
                :value="collection.percentage / 100"
                color="primary"
                size="12px"
                rounded
                class="q-mb-xs"
              />
              <div class="text-caption text-grey-6">{{ collection.itemCount }} items</div>
            </div>
          </div>
          <div v-else class="text-center text-grey-5 q-py-md">
            <q-icon name="folder_off" size="lg" />
            <div class="q-mt-sm">No collections with dimensions</div>
          </div>
        </q-card-section>
      </q-card>
    </div>
    </div>

    <!-- Costs & Route Tab -->
    <div v-else-if="movePlanningTab === 'costs'">
      <!-- Move Configuration -->
      <div class="q-pa-md">
        <q-card flat bordered>
          <q-card-section>
            <div class="text-h6 text-primary q-mb-md">Move Details</div>
            <div class="row q-col-gutter-md">
              <div class="col-12 col-md-3">
                <q-select
                  v-model="originLocation"
                  :options="locationsWithDetails"
                  option-value="value"
                  option-label="label"
                  emit-value
                  map-options
                  label="Origin Location"
                  outlined
                  dense
                >
                  <template v-slot:prepend>
                    <q-icon name="location_on" />
                  </template>
                  <template v-slot:after>
                    <q-btn
                      round
                      dense
                      flat
                      icon="add"
                      color="primary"
                      @click="showAddLocationDialog = true"
                    >
                      <q-tooltip>Add new location</q-tooltip>
                    </q-btn>
                  </template>
                </q-select>
              </div>
              <div class="col-12 col-md-3">
                <q-select
                  v-model="destinationLocation"
                  :options="locationsWithDetails"
                  option-value="value"
                  option-label="label"
                  emit-value
                  map-options
                  label="Destination Location"
                  outlined
                  dense
                >
                  <template v-slot:prepend>
                    <q-icon name="place" />
                  </template>
                  <template v-slot:after>
                    <q-btn
                      round
                      dense
                      flat
                      icon="add"
                      color="primary"
                      @click="showAddLocationDialog = true"
                    >
                      <q-tooltip>Add new location</q-tooltip>
                    </q-btn>
                  </template>
                </q-select>
              </div>
              <div class="col-12 col-md-3">
                <q-input
                  v-model="moveDate"
                  type="date"
                  label="Move Date"
                  outlined
                  dense
                >
                  <template v-slot:prepend>
                    <q-icon name="event" />
                  </template>
                </q-input>
              </div>
              <div class="col-12 col-md-3">
                <q-input
                  v-model.number="numHelpers"
                  type="number"
                  label="Number of Helpers"
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
            </div>
          </q-card-section>
        </q-card>
      </div>

      <div class="q-pa-md content-grid">
      <!-- Cost Estimates -->
      <q-card flat bordered class="content-card">
        <q-card-section>
          <div class="text-h6 text-primary q-mb-md">
            <q-icon name="attach_money" size="sm" class="q-mr-xs" />
            Cost Estimates
          </div>

          <div v-if="estimatedDistance">
            <!-- DIY Move -->
            <div class="q-mb-lg">
            <div class="text-subtitle2 text-grey-8 q-mb-sm">
              <q-icon name="drive_eta" size="sm" class="q-mr-xs" />
              DIY Move
            </div>
            <div class="row items-center q-mb-xs">
              <div class="col text-h5 text-weight-medium">
                ${{ costEstimates.diy.total.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 }) }}
              </div>
            </div>
            <div class="text-caption text-grey-6 q-mb-sm">
              Estimated total for self-move
            </div>
            <div class="text-caption text-grey-7">
              <div>• Truck rental: ${{ costEstimates.diy.breakdown.truckRental.toFixed(0) }} ({{ costEstimates.diy.breakdown.days }} day{{ costEstimates.diy.breakdown.days > 1 ? 's' : '' }})</div>
              <div>• Fuel: ${{ costEstimates.diy.breakdown.fuel.toFixed(0) }}</div>
              <div>• Packing materials: ${{ costEstimates.diy.breakdown.materials.toFixed(0) }}</div>
              <div>• Equipment/misc: ${{ costEstimates.diy.breakdown.equipment.toFixed(0) }}</div>
            </div>
          </div>

          <q-separator class="q-my-md" />

          <!-- Professional Movers (Market Range) -->
          <div class="q-mb-lg">
            <div class="text-subtitle2 text-grey-8 q-mb-sm">
              <q-icon name="local_shipping" size="sm" class="q-mr-xs" />
              Professional Movers (Market Range)
            </div>
            <div class="row items-center q-mb-xs">
              <div class="col text-h5 text-weight-medium">
                ${{ costEstimates.professional.low.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 }) }} -
                ${{ costEstimates.professional.high.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 }) }}
              </div>
            </div>
            <div class="text-caption text-grey-6">
              Estimated range from professional moving companies
            </div>
          </div>

          <q-separator class="q-my-md" />

          <!-- VeriMove Guaranteed Estimate -->
          <div class="q-mb-md bg-primary-1 q-pa-md rounded-borders">
            <div class="text-subtitle2 text-primary q-mb-sm">
              <q-icon name="verified" size="sm" class="q-mr-xs" />
              VeriMove Guaranteed Estimate
            </div>
            <div class="row items-center q-mb-xs">
              <div class="col text-h5 text-weight-bold text-primary">
                ${{ costEstimates.veriMove.low.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 }) }} -
                ${{ costEstimates.veriMove.high.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 }) }}
              </div>
            </div>
            <div class="text-caption text-grey-7 q-mb-sm">
              Binding not-to-exceed estimate
            </div>
            <div class="row items-center bg-positive text-white q-pa-xs rounded-borders" style="display: inline-flex;">
              <q-icon name="savings" size="xs" class="q-mr-xs" />
              <span class="text-caption">
                Save up to ${{ costEstimates.veriMove.savings.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 }) }} vs. market average
              </span>
            </div>
          </div>

          <!-- Request Other Quotes Button -->
          <div class="q-mt-md">
            <q-btn
              outline
              color="secondary"
              icon="request_quote"
              label="Request Quotes from Other Movers"
              class="full-width"
              @click="requestOtherQuotes"
            />
          </div>

            <div class="text-caption text-grey-5 q-mt-sm">
              <q-icon name="info" size="xs" class="q-mr-xs" />
              Estimates based on {{ totalWeightLbs.toLocaleString() }} lbs, {{ totalVolumeCuFt.toFixed(0) }} cu ft,
              {{ estimatedDistance.toLocaleString() }} miles
            </div>
          </div>

          <!-- Placeholder when no locations selected -->
          <div v-else class="text-center text-grey-5 q-py-lg">
            <q-icon name="location_off" size="xl" />
            <div class="text-body2 q-mt-md">Select origin and destination locations</div>
            <div class="text-caption">to see cost estimates</div>
          </div>
        </q-card-section>
      </q-card>

      <!-- Distance & Route Placeholder -->
      <q-card flat bordered class="content-card placeholder-card">
        <q-card-section>
          <div class="text-h6 text-grey-6 q-mb-md">
            <q-icon name="map" size="sm" class="q-mr-xs" />
            Distance & Route
          </div>
          <div class="placeholder-content">
            <q-icon name="construction" size="xl" color="grey-5" />
            <div class="text-body2 text-grey-6 q-mt-md">Coming Soon</div>
            <div class="text-caption text-grey-5">Distance calculation and route planning</div>
          </div>
        </q-card-section>
      </q-card>
      </div>
    </div>

    <!-- Add Location Dialog -->
    <q-dialog v-model="showAddLocationDialog">
      <q-card style="min-width: 400px">
        <q-card-section>
          <div class="text-h6 text-primary">Add New Location</div>
        </q-card-section>

        <q-card-section class="q-pt-none">
          <q-input
            v-model="newLocationName"
            label="Location Name"
            outlined
            dense
            autofocus
            class="q-mb-md"
          />
          <q-input
            v-model="newLocationAddress"
            label="Address (optional)"
            outlined
            dense
          />
        </q-card-section>

        <q-card-actions align="right">
          <q-btn flat label="Cancel" color="grey-7" v-close-popup />
          <q-btn flat label="Add Location" color="primary" @click="addLocation" />
        </q-card-actions>
      </q-card>
    </q-dialog>

  </div>
</template>

<style scoped>
.move-planning-container {
  max-width: 100%;
  background: #F7F8FA;
}

.move-planning-header {
  background: white;
  border-bottom: 1px solid #E0E0E0;
}

.subnav {
  padding: 12px 24px 0;
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 16px;
  margin-top: -8px;
}

.stat-card {
  background: white;
  transition: transform 0.2s ease, box-shadow 0.2s ease;
}

.stat-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
}

.content-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 16px;
  margin-top: -8px;
}

.content-card {
  background: white;
  height: fit-content;
}

.truck-details {
  padding: 12px;
  background: #F7F8FA;
  border-radius: 8px;
}

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
}

.box-item {
  padding: 8px 0;
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
}

.special-item {
  text-align: center;
  padding: 16px;
  background: #F7F8FA;
  border-radius: 8px;
}

.collection-item {
  padding: 8px;
  background: #F7F8FA;
  border-radius: 8px;
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

@media (max-width: 1200px) {
  .content-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 1024px) {
  .stats-grid {
    grid-template-columns: repeat(2, 1fr);
  }

  .special-items-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}

@media (max-width: 600px) {
  .stats-grid {
    grid-template-columns: 1fr;
  }

  .special-items-grid {
    grid-template-columns: 1fr;
  }
}
</style>
