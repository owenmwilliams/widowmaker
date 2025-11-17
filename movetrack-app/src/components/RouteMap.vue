<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';

// Declare google namespace for TypeScript
declare global {
  interface Window {
    google: any;
  }
}

const props = defineProps({
  routePolyline: {
    type: String,
    default: null
  },
  originAddress: {
    type: String,
    required: true
  },
  destinationAddress: {
    type: String,
    required: true
  },
  height: {
    type: String,
    default: '400px'
  }
});

const mapContainer = ref<HTMLElement | null>(null);
const map = ref<any>(null);
const directionsRenderer = ref<any>(null);
const isLoading = ref(true);
const loadError = ref<string | null>(null);

const GOOGLE_MAPS_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '';

const initMap = async () => {
  if (!mapContainer.value) return;

  try {
    isLoading.value = true;
    loadError.value = null;

    // Load Google Maps JavaScript API
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${GOOGLE_MAPS_API_KEY}&libraries=geometry,marker&v=weekly`;
    script.async = true;
    script.defer = true;

    // Wait for script to load
    await new Promise((resolve, reject) => {
      script.onload = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    });

    // Verify Google Maps loaded
    if (!window.google?.maps) {
      throw new Error('Google Maps failed to load');
    }

    // Initialize map centered on US
    map.value = new window.google.maps.Map(mapContainer.value, {
      center: { lat: 39.8283, lng: -98.5795 }, // Geographic center of USA
      zoom: 4,
      mapTypeControl: true,
      streetViewControl: false,
      fullscreenControl: true,
      zoomControl: true,
      scaleControl: true
    });

    // Initialize directions renderer (not actively used, but available for future)
    directionsRenderer.value = new window.google.maps.DirectionsRenderer({
      map: map.value,
      suppressMarkers: false,
      polylineOptions: {
        strokeColor: '#1976D2',
        strokeWeight: 5,
        strokeOpacity: 0.8
      }
    });

    // Render route if we have polyline data
    if (props.routePolyline) {
      renderRoute();
    }

    isLoading.value = false;
  } catch (error) {
    console.error('Error loading Google Maps:', error);
    loadError.value = 'Failed to load map. Please check your Google Maps API key.';
    isLoading.value = false;
  }
};

const renderRoute = () => {
  if (!map.value || !props.routePolyline) return;

  try {
    // Check if google.maps.geometry is loaded
    if (!window.google?.maps?.geometry?.encoding) {
      console.error('Google Maps geometry library not loaded');
      loadError.value = 'Map geometry library failed to load';
      return;
    }

    // Decode polyline and display route
    const path = window.google.maps.geometry.encoding.decodePath(props.routePolyline);

    // Create polyline
    const routeLine = new window.google.maps.Polyline({
      path: path,
      strokeColor: '#1976D2',
      strokeWeight: 5,
      strokeOpacity: 0.8,
      map: map.value
    });

    // Fit bounds to show entire route
    const bounds = new window.google.maps.LatLngBounds();
    path.forEach((point: any) => bounds.extend(point));
    map.value.fitBounds(bounds);

    // Add markers for origin and destination
    if (path.length > 0) {
      // Origin marker (green)
      new window.google.maps.Marker({
        position: path[0],
        map: map.value,
        title: props.originAddress,
        label: {
          text: 'A',
          color: 'white',
          fontWeight: 'bold'
        },
        icon: {
          url: 'https://maps.google.com/mapfiles/ms/icons/green-dot.png'
        }
      });

      // Destination marker (red)
      new window.google.maps.Marker({
        position: path[path.length - 1],
        map: map.value,
        title: props.destinationAddress,
        label: {
          text: 'B',
          color: 'white',
          fontWeight: 'bold'
        },
        icon: {
          url: 'https://maps.google.com/mapfiles/ms/icons/red-dot.png'
        }
      });
    }
  } catch (error) {
    console.error('Error rendering route:', error);
    loadError.value = 'Failed to render route on map';
  }
};

// Watch for route changes
watch(() => props.routePolyline, () => {
  if (map.value && props.routePolyline) {
    renderRoute();
  }
});

onMounted(() => {
  initMap();
});
</script>

<template>
  <div class="route-map-wrapper">
    <div v-if="isLoading" class="map-loading">
      <q-spinner color="primary" size="50px" />
      <div class="text-caption text-grey-7 q-mt-sm">Loading map...</div>
    </div>
    <div v-else-if="loadError" class="map-error">
      <q-icon name="error" color="negative" size="50px" />
      <div class="text-body2 text-negative q-mt-sm">{{ loadError }}</div>
    </div>
    <div
      ref="mapContainer"
      class="map-container"
      :style="{ height: height }"
      v-show="!isLoading && !loadError"
    ></div>
  </div>
</template>

<style scoped>
.route-map-wrapper {
  position: relative;
  width: 100%;
  border-radius: 8px;
  overflow: hidden;
  background: #f5f5f5;
}

.map-container {
  width: 100%;
  border-radius: 8px;
}

.map-loading,
.map-error {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 400px;
  background: #fafafa;
}
</style>
