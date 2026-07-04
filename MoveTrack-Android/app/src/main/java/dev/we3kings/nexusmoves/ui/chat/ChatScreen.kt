package dev.we3kings.nexusmoves.ui.chat

import android.content.Intent
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.Send
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.ChevronRight
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.Home
import androidx.compose.material.icons.outlined.IosShare
import androidx.compose.material.icons.outlined.MoreHoriz
import androidx.compose.material.icons.outlined.PhotoCamera
import androidx.compose.material.icons.outlined.Videocam
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import dev.we3kings.nexusmoves.model.ChatMessage
import dev.we3kings.nexusmoves.ui.auth.AuthViewModel
import dev.we3kings.nexusmoves.ui.components.AssistantAvatar
import dev.we3kings.nexusmoves.ui.components.Banner
import dev.we3kings.nexusmoves.ui.components.BannerTone
import dev.we3kings.nexusmoves.ui.components.NexusIconButton
import dev.we3kings.nexusmoves.ui.components.NexusProgressBar
import dev.we3kings.nexusmoves.ui.components.StatusPill
import dev.we3kings.nexusmoves.ui.components.SuggestionButton
import dev.we3kings.nexusmoves.ui.readiness.ReadinessSheet
import dev.we3kings.nexusmoves.ui.review.DuplicateReviewSheet
import dev.we3kings.nexusmoves.ui.review.ReviewItemsSheet
import dev.we3kings.nexusmoves.ui.theme.NexusRadii
import dev.we3kings.nexusmoves.ui.theme.NexusType
import dev.we3kings.nexusmoves.ui.theme.nexus
import kotlinx.coroutines.launch

