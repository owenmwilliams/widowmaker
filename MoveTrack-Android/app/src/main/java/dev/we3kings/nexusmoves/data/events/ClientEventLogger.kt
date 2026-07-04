package dev.we3kings.nexusmoves.data.events

import android.os.Build
import dev.we3kings.nexusmoves.BuildConfig
import dev.we3kings.nexusmoves.data.Constants
import dev.we3kings.nexusmoves.data.auth.TokenStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.time.Instant
import java.util.concurrent.TimeUnit

/**
 * Lightweight batched client-event log for the scan/chat pipeline — port of iOS
 * ClientEventLogger. Same event names so dashboards stay unified. NOT a crash
 * reporter: no stack traces, no PII, no retries — best-effort lifecycle only.
 */
object ClientEventLogger {

    enum class Type(val raw: String) {
        UploadStarted("upload_started"),
        UploadSucceeded("upload_succeeded"),
        UploadFailed("upload_failed"),
        SseTimeout("sse_timeout"),
        TurnFailed("turn_failed"),
        ReviewCardShown("review_card_shown"),
        ReviewCardCommitted("review_card_committed"),
    }

    @Serializable
    private data class Event(
        val type: String,
        val sessionId: String? = null,
        val clientAt: String,
        val metadata: Map<String, String>? = null,
    )

    @Serializable
    private data class Batch(val events: List<Event>, val appVersion: String?, val osVersion: String?)

    private val json = Json { encodeDefaults = true; explicitNulls = false }
    private val jsonMedia = "application/json".toMediaType()
    private val http = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(15, TimeUnit.SECONDS)
        .build()

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val mutex = Mutex()
    private val buffer = mutableListOf<Event>()
    private var flushJob: Job? = null

    private const val MAX_BUFFER = 20
    private const val FLUSH_DELAY_MS = 10_000L

    /** Queue an event for the next batch. Fire-and-forget from any thread. */
    fun log(type: Type, sessionId: String? = null, metadata: Map<String, String>? = null) {
        val event = Event(type.raw, sessionId, Instant.now().toString(), metadata)
        scope.launch { enqueue(event) }
    }

    private suspend fun enqueue(event: Event) {
        val shouldFlushNow = mutex.withLock {
            buffer.add(event)
            buffer.size >= MAX_BUFFER
        }
        if (shouldFlushNow) {
            flushJob?.cancel()
            flushJob = scope.launch { flush() }
        } else {
            scheduleFlush()
        }
    }

    private fun scheduleFlush() {
        if (flushJob?.isActive == true) return
        flushJob = scope.launch {
            delay(FLUSH_DELAY_MS)
            flush()
        }
    }

    /** Flush the buffer now (e.g. on process background). Best-effort. */
    suspend fun flush() {
        val toSend = mutex.withLock {
            flushJob = null
            if (buffer.isEmpty()) return
            val copy = buffer.toList()
            buffer.clear()
            copy
        }
        val token = TokenStore.sessionToken ?: return
        val batch = Batch(
            events = toSend,
            appVersion = BuildConfig.VERSION_NAME,
            osVersion = Build.VERSION.RELEASE,
        )
        try {
            val request = Request.Builder()
                .url(Constants.apiBaseURL + "/api/client-events")
                .header("Content-Type", "application/json")
                .header("Authorization", "Bearer $token")
                .post(json.encodeToString(batch).toRequestBody(jsonMedia))
                .build()
            http.newCall(request).execute().use { /* drop the response */ }
        } catch (_: Exception) {
            // Best-effort — drop on failure (iOS parity).
        }
    }

    /** Fire a flush without awaiting (scene-background hook). */
    fun flushBlocking() {
        scope.launch { flush() }
    }
}
