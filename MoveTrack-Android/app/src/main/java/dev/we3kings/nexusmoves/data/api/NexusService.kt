package dev.we3kings.nexusmoves.data.api

import dev.we3kings.nexusmoves.data.Constants
import dev.we3kings.nexusmoves.data.auth.TokenStore
import dev.we3kings.nexusmoves.model.ActiveSessionResponse
import dev.we3kings.nexusmoves.model.DetectedItem
import dev.we3kings.nexusmoves.model.DetectedItemsReview
import dev.we3kings.nexusmoves.model.OutgoingAttachment
import dev.we3kings.nexusmoves.model.ReviewedItemPayload
import dev.we3kings.nexusmoves.model.SSEEvent
import dev.we3kings.nexusmoves.model.ScanJobDTO
import dev.we3kings.nexusmoves.model.ScanJobListResponse
import dev.we3kings.nexusmoves.model.ShareDTO
import dev.we3kings.nexusmoves.model.ShareReadinessDTO
import dev.we3kings.nexusmoves.model.SignedUpload
import dev.we3kings.nexusmoves.model.UploadResponse
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import java.util.concurrent.TimeUnit

/**
 * Native networking for the Nexus agent — port of iOS NexusService. Consumes
 * Server-Sent Events off the OkHttp response body so the whole flow is native.
 * All requests carry the session token as a Bearer header. The wire is camelCase
 * (no snake conversion — that's the auth/ApiClient side).
 *
 * Phase 2 covers session/history, SSE /message + /guidance, share links,
 * readiness, scan-jobs, commit, rescan, resolve-duplicates, and clear-session.
 * The media upload methods (multipart photos + signed-URL video PUT with
 * progress) land in Phase 3 (MediaUploader).
 */
object NexusService {

    val json = Json {
        ignoreUnknownKeys = true
        coerceInputValues = true
        explicitNulls = false
        encodeDefaults = true
    }

    private val jsonMedia = "application/json".toMediaType()

    // The orchestrator can think/delegate for a while between SSE chunks; a stall
    // of 120s reads as the soft "stopped responding" timeout (iOS parity).
    private val http: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(30, TimeUnit.SECONDS)
        .readTimeout(120, TimeUnit.SECONDS)
        .callTimeout(600, TimeUnit.SECONDS)
        .build()

    private fun url(path: String) = Constants.apiBaseURL + path

    private fun Request.Builder.auth(): Request.Builder = apply {
        TokenStore.sessionToken?.let { header("Authorization", "Bearer $it") }
    }

    /** Validate + return the success body, mapping 401 → clear token + Unauthorized. */
    private fun validate(response: Response): String {
        val body = response.body?.string() ?: ""
        return when {
            response.code in 200..299 -> body
            response.code == 401 -> {
                TokenStore.clear()
                throw ApiError.Unauthorized
            }
            else -> throw ApiError.ServerError(errorMessage(body) ?: "Request failed (${response.code})")
        }
    }

    private fun errorMessage(body: String): String? = try {
        (json.parseToJsonElement(body) as? JsonObject)?.get("error")?.jsonPrimitive?.content
    } catch (_: Exception) {
        null
    }

    private suspend fun requestBody(
        method: String,
        path: String,
        jsonBody: String? = null,
    ): String = withContext(Dispatchers.IO) {
        val builder = Request.Builder().url(url(path)).header("Content-Type", "application/json").auth()
        when (method) {
            "GET" -> builder.get()
            "DELETE" -> builder.delete(jsonBody?.toRequestBody(jsonMedia))
            else -> builder.method(method, (jsonBody ?: "").toRequestBody(jsonMedia))
        }
        val response = try {
            http.newCall(builder.build()).execute()
        } catch (e: Exception) {
            throw ApiError.NetworkError(e)
        }
        response.use { validate(it) }
    }

    private inline fun <reified T> decode(body: String): T = try {
        json.decodeFromString(body)
    } catch (e: Exception) {
        throw ApiError.DecodingError(e)
    }

    // MARK: - Active session + history

    suspend fun loadActiveSession(): ActiveSessionResponse =
        decode(requestBody("GET", "/api/agents/nexus/active-session"))

    // MARK: - Send message (SSE)

    @Serializable
    private data class MessageBody(val message: String, val attachments: List<OutgoingAttachment>)

    /**
     * Send a message and stream progress via [onEvent] (delivered on Main).
     * Returns the terminal `done` event (with reply, actions, …).
     */
    suspend fun sendMessage(
        text: String,
        attachments: List<OutgoingAttachment>,
        onEvent: (SSEEvent) -> Unit,
    ): SSEEvent {
        val body = json.encodeToString(MessageBody(text, attachments))
        val request = Request.Builder()
            .url(url("/api/agents/nexus/message"))
            .header("Content-Type", "application/json")
            .header("Accept", "text/event-stream")
            .auth()
            .post(body.toRequestBody(jsonMedia))
            .build()
        return streamSSE(request, onEvent)
    }

