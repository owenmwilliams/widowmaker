package dev.we3kings.nexusmoves.data.auth

import dev.we3kings.nexusmoves.data.Constants
import dev.we3kings.nexusmoves.data.api.ApiClient
import dev.we3kings.nexusmoves.data.api.ApiError
import dev.we3kings.nexusmoves.model.AuthResponse
import dev.we3kings.nexusmoves.model.MagicLinkResponse
import dev.we3kings.nexusmoves.model.MeResponse
import dev.we3kings.nexusmoves.model.User
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString

/**
 * Port of iOS AuthService — the OTP login flow and session lifecycle.
 * verify-code persists the returned token to [TokenStore] (Keychain parity).
 */
object AuthService {

    @Serializable private data class EmailBody(val email: String)
    @Serializable private data class VerifyBody(val email: String, val code: String)

    /** POST /auth/request-code — email the user a 6-digit login code. */
    suspend fun requestCode(email: String): MagicLinkResponse =
        ApiClient.post(
            Constants.Endpoints.requestCode,
            ApiClient.json.encodeToString(EmailBody(email)),
            requiresAuth = false,
        )

    /** POST /auth/verify-code — exchange the code for a session token. */
    suspend fun verifyCode(email: String, code: String): AuthResponse {
        val response: AuthResponse = ApiClient.post(
            Constants.Endpoints.verifyCode,
            ApiClient.json.encodeToString(VerifyBody(email, code)),
            requiresAuth = false,
        )
        if (response.success && response.sessionToken != null) {
            TokenStore.sessionToken = response.sessionToken
        }
        return response
    }

    /**
     * GET /auth/verify-magic-link?token=… — the deep-link path (a user taps a
     * magic-link email on their phone with the app installed). Persists the
     * session token on success. The app's own login is OTP; this only handles an
     * inbound magic link.
     */
    suspend fun verifyMagicLink(token: String): AuthResponse {
        val encoded = java.net.URLEncoder.encode(token, "UTF-8")
        val response: AuthResponse = ApiClient.get(
            "${Constants.Endpoints.verifyMagicLink}?token=$encoded",
            requiresAuth = false,
        )
        if (response.success && response.sessionToken != null) {
            TokenStore.sessionToken = response.sessionToken
        }
        return response
    }

    /** GET /auth/me — validate the stored token and load the user. */
    suspend fun getCurrentUser(): User {
        val response: MeResponse = ApiClient.get(Constants.Endpoints.me)
        return response.user
            ?: throw ApiError.ServerError(response.error ?: "Failed to get user")
    }

    /** POST /auth/logout — best-effort; the token is cleared regardless. */
    suspend fun logout() {
        try {
            ApiClient.post<Map<String, String>>(Constants.Endpoints.logout, "{}")
        } catch (_: Exception) {
            // Continue with logout even if the API call fails (iOS parity).
        }
        TokenStore.clear()
    }

    val isLoggedIn: Boolean get() = TokenStore.isLoggedIn
    val sessionToken: String? get() = TokenStore.sessionToken
}
