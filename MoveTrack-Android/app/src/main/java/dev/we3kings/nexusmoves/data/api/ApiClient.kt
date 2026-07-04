package dev.we3kings.nexusmoves.data.api

import dev.we3kings.nexusmoves.BuildConfig
import kotlinx.serialization.json.Json
import okhttp3.OkHttpClient
import java.util.concurrent.TimeUnit

/**
 * HTTP layer — port of iOS APIClient.swift + NexusService.swift. Same wire
 * contract as iOS and web; all intelligence is server-side.
 *
 * Endpoints (all under the movetrack-api base URL):
 *   POST /auth/request-code                         { email }
 *   POST /auth/verify-code                          { email, code }
 *   GET  /auth/me
 *   POST /auth/logout
 *   GET  /api/agents/nexus/active-session
 *   POST /api/agents/nexus/message                  (SSE)
 *   POST /api/agents/nexus/upload                   (multipart "file" — photos)
 *   POST /api/agents/nexus/upload-url               (signed PUT — videos)
 *   POST /api/agents/nexus/scan-jobs                { mediaUrl, mediaUrls?, mimeType, caption?, idempotencyKey, sessionId?, roomHint? }
 *   GET  /api/agents/nexus/scan-jobs[/:id]
 *   POST /api/agents/nexus/scan-jobs/:id/consume
 *   POST /api/agents/nexus/inventory/commit         { items, room?, scanId }
 *   POST /api/agents/nexus/inventory/resolve-duplicates
 *   POST /api/agents/nexus/rescan                   { url, urls?, mimeType, room? }
 *   GET  /api/agents/nexus/share-readiness
 *   POST /api/agents/nexus/client-events
 *
 * Error contract (port of iOS APIClient): 401 → clear token + treat as logged
 * out; 5xx/network → retryable, NEVER a logout.
 */
object ApiClient {
    // Base URL is per-build-type via BuildConfig (see app/build.gradle.kts) —
    // the parity of iOS Constants.apiBaseURL. Debug and release both point at
    // Cloud Run today; flip DEBUG_API_URL in the gradle file for local backend dev.
    val BASE_URL: String = BuildConfig.API_BASE_URL

    val json = Json { ignoreUnknownKeys = true }

    val http: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(30, TimeUnit.SECONDS)
        .readTimeout(60, TimeUnit.SECONDS)
        .build()

    // TODO(android-port): request helpers (auth header from AuthRepository,
    // JSON encode/decode, typed error mapping), SSE reader for /message.
}
