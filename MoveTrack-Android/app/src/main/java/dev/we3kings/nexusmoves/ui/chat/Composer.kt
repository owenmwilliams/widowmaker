package dev.we3kings.nexusmoves.ui.chat

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowForward
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.PhotoCamera
import androidx.compose.material.icons.outlined.Videocam
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import dev.we3kings.nexusmoves.data.upload.MediaUploader
import dev.we3kings.nexusmoves.data.upload.PickedMedia
import dev.we3kings.nexusmoves.ui.components.NexusIconButton
import dev.we3kings.nexusmoves.ui.theme.NexusRadii
import dev.we3kings.nexusmoves.ui.theme.NexusType
import dev.we3kings.nexusmoves.ui.theme.nexus
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File

/**
 * The composer — port of the iOS NexusChatView input bar + attachment flow.
 * Owns the up-to-5-photo batch / single-video attachment rules (photos
 * accumulate, a video is exclusive), the AI-use notice, camera + library
 * capture, and the send path. Matches iOS behavior including restoring media on
 * a failed send (unless a review card already survived the drop).
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun Composer(
    vm: NexusViewModel,
    draft: String,
    onDraftChange: (String) -> Unit,
    cameraRequestCaption: String?,
    onCameraHandled: () -> Unit,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()

    var pendingMedia by remember { mutableStateOf<List<PickedMedia>>(emptyList()) }
    var captureCaption by remember { mutableStateOf("") }
    var showAttachSheet by remember { mutableStateOf(false) }
    var showAINotice by remember { mutableStateOf(false) }
    var aiNoticeShown by remember { mutableStateOf(readAiNoticeShown(context)) }
    var cameraOutputUri by remember { mutableStateOf<Uri?>(null) }

    fun photoSlotsLeft(): Int {
        val photos = if (pendingMedia.any { it.isVideo }) 0 else pendingMedia.size
        return (5 - photos).coerceAtLeast(1)
    }

    // Composer attachment rules: a video always scans alone (attaching one
    // replaces everything); photos accumulate up to five (attaching one replaces
    // a pending video).
    fun attach(items: List<PickedMedia>) {
        if (draft.isEmpty() && captureCaption.isNotEmpty()) onDraftChange(captureCaption)
        captureCaption = ""
        var current = pendingMedia.toMutableList()
        for (item in items) {
            if (item.isVideo) {
                current = mutableListOf(item)
            } else {
                if (current.any { it.isVideo }) current = mutableListOf()
                if (current.size < 5) current.add(item)
            }
        }
        pendingMedia = current
    }

    // --- Activity-result launchers ---

    // Shared handler: decode each picked image to JPEG off the main thread, then
    // attach in order. attach() enforces the ≤5 rule as a backstop.
    val onPhotosPicked: (List<Uri>) -> Unit = { uris ->
        if (uris.isNotEmpty()) {
            scope.launch {
                val picked = withContext(Dispatchers.IO) {
                    uris.mapIndexedNotNull { i, uri ->
                        runCatching {
                            PickedMedia(uri, "image/jpeg", "photo${i + 1}.jpg", MediaUploader.loadImageJpeg(uri))
                        }.getOrNull()
                    }
                }
                if (picked.isNotEmpty()) attach(picked)
            }
        }
    }

    // PickMultipleVisualMedia's maxItems is fixed at construction and must be ≥ 2,
    // so cap the picker UI itself to the remaining slots (5 − already-attached
    // photos) by keeping one launcher per possible cap and a single-pick for the
    // last slot — rather than letting the user over-select and silently dropping.
    val pickSingle = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
        onPhotosPicked(listOfNotNull(uri))
    }
    val pick2 = rememberLauncherForActivityResult(ActivityResultContracts.PickMultipleVisualMedia(2)) { onPhotosPicked(it) }
    val pick3 = rememberLauncherForActivityResult(ActivityResultContracts.PickMultipleVisualMedia(3)) { onPhotosPicked(it) }
    val pick4 = rememberLauncherForActivityResult(ActivityResultContracts.PickMultipleVisualMedia(4)) { onPhotosPicked(it) }
    val pick5 = rememberLauncherForActivityResult(ActivityResultContracts.PickMultipleVisualMedia(5)) { onPhotosPicked(it) }

    fun launchPhotoPicker() {
        val req = PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)
        when (photoSlotsLeft()) {
            1 -> pickSingle.launch(req)
            2 -> pick2.launch(req)
            3 -> pick3.launch(req)
            4 -> pick4.launch(req)
            else -> pick5.launch(req)
        }
    }

    val pickVideo = rememberLauncherForActivityResult(
        ActivityResultContracts.PickVisualMedia()
    ) { uri ->
        if (uri != null) {
            val mime = context.contentResolver.getType(uri) ?: "video/mp4"
            attach(listOf(PickedMedia(uri, mime, "walkthrough.mp4")))
        }
    }

    val takePhoto = rememberLauncherForActivityResult(
        ActivityResultContracts.TakePicture()
    ) { success ->
        val uri = cameraOutputUri
        if (success && uri != null) {
            scope.launch {
                val bytes = withContext(Dispatchers.IO) { runCatching { MediaUploader.loadImageJpeg(uri) }.getOrNull() }
                if (bytes != null) attach(listOf(PickedMedia(uri, "image/jpeg", "camera.jpg", bytes)))
            }
        }
    }

    val recordVideo = rememberLauncherForActivityResult(
        ActivityResultContracts.CaptureVideo()
    ) { success ->
        val uri = cameraOutputUri
        if (success && uri != null) {
            val mime = context.contentResolver.getType(uri) ?: "video/mp4"
            attach(listOf(PickedMedia(uri, mime, "camera.mp4")))
        }
    }

    fun launchTakePhoto() {
        val uri = newCaptureUri(context, ".jpg")
        cameraOutputUri = uri
        takePhoto.launch(uri)
    }

    fun launchRecordVideo() {
        val uri = newCaptureUri(context, ".mp4")
        cameraOutputUri = uri
        recordVideo.launch(uri)
    }

    // CAMERA is declared in the manifest, so some OEMs require the app to hold it
    // before the system camera intent will return. Request at first use, then run
    // the pending capture.
    var pendingCameraAction by remember { mutableStateOf<(() -> Unit)?>(null) }
    val requestCamera = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted ->
        val action = pendingCameraAction
        pendingCameraAction = null
        if (granted) action?.invoke()
    }

    fun withCamera(action: () -> Unit) {
        val granted = ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) ==
            PackageManager.PERMISSION_GRANTED
        if (granted) action() else {
            pendingCameraAction = action
            requestCamera.launch(Manifest.permission.CAMERA)
        }
    }

    fun beginCapture(caption: String) {
        captureCaption = caption
        if (aiNoticeShown) showAttachSheet = true else showAINotice = true
    }

    // Agent [BUTTONS] camera action funnels through the same notice-gated flow.
    LaunchedEffect(cameraRequestCaption) {
        if (cameraRequestCaption != null) {
            beginCapture(cameraRequestCaption)
            onCameraHandled()
        }
    }

    fun doSend() {
        val text = draft
        if (pendingMedia.isNotEmpty()) {
            val items = pendingMedia
            onDraftChange("")
            pendingMedia = emptyList()
            scope.launch {
                val ok = if (items.size == 1) vm.sendMedia(items[0], text) else vm.sendMediaBatch(items, text)
                if (!ok && vm.pendingReview == null) {
                    // Don't lose the media on a failed send — put it back for retry.
                    pendingMedia = items
                    if (draft.isBlank()) onDraftChange(text)
                }
            }
        } else {
            onDraftChange("")
            scope.launch { vm.send(text) }
        }
    }

    val c = nexus
    val canSend = !vm.isBusy && (pendingMedia.isNotEmpty() || draft.trim().isNotEmpty())

    Column(Modifier.fillMaxWidth().background(c.bg).padding(horizontal = 12.dp, vertical = 10.dp)) {
        if (pendingMedia.isNotEmpty()) {
            PendingMediaChips(pendingMedia, onRemove = { id -> pendingMedia = pendingMedia.filterNot { it.id == id } })
            Spacer(Modifier.size(8.dp))
        }
        Row(verticalAlignment = Alignment.Bottom) {
            // Capture (+) — accent circle.
            NexusIconButton(
                icon = Icons.Outlined.Add,
                contentDescription = "Add a photo or video",
                onClick = { beginCapture("") },
                size = 44,
                background = if (vm.isBusy) c.surfaceHover else c.accent,
                tint = if (vm.isBusy) c.textTertiary else Color.White,
                enabled = !vm.isBusy,
            )
            Spacer(Modifier.width(10.dp))
            // Composer field — the rounded chat message bar (Input `composer`).
            Box(
                Modifier
                    .weight(1f)
                    .heightIn(min = 48.dp)
                    .clip(RoundedCornerShape(NexusRadii.bubble.dp))
                    .background(c.surfaceCard)
                    .padding(horizontal = 18.dp, vertical = 13.dp),
                contentAlignment = Alignment.CenterStart,
            ) {
                if (draft.isEmpty()) {
                    Text(
                        if (pendingMedia.isEmpty()) "Message Nexus…" else "Add a note (optional)…",
                        color = c.textTertiary, style = NexusType.typography.bodyLarge,
                    )
                }
                BasicTextField(
                    value = draft,
                    onValueChange = onDraftChange,
                    textStyle = NexusType.typography.bodyLarge.copy(color = c.textPrimary),
                    cursorBrush = SolidColor(c.accent),
                    maxLines = 5,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
            Spacer(Modifier.width(10.dp))
            // Send — accent when there's something to send, quiet otherwise.
            NexusIconButton(
                icon = Icons.AutoMirrored.Outlined.ArrowForward,
                contentDescription = "Send",
                onClick = { doSend() },
                size = 44,
                background = if (canSend) c.accent else c.surfaceHover,
                tint = if (canSend) Color.White else c.textTertiary,
                enabled = canSend,
            )
        }
    }

    if (showAINotice) {
        AlertDialog(
            onDismissRequest = { showAINotice = false },
            containerColor = c.surfaceCard,
            title = { Text("Photos & videos use AI") },
            text = { Text("To build your inventory, the photos and videos you add are sent to AI services to identify your items and estimate their size and weight.") },
            confirmButton = {
                TextButton(onClick = {
                    showAINotice = false
                    aiNoticeShown = true
                    writeAiNoticeShown(context)
                    showAttachSheet = true
                }) { Text("Continue") }
            },
            dismissButton = { TextButton(onClick = { showAINotice = false }) { Text("Cancel") } },
        )
    }

    if (showAttachSheet) {
        ModalBottomSheet(onDismissRequest = { showAttachSheet = false }, containerColor = c.surfaceSunk) {
            Column(Modifier.fillMaxWidth().padding(16.dp)) {
                Text("Add a room photo or video", style = NexusType.typography.titleMedium, color = c.textPrimary)
                Spacer(Modifier.size(8.dp))
                Text(
                    "Recording a room? For best results: talk through your items out loud, " +
                        "open closets & drawers, and pan slowly across the whole room (phone " +
                        "sideways, lights on). For big items, add a straight-on close-up photo.",
                    style = NexusType.typography.bodyMedium,
                    color = c.textSecondary,
                )
                Spacer(Modifier.size(12.dp))
                AttachOption("Take Photo") { showAttachSheet = false; withCamera { launchTakePhoto() } }
                AttachOption("Record Video") { showAttachSheet = false; withCamera { launchRecordVideo() } }
                AttachOption("Choose Photos (up to ${photoSlotsLeft()})") {
                    showAttachSheet = false
                    launchPhotoPicker()
                }
                AttachOption("Choose a Video") {
                    showAttachSheet = false
                    pickVideo.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.VideoOnly))
                }
                Spacer(Modifier.size(12.dp))
            }
        }
    }
}

@Composable
private fun AttachOption(label: String, onClick: () -> Unit) {
    val c = nexus
    Box(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(NexusRadii.button.dp)).background(c.accentQuiet)
            .clickable { onClick() }.padding(horizontal = 16.dp, vertical = 15.dp),
    ) {
        Text(label, color = c.accent, style = NexusType.typography.labelLarge, fontWeight = FontWeight.SemiBold)
    }
    Spacer(Modifier.size(8.dp))
}

@Composable
private fun PendingMediaChips(items: List<PickedMedia>, onRemove: (String) -> Unit) {
    val c = nexus
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        items.forEachIndexed { index, media ->
            Row(
                Modifier.fillMaxWidth().clip(RoundedCornerShape(NexusRadii.button.dp)).background(c.surfaceCard)
                    .padding(start = 12.dp, end = 4.dp, top = 6.dp, bottom = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(
                    if (media.isVideo) Icons.Outlined.Videocam else Icons.Outlined.PhotoCamera,
                    null, tint = c.accent, modifier = Modifier.size(20.dp),
                )
                Spacer(Modifier.width(8.dp))
                Text(
                    if (media.isVideo) "Video attached"
                    else if (items.size == 1) "Photo attached"
                    else "Photo ${index + 1} of ${items.size}",
                    style = NexusType.typography.bodyMedium, fontWeight = FontWeight.Medium,
                    color = c.textPrimary, modifier = Modifier.weight(1f),
                )
                NexusIconButton(
                    icon = Icons.Outlined.Close,
                    contentDescription = "Remove attachment",
                    onClick = { onRemove(media.id) },
                    size = 32,
                    tint = c.textSecondary,
                )
            }
        }
    }
}

private fun newCaptureUri(context: Context, ext: String): Uri {
    val dir = File(context.cacheDir, "captures").apply { mkdirs() }
    val file = File.createTempFile("cap_", ext, dir)
    return FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", file)
}

private const val PREFS = "nexus_prefs"
private const val AI_NOTICE_KEY = "aiCaptureNoticeShown"

private fun readAiNoticeShown(context: Context): Boolean =
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(AI_NOTICE_KEY, false)

private fun writeAiNoticeShown(context: Context) {
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean(AI_NOTICE_KEY, true).apply()
}
