<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch, toRaw } from 'vue';

declare global {
  interface Window {
    google: any;
  }
}

interface LocationForm {
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

const props = defineProps<{
  modelValue: LocationForm;
  label?: string;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', value: LocationForm): void;
}>();

// --- Default State ---

const defaultForm = (): LocationForm => ({
  name: '',
  address1: '',
  address2: '',
  city: '',
  state: '',
  zip: '',
  country: 'USA',
  lat: null,
  lng: null,
  formattedAddress: null
});

const form = reactive<LocationForm>(defaultForm());
const manualEntryOpen = ref(false);
const verifying = ref(false);
const verificationError = ref<string | null>(null);

// --- Google Maps References ---

const googleMapsKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '';
const searchInputRef = ref<any>(null); // Quasar input ref
const searchText = ref('');
const mapContainer = ref<HTMLElement | null>(null);
const mapInstance = ref<any>(null);
const markerInstance = ref<any>(null);

let autocompleteInstance: any = null;
let autocompleteListener: any = null;
let scriptPromise: Promise<void> | null = null;
let manualGeocodeTimeout: ReturnType<typeof setTimeout> | null = null;
let suppressManualGeocode = false;
let isUpdatingFromProp = false;

const hasMapsKey = computed(() => Boolean(googleMapsKey));

// US State options for dropdown
const usStateOptions = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA',
  'HI','ID','IL','IN','IA','KS','KY','LA','ME','MD',
  'MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
  'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC',
  'SD','TN','TX','UT','VT','VA','WA','WV','WI','WY'
].map(state => ({ label: state, value: state }));

// --- State Watchers ---

// Sync Prop -> Local Form
watch(
  () => props.modelValue,
  (newVal) => {
    isUpdatingFromProp = true;
    const source = newVal || defaultForm();
    Object.assign(form, defaultForm(), source);

    // Update map view if coordinates exist
    if (form.lat && form.lng) {
      nextTick(ensureMap);
    }

    // CRITICAL: Use nextTick to ensure flag stays true during reactive updates
    nextTick(() => {
      isUpdatingFromProp = false;
    });
  },
  { immediate: true, deep: true }
);

// Sync Local Form -> Prop
watch(
  form,
  (newVal) => {
    if (isUpdatingFromProp) return;
    emit('update:modelValue', { ...toRaw(newVal) });
  },
  { deep: true }
);

// Watch address fields for manual geocoding trigger
watch(
  () => [form.address1, form.city, form.state, form.zip, form.country],
  () => {
    if (isUpdatingFromProp) return;
    if (manualEntryOpen.value) scheduleManualGeocode();
  }
);

// --- Google Maps Loading Logic ---

const loadMapsScript = () => {
  if (typeof window === 'undefined' || !googleMapsKey) return Promise.resolve();
  if (window.google?.maps?.places) return Promise.resolve();
  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    // Ensure 'places' and 'geometry' are requested
    script.src = `https://maps.googleapis.com/maps/api/js?key=${googleMapsKey}&loading=async&libraries=places,geometry&v=weekly`;
    script.async = true;
    script.defer = true;
    script.onload = () => {
      // Wait for Google Maps to be fully initialized
      const checkGoogleMaps = () => {
        if (window.google?.maps?.places?.Autocomplete) {
          resolve();
        } else {
          setTimeout(checkGoogleMaps, 50);
        }
      };
      checkGoogleMaps();
    };
    script.onerror = reject;
    document.head.appendChild(script);
  });
  return scriptPromise;
};

const ensureMap = async () => {
  if (!googleMapsKey || !mapContainer.value) return;
  await loadMapsScript();

  // Initialize Map
  if (!mapInstance.value) {
    mapInstance.value = new window.google.maps.Map(mapContainer.value, {
      center: { lat: 37.773972, lng: -122.431297 },
      zoom: 4,
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: false
    });
  }

  // Initialize Marker
  if (!markerInstance.value) {
    markerInstance.value = new window.google.maps.Marker({
      map: mapInstance.value,
      draggable: true
    });
    
    markerInstance.value.addListener('dragend', () => {
      const pos = markerInstance.value.getPosition();
      if (!pos) return;
      form.lat = pos.lat();
      form.lng = pos.lng();
    });
  }

  // Update Position
  if (form.lat != null && form.lng != null) {
    const position = { lat: form.lat, lng: form.lng };
    mapInstance.value.setCenter(position);
    mapInstance.value.setZoom(16);
    markerInstance.value.setPosition(position);
  }
};

