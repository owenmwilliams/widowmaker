package dev.we3kings.nexusmoves.ui.chat

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dev.we3kings.nexusmoves.data.api.ApiError
import dev.we3kings.nexusmoves.data.api.NexusService
import dev.we3kings.nexusmoves.data.events.ClientEventLogger
import dev.we3kings.nexusmoves.model.ChatMessage
import dev.we3kings.nexusmoves.model.DetectedItemsReview
import dev.we3kings.nexusmoves.model.DuplicatePair
import dev.we3kings.nexusmoves.model.DuplicateReview
import dev.we3kings.nexusmoves.model.EditableItem
import dev.we3kings.nexusmoves.model.NexusAttachment
import dev.we3kings.nexusmoves.model.OutgoingAttachment
import dev.we3kings.nexusmoves.model.ReviewedItemPayload
import dev.we3kings.nexusmoves.model.SSEEvent
import dev.we3kings.nexusmoves.model.ScanJobDTO
import kotlinx.coroutines.launch

/** Outcome of preparing to share (iOS SharePrep). */
sealed interface SharePrep {
    data class Warn(val message: String) : SharePrep
    data class Ready(val url: String) : SharePrep
    data object Failed : SharePrep
}

/**
 * Drives the native Nexus chat screen — port of iOS NexusViewModel. Loads the
 * active session, streams messages, materializes durable scan-job results, and
 * surfaces a share link. This is the entire app's brain; there are no dashboards.
 *
 * Phase 2 covers chat + scan-job materialization + review queue + share + commit
 * + rescan + resolve. The media-capture path (sendMedia / sendMediaBatch /
 * runScanJob / pollScanJob) lands in Phase 3; those set [lastScan] and enqueue
 * review cards through the same [materializeReview] / [presentReview] machinery.
 */
class NexusViewModel : ViewModel() {
    var messages by mutableStateOf<List<ChatMessage>>(emptyList()); private set
    var quickStartChips by mutableStateOf<List<dev.we3kings.nexusmoves.model.QuickStartChip>>(emptyList()); private set
    var isLoading by mutableStateOf(false); private set
    var isUploading by mutableStateOf(false); internal set
    var uploadProgress by mutableStateOf(0f); internal set
    var phaseText by mutableStateOf(""); internal set
    var detailText by mutableStateOf(""); internal set
    var errorMessage by mutableStateOf<String?>(null)
    var shareUrl by mutableStateOf<String?>(null); private set
    var isPreparingShare by mutableStateOf(false); private set
    var sessionExpired by mutableStateOf(false); private set
    var readiness by mutableStateOf<dev.we3kings.nexusmoves.model.ShareReadinessDTO?>(null); private set
    var pendingReview by mutableStateOf<DetectedItemsReview?>(null)
    var pendingDuplicates by mutableStateOf<DuplicateReview?>(null)

    private val service = NexusService
    internal var sessionId: String? = null
    private var didLoad = false

    // Staged during a streaming turn; promoted after the reply lands.
    private var stagedReview: DetectedItemsReview? = null
    private var stagedDuplicates: List<DuplicatePair>? = null

    // Most recent scanned media, remembered so Rescan can re-run analysis (issue #43).
    internal data class LastScan(val urls: List<String>, val mimeType: String, var room: String?)
    internal var lastScan: LastScan? = null

    // Review cards awaiting the user, one at a time. A card's job is consumed
    // only when the user closes the card, so killing the app with a card up
    // re-surfaces it on next launch.
    private val reviewQueue = ArrayDeque<DetectedItemsReview>()
    private var presentedReviewJobId: String? = null
    private var presentedReviewPillId: String? = null
    private var presentedReviewCount = 0
    private var presentedReviewHandled = false

    val isBusy: Boolean get() = isLoading || isUploading

    // MARK: - Load

    fun loadIfNeeded() {
        if (didLoad) return
        didLoad = true
        viewModelScope.launch { reload() }
    }

    private suspend fun reload() {
        try {
            val resp = service.loadActiveSession()
            sessionId = resp.session?.id
            messages = resp.messages.map { ChatMessage.from(it) }
            quickStartChips = resp.quickStartChips
        } catch (e: ApiError.Unauthorized) {
            sessionExpired = true
        } catch (e: Exception) {
            errorMessage = friendlyError(e)
        }
        materializeUnconsumedScans()
        refreshReadiness()
    }

