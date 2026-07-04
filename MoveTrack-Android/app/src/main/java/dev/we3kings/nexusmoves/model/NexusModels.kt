package dev.we3kings.nexusmoves.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import java.util.UUID

/**
 * Wire models — port of MoveTrack-iOS NexusModels.swift. Keys are camelCase on
 * the wire (url, mimeType, sessionId, …). Decode defensively: the shared Nexus
 * Json (NexusService.json) sets ignoreUnknownKeys + coerceInputValues +
 * explicitNulls=false, so a server-side shape change (an unexpected field, an
 * explicit null where we default) can never wipe history or drop the terminal
 * `done` event — the iOS `try?`-per-field behavior.
 */

// MARK: - Attachments

@Serializable
data class NexusAttachment(
    val url: String? = null,
    val mimeType: String? = null,
) {
    val isVideo: Boolean get() = (mimeType ?: "").startsWith("video")
    val displayLabel: String get() = if (isVideo) "🎥 Video" else "📷 Photo"
}

/**
 * An attachment we send up with a message (both fields required). [byteLength]
 * is what the client measured locally before upload — the server compares it
 * against what it downloads back out of GCS so a truncated upload fails loudly
 * (mediaDownloadService.downloadBuffer expectedBytes).
 */
@Serializable
data class OutgoingAttachment(
    val url: String,
    val mimeType: String,
    val byteLength: Int,
)

// MARK: - Quick-start chips

@Serializable
data class QuickStartChip(
    val label: String = "",
    val message: String = "",
) {
    val id: String get() = "$label|$message"
}

// MARK: - Session + history

@Serializable
data class NexusSessionDTO(val id: String)

@Serializable
data class NexusMessageDTO(
    val role: String = "model",
    val content: String = "",
    val attachments: List<NexusAttachment>? = null,
    /** "scan_review" marks the scan-completion row, rendered as a pill. */
    val kind: String? = null,
    val scanCount: Int? = null,
)

@Serializable
data class ActiveSessionResponse(
    val session: NexusSessionDTO? = null,
    val messages: List<NexusMessageDTO> = emptyList(),
    val quickStartChips: List<QuickStartChip> = emptyList(),
)

// MARK: - Upload

@Serializable
data class UploadResponse(
    val url: String,
    val mimeType: String,
)

/** Signed-URL mint response for direct-to-GCS video upload. */
@Serializable
data class SignedUpload(
    val uploadUrl: String,
    val url: String,
)

// MARK: - Share links

@Serializable
data class ShareDTO(
    val token: String? = null,
    val url: String? = null,
    val revokedAt: String? = null,
    val expiresAt: String? = null,
) {
    /** We never set an expiry from the app, so "active" == not revoked + has url. */
    val isActive: Boolean get() = revokedAt == null && url != null
}

// MARK: - Share readiness (reasonableness check)

@Serializable
data class ShareReadinessDTO(
    val overall: Int? = null,
    val status: String? = null,          // ready | almost_ready | in_progress | early | not_started
    val summary: String? = null,
    val nextSteps: List<String>? = null,
    val reasonableness: Reasonableness? = null,
    val mediaGaps: MediaGaps? = null,
) {
    @Serializable
    data class Reasonableness(
        val hasBenchmark: Boolean? = null,
        val status: String? = null,      // too_low | low | ok | high | too_high | unknown
        val severity: String? = null,    // none | low | medium | high
        val message: String? = null,
    )

    @Serializable
    data class MediaGaps(
        val roomsMissingVideo: List<RoomGap>? = null,
        val largeItemsMissingPhoto: List<ItemGap>? = null,
    ) {
        @Serializable data class RoomGap(val room: String? = null, val itemCount: Int? = null)
        @Serializable data class ItemGap(val room: String? = null, val items: List<String>? = null)
    }

    /** A high-severity warning to surface before sharing, or null. Warn-but-allow. */
    val shareWarning: String?
        get() {
            val r = reasonableness ?: return null
            return if (r.hasBenchmark == true && r.severity == "high") r.message else null
        }

    val progress: Float get() = (overall ?: 0).coerceIn(0, 100) / 100f

    val statusLabel: String
        get() = when (status) {
            "ready" -> "Ready to share"
            "almost_ready" -> "Almost ready"
            "in_progress" -> "In progress"
            "early" -> "Just getting started"
            else -> "Let's get started"
        }
}

// MARK: - SSE stream events

@Serializable
data class NexusActionResult(val url: String? = null, val success: Boolean? = null)

@Serializable
data class NexusActionDTO(val tool: String? = null, val result: NexusActionResult? = null)

/**
 * A single Server-Sent Event from /message or /guidance. Every field is optional
 * so a malformed intermediate event (or an unexpected `actions` payload on the
 * terminal `done` event) can never break the stream.
 */
@Serializable
data class SSEEvent(
    val type: String? = null,
    val phase: String? = null,
    val source: String? = null,
    val delegationTarget: String? = null,
    val hasAttachments: Boolean? = null,
    val label: String? = null,
    val detail: String? = null,
    val tool: String? = null,
    val success: Boolean? = null,
    val text: String? = null,       // partial_reply
    val reply: String? = null,      // done
    val sessionId: String? = null,  // done
    val error: String? = null,      // error
    val actions: List<NexusActionDTO>? = null,
    @SerialName("items") val detectedItems: List<DetectedItem>? = null,  // detected_items
    val mediaKind: String? = null,
    val room: String? = null,
    val scanId: String? = null,
    @SerialName("pairs") val duplicatePairs: List<DuplicatePair>? = null, // duplicate_pairs
)

