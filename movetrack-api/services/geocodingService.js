/**
 * Centralized Geocoding Service
 *
 * Handles all reverse geocoding requests with:
 * - In-memory caching to avoid repeated API calls
 * - Retry logic with exponential backoff
 * - Consistent address parsing
 * - Detailed logging with correlation IDs
 */

const axios = require('axios');
const { GOOGLE_MAPS_API_KEY, isGoogleMapsConfigured } = require('../config/google');

// In-memory cache for geocoding results
// Key: "lat,lng" (rounded to 4 decimal places ~11m accuracy)
// Value: { city, state, country, timestamp }
const geocodeCache = new Map();

// Cache configuration
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const CACHE_PRECISION = 4; // Decimal places for lat/lng rounding

// Retry configuration
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 500;
const MAX_DELAY_MS = 5000;

/**
 * Generate a cache key from lat/lng coordinates
 * Rounds to CACHE_PRECISION decimal places to allow nearby coords to share cache
 * @param {number} lat - Latitude
 * @param {number} lng - Longitude
 * @returns {string} Cache key
 */
function getCacheKey(lat, lng) {
  const roundedLat = Number(lat.toFixed(CACHE_PRECISION));
  const roundedLng = Number(lng.toFixed(CACHE_PRECISION));
  return `${roundedLat},${roundedLng}`;
}

/**
 * Check if a cached entry is still valid
 * @param {Object} entry - Cache entry with timestamp
 * @returns {boolean} True if entry is still valid
 */
function isCacheValid(entry) {
  if (!entry || !entry.timestamp) return false;
  return Date.now() - entry.timestamp < CACHE_TTL_MS;
}

/**
 * Sleep for a given number of milliseconds
 * @param {number} ms - Milliseconds to sleep
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Calculate exponential backoff delay
 * @param {number} attempt - Current attempt number (0-based)
 * @returns {number} Delay in milliseconds
 */
function getBackoffDelay(attempt) {
  const delay = Math.min(BASE_DELAY_MS * Math.pow(2, attempt), MAX_DELAY_MS);
  // Add jitter (0-25% of delay) to prevent thundering herd
  const jitter = Math.random() * delay * 0.25;
  return Math.floor(delay + jitter);
}

/**
 * Parse address components from Google Geocoding API response
 * @param {Object[]} results - Google Geocoding API results array
 * @returns {Object} Parsed address { city, state, country }
 */
function parseAddressComponents(results) {
  let city = null;
  let state = null;
  let country = null;

  // Priority order for city: locality > sublocality > admin_area_level_3 > admin_area_level_2
  for (const result of results) {
    for (const component of result.address_components || []) {
      const types = component.types;

      // City extraction with priority
      if (!city && types.includes('locality')) {
        city = component.long_name;
      } else if (!city && types.includes('sublocality_level_1')) {
        city = component.long_name;
      } else if (!city && types.includes('administrative_area_level_3')) {
        city = component.long_name;
      } else if (!city && types.includes('administrative_area_level_2')) {
        // County name as last resort
        city = component.long_name;
      }

      // State extraction
      if (!state && types.includes('administrative_area_level_1')) {
        state = component.short_name; // Use abbreviation (e.g., "CA" instead of "California")
      }

      // Country extraction
      if (!country && types.includes('country')) {
        country = component.short_name; // Use country code (e.g., "US")
      }
    }

    // If we have a city, we can stop looking
    if (city) break;
  }

  return { city, state, country };
}

/**
 * Reverse geocode coordinates to get city/state/country
 *
 * @param {number} lat - Latitude
 * @param {number} lng - Longitude
 * @param {Object} options - Optional settings
 * @param {string} options.correlationId - Request correlation ID for logging
 * @param {boolean} options.skipCache - Skip cache lookup (default: false)
 * @returns {Promise<Object>} Result { city, state, country, source: 'cache'|'api'|'fallback' }
 */
