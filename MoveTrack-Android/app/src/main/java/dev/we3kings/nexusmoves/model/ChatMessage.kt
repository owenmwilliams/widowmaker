package dev.we3kings.nexusmoves.model

import java.util.UUID

/**
 * What the chat view renders — port of iOS ChatMessage. Distinct from the wire
 * DTO so we can hold optimistic (not-yet-persisted) messages and locally-created
 * replies. The review modal IS the response to a scan; the chat keeps a compact
 * [ScanReviewState] pill artifact instead of a prose bubble.
 */
data class ChatMessage(
    val id: String = UUID.randomUUID().toString(),
    val role: Role,
    val text: String,
    val attachments: List<NexusAttachment> = emptyList(),
    val kind: Kind = Kind.Text,
) {
    enum class Role { User, Model }

    sealed interface Kind {
        data object Text : Kind
        data class ScanReview(val state: ScanReviewState) : Kind
    }

    sealed interface ScanReviewState {
        data class Pending(val count: Int) : ScanReviewState               // card up, undecided
        data class Reviewed(val added: Int, val skipped: Int) : ScanReviewState  // committed
        data class Dismissed(val count: Int) : ScanReviewState             // closed without adding
        data class Record(val count: Int) : ScanReviewState               // reloaded from transcript
    }

    companion object {
        fun from(dto: NexusMessageDTO): ChatMessage = ChatMessage(
            role = if (dto.role == "user") Role.User else Role.Model,
            text = dto.content,
            attachments = dto.attachments ?: emptyList(),
            kind = if (dto.kind == "scan_review")
                Kind.ScanReview(ScanReviewState.Record(dto.scanCount ?: 0))
            else Kind.Text,
        )
    }
}
