package dev.we3kings.nexusmoves.data.upload

import android.graphics.BitmapFactory
import android.net.Uri
import dev.we3kings.nexusmoves.NexusApplication
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.security.MessageDigest

/**
 * Android media prep helpers — the local half of the upload path (the network
 * half lives in NexusService.uploadMedia / uploadMediaDirect). Reads content
 * Uris, recompresses photos to JPEG q0.8 (parity with iOS
 * jpegData(compressionQuality: 0.8)), and derives the SHA-256 idempotency key.
 */
object MediaUploader {

    private val resolver get() = NexusApplication.appContext.contentResolver

    /** Decode a picked image and recompress to JPEG q0.8 (iOS parity). */
    fun loadImageJpeg(uri: Uri): ByteArray {
        val bitmap = resolver.openInputStream(uri).use { input ->
            BitmapFactory.decodeStream(input)
        } ?: throw IOException("Couldn't read the selected image")
        return ByteArrayOutputStream().use { out ->
            bitmap.compress(android.graphics.Bitmap.CompressFormat.JPEG, 80, out)
            bitmap.recycle()
            out.toByteArray()
        }
    }

    /** Read a content Uri's raw bytes (used for an already-transcoded video file). */
    fun readBytes(uri: Uri): ByteArray =
        resolver.openInputStream(uri)?.use { it.readBytes() }
            ?: throw IOException("Couldn't read the selected media")

    /**
     * Content-derived idempotency key — SHA-256 over the media bytes. For a photo
     * batch it hashes each part in order (iOS: hash of concatenated bytes), so the
     * same batch retried reuses the in-flight/unseen job instead of scanning twice.
     */
    fun sha256Hex(vararg parts: ByteArray): String {
        val md = MessageDigest.getInstance("SHA-256")
        parts.forEach { md.update(it) }
        return md.digest().joinToString("") { "%02x".format(it) }
    }

    fun sha256Hex(parts: List<ByteArray>): String = sha256Hex(*parts.toTypedArray())
}
