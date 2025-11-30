<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';

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
let manualGeocodeTimeout: ReturnType<typeof setTimeout> | null = null;
let suppressManualGeocode = false;

watch(
  () => props.modelValue,
  (val) => {
    const source = val || defaultForm();
    Object.assign(form, defaultForm(), source);
  },
  { immediate: true, deep: true }
);

watch(
  form,
  () => {
    emit('update:modelValue', { ...form });
  },
  { deep: true }
);

watch(
  () => [form.lat, form.lng],
  async ([lat, lng]) => {
    if (lat != null && lng != null) {
      await ensureMap();
      if (mapInstance.value && markerInstance.value) {
        const position = { lat, lng };
        mapInstance.value.setCenter(position);
        mapInstance.value.setZoom(15);
        markerInstance.value.setPosition(position);
      }
    }
  }
);

watch(
  () => [form.address1, form.address2, form.city, form.state, form.zip, form.country],
  () => {
    if (!manualEntryOpen.value) return;
    scheduleManualGeocode();
  }
);

watch(manualEntryOpen, (open) => {
  if (open) {
    scheduleManualGeocode();
  } else if (manualGeocodeTimeout) {
    clearTimeout(manualGeocodeTimeout);
  }
});

const geocodeManualAddress = async () => {
  if (!googleMapsKey || !form.address1 || !form.city || !form.state) return;
  verifying.value = true;
  verificationError.value = null;
  try {
    await ensureMap();
    const query = [form.address1, form.address2, form.city, form.state, form.zip, form.country]
      .filter(Boolean)
      .join(', ');
    const response = await fetch(
      `https://maps.googleapis.com/maps/api/geocode/json?key=${googleMapsKey}&address=${encodeURIComponent(query)}`
    );
    if (!response.ok) throw new Error('Failed to contact Google Maps');
    const payload = await response.json();
    if (payload.status !== 'OK' || !payload.results?.length) {
      throw new Error('Address not found. Refine and try again.');
    }
    const result = payload.results[0];
    form.formattedAddress = result.formatted_address;
    form.lat = result.geometry.location.lat;
    form.lng = result.geometry.location.lng;
    if (mapInstance.value && markerInstance.value) {
      const position = { lat: form.lat, lng: form.lng };
      mapInstance.value.setCenter(position);
      mapInstance.value.setZoom(16);
      markerInstance.value.setPosition(position);
    }
  } catch (error: any) {
    console.error('[LocationSearchInline] manual geocode failed', error);
    verificationError.value = error?.message || 'Unable to verify address.';
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
  }, 800);
};

const googleMapsKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '';
const autocompleteContainer = ref<HTMLElement | null>(null);
const mapContainer = ref<HTMLElement | null>(null);
const mapInstance = ref<any>(null);
const markerInstance = ref<any>(null);
let autocompleteElement: any = null;
let autocompleteListener: any = null;
let scriptPromise: Promise<void> | null = null;
const hasMapsKey = computed(() => Boolean(googleMapsKey));

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
      draggable: true
    });
    markerInstance.value.addListener('dragend', () => {
      const pos = markerInstance.value.getPosition();
      if (!pos) return;
      form.lat = pos.lat();
      form.lng = pos.lng();
    });
  }
  if (form.lat != null && form.lng != null) {
    const position = { lat: form.lat, lng: form.lng };
    mapInstance.value.setCenter(position);
    mapInstance.value.setZoom(15);
    markerInstance.value.setPosition(position);
  }
};

