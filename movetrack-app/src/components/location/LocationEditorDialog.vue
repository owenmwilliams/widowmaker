<script setup lang="ts">
import { computed, defineEmits, defineProps, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { Notify } from 'quasar';
import { useLocationForm } from '../../composables/useLocationForm';

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
  modelValue: boolean;
  mode?: 'add' | 'edit';
  initialLocation?: Partial<LocationForm> | null;
  title?: string;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void;
  (e: 'save', payload: LocationForm): void;
  (e: 'cancel'): void;
}>();

const dialogVisible = computed({
  get: () => props.modelValue,
  set: (val: boolean) => emit('update:modelValue', val)
});

const googleMapsKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '';

// Form State
const form = ref<LocationForm>({
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
const { manualAddressComplete } = useLocationForm(() => form.value);

// UI State
const isSaving = ref(false);
const verifying = ref(false);
const verificationError = ref<string | null>(null);
const mapContainer = ref<HTMLElement | null>(null);
const searchInputRef = ref<any>(null); // Ref to the Quasar input component
const searchText = ref(''); // Bound to the search input
const mapInstance = ref<any>(null);
const markerInstance = ref<any>(null);
const manualEntryOpen = ref(false);

// Internal Google Objects
let scriptPromise: Promise<void> | null = null;
let autocompleteInstance: any = null;
let autocompleteListener: any = null;
let manualGeocodeTimeout: ReturnType<typeof setTimeout> | null = null;
let suppressManualGeocode = false;

const usStateOptions = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA',
  'HI','ID','IL','IN','IA','KS','KY','LA','ME','MD',
  'MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
  'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC',
  'SD','TN','TX','UT','VT','VA','WA','WV','WI','WY'
].map(state => ({ label: state, value: state }));

const dialogTitle = computed(() => {
  if (props.title) return props.title;
  return props.mode === 'edit' ? 'Update location' : 'Add new location';
});

const canSave = computed(() => {
  return Boolean(
    form.value.name.trim() &&
    manualAddressComplete.value &&
    !verifying.value &&
    !isSaving.value
  );
});

// --- Google Maps Loading ---

const loadMapsScript = () => {
  if (typeof window === 'undefined' || !googleMapsKey) return Promise.resolve();
  if (window.google?.maps) return Promise.resolve();
  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    // Added libraries=places explicitly here
    script.src = `https://maps.googleapis.com/maps/api/js?key=${googleMapsKey}&libraries=geometry,places&v=weekly`;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = reject;
    document.head.appendChild(script);
  });

  return scriptPromise;
};

const ensureMap = async () => {
  if (!googleMapsKey || !mapContainer.value) return;
  await loadMapsScript();

  if (!mapInstance.value) {
    mapInstance.value = new window.google.maps.Map(mapContainer.value, {
      center: { lat: 37.773972, lng: -122.431297 },
      zoom: 4,
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: false
    });
  }

  if (!markerInstance.value) {
    markerInstance.value = new window.google.maps.Marker({
      map: mapInstance.value,
      draggable: true,
      visible: false
    });
    
    // Listen for drag events to update lat/lng
    markerInstance.value.addListener('dragend', () => {
      const pos = markerInstance.value.getPosition();
      if (!pos) return;
      form.value.lat = pos.lat();
      form.value.lng = pos.lng();
    });
  }

  // Position the map if we have data
  if (form.value.lat != null && form.value.lng != null) {
    const position = { lat: form.value.lat, lng: form.value.lng };
    mapInstance.value.setCenter(position);
    mapInstance.value.setZoom(16);
    markerInstance.value.setPosition(position);
    markerInstance.value.setVisible(true);
  } else {
    markerInstance.value.setVisible(false);
  }
};

// --- Autocomplete Logic ---

const initAutocomplete = async () => {
  if (!googleMapsKey || !searchInputRef.value) return;
  await loadMapsScript();
  
  // Clean up old instance
  if (autocompleteListener) {
    window.google.maps.event.removeListener(autocompleteListener);
  }

  // Get the native input element from Quasar wrapper
  const nativeInput = searchInputRef.value.$el.getElementsByTagName('input')[0];
  if (!nativeInput) return;

  // Initialize Standard Autocomplete
  autocompleteInstance = new window.google.maps.places.Autocomplete(nativeInput, {
    fields: ['formatted_address', 'geometry', 'address_components', 'name'],
    types: ['address'], // Prioritize precise addresses
    componentRestrictions: { country: ['us', 'ca'] } // Adjust as needed
  });

  // Bind the listener
  autocompleteListener = autocompleteInstance.addListener('place_changed', handlePlaceChanged);
};

