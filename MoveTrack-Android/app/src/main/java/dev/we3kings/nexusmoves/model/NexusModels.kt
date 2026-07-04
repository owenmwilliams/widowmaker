package dev.we3kings.nexusmoves.model

import kotlinx.serialization.Serializable

/**
 * Wire models — port of MoveTrack-iOS NexusModels.swift. Keys are camelCase on
 * the wire; decode defensively (ignoreUnknownKeys, nullable fields) so server
 * shape changes never wipe history.
 * TODO(android-port): complete fields against NexusModels.swift, which is the
 * source of truth for this contract.
 */

@Serializable
data class NexusAttachment(val url: String? = null, val mimeType: String? = null)

@Serializable
data class NexusMessageDTO(
    val role: String = "model",
    val content: String = "",
    val attachments: List<NexusAttachment>? = null,
    val kind: String? = null,       // "scan_review" → compact pill, not a bubble
    val scanCount: Int? = null,
)

@Serializable
data class UploadResponse(val url: String, val mimeType: String)

@Serializable
data class ScanJobDTO(
    val id: String,
    val status: String,             // queued | processing | completed | failed
    val stage: String? = null,
    val mediaKind: String? = null,
    val mediaUrl: String? = null,
    val mediaUrls: List<String>? = null,
    val roomHint: String? = null,
    val error: String? = null,
)

// TODO(android-port): DetectedItem/DetectedItemsReview (review card),
// ShareReadinessDTO (nextSteps/overall/shareWarning), QuickStartChip,
// commit request/response (addedCount/updatedCount), duplicates DTOs.
