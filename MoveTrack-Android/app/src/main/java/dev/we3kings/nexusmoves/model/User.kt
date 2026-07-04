package dev.we3kings.nexusmoves.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * Port of iOS User.swift. The auth wire is snake_case (the iOS APIClient uses
 * convertFrom/ToSnakeCase); every field is annotated explicitly rather than
 * relying on an experimental global naming strategy. Confirmed against
 * movetrack-api authService.getUserFromToken (user_id, first_name, …).
 */
@Serializable
data class User(
    @SerialName("user_id") val id: String,
    val email: String,
    @SerialName("first_name") val firstName: String? = null,
    @SerialName("last_name") val lastName: String? = null,
    @SerialName("onboarding_completed") val onboardingCompleted: Boolean = false,
    @SerialName("email_verified") val emailVerified: Boolean = false,
    val plan: String = "free",
    @SerialName("is_admin") val isAdmin: Boolean = false,
) {
    val displayName: String
        get() = when {
            firstName != null && lastName != null -> "$firstName $lastName"
            firstName != null -> firstName
            else -> email
        }

    val isPro: Boolean get() = plan == "pro"
}

/** Response of POST /auth/verify-code. The server emits both keys; we read either. */
@Serializable
data class AuthResponse(
    val success: Boolean = false,
    @SerialName("session_token") val sessionToken: String? = null,
    val user: User? = null,
    val error: String? = null,
)

/** Response of POST /auth/request-code. */
@Serializable
data class MagicLinkResponse(
    val success: Boolean = false,
    val message: String? = null,
    val error: String? = null,
)

/** Response of GET /auth/me. */
@Serializable
data class MeResponse(
    val success: Boolean = false,
    val user: User? = null,
    val error: String? = null,
)
