<script setup lang="ts">
import { onMounted, ref, watch, toRaw, type PropType } from 'vue';

// Declare google namespace for TypeScript
declare global {
  interface Window {
    google: any;
  }
}

interface Waypoint {
  id: number;
  city: string;
  state?: string;
  lat?: number;
  lng?: number;
  overnight_recommended?: boolean;
  sequence_order: number;
}

interface DropoffLocation {
  id: number;
  name: string;
  address?: string;
  lat?: number;
  lng?: number;
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
  },
  waypoints: {
    type: Array as PropType<Waypoint[]>,
    default: () => []
  },
  dropoffLocations: {
    type: Array as PropType<DropoffLocation[]>,
    default: () => []
  }
});

const mapContainer = ref<HTMLElement | null>(null);
const map = ref<any>(null);
const directionsRenderer = ref<any>(null);
const isLoading = ref(true);
const loadError = ref<string | null>(null);
const waypointMarkers = ref<any[]>([]);
const dropoffMarkers = ref<any[]>([]);
const routePolylineObj = ref<any>(null);
const originMarker = ref<any>(null);
const destinationMarker = ref<any>(null);
const isDev = import.meta.env?.DEV ?? false;

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
      mapTypeControl: false,  // Disable Map/Satellite toggle - force Map view only
      mapTypeId: 'roadmap',   // Force standard map view
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

const clearMapObjects = () => {
  // Clear existing polyline
  // Use toRaw() to unwrap Vue's Proxy - Google Maps objects don't work properly when wrapped
  if (routePolylineObj.value) {
    toRaw(routePolylineObj.value).setMap(null);
    routePolylineObj.value = null;
  }
  // Clear origin/destination markers
  if (originMarker.value) {
    toRaw(originMarker.value).setMap(null);
    originMarker.value = null;
  }
  if (destinationMarker.value) {
    toRaw(destinationMarker.value).setMap(null);
    destinationMarker.value = null;
  }
  // Clear waypoint markers - toRaw() is essential here for proper removal
  waypointMarkers.value.forEach(marker => toRaw(marker).setMap(null));
  waypointMarkers.value = [];
  // Clear dropoff markers
  dropoffMarkers.value.forEach(marker => toRaw(marker).setMap(null));
  dropoffMarkers.value = [];
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

    // Clear existing map objects before rendering new ones
    clearMapObjects();

    // Decode polyline and display route
    const path = window.google.maps.geometry.encoding.decodePath(props.routePolyline);

    // Create polyline
    routePolylineObj.value = new window.google.maps.Polyline({
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
      originMarker.value = new window.google.maps.Marker({
        position: path[0],
        map: map.value,
        title: props.originAddress,
        icon: {
          url: 'https://maps.google.com/mapfiles/ms/icons/green-dot.png'
        }
      });

      // Destination marker (red)
      destinationMarker.value = new window.google.maps.Marker({
        position: path[path.length - 1],
        map: map.value,
        title: props.destinationAddress,
        icon: {
          url: 'https://maps.google.com/mapfiles/ms/icons/red-dot.png'
        }
      });
    }

    // Render waypoint markers if we have waypoints with coordinates
    renderWaypointMarkers(path);

    // Render dropoff location markers if we have any
    renderDropoffMarkers(path);
  } catch (error) {
    console.error('Error rendering route:', error);
    loadError.value = 'Failed to render route on map';
  }
};

const renderWaypointMarkers = (routePath: any[]) => {
  if (!map.value || !props.waypoints?.length) return;

  const sortedWaypoints = [...props.waypoints].sort((a, b) => a.sequence_order - b.sequence_order);

  sortedWaypoints.forEach((waypoint, index) => {
    let position: { lat: number; lng: number } | null = null;

    // If waypoint has lat/lng, use those coordinates (ensure they're numbers)
    if (waypoint.lat != null && waypoint.lng != null) {
      const lat = typeof waypoint.lat === 'string' ? parseFloat(waypoint.lat) : waypoint.lat;
      const lng = typeof waypoint.lng === 'string' ? parseFloat(waypoint.lng) : waypoint.lng;
      // Validate that we have valid numbers
      if (!isNaN(lat) && !isNaN(lng)) {
        position = { lat, lng };
      }
    }

    // Fallback: estimate position along route based on sequence
    if (!position && routePath.length > 0) {
      const fraction = (index + 1) / (sortedWaypoints.length + 1);
      const pathIndex = Math.floor(fraction * routePath.length);
      const pathPoint = routePath[Math.min(pathIndex, routePath.length - 1)];
      if (pathPoint) {
        // pathPoint from decodePath is a LatLng object, extract values
        position = {
          lat: typeof pathPoint.lat === 'function' ? pathPoint.lat() : pathPoint.lat,
          lng: typeof pathPoint.lng === 'function' ? pathPoint.lng() : pathPoint.lng
        };
      }
    }

    if (!position) return;

    // Different icon for overnight vs regular stops
    const iconUrl = waypoint.overnight_recommended
      ? 'https://maps.google.com/mapfiles/ms/icons/orange-dot.png'  // Orange for overnight
      : 'https://maps.google.com/mapfiles/ms/icons/blue-dot.png';   // Blue for regular

    const waypointLabel = `${waypoint.city}${waypoint.state ? `, ${waypoint.state}` : ''}`;

    const marker = new window.google.maps.Marker({
      position: position,
      map: map.value,
      title: waypointLabel + (waypoint.overnight_recommended ? ' (Overnight Stop)' : ''),
      icon: {
        url: iconUrl
      },
      zIndex: 100 + index  // Ensure waypoints appear above route line
    });

    // Add info window on click
    const infoWindow = new window.google.maps.InfoWindow({
      content: `
        <div style="padding: 8px; max-width: 200px;">
          <div style="font-weight: bold; margin-bottom: 4px;">${waypointLabel}</div>
          ${waypoint.overnight_recommended ? '<div style="color: #F57C00; font-size: 12px;">Overnight Stop Recommended</div>' : ''}
          <div style="font-size: 12px; color: #666;">Stop ${index + 1} of ${sortedWaypoints.length}</div>
        </div>
      `
    });

    marker.addListener('click', () => {
      infoWindow.open(map.value, marker);
    });

    waypointMarkers.value.push(marker);
  });
};