// MARK: - Review cards (detected items + duplicates)

/**
 * One item detected by a scan, surfaced for interactive review. Wire fields are
 * immutable; the review sheet edits happen on a mutable [EditableItem] copy.
 * [clientId] is a stable per-instance key for Compose lists — never from the wire.
 */
@Serializable
data class DetectedItem(
    val name: String = "Item",
    val quantity: Int = 1,
    val room: String? = null,
    val pictureUrl: String? = null,
    val weightLbs: Double? = null,
    val lengthIn: Double? = null,
    val widthIn: Double? = null,
    val heightIn: Double? = null,
    val material: String? = null,
    val fragile: Boolean = false,
    val confidence: Double? = null,
) {
    val clientId: String = UUID.randomUUID().toString()

    /** A short "84×36×34 in · 150 lb" spec line, or null if we know nothing. */
    val specLine: String?
        get() {
            val parts = mutableListOf<String>()
            val l = lengthIn; val w = widthIn; val h = heightIn
            if (l != null && w != null && h != null && l > 0 && w > 0 && h > 0) {
                parts.add("${l.toInt()}×${w.toInt()}×${h.toInt()} in")
            }
            val wt = weightLbs
            if (wt != null && wt > 0) parts.add("${wt.toInt()} lb")
            return if (parts.isEmpty()) null else parts.joinToString(" · ")
        }
}

/**
 * Mutable review-sheet state for one detected item — the Kotlin equivalent of
 * iOS binding directly into a `var` DetectedItem. Carries the read-only wire
 * fields plus the editable name/quantity/keep.
 */
class EditableItem(item: DetectedItem) {
    val clientId: String = item.clientId
    var name: String = item.name
    var quantity: Int = item.quantity
    var keep: Boolean = true
    val room: String? = item.room
    val pictureUrl: String? = item.pictureUrl
    val weightLbs: Double? = item.weightLbs
    val lengthIn: Double? = item.lengthIn
    val widthIn: Double? = item.widthIn
    val heightIn: Double? = item.heightIn
    val material: String? = item.material
    val fragile: Boolean = item.fragile
    val confidence: Double? = item.confidence

    val specLine: String?
        get() {
            val parts = mutableListOf<String>()
            val l = lengthIn; val w = widthIn; val h = heightIn
            if (l != null && w != null && h != null && l > 0 && w > 0 && h > 0) {
                parts.add("${l.toInt()}×${w.toInt()}×${h.toInt()} in")
            }
            val wt = weightLbs
            if (wt != null && wt > 0) parts.add("${wt.toInt()} lb")
            return if (parts.isEmpty()) null else parts.joinToString(" · ")
        }
}

/** The shape POST /inventory/commit expects for a reviewed item. */
@Serializable
data class ReviewedItemPayload(
    val name: String,
    val quantity: Int,
    val room: String? = null,
    val pictureUrl: String? = null,
    val weightLbs: Double? = null,
    val lengthIn: Double? = null,
    val widthIn: Double? = null,
    val heightIn: Double? = null,
    val material: String? = null,
    val fragile: Boolean = false,
    val confidence: Double? = null,
) {
    companion object {
        fun from(item: EditableItem, fallbackRoom: String?): ReviewedItemPayload {
            val itemRoom = item.room?.trim()
            return ReviewedItemPayload(
                name = item.name.trim(),
                quantity = maxOf(1, item.quantity),
                room = if (!itemRoom.isNullOrEmpty()) itemRoom else fallbackRoom,
                pictureUrl = item.pictureUrl,
                weightLbs = item.weightLbs,
                lengthIn = item.lengthIn,
                widthIn = item.widthIn,
                heightIn = item.heightIn,
                material = item.material,
                fragile = item.fragile,
                confidence = item.confidence,
            )
        }
    }
}

/** A potential duplicate pair from find_duplicates, for interactive review. */
@Serializable
data class DuplicatePair(
    val itemA: DupItem,
    val itemB: DupItem,
    val similarity: Double? = null,
) {
    val clientId: String = UUID.randomUUID().toString()

    @Serializable
    data class DupItem(
        val id: Int = -1,
        val name: String? = null,
        val room: String? = null,
        val quantity: Int? = null,
    )
}

/**
 * Drives the review sheet after a scan. The backing job is consumed when the
 * user CLOSES the card (commit or dismiss) — never merely for displaying it.
 */
data class DetectedItemsReview(
    val mediaKind: String,   // "video" | "photo"
    val room: String?,
    val items: List<DetectedItem>,
    val scanId: String? = null,
    val jobId: String? = null,
    var pillId: String? = null,
    val id: String = UUID.randomUUID().toString(),
)

data class DuplicateReview(
    val pairs: List<DuplicatePair>,
    val id: String = UUID.randomUUID().toString(),
)

// MARK: - Scan jobs (durable async scans)

@Serializable
data class ScanJobDTO(
    val id: String,
    val status: String,        // queued | processing | completed | failed
    val stage: String? = null,
    val mediaKind: String? = null,
    val mediaUrl: String? = null,
    val roomHint: String? = null,
    val caption: String? = null,
    val result: ScanJobResult? = null,
    val error: String? = null,
) {
    val isTerminal: Boolean get() = status == "completed" || status == "failed"
}

@Serializable
data class ScanJobResult(
    val mediaKind: String? = null,
    val room: String? = null,
    val items: List<DetectedItem>? = null,
)

@Serializable
data class ScanJobListResponse(val jobs: List<ScanJobDTO> = emptyList())