async function reverseGeocode(lat, lng, options = {}) {
  const { correlationId = 'unknown', skipCache = false } = options;
  const logPrefix = `[Geocoding ${correlationId}]`;

  // Validate inputs
  if (typeof lat !== 'number' || typeof lng !== 'number' || isNaN(lat) || isNaN(lng)) {
    console.warn(`${logPrefix} Invalid coordinates: lat=${lat}, lng=${lng}`);
    return { city: null, state: null, country: null, source: 'error' };
  }

  const cacheKey = getCacheKey(lat, lng);

  // Check cache first
  if (!skipCache) {
    const cached = geocodeCache.get(cacheKey);
    if (isCacheValid(cached)) {
      console.log(`${logPrefix} Cache hit for ${cacheKey}: ${cached.city}, ${cached.state}`);
      return { ...cached, source: 'cache' };
    }
  }

  // Check if Google Maps is configured
  if (!isGoogleMapsConfigured()) {
    console.log(`${logPrefix} Google Maps not configured, returning null`);
    return { city: null, state: null, country: null, source: 'not_configured' };
  }

  // Make API request with retry logic
  let lastError = null;
  let lastStatus = null;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      // Add delay before retries (not before first attempt)
      if (attempt > 0) {
        const delay = getBackoffDelay(attempt - 1);
        console.log(`${logPrefix} Retry ${attempt}/${MAX_RETRIES - 1} after ${delay}ms delay`);
        await sleep(delay);
      }

      const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${GOOGLE_MAPS_API_KEY}`;

      console.log(`${logPrefix} Requesting geocode for ${lat},${lng} (attempt ${attempt + 1}/${MAX_RETRIES})`);

      const response = await axios.get(url, {
        timeout: 10000, // 10 second timeout
        validateStatus: () => true // Don't throw on HTTP errors
      });

      const { status, results, error_message } = response.data;
      lastStatus = status;

      // Handle successful response
      if (status === 'OK' && results && results.length > 0) {
        const parsed = parseAddressComponents(results);

        console.log(`${logPrefix} Success: ${parsed.city || 'unknown city'}, ${parsed.state || 'unknown state'}`);

        // Store in cache
        const cacheEntry = {
          city: parsed.city,
          state: parsed.state,
          country: parsed.country || 'US',
          timestamp: Date.now()
        };
        geocodeCache.set(cacheKey, cacheEntry);

        return { ...cacheEntry, source: 'api' };
      }

      // Handle ZERO_RESULTS - not an error, just no data
      if (status === 'ZERO_RESULTS') {
        console.log(`${logPrefix} No results for coordinates ${lat},${lng}`);
        return { city: null, state: null, country: null, source: 'no_results' };
      }

      // Handle retryable errors
      if (status === 'OVER_QUERY_LIMIT' || status === 'REQUEST_DENIED') {
        console.warn(`${logPrefix} Retryable error: ${status} - ${error_message || 'No error message'}`);
        lastError = new Error(`${status}: ${error_message || 'Unknown error'}`);

        // If this is REQUEST_DENIED, log helpful info
        if (status === 'REQUEST_DENIED') {
          console.error(`${logPrefix} REQUEST_DENIED - ensure Geocoding API is enabled at: https://console.cloud.google.com/apis/library/geocoding-backend.googleapis.com`);
        }

        // Continue to retry
        continue;
      }

      // Handle non-retryable errors
      console.error(`${logPrefix} Non-retryable error: ${status} - ${error_message || 'No error message'}`);
      return { city: null, state: null, country: null, source: 'error' };

    } catch (error) {
      lastError = error;
      console.error(`${logPrefix} Network error on attempt ${attempt + 1}: ${error.message}`);

      // Network errors are retryable
      if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
        continue;
      }

      // Other errors might not be retryable
      if (attempt === MAX_RETRIES - 1) {
        break;
      }
    }
  }

  // All retries exhausted
  console.error(`${logPrefix} All ${MAX_RETRIES} attempts failed. Last status: ${lastStatus}, Last error: ${lastError?.message}`);
  return { city: null, state: null, country: null, source: 'failed' };
}

/**
 * Batch reverse geocode multiple coordinates
 * Adds delay between requests to avoid rate limiting
 *
 * @param {Array<{lat: number, lng: number, id: any}>} coordinates - Array of coordinate objects
 * @param {Object} options - Optional settings
 * @param {string} options.correlationId - Request correlation ID for logging
 * @param {number} options.delayBetweenRequests - MS delay between API requests (default: 300)
 * @returns {Promise<Map<any, Object>>} Map of id -> geocode result
 */
async function batchReverseGeocode(coordinates, options = {}) {
  const { correlationId = 'batch', delayBetweenRequests = 300 } = options;
  const results = new Map();

  console.log(`[Geocoding ${correlationId}] Starting batch geocode for ${coordinates.length} coordinates`);

  for (let i = 0; i < coordinates.length; i++) {
    const { lat, lng, id } = coordinates[i];

    // Add delay between requests (not before first)
    if (i > 0) {
      await sleep(delayBetweenRequests);
    }

    const result = await reverseGeocode(lat, lng, {
      correlationId: `${correlationId}-${i + 1}/${coordinates.length}`
    });

    results.set(id, result);
  }

  // Log summary
  const cacheHits = Array.from(results.values()).filter(r => r.source === 'cache').length;
  const apiCalls = Array.from(results.values()).filter(r => r.source === 'api').length;
  const failures = Array.from(results.values()).filter(r => r.source === 'failed' || r.source === 'error').length;

  console.log(`[Geocoding ${correlationId}] Batch complete: ${cacheHits} cache hits, ${apiCalls} API calls, ${failures} failures`);

  return results;
}

// Separate cache for forward geocoding (address -> lat/lng)
const forwardGeocodeCache = new Map();

/**
 * Forward geocode an address to get lat/lng coordinates
 * Uses Google Geocoding API with caching and retry logic
 *
 * @param {string} city - City name
 * @param {string} state - State code (e.g., "PA", "CA")
 * @param {string} country - Country code (default: "USA")
 * @param {Object} options - Optional settings
 * @param {string} options.correlationId - Request correlation ID for logging
 * @param {boolean} options.skipCache - Skip cache lookup (default: false)
 * @returns {Promise<Object>} Result { lat, lng, formattedAddress, source }
 */