// --- Autocomplete Logic ---

const initAutocomplete = async () => {
  if (!googleMapsKey || !searchInputRef.value) return;
  await loadMapsScript();

  // Clean up previous instance
  if (autocompleteListener) {
    window.google.maps.event.removeListener(autocompleteListener);
  }

  // Get the native input element from Quasar wrapper
  const nativeInput = searchInputRef.value.$el.getElementsByTagName('input')[0];
  if (!nativeInput) return;

  autocompleteInstance = new window.google.maps.places.Autocomplete(nativeInput, {
    fields: ['formatted_address', 'geometry', 'address_components', 'name'],
    types: ['address'],
    componentRestrictions: { country: ['us', 'ca', 'gb', 'au'] } // Common defaults, adjust as needed
  });

  autocompleteListener = autocompleteInstance.addListener('place_changed', handlePlaceChanged);
};

const handlePlaceChanged = async () => {
  const place = autocompleteInstance.getPlace();
  verificationError.value = null;

  if (!place || !place.geometry) {
    verificationError.value = "Please select an address from the dropdown list.";
    return;
  }

  suppressManualGeocode = true;

  // Parse Components
  const components = place.address_components || [];
  const getComponent = (type: string, useShort = false) => {
    const match = components.find((c: any) => c.types.includes(type));
    return match ? (useShort ? match.short_name : match.long_name) : '';
  };

  const streetNum = getComponent('street_number');
  const route = getComponent('route');
  
  form.address1 = `${streetNum} ${route}`.trim();
  // Fallback if component parsing fails but formatted address exists
  if (!form.address1 && place.formatted_address) {
    form.address1 = place.formatted_address.split(',')[0];
  }

  form.city = getComponent('locality') || getComponent('sublocality') || getComponent('administrative_area_level_2');
  form.state = getComponent('administrative_area_level_1', true); // Short name for state
  form.zip = getComponent('postal_code');
  form.country = getComponent('country');
  form.formattedAddress = place.formatted_address;
  
  // Clear optional
  form.address2 = '';

  // Handle Geometry
  if (place.geometry.location) {
    form.lat = place.geometry.location.lat();
    form.lng = place.geometry.location.lng();
    await ensureMap();
    
    const pos = { lat: form.lat as number, lng: form.lng as number };
    mapInstance.value.setCenter(pos);
    mapInstance.value.setZoom(17);
    markerInstance.value.setPosition(pos);
  }

  searchText.value = ''; // Clear search bar
  manualEntryOpen.value = true; // Reveal details
  
  // Debounce release of suppression to prevent watchers from firing immediately
  setTimeout(() => {
    suppressManualGeocode = false;
  }, 500);
};

// --- Manual Geocoding ---

const geocodeManualAddress = async () => {
  if (!googleMapsKey || !form.address1 || !form.city || !form.state) return;

  verifying.value = true;
  verificationError.value = null;

  try {
    await ensureMap();
    const query = [
      form.address1, 
      form.address2, 
      form.city, 
      form.state, 
      form.zip, 
      form.country
    ].filter(Boolean).join(', ');

    const geocoder = new window.google.maps.Geocoder();
    
    // Wrap generic Geocoding in Promise
    const result = await new Promise<any>((resolve, reject) => {
      geocoder.geocode({ address: query }, (results: any, status: any) => {
        if (status === 'OK' && results[0]) resolve(results[0]);
        else reject(new Error(status));
      });
    });

    form.formattedAddress = result.formatted_address;
    form.lat = result.geometry.location.lat();
    form.lng = result.geometry.location.lng();

    if (mapInstance.value && markerInstance.value) {
      const position = { lat: form.lat!, lng: form.lng! };
      mapInstance.value.setCenter(position);
      mapInstance.value.setZoom(16);
      markerInstance.value.setPosition(position);
    }
  } catch (error: any) {
    console.warn('[LocationSearchInline] Manual geocode failed', error);
    // Don't show visible error for manual typing to avoid annoying user
  } finally {
    verifying.value = false;
  }
};

