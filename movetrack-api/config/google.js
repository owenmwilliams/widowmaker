/**
 * Central Google Maps configuration module
 *
 * All Google Maps API credentials and settings should be imported from here
 * to ensure consistent configuration across the application.
 */

const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;

// Validate at startup - warn but don't crash (some features can work without it)
if (!GOOGLE_MAPS_API_KEY) {
  console.warn(
    '[Google Config] WARNING: GOOGLE_MAPS_API_KEY is not set.\n' +
    '  - Geocoding and directions features will use fallback behavior.\n' +
    '  - Set GOOGLE_MAPS_API_KEY in your environment to enable full functionality.\n' +
    '  - Get your key at: https://console.cloud.google.com/apis/credentials'
  );
}

/**
 * Check if Google Maps API is configured
 * @returns {boolean} True if API key is available
 */
function isGoogleMapsConfigured() {
  return Boolean(GOOGLE_MAPS_API_KEY);
}

/**
 * Get the Google Maps API key
 * @returns {string|undefined} The API key or undefined if not configured
 */
function getGoogleMapsApiKey() {
  return GOOGLE_MAPS_API_KEY;
}

/**
 * Require Google Maps API key - throws if not configured
 * Use this in routes that absolutely require Google Maps
 * @throws {Error} If GOOGLE_MAPS_API_KEY is not set
 * @returns {string} The API key
 */
function requireGoogleMapsApiKey() {
  if (!GOOGLE_MAPS_API_KEY) {
    throw new Error(
      'GOOGLE_MAPS_API_KEY is required but not configured. ' +
      'Set it in your environment variables.'
    );
  }
  return GOOGLE_MAPS_API_KEY;
}

module.exports = {
  GOOGLE_MAPS_API_KEY,
  isGoogleMapsConfigured,
  getGoogleMapsApiKey,
  requireGoogleMapsApiKey
};