    /** Requests proactive guidance (reopening a stale conversation). */
    suspend fun requestGuidance(onEvent: (SSEEvent) -> Unit): SSEEvent {
        val request = Request.Builder()
            .url(url("/api/agents/nexus/guidance"))
            .header("Content-Type", "application/json")
            .header("Accept", "text/event-stream")
            .auth()
            .post("{}".toRequestBody(jsonMedia))
            .build()
        return streamSSE(request, onEvent)
    }

    private suspend fun streamSSE(request: Request, onEvent: (SSEEvent) -> Unit): SSEEvent =
        withContext(Dispatchers.IO) {
            val response = try {
                http.newCall(request).execute()
            } catch (e: Exception) {
                throw ApiError.NetworkError(e)
            }
            response.use { resp ->
                if (resp.code == 401) {
                    TokenStore.clear()
                    throw ApiError.Unauthorized
                }
                if (resp.code !in 200..299) {
                    val body = resp.body?.string() ?: ""
                    throw ApiError.ServerError(errorMessage(body) ?: "Request failed (${resp.code})")
                }

                val source = resp.body?.source() ?: throw ApiError.ServerError("No response body")
                var done: SSEEvent? = null
                while (true) {
                    val line = try {
                        source.readUtf8Line()
                    } catch (e: Exception) {
                        throw ApiError.NetworkError(e)
                    } ?: break

                    if (!line.startsWith("data:")) continue
                    // Tolerate "data: {json}" and "data:{json}".
                    val payload = if (line.startsWith("data: ")) line.substring(6) else line.substring(5)
                    val event = try {
                        json.decodeFromString<SSEEvent>(payload)
                    } catch (_: Exception) {
                        continue
                    }
                    when (event.type) {
                        "error" -> throw ApiError.ServerError(event.error ?: "The assistant hit an error.")
                        "done" -> done = event
                        else -> withContext(Dispatchers.Main) { onEvent(event) }
                    }
                }
                done ?: throw ApiError.ServerError("The assistant stopped responding. Please try again.")
            }
        }

    // MARK: - Upload (multipart photos + signed-URL video PUT)

    /**
     * Upload a photo via the multipart endpoint (small, well under the ~32MB cap).
     * Port of iOS NexusService.uploadMedia.
     */
    suspend fun uploadMedia(data: ByteArray, mimeType: String, filename: String): UploadResponse =
        withContext(Dispatchers.IO) {
            val body = okhttp3.MultipartBody.Builder()
                .setType(okhttp3.MultipartBody.FORM)
                .addFormDataPart("file", filename, data.toRequestBody(mimeType.toMediaType()))
                .build()
            val request = Request.Builder()
                .url(url("/api/agents/nexus/upload"))
                .auth()
                .post(body)
                .build()
            val response = try {
                http.newCall(request).execute()
            } catch (e: Exception) {
                throw ApiError.NetworkError(e)
            }
            decode<UploadResponse>(response.use { validate(it) })
        }

    @Serializable
    private data class SignedUrlBody(val mimeType: String, val filename: String, val byteLength: Int)

    /**
     * Upload media DIRECTLY to storage via a signed URL, bypassing the API's
     * ~32MB request cap (used for videos). 1) mint a signed URL, 2) PUT the bytes
     * to GCS with body-upload progress. Both legs get one retry (the URL is valid
     * 15 min, so a transient cellular blip shouldn't force a re-record). Port of
     * iOS NexusService.uploadMediaDirect.
     */
    suspend fun uploadMediaDirect(
        data: ByteArray,
        mimeType: String,
        filename: String,
        onProgress: (Float) -> Unit = {},
    ): UploadResponse = withContext(Dispatchers.IO) {
        // 1. Request a signed upload URL.
        val mintBody = json.encodeToString(SignedUrlBody(mimeType, filename, data.size))
        val info = withOneRetry {
            decode<SignedUpload>(requestBody("POST", "/api/agents/nexus/upload-url", mintBody))
        }

        // 2. PUT the bytes straight to GCS. No auth header; Content-Type MUST match
        //    what the signed URL was minted for.
        val putBody = ProgressRequestBody(data, mimeType.toMediaType(), onProgress)
        val response = withOneRetry {
            val put = Request.Builder().url(info.uploadUrl).put(putBody).build()
            try {
                http.newCall(put).execute()
            } catch (e: Exception) {
                throw ApiError.NetworkError(e)
            }
        }
        response.use {
            if (it.code !in 200..299) {
                throw ApiError.ServerError(errorMessage(it.body?.string() ?: "") ?: "Upload failed (${it.code})")
            }
        }
        UploadResponse(url = info.url, mimeType = mimeType)
    }

    /** Run [operation] once more if it throws (safe within the 15-min URL window). */
    private inline fun <T> withOneRetry(operation: () -> T): T = try {
        operation()
    } catch (e: Exception) {
        operation()
    }

    // MARK: - Scan jobs (durable async scans)

    @Serializable
    private data class ScanJobBody(
        val mediaUrl: String,
        val mediaUrls: List<String>? = null,
        val mimeType: String,
        val caption: String? = null,
        val idempotencyKey: String,
        val sessionId: String? = null,
        val roomHint: String? = null,
    )

