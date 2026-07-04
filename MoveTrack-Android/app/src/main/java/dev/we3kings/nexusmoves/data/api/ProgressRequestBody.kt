package dev.we3kings.nexusmoves.data.api

import okhttp3.MediaType
import okhttp3.RequestBody
import okio.BufferedSink

/**
 * A RequestBody that reports body-upload progress (0.0–1.0) as bytes are
 * written to the sink — the OkHttp equivalent of iOS
 * URLSessionTaskDelegate.didSendBodyData, used for the direct-GCS video PUT.
 */
class ProgressRequestBody(
    private val bytes: ByteArray,
    private val contentType: MediaType,
    private val onProgress: (Float) -> Unit,
) : RequestBody() {

    override fun contentType(): MediaType = contentType

    override fun contentLength(): Long = bytes.size.toLong()

    override fun writeTo(sink: BufferedSink) {
        val total = bytes.size
        if (total == 0) { onProgress(1f); return }
        val chunk = 16 * 1024
        var written = 0
        while (written < total) {
            val n = minOf(chunk, total - written)
            sink.write(bytes, written, n)
            written += n
            onProgress(written.toFloat() / total)
        }
        sink.flush()
    }
}
