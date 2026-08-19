import axios from 'axios';
import { API_BASE_URL } from '../config/api';

/**
 * Company (mover dashboard) session helpers — issue #99.
 *
 * Companies authenticate with an opaque `cmp_…` session token from
 * POST /api/company/auth/verify. It is stored under DISTINCT localStorage
 * keys from user auth (`session_token` / `user_data`), so logging in as a
 * mover never touches a customer session in the same browser and vice versa.
 */

const TOKEN_KEY = 'company_session_token';
const DATA_KEY = 'company_data';

export type CompanyProfile = {
  id: string;
  name: string;
  contactEmail: string;
};

export function getCompanySessionToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function getCompanyData(): CompanyProfile | null {
  try {
    const raw = localStorage.getItem(DATA_KEY);
    return raw ? (JSON.parse(raw) as CompanyProfile) : null;
  } catch {
    return null;
  }
}

export function setCompanySession(token: string, company: CompanyProfile): void {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(DATA_KEY, JSON.stringify(company));
}

export function clearCompanySession(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(DATA_KEY);
}

/** Authorization header for company API calls. */
export function companyAuthHeaders(): Record<string, string> {
  const token = getCompanySessionToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/**
 * Log the company out: best-effort server revocation, then clear local state.
 */
export async function logoutCompany(): Promise<void> {
  const token = getCompanySessionToken();
  if (token) {
    try {
      await axios.post(`${API_BASE_URL}/api/company/auth/logout`, {}, {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 5000,
      });
    } catch {
      // Server revocation is best-effort — still clear local state.
    }
  }
  clearCompanySession();
}
