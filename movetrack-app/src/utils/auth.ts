import axios from 'axios';

const core_url = import.meta.env.VITE_CORE_URL;

// Cache validation results to avoid repeated API calls
let lastValidationTime = 0;
let lastValidationResult = false;
let lastValidatedToken: string | null = null;
const VALIDATION_CACHE_MS = 60000; // Cache for 1 minute

/**
 * Validates the current session token by making a lightweight API call
 * Returns true if token is valid, false otherwise
 * Uses caching to avoid repeated API calls during navigation
 */
export async function validateSessionToken(): Promise<boolean> {
  const sessionToken = localStorage.getItem('session_token');

  if (!sessionToken) {
    console.log('[auth] No session token found');
    return false;
  }

  // Return cached result if token hasn't changed and cache is still fresh
  const now = Date.now();
  if (
    sessionToken === lastValidatedToken &&
    lastValidationResult &&
    now - lastValidationTime < VALIDATION_CACHE_MS
  ) {
    console.log('[auth] Using cached validation result (valid)');
    return true;
  }

  console.log('[auth] Making API call to validate token...');

  try {
    // Make a lightweight request to verify the token is valid
    // Using /auth/me endpoint which is designed for session validation
    const response = await axios.get(`${core_url}/auth/me`, {
      headers: {
        Authorization: `Bearer ${sessionToken}`,
      },
      timeout: 5000, // 5 second timeout
    });

    const isValid = response.status === 200;
    console.log('[auth] Token validation response:', response.status, isValid);

    // Cache the result
    lastValidatedToken = sessionToken;
    lastValidationResult = isValid;
    lastValidationTime = now;

    return isValid;
  } catch (error) {
    // Token is invalid, expired, or API is unreachable
    if (axios.isAxiosError(error) && error.response?.status === 401) {
      console.log('[auth] Session token is invalid or expired (401)');
      lastValidatedToken = sessionToken;
      lastValidationResult = false;
      lastValidationTime = now;
      return false;
    }

    // For network errors, assume token is still valid to avoid blocking users
    console.warn('[auth] Unable to validate session token (network error):', error.message);
    return true;
  }
}

/**
 * Clears all authentication data from localStorage
 */
export function clearAuthData(): void {
  localStorage.removeItem('session_token');
  localStorage.removeItem('user_data');

  // Clear any onboarding keys
  const keys = Object.keys(localStorage);
  keys.forEach(key => {
    if (key.startsWith('onboarding_completed:')) {
      localStorage.removeItem(key);
    }
  });

  // Clear validation cache
  lastValidatedToken = null;
  lastValidationResult = false;
  lastValidationTime = 0;
}