const handlePlaceSelection = async (place: any) => {
  if (!place) return;
  try {
    await place.fetchFields({ fields: ['formattedAddress', 'addressComponents', 'location'] });
  } catch (error) {
    console.warn('[LocationSearchInline] fetchFields failed', error);
  }
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
    form.address1 = `${streetNumber} ${route}`.trim();
  } else if (place.formattedAddress) {
    form.address1 = place.formattedAddress.split(',')[0] || place.formattedAddress;
  }
  const cityFallback =
    getComponent('locality') ||
    getComponent('sublocality_level_1') ||
    getComponent('administrative_area_level_2');
  if (cityFallback) {
    form.city = cityFallback;
  }
  const state = getComponent('administrative_area_level_1', true);
  if (state) {
    form.state = state;
  }
  const postal = getComponent('postal_code') || getComponent('postal_code', true);
  const postalSuffix = getComponent('postal_code_suffix', true);
  if (postal && postalSuffix) {
    form.zip = `${postal}-${postalSuffix}`;
  } else if (postal) {
    form.zip = postal;
  }
  const country = getComponent('country');
  if (country) {
    form.country = country;
  }
  form.formattedAddress = place.formattedAddress || form.address1;
  manualEntryOpen.value = false;
  let lat: number | null = null;
  let lng: number | null = null;
  if (place.location) {
    if (typeof place.location.lat === 'function') {
      lat = place.location.lat();
      lng = place.location.lng();
    } else {
      lat = place.location.lat ?? place.location.latitude ?? null;
      lng = place.location.lng ?? place.location.longitude ?? null;
    }
  }
  if (lat != null && lng != null) {
    form.lat = lat;
    form.lng = lng;
    if (mapInstance.value && markerInstance.value) {
      const position = { lat, lng };
      mapInstance.value.setCenter(position);
      mapInstance.value.setZoom(16);
      markerInstance.value.setPosition(position);
    }
  }
  suppressManualGeocode = false;
};

const initAutocomplete = async () => {
  if (!googleMapsKey || !autocompleteContainer.value) return;
  await loadMapsScript();
  await window.google.maps.importLibrary('places');
  await ensureMap();
  if (autocompleteElement && autocompleteListener) {
    autocompleteElement.removeEventListener('gmpx-placechange', autocompleteListener);
  }
  autocompleteElement = new window.google.maps.places.PlaceAutocompleteElement({
    componentRestrictions: { country: form.country?.toLowerCase?.() || 'us' }
  });
  autocompleteElement.fields = ['formattedAddress', 'addressComponents', 'location'];
  autocompleteElement.classList.add('inline-autocomplete');
  autocompleteContainer.value.innerHTML = '';
  autocompleteContainer.value.appendChild(autocompleteElement);
  autocompleteListener = (event: any) => {
    event?.preventDefault?.();
    const place = event?.detail?.place || autocompleteElement?.place;
    handlePlaceSelection(place);
  };
  autocompleteElement.addEventListener('gmpx-placechange', autocompleteListener);
};

onMounted(async () => {
  await nextTick();
  initAutocomplete();
});

onBeforeUnmount(() => {
  if (autocompleteElement && autocompleteListener) {
    autocompleteElement.removeEventListener('gmpx-placechange', autocompleteListener);
  }
});
</script>

<template>
  <div class="location-search-inline">
    <q-input v-model="form.name" label="Location nickname" outlined dense autofocus />
    <label class="text-caption text-grey-7">Search address</label>
    <div ref="autocompleteContainer" class="inline-search-input"></div>
    <div class="text-caption text-grey-6 q-mt-xs" v-if="form.formattedAddress">
      {{ form.formattedAddress }}<span v-if="form.zip"> • ZIP {{ form.zip }}</span>
    </div>
    <div ref="mapContainer" class="inline-map q-mt-md"></div>
    <div class="text-caption text-grey-7 q-mt-xs">Drag the marker if the entrance is different.</div>
  </div>
</template>

<style scoped>
.location-search-inline {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.inline-search-input {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid #cfd8dc;
  border-radius: 6px;
  font-size: 14px;
}

.inline-map {
  width: 100%;
  height: 220px;
  border-radius: 8px;
  border: 1px solid #cfd8dc;
  overflow: hidden;
}
</style>
