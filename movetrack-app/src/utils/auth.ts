import axios from 'axios';

const core_url = import.meta.env.VITE_CORE_URL;

/**
 * Validates the current session token by making a lightweight API call
 * Returns true if token is valid, false otherwise
 */
export async function validateSessionToken(): Promise<boolean> {
  const sessionToken = localStorage.getItem('session_token');

  if (!sessionToken) {
    return false;
  }

  try {
    // Make a lightweight request to verify the token is valid
    // Using /users/name endpoint as it's simple and requires auth
    const response = await axios.get(`${core_url}/users/name`, {
      headers: {
        Authorization: `Bearer ${sessionToken}`,
      },
      timeout: 5000, // 5 second timeout
    });

    return response.status === 200;
  } catch (error) {
    // Token is invalid, expired, or API is unreachable
    if (axios.isAxiosError(error) && error.response?.status === 401) {
      console.log('[auth] Session token is invalid or expired');
      return false;
    }

    // For network errors, assume token is still valid to avoid blocking users
    console.warn('[auth] Unable to validate session token:', error);
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
}