    /** Register uploaded media as a durable scan job. Idempotent per key. */
    suspend fun createScanJob(
        mediaUrl: String,
        mediaUrls: List<String>? = null,
        mimeType: String,
        caption: String?,
        idempotencyKey: String,
        sessionId: String?,
        roomHint: String?,
    ): ScanJobDTO {
        val body = json.encodeToString(
            ScanJobBody(mediaUrl, mediaUrls, mimeType, caption, idempotencyKey, sessionId, roomHint)
        )
        return decode(requestBody("POST", "/api/agents/nexus/scan-jobs", body))
    }

    suspend fun scanJob(id: String): ScanJobDTO =
        decode(requestBody("GET", "/api/agents/nexus/scan-jobs/$id"))

    /** Finished jobs the client hasn't shown yet — the reconnect/relaunch path. */
    suspend fun unconsumedScanJobs(): List<ScanJobDTO> =
        decode<ScanJobListResponse>(requestBody("GET", "/api/agents/nexus/scan-jobs")).jobs

    /** Tell the server this job's outcome reached the user (stop resurfacing it). */
    suspend fun consumeScanJob(id: String) {
        requestBody("POST", "/api/agents/nexus/scan-jobs/$id/consume", "{}")
    }

    // MARK: - Share links

    suspend fun listShares(): List<ShareDTO> =
        decode(requestBody("GET", "/shares"))

    suspend fun createShare(): ShareDTO =
        decode(requestBody("POST", "/shares", "{}"))

    suspend fun shareReadiness(): ShareReadinessDTO =
        decode(requestBody("GET", "/shares/readiness"))

    // MARK: - Inventory review (native review cards)

    /**
     * Outcome of a review-card commit. [added] counts only true new items;
     * [updated] counts photos attached to items already on the list (a photo of
     * an existing item updates its picture instead of re-adding) — the server's
     * addedCount already excludes these, so "Added N" must never fold updates in.
     */
    data class CommitOutcome(
        val added: Int,
        val updated: Int,
        val skipped: Int,
        val failed: Int,
        val alreadyCommitted: Boolean,
    )

    @Serializable
    private data class CommitBody(val items: List<ReviewedItemPayload>, val room: String?, val scanId: String?)

    @Serializable
    private data class CommitResp(
        val addedCount: Int? = null,
        val updatedCount: Int? = null,
        val skippedCount: Int? = null,
        val failedCount: Int? = null,
        val alreadyCommitted: Boolean? = null,
    )

    /** Commit the items the user kept/edited. Keyed on scanId for idempotency. */
    suspend fun commitReviewedItems(
        items: List<ReviewedItemPayload>,
        room: String?,
        scanId: String?,
    ): CommitOutcome {
        val body = json.encodeToString(CommitBody(items, room, scanId))
        val respBody = requestBody("POST", "/api/agents/nexus/inventory/commit", body)
        val resp = try { json.decodeFromString<CommitResp>(respBody) } catch (_: Exception) { null }
        return CommitOutcome(
            added = resp?.addedCount ?: items.size,
            updated = resp?.updatedCount ?: 0,
            skipped = resp?.skippedCount ?: 0,
            failed = resp?.failedCount ?: 0,
            alreadyCommitted = resp?.alreadyCommitted ?: false,
        )
    }

    @Serializable
    private data class RescanBody(val url: String, val urls: List<String>, val mimeType: String, val room: String?)

    @Serializable
    private data class RescanResp(
        val items: List<DetectedItem>? = null,
        val mediaKind: String? = null,
        val room: String? = null,
        val scanId: String? = null,
    )

    /** Deterministically re-run vision analysis on already-uploaded media. */
    suspend fun rescan(urls: List<String>, mimeType: String, room: String?): DetectedItemsReview {
        val body = json.encodeToString(RescanBody(urls.firstOrNull() ?: "", urls, mimeType, room))
        val resp = decode<RescanResp>(requestBody("POST", "/api/agents/nexus/rescan", body))
        return DetectedItemsReview(
            mediaKind = resp.mediaKind ?: if (mimeType.startsWith("video")) "video" else "photo",
            room = resp.room ?: room,
            items = resp.items ?: emptyList(),
            scanId = resp.scanId,
        )
    }

    @Serializable
    private data class ResolveBody(val removeItemIds: List<Int>)

    @Serializable
    private data class ResolveResp(val removedCount: Int? = null)

    /** Remove the item ids chosen in the duplicate-review sheet. */
    suspend fun resolveDuplicates(removeItemIds: List<Int>): Int {
        val body = json.encodeToString(ResolveBody(removeItemIds))
        val respBody = requestBody("POST", "/api/agents/nexus/inventory/resolve-duplicates", body)
        return (try { json.decodeFromString<ResolveResp>(respBody) } catch (_: Exception) { null })
            ?.removedCount ?: removeItemIds.size
    }

    // MARK: - Clear / archive session

    suspend fun clearSession(id: String) {
        requestBody("DELETE", "/api/agents/nexus/sessions/$id")
    }
}
