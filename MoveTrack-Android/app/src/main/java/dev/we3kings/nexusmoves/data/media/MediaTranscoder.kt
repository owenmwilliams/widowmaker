package dev.we3kings.nexusmoves.data.media

import android.net.Uri
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.util.UnstableApi
import androidx.media3.effect.Presentation
import androidx.media3.transformer.Composition
import androidx.media3.transformer.ExportException
import androidx.media3.transformer.ExportResult
import androidx.media3.transformer.Transformer
import dev.we3kings.nexusmoves.NexusApplication
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import java.io.File
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

/**
 * Media3 Transformer wrapper — transcodes a picked video to H.264 720p before
 * upload. iOS gets 720p for free from UIImagePickerController's export preset;
 * Android must do it explicitly, or a 4K walkthrough blows past the upload path
 * (the ~32MB request cap on the multipart endpoint, and just slow PUTs on the
 * signed-URL path). Height is clamped to 720 preserving aspect ratio via a
 * Presentation video effect; a video already ≤720p is re-encoded, not upscaled.
 */
@UnstableApi
object MediaTranscoder {

    /**
     * Transcode [input] to a 720p H.264 mp4 in the cache dir and return the file.
     * Transformer requires a Looper thread, so this runs on Main.
     */
    suspend fun transcodeTo720p(input: Uri): File = withContext(Dispatchers.Main) {
        val ctx = NexusApplication.appContext
        val output = File.createTempFile("nexus_scan_", ".mp4", ctx.cacheDir)

        suspendCancellableCoroutine { cont ->
            val transformer = Transformer.Builder(ctx)
                .setVideoMimeType(MimeTypes.VIDEO_H264)
                .setVideoEffects(listOf(Presentation.createForHeight(720)))
                .addListener(object : Transformer.Listener {
                    override fun onCompleted(composition: Composition, exportResult: ExportResult) {
                        if (cont.isActive) cont.resume(output)
                    }

                    override fun onError(
                        composition: Composition,
                        exportResult: ExportResult,
                        exportException: ExportException,
                    ) {
                        if (cont.isActive) cont.resumeWithException(exportException)
                    }
                })
                .build()

            transformer.start(MediaItem.fromUri(input), output.absolutePath)
            cont.invokeOnCancellation { transformer.cancel() }
        }
    }
}