const handlePlaceChanged = async () => {
  verificationError.value = null;
  const place = autocompleteInstance.getPlace();

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
  
  // Fill Form
  form.value.name = form.value.name || place.name || ''; // Keep existing name if typed
  form.value.address1 = `${streetNum} ${route}`.trim();
  form.value.city = getComponent('locality') || getComponent('sublocality') || getComponent('administrative_area_level_2');
  form.value.state = getComponent('administrative_area_level_1', true); // Use short name (e.g. NY)
  form.value.zip = getComponent('postal_code');
  form.value.country = getComponent('country');
  form.value.formattedAddress = place.formatted_address;

  // Clear optional fields
  form.value.address2 = ''; 

  // Handle Coordinates
  if (place.geometry.location) {
    form.value.lat = place.geometry.location.lat();
    form.value.lng = place.geometry.location.lng();
    
    // Update Map View
    await ensureMap(); // Ensure map exists
    const pos = { lat: form.value.lat as number, lng: form.value.lng as number };
    mapInstance.value.setCenter(pos);
    mapInstance.value.setZoom(17);
    markerInstance.value.setPosition(pos);
    markerInstance.value.setVisible(true);
  }

  // Clean up UI
  searchText.value = ''; // Clear search box after selection
  manualEntryOpen.value = true; // Show the filled fields to the user
  suppressManualGeocode = false;
};

// --- Manual Geocoding (Fallback) ---

const geocodeManualAddress = async () => {
  if (!googleMapsKey) return;
  if (!form.value.address1 || !form.value.city || !form.value.state) return;

  verifying.value = true;
  verificationError.value = null;

  try {
    await ensureMap();
    const query = [
      form.value.address1,
      form.value.address2,
      form.value.city,
      form.value.state,
      form.value.zip,
      form.value.country
    ].filter(Boolean).join(', ');

    const geocoder = new window.google.maps.Geocoder();
    const result = await new Promise<any>((resolve, reject) => {
      geocoder.geocode({ address: query }, (results: any, status: any) => {
        if (status === 'OK' && results[0]) resolve(results[0]);
        else reject(new Error(status));
      });
    });

    form.value.formattedAddress = result.formatted_address;
    form.value.lat = result.geometry.location.lat();
    form.value.lng = result.geometry.location.lng();

    // Update Marker
    const position = { lat: form.value.lat!, lng: form.value.lng! };
    mapInstance.value.setCenter(position);
    markerInstance.value.setPosition(position);
    markerInstance.value.setVisible(true);

  } catch (error: any) {
    // Silent fail often better while typing, or show subtle error
    console.warn('Geocoding failed:', error);
  } finally {
    verifying.value = false;
  }
};

const scheduleManualGeocode = () => {
  if (suppressManualGeocode) return;
  if (!manualEntryOpen.value) return;
  if (manualGeocodeTimeout) clearTimeout(manualGeocodeTimeout);
  
  manualGeocodeTimeout = setTimeout(() => {
    geocodeManualAddress();
  }, 1000); // 1s debounce
};

// --- Lifecycle & Watchers ---

const resetForm = () => {
  form.value = {
    name: props.initialLocation?.name || '',
    address1: props.initialLocation?.address1 || '',
    address2: props.initialLocation?.address2 || '',
    city: props.initialLocation?.city || '',
    state: props.initialLocation?.state || '',
    zip: props.initialLocation?.zip || '',
    country: props.initialLocation?.country || 'USA',
    lat: props.initialLocation?.lat ?? null,
    lng: props.initialLocation?.lng ?? null,
    formattedAddress: props.initialLocation?.formattedAddress || null
  };
  searchText.value = '';
  verificationError.value = null;
  manualEntryOpen.value = false;
};

watch(() => props.initialLocation, () => {
  if (!dialogVisible.value) return;
  resetForm();
  nextTick(ensureMap);
}, { deep: true });