    suspend fun refreshReadiness() {
        try {
            readiness = service.shareReadiness()
        } catch (_: Exception) {
            // best-effort; never disrupts the UI
        }
    }

    // MARK: - Send

    suspend fun send(text: String): Boolean = send(text, emptyList())

    /**
     * Returns true only when the turn genuinely completed (a `done` event
     * arrived). Callers that clear state on send must key off this.
     */
    suspend fun send(rawText: String, attachments: List<OutgoingAttachment>): Boolean {
        val text = rawText.trim()
        if (text.isEmpty() && attachments.isEmpty()) return false
        if (isLoading) return false

        val optimistic = ChatMessage(
            role = ChatMessage.Role.User,
            text = text,
            attachments = attachments.map { NexusAttachment(it.url, it.mimeType) },
        )
        messages = messages + optimistic
        quickStartChips = emptyList()
        errorMessage = null
        isLoading = true
        phaseText = "Thinking…"
        detailText = ""
        stagedReview = null
        stagedDuplicates = null

        var completed = false
        try {
            val done = service.sendMessage(text, attachments) { event -> handle(event) }
            completed = true
            sessionId = done.sessionId ?: sessionId
            val rawReply = (done.reply ?: "").trim()
            // When a card is about to appear, drop the agent's [BUTTONS] from its
            // bubble so the card is the single commit path (prevents a double-add).
            val hasCard = stagedReview != null || stagedDuplicates != null
            val reply = if (hasCard) {
                val prose = AgentMessageParser.parse(rawReply).prose.trim()
                prose.ifEmpty { rawReply }
            } else rawReply
            if (reply.isNotEmpty()) {
                messages = messages + ChatMessage(role = ChatMessage.Role.Model, text = reply)
            }
            captureShare(done)
            stagedReview?.let { presentReview(it) }
            stagedDuplicates?.let { pendingDuplicates = DuplicateReview(it) }
            stagedReview = null
            stagedDuplicates = null
        } catch (e: ApiError.Unauthorized) {
            messages = messages.filterNot { it.id == optimistic.id }
            sessionExpired = true
        } catch (e: Exception) {
            // Drop the optimistic bubble and surface the error — but keep any
            // review card that already arrived (the scan can finish server-side
            // and stream detected_items before the connection drops).
            messages = messages.filterNot { it.id == optimistic.id }
            errorMessage = friendlyError(e)
            stagedReview?.let { presentReview(it) }
            stagedDuplicates?.let { pendingDuplicates = DuplicateReview(it) }
            stagedReview = null
            stagedDuplicates = null
            logTurnFailure(e)
        }

        isLoading = false
        phaseText = ""
        detailText = ""
        refreshReadiness()
        return completed
    }

    private fun logTurnFailure(e: Exception) {
        val msg = e.message ?: ""
        when {
            msg.contains("timeout", ignoreCase = true) ->
                ClientEventLogger.log(ClientEventLogger.Type.SseTimeout, sessionId)
            e is ApiError.ServerError && msg.contains("stopped responding") ->
                ClientEventLogger.log(ClientEventLogger.Type.SseTimeout, sessionId, mapOf("reason" to "no_done_event"))
            else ->
                ClientEventLogger.log(ClientEventLogger.Type.TurnFailed, sessionId, mapOf("error" to msg.take(200)))
        }
    }

    // MARK: - Media (capture → upload → durable scan job)

    private fun postProgress(p: Float) {
        viewModelScope.launch { uploadProgress = p }
    }

