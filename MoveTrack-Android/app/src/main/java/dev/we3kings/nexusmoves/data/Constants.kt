package dev.we3kings.nexusmoves.data

import dev.we3kings.nexusmoves.BuildConfig

/**
 * Port of iOS Constants.swift — API base URL, endpoints, and storage keys.
 * The base URL comes from BuildConfig per build type (see app/build.gradle.kts).
 */
object Constants {
    val apiBaseURL: String = BuildConfig.API_BASE_URL

    // movetrack:// deep-link scheme (parity with iOS CFBundleURLSchemes).
    const val urlScheme = "movetrack"

    // EncryptedSharedPreferences file + key (Keychain equivalent).
    const val securePrefsFile = "nexus_secure_prefs"
    const val sessionTokenKey = "sessionToken"

    object Endpoints {
        const val requestCode = "/auth/request-code"
        const val verifyCode = "/auth/verify-code"
        const val verifyMagicLink = "/auth/verify-magic-link"
        const val logout = "/auth/logout"
        const val me = "/auth/me"
    }
}
