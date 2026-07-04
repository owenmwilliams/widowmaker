package dev.we3kings.nexusmoves.ui.auth

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dev.we3kings.nexusmoves.data.api.ApiError
import dev.we3kings.nexusmoves.data.auth.AuthService
import dev.we3kings.nexusmoves.model.User
import kotlinx.coroutines.launch

/**
 * Port of iOS AuthViewModel. Owns the launch gate and OTP login flow.
 *
 * The launch gate is the whole point of PR #66: while a stored token is being
 * validated the UI shows the splash (never login), and — critically — ONLY a
 * real HTTP 401 ends the session. A timeout / offline / 5xx sets
 * [authCheckFailed] so the splash can offer "Try Again" with the token kept.
 */
class AuthViewModel : ViewModel() {
    var isAuthenticated by mutableStateOf(false); private set
    var currentUser by mutableStateOf<User?>(null); private set
    var isLoading by mutableStateOf(false); private set
    var errorMessage by mutableStateOf<String?>(null)

    // While a stored session is being validated the UI shows the splash, never
    // the login screen — a valid session must not be able to start a second
    // login, and a network blip must not read as "logged out".
    var isCheckingAuth by mutableStateOf(AuthService.isLoggedIn); private set
    var authCheckFailed by mutableStateOf(false); private set

    init {
        checkAuthStatus()
    }

    fun checkAuthStatus() {
        if (!AuthService.isLoggedIn) {
            isAuthenticated = false
            isCheckingAuth = false
            return
        }
        isCheckingAuth = true
        authCheckFailed = false
        viewModelScope.launch { loadCurrentUser() }
    }

    /** Retry after an unreachable-server launch (the splash "Try Again"). */
    fun retryAuthCheck() = checkAuthStatus()

    /**
     * Handle an inbound magic-link deep link (movetrack://login?token=…). Shows
     * the splash while verifying so the UI doesn't flash login mid-verify.
     */
    fun handleMagicLink(token: String) {
        isCheckingAuth = true
        authCheckFailed = false
        viewModelScope.launch {
            isLoading = true
            errorMessage = null
            try {
                val response = AuthService.verifyMagicLink(token)
                if (response.success && response.user != null) {
                    currentUser = response.user
                    isAuthenticated = true
                } else {
                    errorMessage = response.error ?: "That sign-in link is invalid or expired."
                }
            } catch (e: Exception) {
                errorMessage = friendlyError(e)
            }
            isLoading = false
            isCheckingAuth = false
        }
    }

    private suspend fun loadCurrentUser() {
        try {
            currentUser = AuthService.getCurrentUser()
            isAuthenticated = true
            authCheckFailed = false
        } catch (e: ApiError.Unauthorized) {
            // Real 401 — the server rejected the token (ApiClient already
            // cleared it). This is the ONLY case that ends the session.
            currentUser = null
            isAuthenticated = false
        } catch (e: Exception) {
            // Timeout, offline, 5xx: the session is still good — keep the token
            // and let the splash offer a retry.
            authCheckFailed = true
        }
        isCheckingAuth = false
    }

    /** Request an OTP code. Returns true if the send succeeded. */
    suspend fun requestCode(email: String): Boolean {
        isLoading = true
        errorMessage = null
        val ok = try {
            val response = AuthService.requestCode(email)
            if (response.success) true
            else { errorMessage = response.error ?: "Failed to send code"; false }
        } catch (e: Exception) {
            errorMessage = friendlyError(e); false
        }
        isLoading = false
        return ok
    }

    /** Verify an OTP code. On success, sets [currentUser] + [isAuthenticated]. */
    suspend fun verifyCode(email: String, code: String): Boolean {
        isLoading = true
        errorMessage = null
        val ok = try {
            val response = AuthService.verifyCode(email, code)
            if (response.success && response.user != null) {
                currentUser = response.user
                isAuthenticated = true
                true
            } else {
                errorMessage = response.error ?: "Invalid or expired code"; false
            }
        } catch (e: Exception) {
            errorMessage = friendlyError(e); false
        }
        isLoading = false
        return ok
    }

    fun logout() {
        viewModelScope.launch {
            isLoading = true
            try {
                AuthService.logout()
            } catch (_: Exception) {
            }
            currentUser = null
            isAuthenticated = false
            isLoading = false
            isCheckingAuth = false
            authCheckFailed = false
        }
    }

    private fun friendlyError(e: Exception): String = when (e) {
        is ApiError.ServerError -> e.serverMessage
        is ApiError -> e.message ?: "Something went wrong"
        else -> e.message ?: "Something went wrong"
    }
}
