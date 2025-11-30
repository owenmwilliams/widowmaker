<script setup lang="ts">
import { computed, defineEmits, defineProps, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { Notify } from 'quasar';

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

const isSaving = ref(false);
const verifying = ref(false);
const verificationError = ref<string | null>(null);
const autocompleteContainer = ref<HTMLElement | null>(null);
const mapContainer = ref<HTMLElement | null>(null);
const mapInstance = ref<any>(null);
const markerInstance = ref<any>(null);
const manualEntryOpen = ref(false);
let scriptPromise: Promise<void> | null = null;
let autocompleteElement: any = null;
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
    form.value.address1.trim() &&
    form.value.city.trim() &&
    form.value.state.trim() &&
    form.value.lat != null &&
    form.value.lng != null &&
    !verifying.value &&
    !isSaving.value
  );
});

const loadMapsScript = () => {
  if (typeof window === 'undefined' || !googleMapsKey) return Promise.resolve();
  if (window.google?.maps) return Promise.resolve();
  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${googleMapsKey}&libraries=geometry&v=weekly`;
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
    markerInstance.value.addListener('dragend', () => {
      const pos = markerInstance.value.getPosition();
      if (!pos) return;
      form.value.lat = pos.lat();
      form.value.lng = pos.lng();
    });
  }

  if (form.value.lat != null && form.value.lng != null) {
    const position = { lat: form.value.lat, lng: form.value.lng };
    mapInstance.value.setCenter(position);
    mapInstance.value.setZoom(15);
    markerInstance.value.setPosition(position);
    markerInstance.value.setVisible(true);
  } else {
    markerInstance.value.setVisible(false);
  }
};

const destroyAutocomplete = () => {
  if (autocompleteElement && autocompleteListener) {
    autocompleteElement.removeEventListener('gmp-select', autocompleteListener);
  }
  autocompleteElement = null;
  autocompleteListener = null;
  if (autocompleteContainer.value) {
    autocompleteContainer.value.innerHTML = '';
  }
};

const handlePlaceSelection = async (place: any) => {
  if (!place) return;
  verificationError.value = null;

  // Fields are already fetched by the event listener
  // Ensure map is ready before processing
  await ensureMap();

  const components = place.addressComponents || [];
  const getComponent = (type: string, short = false) => {
    const match = components.find((c: any) => c.types?.includes(type));
    return short ? match?.shortText ?? match?.short_name : match?.longText ?? match?.long_name;
  };

  suppressManualGeocode = true;
  const streetNumber = getComponent('street_number', true) || '';
  const route = getComponent('route') || '';
  if (streetNumber || route) {
    form.value.address1 = `${streetNumber} ${route}`.trim();
  } else if (place.formattedAddress) {
    form.value.address1 = place.formattedAddress.split(',')[0] || place.formattedAddress;
  }

  const cityFallback =
    getComponent('locality') ||
    getComponent('sublocality_level_1') ||
    getComponent('administrative_area_level_2') ||
    getComponent('administrative_area_level_3');
  form.value.city = cityFallback || form.value.city;

  form.value.state = getComponent('administrative_area_level_1', true) || form.value.state;

  const postal = getComponent('postal_code') || getComponent('postal_code', true);
  const postalSuffix = getComponent('postal_code_suffix', true);
  if (postal && postalSuffix) {
    form.value.zip = `${postal}-${postalSuffix}`;
  } else if (postal) {
    form.value.zip = postal;
  }

  form.value.country = getComponent('country') || form.value.country;
  form.value.formattedAddress = place.formattedAddress || form.value.address1;
  manualEntryOpen.value = false;

  let lat: number | null = null;
  let lng: number | null = null;

  // Try multiple ways to get the location coordinates
  if (place.location) {
    if (typeof place.location.lat === 'function') {
      lat = place.location.lat();
      lng = place.location.lng();
    } else {
      lat = place.location.lat ?? place.location.latitude ?? null;
      lng = place.location.lng ?? place.location.longitude ?? null;
    }
  } else if (place.geometry?.location) {
    if (typeof place.geometry.location.lat === 'function') {
      lat = place.geometry.location.lat();
      lng = place.geometry.location.lng();
    } else {
      lat = place.geometry.location.lat ?? null;
      lng = place.geometry.location.lng ?? null;
    }
  }

  if (lat != null && lng != null) {
    form.value.lat = lat;
    form.value.lng = lng;

    // Update map immediately
    await nextTick();
    if (mapInstance.value && markerInstance.value) {
      const position = { lat, lng };
      mapInstance.value.setCenter(position);
      mapInstance.value.setZoom(16);
      markerInstance.value.setPosition(position);
      markerInstance.value.setVisible(true);
    }
  } else {
    // fallback to manual geocode using the formatted address
    console.warn('[LocationEditor] No coordinates found in place, falling back to geocode');
    await geocodeManualAddress();
  }
  suppressManualGeocode = false;
};

const initAutocomplete = async () => {
  if (!googleMapsKey || !autocompleteContainer.value) return;
  await loadMapsScript();
  await window.google.maps.importLibrary('places');
  await ensureMap();

  destroyAutocomplete();

  autocompleteElement = new window.google.maps.places.PlaceAutocompleteElement({
    componentRestrictions: { country: form.value.country?.toLowerCase?.() || 'us' }
  });
  autocompleteElement.fields = ['formattedAddress', 'addressComponents', 'location'];
  autocompleteElement.placeholder = 'Search for an address';
  autocompleteElement.classList.add('place-autocomplete-element');
  autocompleteContainer.value.appendChild(autocompleteElement);

  autocompleteListener = async (event: any) => {
    event?.preventDefault?.();

    // New API pattern: event contains placePrediction, not place
    const placePrediction = event?.placePrediction;
    if (!placePrediction) {
      verificationError.value = 'Unable to fetch address selection. Try again.';
      return;
    }

    try {
      // Convert placePrediction to Place object
      const place = await placePrediction.toPlace();

      // Fetch required fields
      await place.fetchFields({
        fields: ['formattedAddress', 'addressComponents', 'location']
      });

      await handlePlaceSelection(place);
    } catch (error) {
      console.error('[LocationEditor] Failed to handle place selection', error);
      verificationError.value = 'Unable to load that address.';
    }
  };

  // Listen for the correct event name (changed in 2025)
  autocompleteElement.addEventListener('gmp-select', autocompleteListener);
};

const geocodeManualAddress = async () => {
  if (!googleMapsKey) {
    verificationError.value = 'Google Maps key missing. Contact support.';
    return;
  }
  if (!form.value.address1 || !form.value.city || !form.value.state) {
    return;
  }

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

    const response = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?key=${googleMapsKey}&address=${encodeURIComponent(query)}`);
    if (!response.ok) throw new Error('Failed to contact Google Maps');
    const payload = await response.json();
    if (payload.status !== 'OK' || !payload.results?.length) throw new Error('Address not found. Refine and try again.');

    const result = payload.results[0];
    form.value.formattedAddress = result.formatted_address;
    form.value.lat = result.geometry.location.lat;
    form.value.lng = result.geometry.location.lng;

    if (mapInstance.value && markerInstance.value) {
      const position = { lat: form.value.lat, lng: form.value.lng };
      mapInstance.value.setCenter(position);
      mapInstance.value.setZoom(16);
      markerInstance.value.setPosition(position);
      markerInstance.value.setVisible(true);
    }
  } catch (error: any) {
    console.error('[LocationEditor] Manual geocode failed', error);
    verificationError.value = error?.message || 'Could not verify this address.';
  } finally {
    verifying.value = false;
  }
};

