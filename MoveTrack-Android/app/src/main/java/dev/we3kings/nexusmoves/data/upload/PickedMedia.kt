package dev.we3kings.nexusmoves.data.upload

import android.net.Uri
import java.util.UUID

/**
 * One picked media item ready to attach to the composer — port of iOS
 * PickedMedia. Images carry their compressed JPEG [bytes] eagerly (so the size
 * guard and batch idempotency hash work in the composer); videos keep only the
 * [uri] and are transcoded to 720p + read at send time.
 */
data class PickedMedia(
    val uri: Uri,
    val mimeType: String,
    val filename: String,
    val bytes: ByteArray? = null,
    val id: String = UUID.randomUUID().toString(),
) {
    val isVideo: Boolean get() = mimeType.startsWith("video")

    // Identity is the generated id; the ByteArray payload is incidental.
    override fun equals(other: Any?): Boolean = other is PickedMedia && other.id == id
    override fun hashCode(): Int = id.hashCode()
}