watch(dialogVisible, async (open) => {
  if (open) {
    resetForm();
    await nextTick();
    if (googleMapsKey) {
      initAutocomplete();
      ensureMap();
    }
  } else {
    // Cleanup
    if (autocompleteListener) {
      window.google.maps?.event.removeListener(autocompleteListener);
    }
  }
});

watch(
  () => [form.value.address1, form.value.address2, form.value.city, form.value.state, form.value.zip],
  () => {
    if (dialogVisible.value) scheduleManualGeocode();
  }
);

const submit = async () => {
  if (!canSave.value) return;
  isSaving.value = true;
  try {
    emit('save', { ...form.value });
    dialogVisible.value = false;
  } finally {
    isSaving.value = false;
  }
};
</script>

<template>
  <q-dialog v-model="dialogVisible" persistent>
    <q-card style="min-width: 460px; max-width: 640px;">
      <q-card-section>
        <div class="text-h6 text-primary">{{ dialogTitle }}</div>
        <div class="text-caption text-grey-7">
          Search for an address or drag the map pin to set the location.
        </div>
      </q-card-section>

      <q-card-section class="q-pt-none">
        <div class="row q-col-gutter-md">
          <div class="col-12">
            <q-input 
              v-model="form.name" 
              label="Location Name (e.g. Office, Home)" 
              outlined 
              dense 
              autofocus 
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
              :disable="!googleMapsKey"
            >
              <template v-slot:prepend>
                <q-icon name="search" />
              </template>
            </q-input>
            <div v-if="!googleMapsKey" class="text-caption text-negative q-mt-xs">
              Google Maps API Key is missing.
            </div>
          </div>

          <div class="col-12">
            <q-expansion-item
              dense
              dense-toggle
              v-model="manualEntryOpen"
              label="Edit Address Details"
              class="border-radius-inherit"
              header-class="bg-grey-2 text-grey-9"
              expand-icon-class="text-grey-7"
            >
              <q-card flat class="bg-grey-1 q-pa-sm">
                <div class="row q-col-gutter-sm">
                  <div class="col-12">
                    <q-input v-model="form.address1" label="Street Address" outlined dense bg-color="white" />
                  </div>
                  <div class="col-12">
                    <q-input v-model="form.address2" label="Apt, Suite, Unit (Optional)" outlined dense bg-color="white" />
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
                <div
                  class="text-caption q-mt-sm"
                  :class="manualAddressComplete ? 'text-positive' : 'text-negative'"
                >
                  Address, city, state, and ZIP are required before saving.
                </div>
              </q-card>
            </q-expansion-item>
          </div>

          <div class="col-12">
            <div ref="mapContainer" class="location-map"></div>
            <div class="text-caption text-grey-7 q-mt-xs text-center">
              <span v-if="form.lat && form.lng" class="text-positive text-weight-bold">
                <q-icon name="check_circle" /> Pin placed at {{ form.lat.toFixed(5) }}, {{ form.lng.toFixed(5) }}
              </span>
              <span v-else>
                No location set yet.
              </span>
            </div>
          </div>
        </div>

        <q-banner v-if="verificationError" dense rounded class="bg-negative text-white q-mt-sm">
          {{ verificationError }}
        </q-banner>
      </q-card-section>

      <q-card-actions align="right">
        <q-btn flat label="Cancel" color="grey-8" :disable="isSaving" @click="dialogVisible = false" />
        <q-btn 
          unelevated 
          :label="mode === 'edit' ? 'Save Changes' : 'Add Location'" 
          color="primary" 
          :loading="isSaving" 
          :disable="!canSave" 
          @click="submit" 
        />
      </q-card-actions>
    </q-card>
  </q-dialog>
</template>

<style>
/* CRITICAL: Google Maps Autocomplete Dropdown (pac-container) 
   appends to body and often hides behind Quasar Modals (z-index 6000+).
   This forces it to the front.
*/
.pac-container {
  z-index: 9999 !important;
  font-family: inherit;
}

.location-map {
  width: 100%;
  height: 250px;
  border-radius: 8px;
  border: 1px solid #ddd;
  background-color: #f5f5f5;
}
</style>