const scheduleManualGeocode = () => {
  if (suppressManualGeocode) return;
  if (!hasMapsKey.value) return;
  
  if (manualGeocodeTimeout) clearTimeout(manualGeocodeTimeout);
  manualGeocodeTimeout = setTimeout(() => {
    geocodeManualAddress();
  }, 1000); // 1s debounce
};

// --- Lifecycle ---

onMounted(async () => {
  if (hasMapsKey.value) {
    // Wait for DOM to be ready
    await nextTick();
    await loadMapsScript();
    initAutocomplete();
    ensureMap();
  }
});

onBeforeUnmount(() => {
  if (autocompleteListener) {
    window.google.maps?.event.removeListener(autocompleteListener);
  }
  if (manualGeocodeTimeout) {
    clearTimeout(manualGeocodeTimeout);
  }
});
</script>

<template>
  <div class="location-search-inline">
    <div class="row q-col-gutter-sm">
      <div class="col-12">
        <q-input 
          v-model="form.name" 
          label="Location Nickname (e.g. Warehouse A)" 
          outlined 
          dense 
        />
      </div>
      
      <div class="col-12">
        <label class="text-caption text-grey-7">Address Search</label>
        <q-input
          ref="searchInputRef"
          v-model="searchText"
          placeholder="Start typing an address..."
          outlined
          dense
          bg-color="white"
          :disable="!hasMapsKey"
        >
          <template v-slot:prepend>
            <q-icon name="search" />
          </template>
        </q-input>
        
        <div v-if="!hasMapsKey" class="text-caption text-negative q-mt-xs">
          Google Maps API key missing.
        </div>
        
        <div class="text-caption text-grey-6 q-mt-xs" v-if="form.formattedAddress">
          Currently: <strong>{{ form.formattedAddress }}</strong>
        </div>
      </div>
    </div>

    <q-expansion-item
      dense
      dense-toggle
      v-model="manualEntryOpen"
      label="Address Details"
      class="q-mt-sm border-radius-inherit"
      header-class="text-caption text-grey-7 bg-grey-2"
      expand-icon-class="text-grey-7"
    >
      <q-card flat class="bg-grey-1 q-pa-sm">
        <div class="row q-col-gutter-sm">
          <div class="col-12">
            <q-input v-model="form.address1" label="Address line 1" outlined dense bg-color="white" />
          </div>
          <div class="col-12">
            <q-input v-model="form.address2" label="Line 2 (Optional)" outlined dense bg-color="white" />
          </div>
          <div class="col-12 col-md-6">
            <q-input v-model="form.city" label="City" outlined dense bg-color="white" />
          </div>
          <div class="col-6 col-md-3">
            <q-select
              v-model="form.state"
              :options="usStateOptions"
              label="State"
              outlined
              dense
              emit-value
              map-options
              bg-color="white"
            />
          </div>
          <div class="col-6 col-md-3">
            <q-input v-model="form.zip" label="ZIP" outlined dense bg-color="white" />
          </div>
          <div class="col-12 col-md-6">
            <q-input v-model="form.country" label="Country" outlined dense bg-color="white" />
          </div>
        </div>
        <div class="text-caption text-grey-6 q-mt-xs">
          <q-icon name="info" /> Map updates automatically as you edit fields.
        </div>
      </q-card>
    </q-expansion-item>

    <div class="col-12 q-mt-md">
      <div ref="mapContainer" class="inline-map"></div>
      <div class="text-caption text-grey-7 q-mt-xs text-center">
        <span v-if="form.lat && form.lng" class="text-positive text-weight-bold">
           Pin active: {{ form.lat.toFixed(5) }}, {{ form.lng.toFixed(5) }}
        </span>
        <span v-else>
          Enter an address to place pin.
        </span>
      </div>
    </div>

    <q-banner
      v-if="verificationError"
      dense
      rounded
      class="bg-negative text-white q-mt-sm"
    >
      {{ verificationError }}
    </q-banner>
  </div>
</template>

<style scoped>
.location-search-inline {
  display: flex;
  flex-direction: column;
}

.inline-map {
  width: 100%;
  height: 220px;
  border-radius: 8px;
  border: 1px solid #cfd8dc;
  overflow: hidden;
  background-color: #f5f5f5;
}

/* Ensure Google Autocomplete shows above other elements */
:global(.pac-container) {
  z-index: 9999 !important;
  font-family: inherit;
  border-radius: 0 0 8px 8px;
  box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1);
  border: 1px solid #e2e8f0;
}
</style>