// Render drop-off location markers (intermediate destinations) with orange markers
const renderDropoffMarkers = (routePath: any[]) => {
  if (!map.value || !props.dropoffLocations?.length) return;

  if (isDev) {
    console.groupCollapsed('[RouteMap] Drop-off payload');
    console.table(
      props.dropoffLocations.map(dropoff => ({
        id: dropoff.id,
        name: dropoff.name,
        address: dropoff.address,
        lat: dropoff.lat ?? null,
        lng: dropoff.lng ?? null
      }))
    );
    console.groupEnd();
  }

  props.dropoffLocations.forEach((dropoff, index) => {
    let position: { lat: number; lng: number } | null = null;
    let positionSource: 'explicit' | 'polyline' = 'polyline';

    // If dropoff has lat/lng, use those coordinates
    if (dropoff.lat != null && dropoff.lng != null) {
      const lat = typeof dropoff.lat === 'string' ? parseFloat(dropoff.lat) : dropoff.lat;
      const lng = typeof dropoff.lng === 'string' ? parseFloat(dropoff.lng) : dropoff.lng;
      if (!isNaN(lat) && !isNaN(lng)) {
        position = { lat, lng };
        positionSource = 'explicit';
      }
    }

    // Fallback: estimate position along route based on index
    if (!position && routePath.length > 0) {
      // Place dropoffs between origin and destination, evenly spaced
      const fraction = (index + 1) / (props.dropoffLocations!.length + 1);
      const pathIndex = Math.floor(fraction * routePath.length);
      const pathPoint = routePath[Math.min(pathIndex, routePath.length - 1)];
      if (pathPoint) {
        position = {
          lat: typeof pathPoint.lat === 'function' ? pathPoint.lat() : pathPoint.lat,
          lng: typeof pathPoint.lng === 'function' ? pathPoint.lng() : pathPoint.lng
        };
      }
    }

    if (!position) return;

    const marker = new window.google.maps.Marker({
      position: position,
      map: map.value,
      title: `Drop-off: ${dropoff.name}`,
      icon: {
        url: 'https://maps.google.com/mapfiles/ms/icons/orange-dot.png'  // Orange for drop-offs
      },
      zIndex: 200 + index  // Above waypoints
    });

    // Add info window on click
    const infoWindow = new window.google.maps.InfoWindow({
      content: `
        <div style="padding: 8px; max-width: 200px;">
          <div style="font-weight: bold; margin-bottom: 4px; color: #FF9800;">Drop-off Location</div>
          <div style="font-weight: bold;">${dropoff.name}</div>
          ${dropoff.address ? `<div style="font-size: 12px; color: #666; margin-top: 4px;">${dropoff.address}</div>` : ''}
          <div style="font-size: 12px; color: #666; margin-top: 4px;">Stop ${index + 1} of ${props.dropoffLocations!.length}</div>
        </div>
      `
    });

    marker.addListener('click', () => {
      infoWindow.open(map.value, marker);
    });

    if (isDev) {
      console.log('[RouteMap] Drop-off marker', {
        name: dropoff.name,
        address: dropoff.address,
        source: positionSource,
        lat: position.lat,
        lng: position.lng
      });
    }

    dropoffMarkers.value.push(marker);
  });
};

// Watch for route changes
watch(() => props.routePolyline, () => {
  if (map.value && props.routePolyline) {
    renderRoute();
  }
});

// Watch for waypoint changes - handles both additions and deletions
// Using a computed length to ensure reactivity triggers on array changes
watch(
  () => props.waypoints?.length,
  (newLen, oldLen) => {
    console.log(`[RouteMap] Waypoints length changed: ${oldLen ?? 0} -> ${newLen ?? 0}`);

    if (!map.value) {
      console.log('[RouteMap] Map not ready, skipping update');
      return;
    }

    if (props.routePolyline) {
      // Re-render route which includes clearing and re-adding waypoint markers
      console.log('[RouteMap] Re-rendering route with updated waypoints');
      renderRoute();
    } else {
      // No route polyline - clear all waypoint markers and re-add if any exist
      console.log('[RouteMap] No route, clearing and re-rendering waypoint markers');
      waypointMarkers.value.forEach(marker => toRaw(marker).setMap(null));
      waypointMarkers.value = [];
    }
  }
);

// Watch for dropoff location changes
watch(
  () => props.dropoffLocations?.length,
  () => {
    if (!map.value) return;

    if (props.routePolyline) {
      // Re-render route which includes clearing and re-adding all markers
      renderRoute();
    } else {
      // Clear dropoff markers if no route
      dropoffMarkers.value.forEach(marker => toRaw(marker).setMap(null));
      dropoffMarkers.value = [];
    }
  }
);

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