const scheduleManualGeocode = () => {
  if (suppressManualGeocode) return;
  if (!manualEntryOpen.value) return;
  if (!googleMapsKey) return;
  if (!form.value.address1 || !form.value.city || !form.value.state) return;
  if (manualGeocodeTimeout) clearTimeout(manualGeocodeTimeout);
  manualGeocodeTimeout = setTimeout(() => {
    geocodeManualAddress();
  }, 800);
};

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
  verificationError.value = null;
  manualEntryOpen.value = false;
};

watch(() => props.initialLocation, () => {
  if (!dialogVisible.value) return;
  resetForm();
  nextTick(() => {
    ensureMap();
  });
}, { deep: true });

watch(dialogVisible, async (open) => {
  if (open) {
    resetForm();
    await nextTick();
    if (googleMapsKey) {
      try {
        await initAutocomplete();
      } catch (error) {
        console.error('[LocationEditor] Failed to init autocomplete', error);
        verificationError.value = 'Unable to load map search, try again later.';
      }
    }
  } else {
    destroyAutocomplete();
    if (manualGeocodeTimeout) {
      clearTimeout(manualGeocodeTimeout);
      manualGeocodeTimeout = null;
    }
    emit('cancel');
  }
});

onBeforeUnmount(() => {
  destroyAutocomplete();
  if (manualGeocodeTimeout) {
    clearTimeout(manualGeocodeTimeout);
    manualGeocodeTimeout = null;
  }
});