async function forwardGeocode(city, state, country = 'USA', options = {}) {
  const { correlationId = 'unknown', skipCache = false } = options;
  const logPrefix = `[Geocoding ${correlationId}]`;

  // Validate inputs
  if (!city || typeof city !== 'string') {
    console.warn(`${logPrefix} Invalid city: ${city}`);
    return { lat: null, lng: null, formattedAddress: null, source: 'error' };
  }

  // Build address string for geocoding
  const addressParts = [city];
  if (state) addressParts.push(state);
  if (country) addressParts.push(country);
  const address = addressParts.join(', ');

  // Create cache key from normalized address
  const cacheKey = `fwd:${address.toLowerCase().replace(/\s+/g, ' ').trim()}`;

  // Check cache first
  if (!skipCache) {
    const cached = forwardGeocodeCache.get(cacheKey);
    if (isCacheValid(cached)) {
      console.log(`${logPrefix} Forward cache hit for "${address}": ${cached.lat}, ${cached.lng}`);
      return { ...cached, source: 'cache' };
    }
  }

  // Check if Google Maps is configured
  if (!isGoogleMapsConfigured()) {
    console.log(`${logPrefix} Google Maps not configured, returning null`);
    return { lat: null, lng: null, formattedAddress: null, source: 'not_configured' };
  }

  // Make API request with retry logic
  let lastError = null;
  let lastStatus = null;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      // Add delay before retries (not before first attempt)
      if (attempt > 0) {
        const delay = getBackoffDelay(attempt - 1);
        console.log(`${logPrefix} Retry ${attempt}/${MAX_RETRIES - 1} after ${delay}ms delay`);
        await sleep(delay);
      }

      const encodedAddress = encodeURIComponent(address);
      const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodedAddress}&key=${GOOGLE_MAPS_API_KEY}`;

      console.log(`${logPrefix} Forward geocoding "${address}" (attempt ${attempt + 1}/${MAX_RETRIES})`);

      const response = await axios.get(url, {
        timeout: 10000,
        validateStatus: () => true
      });

      const { status, results, error_message } = response.data;
      lastStatus = status;

      // Handle successful response
      if (status === 'OK' && results && results.length > 0) {
        const location = results[0].geometry.location;
        const formattedAddress = results[0].formatted_address;

        console.log(`${logPrefix} Forward geocode success: ${formattedAddress} -> ${location.lat}, ${location.lng}`);

        // Store in cache
        const cacheEntry = {
          lat: location.lat,
          lng: location.lng,
          formattedAddress,
          timestamp: Date.now()
        };
        forwardGeocodeCache.set(cacheKey, cacheEntry);

        return { ...cacheEntry, source: 'api' };
      }

      // Handle ZERO_RESULTS
      if (status === 'ZERO_RESULTS') {
        console.log(`${logPrefix} No results for address "${address}"`);
        return { lat: null, lng: null, formattedAddress: null, source: 'no_results' };
      }

      // Handle retryable errors
      if (status === 'OVER_QUERY_LIMIT' || status === 'REQUEST_DENIED') {
        console.warn(`${logPrefix} Retryable error: ${status} - ${error_message || 'No error message'}`);
        lastError = new Error(`${status}: ${error_message || 'Unknown error'}`);
        continue;
      }

      // Handle non-retryable errors
      console.error(`${logPrefix} Non-retryable error: ${status} - ${error_message || 'No error message'}`);
      return { lat: null, lng: null, formattedAddress: null, source: 'error' };

    } catch (error) {
      lastError = error;
      console.error(`${logPrefix} Network error on attempt ${attempt + 1}: ${error.message}`);

      if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
        continue;
      }

      if (attempt === MAX_RETRIES - 1) {
        break;
      }
    }
  }

  // All retries exhausted
  console.error(`${logPrefix} All ${MAX_RETRIES} attempts failed. Last status: ${lastStatus}, Last error: ${lastError?.message}`);
  return { lat: null, lng: null, formattedAddress: null, source: 'failed' };
}

/**
 * Clear the geocoding cache
 * Useful for testing or when you need fresh data
 */
function clearCache() {
  const reverseSize = geocodeCache.size;
  const forwardSize = forwardGeocodeCache.size;
  geocodeCache.clear();
  forwardGeocodeCache.clear();
  console.log(`[Geocoding] Cache cleared (${reverseSize} reverse + ${forwardSize} forward entries removed)`);
}

/**
 * Get cache statistics
 * @returns {Object} Cache stats
 */
function getCacheStats() {
  let validEntries = 0;
  let expiredEntries = 0;

  for (const entry of geocodeCache.values()) {
    if (isCacheValid(entry)) {
      validEntries++;
    } else {
      expiredEntries++;
    }
  }

  return {
    totalEntries: geocodeCache.size,
    validEntries,
    expiredEntries,
    cacheTtlMs: CACHE_TTL_MS
  };
}

module.exports = {
  reverseGeocode,
  batchReverseGeocode,
  forwardGeocode,
  clearCache,
  getCacheStats,
  // Export for testing
  parseAddressComponents,
  getCacheKey
};
