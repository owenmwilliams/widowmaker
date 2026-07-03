package dev.we3kings.nexusmoves.data.auth

/**
 * Session management — port of iOS AuthService/AuthViewModel semantics:
 * - token in EncryptedSharedPreferences (Keychain equivalent)
 * - checkAuthStatus(): token present → validate via GET /auth/me
 * - ONLY HTTP 401 clears the token; timeouts/offline/5xx keep the session
 *   (iOS PR #66 — "only a real 401 logs out")
 * TODO(android-port).
 */
class AuthRepository