watch(
  () => [form.value.address1, form.value.address2, form.value.city, form.value.state, form.value.zip, form.value.country],
  () => {
    if (!dialogVisible.value) return;
    scheduleManualGeocode();
  }
);

watch(manualEntryOpen, (open) => {
  if (open) {
    scheduleManualGeocode();
  }
});

const submit = async () => {
  if (!canSave.value) {
    Notify.create({
      type: 'warning',
      message: 'Complete the address and verify it on the map first.'
    });
    return;
  }

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
          Confirm the map marker so we can keep routes accurate.
        </div>
      </q-card-section>

      <q-card-section class="q-pt-none">
        <div class="row q-col-gutter-md">
          <div class="col-12">
            <q-input v-model="form.name" label="Location name" outlined dense maxlength="120" autofocus />
          </div>
          <div class="col-12">
            <label class="text-caption text-grey-7">Search & auto-complete</label>
            <div ref="autocompleteContainer" class="autocomplete-shell q-mt-xs" :class="{ 'no-key': !googleMapsKey }">
              <div v-if="!googleMapsKey" class="text-caption text-negative">
                Google Maps API key missing. Contact support.
              </div>
            </div>
            <div class="text-caption text-grey-6 q-mt-xs">
              {{ form.formattedAddress || 'Select a suggested address or enter it manually below.' }}
              <template v-if="form.zip">
                • ZIP: <strong>{{ form.zip }}</strong>
              </template>
            </div>
          </div>

          <div class="col-12">
            <q-expansion-item
              dense
              dense-toggle
              v-model="manualEntryOpen"
              label="Enter address manually"
              header-class="text-caption text-grey-7"
            >
              <q-card flat>
                <q-card-section class="q-pt-xs">
                  <div class="row q-col-gutter-sm">
                    <div class="col-12">
                      <q-input v-model="form.address1" label="Address line 1" outlined dense />
                    </div>
                    <div class="col-12">
                      <q-input v-model="form.address2" label="Address line 2 (optional)" outlined dense />
                    </div>
                    <div class="col-12 col-md-6">
                      <q-input v-model="form.city" label="City" outlined dense />
                    </div>
                    <div class="col-6 col-md-3">
                      <q-select v-model="form.state" :options="usStateOptions" label="State" outlined dense emit-value map-options />
                    </div>
                    <div class="col-6 col-md-3">
                      <q-input v-model="form.zip" label="ZIP" outlined dense />
                    </div>
                    <div class="col-12 col-md-6">
                      <q-input v-model="form.country" label="Country" outlined dense />
                    </div>
                  </div>
                  <div class="text-caption text-grey-6 q-mt-sm">
                    Map updates automatically as you edit these fields.
                  </div>
                </q-card-section>
              </q-card>
            </q-expansion-item>
          </div>

          <div class="col-12">
            <div ref="mapContainer" class="location-map"></div>
            <div class="text-caption text-grey-7 q-mt-xs">
              Drag the pin if the entrance is somewhere else.
            </div>
          </div>
        </div>

        <q-banner v-if="verificationError" dense rounded class="bg-negative text-white q-mt-sm">
          {{ verificationError }}
        </q-banner>
        <q-banner
          v-else-if="form.lat != null && form.lng != null"
          dense
          rounded
          class="bg-positive text-white q-mt-sm"
        >
          Coordinates confirmed: {{ form.lat.toFixed(5) }}, {{ form.lng.toFixed(5) }}
        </q-banner>
      </q-card-section>

      <q-card-actions align="right">
        <q-btn flat label="Cancel" color="grey-7" :disable="isSaving" @click="dialogVisible = false" />
        <q-btn flat :label="mode === 'edit' ? 'Save changes' : 'Add Location'" color="primary" :loading="isSaving" :disable="!canSave" @click="submit" />
      </q-card-actions>
    </q-card>
  </q-dialog>
</template>

<style scoped>
.autocomplete-shell {
  min-height: 42px;
  border: 1px solid #cfd8dc;
  border-radius: 6px;
  padding: 4px 0;
}

.autocomplete-shell.no-key {
  border-style: dashed;
  padding: 8px;
}

.autocomplete-shell :global(.place-autocomplete-element) {
  width: 100%;
  border: none;
}

.location-map {
  width: 100%;
  height: 230px;
  border-radius: 8px;
  border: 1px solid #cfd8dc;
  overflow: hidden;
}
</style>