/**
 * The whole product post-login — port of iOS NexusChatView, styled to the Nexus
 * design system: dark surfaces, the shimmer AssistantAvatar, solid-accent user
 * bubbles / card assistant bubbles, block SuggestionButtons, a shimmer readiness
 * fill, and Material Symbols outlined icons (no emoji). Behavior is unchanged.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ChatScreen(
    auth: AuthViewModel,
    vm: NexusViewModel = viewModel(key = "nexus-${auth.currentUser?.id ?: "anon"}"),
) {
    val c = nexus
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    var draft by remember { mutableStateOf("") }
    var shareWarningText by remember { mutableStateOf<String?>(null) }
    var cameraRequest by remember { mutableStateOf<String?>(null) }
    var showReadiness by remember { mutableStateOf(false) }

    LaunchedEffect(Unit) { vm.loadIfNeeded() }
    LaunchedEffect(vm.sessionExpired) { if (vm.sessionExpired) auth.logout() }

    fun systemShare(url: String) {
        val intent = Intent(Intent.ACTION_SEND).apply {
            type = "text/plain"
            putExtra(Intent.EXTRA_TEXT, url)
        }
        context.startActivity(Intent.createChooser(intent, null))
    }

    fun onShareTapped() {
        scope.launch {
            when (val prep = vm.evaluateAndPrepareShare()) {
                is SharePrep.Warn -> shareWarningText = prep.message
                is SharePrep.Ready -> systemShare(prep.url)
                SharePrep.Failed -> {}
            }
        }
    }

    Column(Modifier.fillMaxSize().background(c.bg)) {
        Header(vm, onNewConversation = { scope.launch { vm.startNewConversation() } },
            onLogout = { auth.logout() }, onShare = { onShareTapped() },
            onOpenReadiness = { showReadiness = true })

        Conversation(vm, modifier = Modifier.weight(1f),
            onChip = { message -> scope.launch { vm.send(message) } },
            onAgentButton = { button ->
                when (button.primaryAction) {
                    AgentButtonAction.Send -> scope.launch { vm.send(button.message) }
                    AgentButtonAction.Prefill -> draft = button.message
                    AgentButtonAction.Camera -> cameraRequest = button.message
                }
            })

        vm.errorMessage?.let { ErrorBar(it) { vm.errorMessage = null } }

        Composer(
            vm = vm,
            draft = draft,
            onDraftChange = { draft = it },
            cameraRequestCaption = cameraRequest,
            onCameraHandled = { cameraRequest = null },
        )
    }

    if (shareWarningText != null) {
        AlertDialog(
            onDismissRequest = { shareWarningText = null },
            containerColor = c.surfaceCard,
            title = { Text("Before you share") },
            text = { Text(shareWarningText ?: "") },
            confirmButton = {
                TextButton(onClick = {
                    shareWarningText = null
                    scope.launch { vm.forceShare()?.let { systemShare(it) } }
                }) { Text("Share anyway") }
            },
            dismissButton = {
                TextButton(onClick = { shareWarningText = null }) { Text("Go back & fix") }
            },
        )
    }

    // Scan review card — the modal IS the scan response. Every close path funnels
    // through the view model so the job is consumed once and the pill records it.
    val review = vm.pendingReview
    if (review != null) {
        ModalBottomSheet(
            onDismissRequest = { vm.dismissReview() },
            sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
            containerColor = c.surfaceSunk,
        ) {
            ReviewItemsSheet(
                review = review,
                onCommit = { items -> scope.launch { vm.commitReview(items, review.room, review.scanId) } },
                onCancel = { vm.dismissReview() },
                onRescan = { scope.launch { vm.rescanFromReview() } },
            )
        }
    }

    val dup = vm.pendingDuplicates
    if (dup != null) {
        ModalBottomSheet(
            onDismissRequest = { vm.pendingDuplicates = null },
            sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
            containerColor = c.surfaceSunk,
        ) {
            DuplicateReviewSheet(
                review = dup,
                onApply = { ids -> scope.launch { vm.resolveDuplicates(ids) } },
                onCancel = { vm.pendingDuplicates = null },
            )
        }
    }

    if (showReadiness) {
        ModalBottomSheet(
            onDismissRequest = { showReadiness = false },
            sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
            containerColor = c.surfaceSunk,
        ) {
            ReadinessSheet(
                readiness = vm.readiness,
                onShare = { showReadiness = false; onShareTapped() },
                onEstimateWeights = {
                    showReadiness = false
                    scope.launch { vm.send("Estimate the missing weights for my items.") }
                },
                onAddVideo = { showReadiness = false; cameraRequest = "" },
                onStep = { step -> showReadiness = false; scope.launch { vm.send(step) } },
            )
        }
    }
}

// MARK: - Header

@Composable
private fun Header(
    vm: NexusViewModel,
    onNewConversation: () -> Unit,
    onLogout: () -> Unit,
    onShare: () -> Unit,
    onOpenReadiness: () -> Unit,
) {
    val c = nexus
    var menuOpen by remember { mutableStateOf(false) }
    Column(
        Modifier
            .fillMaxWidth()
            .background(c.surface)
            .padding(horizontal = 16.dp)
            .padding(top = 8.dp, bottom = 14.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            AssistantAvatar(size = 44)
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text("Nexus Moves", style = NexusType.typography.titleLarge, color = c.textPrimary)
                Text("Your moving assistant", style = NexusType.typography.bodySmall,
                    color = c.textSecondary, fontWeight = FontWeight.Medium)
            }
            Box {
                NexusIconButton(
                    icon = Icons.Outlined.MoreHoriz,
                    contentDescription = "Menu",
                    onClick = { menuOpen = true },
                    size = 34,
                    tint = c.accent,
                    borderColor = c.accentQuiet2,
                )
                DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }) {
                    DropdownMenuItem(text = { Text("New conversation") },
                        onClick = { menuOpen = false; onNewConversation() })
                    HorizontalDivider()
                    DropdownMenuItem(text = { Text("Log out") },
                        onClick = { menuOpen = false; onLogout() })
                }
            }
        }
        Spacer(Modifier.height(14.dp))
        ReadinessCard(vm, onShare = onShare, onOpenReadiness = onOpenReadiness)
    }
}

@Composable
private fun ReadinessCard(vm: NexusViewModel, onShare: () -> Unit, onOpenReadiness: () -> Unit) {
    val c = nexus
    val r = vm.readiness
    Row(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(NexusRadii.bubble.dp))
            .background(Color.Black)
            .padding(16.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f).clickable { onOpenReadiness() }) {
            Row(verticalAlignment = Alignment.Bottom) {
                Text(r?.statusLabel ?: "Building your inventory",
                    style = NexusType.typography.titleMedium, color = Color.White,
                    modifier = Modifier.weight(1f))
                Text("${r?.overall ?: 0}%", style = NexusType.dataReadout, color = c.textSecondary)
            }
            Spacer(Modifier.height(12.dp))
            NexusProgressBar(value = r?.progress ?: 0f)
            Spacer(Modifier.height(10.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("See what's left", style = NexusType.typography.labelLarge,
                    fontWeight = FontWeight.Bold, color = c.accent)
                Icon(Icons.Outlined.ChevronRight, null, tint = c.accent, modifier = Modifier.size(16.dp))
            }
        }
        Spacer(Modifier.width(14.dp))
        Column(
            Modifier
                .width(64.dp)
                .height(60.dp)
                .clip(RoundedCornerShape(NexusRadii.button.dp))
                .background(c.accent)
                .clickable(enabled = !vm.isPreparingShare) { onShare() }
                .alpha(if (vm.isPreparingShare) 0.6f else 1f),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center,
        ) {
            Icon(Icons.Outlined.IosShare, null, tint = Color.White, modifier = Modifier.size(22.dp))
            Spacer(Modifier.height(3.dp))
            Text("Share", color = Color.White, style = NexusType.typography.labelMedium, fontWeight = FontWeight.Bold)
        }
    }
}

// MARK: - Conversation

@Composable
private fun Conversation(
    vm: NexusViewModel,
    modifier: Modifier = Modifier,
    onChip: (String) -> Unit,
    onAgentButton: (AgentButton) -> Unit,
) {
    val listState = rememberLazyListState()
    LaunchedEffect(vm.messages.size, vm.isLoading, vm.isUploading, vm.phaseText) {
        val count = vm.messages.size + 2
        if (count > 0) listState.animateScrollToItem((count - 1).coerceAtLeast(0))
    }

    LazyColumn(
        modifier = modifier.fillMaxSize(),
        state = listState,
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        if (vm.messages.isEmpty() && !vm.isLoading) {
            item { WelcomeCard() }
        }
        items(vm.messages, key = { it.id }) { message ->
            val kind = message.kind
            if (kind is ChatMessage.Kind.ScanReview) {
                ScanReviewPill(kind.state)
            } else {
                MessageBubble(message, onAgentButton)
            }
        }
        if (vm.quickStartChips.isNotEmpty()) {
            item {
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    vm.quickStartChips.forEach { chip ->
                        SuggestionButton(label = chip.label, onClick = { onChip(chip.message) })
                    }
                }
            }
        }
        if (vm.isUploading) {
            item { UploadProgressRow(vm.uploadProgress, vm.phaseText) }
        }
        if (vm.isLoading) {
            item { TypingIndicator(vm.phaseText, vm.detailText) }
        }
    }
}

@Composable
private fun WelcomeCard() {
    val c = nexus
    Column(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(NexusRadii.card.dp))
            .background(c.surfaceCard)
            .padding(18.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text("Hi, I'm Nexus", style = NexusType.typography.titleLarge, color = c.textPrimary)
        Text(
            "Tell me about your move and I'll build an inventory you can share with movers — in three quick steps:",
            color = c.textSecondary, style = NexusType.typography.bodyMedium,
        )
        StepRow(Icons.Outlined.Home, "Tell me about your current home")
        StepRow(Icons.Outlined.Videocam, "Add a photo or video of each room")
        StepRow(Icons.Outlined.IosShare, "Share your inventory with movers")
        Text(
            InlineMarkdown.parse("First — **what's your name?** Type it below to get started."),
            style = NexusType.typography.bodyMedium, color = c.textPrimary,
        )
    }
}

@Composable
private fun StepRow(icon: androidx.compose.ui.graphics.vector.ImageVector, text: String) {
    val c = nexus
    Row(verticalAlignment = Alignment.CenterVertically) {
        Box(
            Modifier.size(32.dp).clip(CircleShape).background(c.accentQuiet),
            contentAlignment = Alignment.Center,
        ) { Icon(icon, null, tint = c.accent, modifier = Modifier.size(17.dp)) }
        Spacer(Modifier.width(12.dp))
        Text(text, style = NexusType.typography.bodyMedium, color = c.textPrimary)
    }
}

@Composable
private fun MessageBubble(message: ChatMessage, onButton: (AgentButton) -> Unit) {
    val c = nexus
    val isUser = message.role == ChatMessage.Role.User
    val parsed = if (isUser) null else AgentMessageParser.parse(message.text)
    val displayText = if (isUser) message.text else (parsed?.prose ?: message.text)
    val tail = 7.dp
    val bubbleShape = RoundedCornerShape(
        topStart = NexusRadii.bubble.dp, topEnd = NexusRadii.bubble.dp,
        bottomEnd = if (isUser) tail else NexusRadii.bubble.dp,
        bottomStart = if (isUser) NexusRadii.bubble.dp else tail,
    )

    Column(
        Modifier.fillMaxWidth(),
        horizontalAlignment = if (isUser) Alignment.End else Alignment.Start,
    ) {
        message.attachments.forEach { attachment ->
            Text(
                attachment.displayLabel,
                style = NexusType.typography.labelMedium,
                color = if (isUser) Color.White else c.accent,
                modifier = Modifier
                    .padding(bottom = 4.dp)
                    .clip(CircleShape)
                    .background(if (isUser) Color.White.copy(alpha = 0.22f) else c.accentQuiet)
                    .padding(horizontal = 12.dp, vertical = 6.dp),
            )
        }
        if (displayText.isNotEmpty()) {
            Box(
                Modifier
                    .widthIn(max = 320.dp)
                    .clip(bubbleShape)
                    .background(if (isUser) c.bubbleSelf else c.bubbleOther)
                    .padding(horizontal = 16.dp, vertical = 12.dp),
            ) {
                Text(
                    if (isUser) AnnotatedString(displayText) else InlineMarkdown.parse(displayText),
                    color = if (isUser) c.bubbleSelfText else c.bubbleOtherText,
                    style = NexusType.typography.bodyLarge,
                    fontWeight = if (isUser) FontWeight.SemiBold else FontWeight.Normal,
                )
            }
        }
        val buttons = parsed?.buttons
        if (!buttons.isNullOrEmpty()) {
            Spacer(Modifier.height(8.dp))
            Column(verticalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
                buttons.forEach { button ->
                    val icon = when (button.primaryAction) {
                        AgentButtonAction.Camera -> Icons.Outlined.PhotoCamera
                        AgentButtonAction.Prefill -> Icons.Outlined.Edit
                        AgentButtonAction.Send -> Icons.AutoMirrored.Outlined.Send
                    }
                    SuggestionButton(label = button.label, icon = icon, onClick = { onButton(button) })
                }
            }
        }
    }
}

@Composable
private fun ScanReviewPill(state: ChatMessage.ScanReviewState) {
    val reviewed = state is ChatMessage.ScanReviewState.Reviewed
    val label = when (state) {
        is ChatMessage.ScanReviewState.Pending -> "${state.count} item${plural(state.count)} found — reviewing…"
        is ChatMessage.ScanReviewState.Reviewed -> buildString {
            append("Items reviewed")
            when {
                state.added > 0 -> {
                    append(" · ${state.added} added")
                    if (state.updated > 0) append(", ${state.updated} photo${plural(state.updated)} updated")
                }
                state.updated > 0 -> append(" · ${state.updated} photo${plural(state.updated)} updated")
            }
            if (state.skipped > 0) append(", ${state.skipped} skipped")
        }
        is ChatMessage.ScanReviewState.Dismissed -> "${state.count} item${plural(state.count)} found · not added"
        is ChatMessage.ScanReviewState.Record ->
            if (state.count > 0) "${state.count} item${plural(state.count)} found · reviewed" else "Items reviewed"
    }
    StatusPill(
        label = label,
        icon = if (reviewed) Icons.Outlined.CheckCircle else null,
        success = reviewed,
    )
}

private fun plural(n: Int) = if (n == 1) "" else "s"

@Composable
private fun TypingIndicator(phase: String, detail: String) {
    val c = nexus
    Row(verticalAlignment = Alignment.CenterVertically) {
        Box(
            Modifier.clip(RoundedCornerShape(NexusRadii.bubble.dp)).background(c.surfaceCard)
                .padding(horizontal = 14.dp, vertical = 13.dp),
        ) { CircularProgressIndicator(Modifier.size(16.dp), color = c.accent, strokeWidth = 2.dp) }
        Spacer(Modifier.width(10.dp))
        Column {
            Text(phase.ifEmpty { "Thinking…" }, style = NexusType.typography.bodyMedium, color = c.textSecondary)
            if (detail.isNotEmpty()) {
                Text(detail, style = NexusType.typography.labelMedium, color = c.textTertiary)
            }
        }
    }
}

@Composable
private fun UploadProgressRow(progress: Float, label: String) {
    val c = nexus
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            if (progress > 0f) {
                Text("${(progress.coerceIn(0f, 1f) * 100).toInt()}%", style = NexusType.dataReadout,
                    color = c.textSecondary)
                Spacer(Modifier.width(8.dp))
            } else {
                CircularProgressIndicator(Modifier.size(14.dp), color = c.accent, strokeWidth = 2.dp)
                Spacer(Modifier.width(8.dp))
            }
            Text(label.ifEmpty { "Uploading…" }, style = NexusType.typography.labelMedium, color = c.textSecondary)
        }
        NexusProgressBar(value = progress, modifier = Modifier.widthIn(max = 260.dp))
    }
}

// MARK: - Error bar

@Composable
private fun ErrorBar(message: String, onDismiss: () -> Unit) {
    val c = nexus
    Box(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 6.dp)) {
        Banner(text = message, tone = BannerTone.Danger)
        NexusIconButton(
            icon = Icons.Outlined.Close,
            contentDescription = "Dismiss error",
            onClick = onDismiss,
            size = 32,
            tint = c.danger,
            modifier = Modifier.align(Alignment.CenterEnd).padding(end = 4.dp),
        )
    }
}