    /**
     * Upload one picked photo/video and run its scan. Returns true if the media
     * uploaded and the scan finished; false on any failure so the composer can
     * keep the attachment for a retry. Videos are transcoded to 720p first.
     */
    @androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)
    suspend fun sendMedia(picked: dev.we3kings.nexusmoves.data.upload.PickedMedia, caption: String = "", roomHint: String? = null): Boolean {
        if (isBusy) return false
        errorMessage = null
        val isVideo = picked.isVideo

        // Resolve the bytes to upload. Videos are transcoded to H.264 720p first
        // (iOS gets this free from the picker); photos already carry JPEG bytes.
        val data: ByteArray
        val mimeType: String
        val filename: String
        try {
            if (isVideo) {
                isLoading = true
                phaseText = "Optimizing video…"
                val transcoded = dev.we3kings.nexusmoves.data.media.MediaTranscoder
                    .transcodeTo720p(picked.uri)
                data = transcoded.readBytes()
                transcoded.delete()
                mimeType = "video/mp4"
                filename = picked.filename.substringBeforeLast('.', "video") + ".mp4"
                isLoading = false
                phaseText = ""
            } else {
                data = picked.bytes ?: dev.we3kings.nexusmoves.data.upload.MediaUploader.loadImageJpeg(picked.uri)
                mimeType = "image/jpeg"
                filename = picked.filename
            }
        } catch (e: Exception) {
            isLoading = false
            phaseText = ""
            errorMessage = friendlyError(e)
            return false
        }

        // Photos over ~30MB would 413; guard those (videos go direct to storage).
        if (!isVideo && data.size > 30 * 1024 * 1024) {
            errorMessage = "That photo is too large to upload (${data.size / 1024 / 1024} MB)."
            return false
        }

        val idempotencyKey = dev.we3kings.nexusmoves.data.upload.MediaUploader.sha256Hex(data)

        val optimistic = ChatMessage(
            role = ChatMessage.Role.User,
            text = caption.ifEmpty { if (isVideo) "🎥 Video walkthrough" else "📷 Photo" },
        )
        messages = messages + optimistic

        isUploading = true
        uploadProgress = 0f
        phaseText = if (isVideo) "Uploading video…" else "Uploading photo…"
        val meta = mapOf("mediaKind" to if (isVideo) "video" else "photo", "bytes" to data.size.toString())
        ClientEventLogger.log(ClientEventLogger.Type.UploadStarted, sessionId, meta)

        val uploaded = try {
            if (isVideo) {
                service.uploadMediaDirect(data, mimeType, filename) { p -> postProgress(p) }
            } else {
                service.uploadMedia(data, mimeType, filename)
            }
        } catch (e: ApiError.Unauthorized) {
            isUploading = false; phaseText = ""
            messages = messages.filterNot { it.id == optimistic.id }
            sessionExpired = true
            ClientEventLogger.log(ClientEventLogger.Type.UploadFailed, sessionId, meta)
            return false
        } catch (e: Exception) {
            isUploading = false; phaseText = ""
            messages = messages.filterNot { it.id == optimistic.id }
            errorMessage = friendlyError(e)
            ClientEventLogger.log(ClientEventLogger.Type.UploadFailed, sessionId, meta + ("error" to (e.message ?: "").take(200)))
            return false
        }
        isUploading = false
        phaseText = ""
        ClientEventLogger.log(ClientEventLogger.Type.UploadSucceeded, sessionId, meta)
        lastScan = LastScan(listOf(uploaded.url), uploaded.mimeType, null)

        return runScanJob(listOf(uploaded.url), uploaded.mimeType, caption, roomHint, idempotencyKey, isVideo, optimistic)
    }

    /**
     * Send up to five photos as ONE scan: each uploads separately (and shows as
     * its own attachment), then a single scan job analyzes them together — one
     * review card, not five. Port of iOS sendMediaBatch (#67).
     */
    suspend fun sendMediaBatch(items: List<dev.we3kings.nexusmoves.data.upload.PickedMedia>, caption: String = "", roomHint: String? = null): Boolean {
        if (isBusy) return false
        if (items.size <= 1) {
            return items.firstOrNull()?.let { sendMedia(it, caption, roomHint) } ?: false
        }
        errorMessage = null
        if (items.size > 5 || items.any { it.isVideo }) {
            errorMessage = "Up to 5 photos can be sent together — videos go one at a time."
            return false
        }
        val byteLists = items.map { it.bytes ?: dev.we3kings.nexusmoves.data.upload.MediaUploader.loadImageJpeg(it.uri) }
        byteLists.firstOrNull { it.size > 30 * 1024 * 1024 }?.let {
            errorMessage = "One of those photos is too large to upload (${it.size / 1024 / 1024} MB)."
            return false
        }
        val idempotencyKey = dev.we3kings.nexusmoves.data.upload.MediaUploader.sha256Hex(byteLists)

        val optimistic = ChatMessage(
            role = ChatMessage.Role.User,
            text = caption,
            attachments = items.map { NexusAttachment(null, it.mimeType) },
        )
        messages = messages + optimistic

        isUploading = true
        uploadProgress = 0f
        val meta = mapOf(
            "mediaKind" to "photo_batch",
            "count" to items.size.toString(),
            "bytes" to byteLists.sumOf { it.size }.toString(),
        )
        ClientEventLogger.log(ClientEventLogger.Type.UploadStarted, sessionId, meta)

        val urls = mutableListOf<String>()
        try {
            byteLists.forEachIndexed { index, bytes ->
                phaseText = "Uploading photo ${index + 1} of ${items.size}…"
                val up = service.uploadMedia(bytes, "image/jpeg", items[index].filename)
                urls.add(up.url)
                uploadProgress = (index + 1).toFloat() / items.size
            }
        } catch (e: ApiError.Unauthorized) {
            isUploading = false; phaseText = ""
            messages = messages.filterNot { it.id == optimistic.id }
            sessionExpired = true
            ClientEventLogger.log(ClientEventLogger.Type.UploadFailed, sessionId, meta)
            return false
        } catch (e: Exception) {
            isUploading = false; phaseText = ""
            messages = messages.filterNot { it.id == optimistic.id }
            errorMessage = friendlyError(e)
            ClientEventLogger.log(ClientEventLogger.Type.UploadFailed, sessionId, meta + ("error" to (e.message ?: "").take(200)))
            return false
        }
        isUploading = false
        phaseText = ""
        ClientEventLogger.log(ClientEventLogger.Type.UploadSucceeded, sessionId, meta)
        lastScan = LastScan(urls, "image/jpeg", null)

        return runScanJob(urls, "image/jpeg", caption, roomHint, idempotencyKey, false, optimistic)
    }

    /** Register uploaded media as a scan job, poll to terminal, materialize the card. */
    private suspend fun runScanJob(
        mediaUrls: List<String>,
        mimeType: String,
        caption: String,
        roomHint: String?,
        idempotencyKey: String,
        isVideo: Boolean,
        optimistic: ChatMessage,
    ): Boolean {
        quickStartChips = emptyList()
        isLoading = true
        phaseText = if (isVideo) "Scanning your video…" else "Scanning your photo…"
        try {
            val created = service.createScanJob(
                mediaUrl = mediaUrls.firstOrNull() ?: "",
                mediaUrls = if (mediaUrls.size > 1) mediaUrls else null,
                mimeType = mimeType,
                caption = caption.ifEmpty { null },
                idempotencyKey = idempotencyKey,
                sessionId = sessionId,
                roomHint = roomHint,
            )
            val job = pollScanJob(created.id)
            if (job.status == "completed") {
                // NOT consumed here — the job is acknowledged when the user closes
                // the review card, so killing the app with the card up re-surfaces it.
                materializeReview(job)
                refreshReadiness()
                return true
            }
            messages = messages.filterNot { it.id == optimistic.id }
            errorMessage = job.error ?: "The scan failed. Please try again."
            runCatching { service.consumeScanJob(job.id) }
            return false
        } catch (e: ApiError.Unauthorized) {
            messages = messages.filterNot { it.id == optimistic.id }
            sessionExpired = true
            return false
        } catch (e: Exception) {
            messages = messages.filterNot { it.id == optimistic.id }
            errorMessage = friendlyError(e)
            return false
        } finally {
            isLoading = false
            phaseText = ""
            detailText = ""
        }
    }

    /**
     * Poll a scan job to a terminal state. Transient poll failures are tolerated
     * — the job keeps running server-side, so a network blip mid-poll must not
     * abort the scan. 3s cadence, 15-min deadline; on timeout the job is left
     * unconsumed so reload() surfaces it.
     */
    private suspend fun pollScanJob(id: String): ScanJobDTO {
        val deadline = System.currentTimeMillis() + 15 * 60 * 1000
        var consecutiveErrors = 0
        while (System.currentTimeMillis() < deadline) {
            try {
                val job = service.scanJob(id)
                consecutiveErrors = 0
                if (job.isTerminal) return job
            } catch (e: ApiError.Unauthorized) {
                throw e
            } catch (e: Exception) {
                consecutiveErrors += 1
                if (consecutiveErrors >= 10) throw e
            }
            kotlinx.coroutines.delay(3_000)
        }
        throw ApiError.NetworkError(
            java.io.IOException("The scan is taking longer than expected. It keeps running in the background — pull to refresh in a bit to see the result.")
        )
    }

    // MARK: - Scan-job materialization (shared by reload + Phase-3 capture)

    private fun updatePill(id: String?, state: ChatMessage.ScanReviewState) {
        if (id == null) return
        messages = messages.map {
            if (it.id == id) it.copy(kind = ChatMessage.Kind.ScanReview(state)) else it
        }
    }

    /** Turn a completed scan job into a review card plus a pill. */
    internal fun materializeReview(job: ScanJobDTO) {
        val items = job.result?.items ?: emptyList()
        val kindWord = if ((job.result?.mediaKind ?: job.mediaKind ?: "photo") == "video") "video" else "photo"
        if (items.isEmpty()) {
            messages = messages + ChatMessage(
                role = ChatMessage.Role.Model,
                text = "I couldn't detect any items in that $kindWord. Try again with more light, or pan a little slower.",
            )
            val jobId = job.id
            viewModelScope.launch { runCatching { service.consumeScanJob(jobId) } }
            return
        }
        // The review card IS the response — keep a compact pill, not a prose bubble.
        val pill = ChatMessage(
            role = ChatMessage.Role.Model,
            text = "${items.size} items found",
            kind = ChatMessage.Kind.ScanReview(ChatMessage.ScanReviewState.Pending(items.size)),
        )
        messages = messages + pill
        val room = job.result?.room ?: job.roomHint
        if (room != null && lastScan != null) lastScan?.room = room
        presentReview(
            DetectedItemsReview(
                mediaKind = job.result?.mediaKind ?: job.mediaKind ?: "photo",
                room = room,
                items = items,
                jobId = job.id,
                pillId = pill.id,
            )
        )
    }

    /** Surface scans that finished while the app was away (reconnect/relaunch). */
    private suspend fun materializeUnconsumedScans() {
        val jobs = try { service.unconsumedScanJobs() } catch (_: Exception) { return }
        if (jobs.isEmpty()) return
        for (job in jobs) if (job.status == "completed") materializeReview(job)
        val failures = jobs.filter { it.status == "failed" }
        for (job in failures) {
            messages = messages + ChatMessage(
                role = ChatMessage.Role.Model,
                text = "⚠️ A scan didn't finish: ${job.error ?: "unknown error"}. Please try scanning again.",
            )
            runCatching { service.consumeScanJob(job.id) }
        }
        failures.lastOrNull()?.let {
            errorMessage = "A scan from earlier didn't finish: ${it.error ?: "unknown error"}. Please try again."
        }
    }

    // MARK: - Review-card queue

    private fun presentReview(review: DetectedItemsReview) {
        reviewQueue.addLast(review)
        presentNextReview()
    }

    private fun presentNextReview() {
        if (pendingReview != null) return
        val next = reviewQueue.removeFirstOrNull() ?: return
        presentedReviewJobId = next.jobId
        presentedReviewPillId = next.pillId
        presentedReviewCount = next.items.size
        presentedReviewHandled = false
        pendingReview = next
    }

    /**
     * Called when the review sheet closes — commit, skip, and swipe-down all
     * funnel here. Closing the card is the acknowledgment: consume its job
     * (idempotent server-side) and present the next queued card.
     */
    fun reviewSheetClosed() {
        val jobId = presentedReviewJobId
        presentedReviewJobId = null
        if (!presentedReviewHandled) {
            updatePill(presentedReviewPillId, ChatMessage.ScanReviewState.Dismissed(presentedReviewCount))
        }
        presentedReviewPillId = null
        presentedReviewHandled = false
        viewModelScope.launch {
            if (jobId != null) runCatching { service.consumeScanJob(jobId) }
            presentNextReview()
        }
    }

    // MARK: - Share

    suspend fun evaluateAndPrepareShare(): SharePrep {
        if (isPreparingShare) return SharePrep.Failed
        isPreparingShare = true
        errorMessage = null
        try {
            // Reasonableness gate (warn-but-allow). Don't block on a check failure.
            try {
                val warning = service.shareReadiness().shareWarning
                if (warning != null) return SharePrep.Warn(warning)
            } catch (e: ApiError.Unauthorized) {
                sessionExpired = true
                return SharePrep.Failed
            } catch (_: Exception) {
                // ignore — proceed to share
            }
            val url = createOrFetchShareURL()
            return if (url != null) SharePrep.Ready(url) else SharePrep.Failed
        } finally {
            isPreparingShare = false
        }
    }

    /** "Share anyway" — skip the warning, just prepare the link. */
    suspend fun forceShare(): String? {
        if (isPreparingShare) return shareUrl
        isPreparingShare = true
        errorMessage = null
        try {
            return createOrFetchShareURL()
        } finally {
            isPreparingShare = false
        }
    }

    private suspend fun createOrFetchShareURL(): String? {
        return try {
            val existing = service.listShares().firstOrNull { it.isActive }
            val share = existing ?: service.createShare()
            val urlString = share.url
            if (urlString != null) {
                shareUrl = urlString
                urlString
            } else {
                errorMessage = "Couldn't prepare a share link. Please try again."
                null
            }
        } catch (e: ApiError.Unauthorized) {
            sessionExpired = true
            null
        } catch (e: Exception) {
            errorMessage = friendlyError(e)
            null
        }
    }

    // MARK: - Review commit (native cards)

    /** Commit the items the user kept/edited in the detected-items review sheet. */
    suspend fun commitReview(items: List<EditableItem>, room: String?, scanId: String?) {
        pendingReview = null
        val kept = items.filter { it.keep && it.name.trim().isNotEmpty() }
        if (kept.isEmpty()) return
        val pillId = presentedReviewPillId
        val totalDetected = presentedReviewCount
        isLoading = true
        phaseText = "Adding your items…"
        errorMessage = null

        var report: String? = null
        try {
            val payload = kept.map { ReviewedItemPayload.from(it, room) }
            val result = service.commitReviewedItems(payload, room, scanId)
            presentedReviewHandled = true
            updatePill(pillId, ChatMessage.ScanReviewState.Reviewed(result.added, result.skipped))
            ClientEventLogger.log(
                ClientEventLogger.Type.ReviewCardCommitted, sessionId,
                mapOf("itemCount" to result.added.toString()),
            )
            if (!(result.alreadyCommitted || (result.added == 0 && result.skipped > 0))) {
                val fromScan = room?.let { " from the $it scan" } ?: " from the scan"
                var t = "Added ${result.added} of the $totalDetected items$fromScan."
                if (result.skipped > 0) t += " ${result.skipped} were already on the list."
                if (result.failed > 0) t += " ${result.failed} couldn't be added."
                report = t
            }
        } catch (e: ApiError.Unauthorized) {
            sessionExpired = true
        } catch (e: Exception) {
            errorMessage = friendlyError(e)
        }
        isLoading = false
        phaseText = ""
        refreshReadiness()

        // Close the loop conversationally: the report goes out as a REAL user
        // message, and the model's reply moves the chat forward.
        if (report != null) send(report)
    }

    /** Deterministically re-run analysis on the most recently scanned media. */
    suspend fun rescanLast() {
        val scan = lastScan ?: return
        if (isBusy) return
        isLoading = true
        phaseText = "Rescanning…"
        errorMessage = null
        try {
            val review = service.rescan(scan.urls, scan.mimeType, scan.room)
            if (review.items.isEmpty()) {
                messages = messages + ChatMessage(
                    role = ChatMessage.Role.Model,
                    text = "I ran the scan again but still couldn't pick out any items. Try a slower, well-lit pan with closets open — or add the items by name.",
                )
            } else {
                val pill = ChatMessage(
                    role = ChatMessage.Role.Model,
                    text = "${review.items.size} items found",
                    kind = ChatMessage.Kind.ScanReview(ChatMessage.ScanReviewState.Pending(review.items.size)),
                )
                messages = messages + pill
                presentReview(review.copy(pillId = pill.id))
            }
        } catch (e: ApiError.Unauthorized) {
            sessionExpired = true
        } catch (e: Exception) {
            errorMessage = friendlyError(e)
        }
        isLoading = false
        phaseText = ""
    }

    /** Remove the item ids the user chose in the duplicate-review sheet. */
    suspend fun resolveDuplicates(rawIds: List<Int>) {
        pendingDuplicates = null
        val ids = rawIds.filter { it > 0 }
        if (ids.isEmpty()) return
        isLoading = true
        phaseText = "Removing duplicates…"
        errorMessage = null
        try {
            val removed = service.resolveDuplicates(ids)
            messages = messages + ChatMessage(
                role = ChatMessage.Role.Model,
                text = "🧹 Removed $removed duplicate${if (removed == 1) "" else "s"}.",
            )
        } catch (e: ApiError.Unauthorized) {
            sessionExpired = true
        } catch (e: Exception) {
            errorMessage = friendlyError(e)
        }
        isLoading = false
        phaseText = ""
        refreshReadiness()
    }

    // MARK: - New conversation

    suspend fun startNewConversation() {
        if (isBusy) return
        sessionId?.let { runCatching { service.clearSession(it) } }
        sessionId = null
        messages = emptyList()
        quickStartChips = emptyList()
        shareUrl = null
        errorMessage = null
        pendingReview = null
        pendingDuplicates = null
        stagedReview = null
        stagedDuplicates = null
        reviewQueue.clear()
        presentedReviewJobId = null
        reload()
    }

    // MARK: - SSE handling

    private fun friendlyError(e: Throwable): String {
        val msg = e.message ?: ""
        val transient = e is ApiError.NetworkError ||
            msg.contains("timeout", ignoreCase = true) ||
            msg.contains("connection", ignoreCase = true)
        if (transient) return "Connection interrupted — please try again."
        return when (e) {
            is ApiError.ServerError -> e.serverMessage
            is ApiError -> e.message ?: "Something went wrong"
            else -> e.message ?: "Something went wrong"
        }
    }

    /** Called on Main (NexusService switches dispatchers before invoking). */
    private fun handle(event: SSEEvent) {
        when (event.type) {
            "thinking" -> {
                if (event.phase == "finalizing") phaseText = "Putting it together…"
                else if (phaseText.isEmpty()) phaseText = "Thinking…"
            }

            "tool_call" -> {
                if (event.source == "orchestrator") {
                    phaseText = if (event.phase == "delegation") {
                        when (event.delegationTarget) {
                            "census" -> if (event.hasAttachments == true) "Scanning your photo…" else "Working on your inventory…"
                            "vector" -> "Planning your move…"
                            else -> event.label ?: "Working…"
                        }
                    } else {
                        event.label ?: "Working…"
                    }
                } else if (event.label != null) {
                    detailText = event.detail?.let { "${event.label}: $it" } ?: event.label
                }
            }

            "detected_items" -> {
                val items = event.detectedItems
                if (!items.isNullOrEmpty()) {
                    stagedReview = DetectedItemsReview(
                        mediaKind = event.mediaKind ?: "photo",
                        room = event.room,
                        items = items,
                        scanId = event.scanId,
                    )
                    ClientEventLogger.log(
                        ClientEventLogger.Type.ReviewCardShown, sessionId,
                        mapOf("mediaKind" to (event.mediaKind ?: "photo"), "itemCount" to items.size.toString()),
                    )
                    if (event.room != null && lastScan != null) lastScan?.room = event.room
                }
            }

            "duplicate_pairs" -> {
                val pairs = event.duplicatePairs
                if (!pairs.isNullOrEmpty()) stagedDuplicates = pairs
            }
        }
    }

    private fun captureShare(done: SSEEvent) {
        val action = done.actions?.firstOrNull { it.tool == "create_share" } ?: return
        val urlString = action.result?.url ?: return
        shareUrl = urlString
    }

    fun clearSessionExpired() {
        sessionExpired = false
    }
}
