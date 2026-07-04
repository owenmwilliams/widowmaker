package dev.we3kings.nexusmoves.ui.chat

import android.content.Intent
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
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
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
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
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import dev.we3kings.nexusmoves.model.ChatMessage
import dev.we3kings.nexusmoves.ui.auth.AuthViewModel
import dev.we3kings.nexusmoves.ui.theme.Theme
import kotlinx.coroutines.launch

/**
 * The whole product post-login — port of iOS NexusChatView. Phase 2 wires the
 * chat: brand header + live readiness banner, message list (markdown bubbles,
 * scan-review pills, typing/upload rows), quick-start chips, error bar, and the
 * share flow. The composer's `+` capture button is disabled pending Phase 3;
 * the review/duplicate/readiness sheets arrive in Phase 4.
 */
@Composable
fun ChatScreen(auth: AuthViewModel, vm: NexusViewModel = viewModel()) {
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    var draft by remember { mutableStateOf("") }
    var shareWarningText by remember { mutableStateOf<String?>(null) }

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

    Column(Modifier.fillMaxSize().background(Theme.canvas)) {
        Header(vm, onNewConversation = { scope.launch { vm.startNewConversation() } },
            onLogout = { auth.logout() }, onShare = { onShareTapped() })

        Conversation(vm, modifier = Modifier.weight(1f),
            onChip = { message -> scope.launch { vm.send(message) } },
            onAgentButton = { button ->
                when (button.primaryAction) {
                    AgentButtonAction.Send -> scope.launch { vm.send(button.message) }
                    AgentButtonAction.Prefill -> draft = button.message
                    AgentButtonAction.Camera -> { /* capture: Phase 3 */ }
                }
            })

        vm.errorMessage?.let { ErrorBar(it) { vm.errorMessage = null } }

        InputBar(
            draft = draft,
            onDraftChange = { draft = it },
            enabled = !vm.isBusy,
            onSend = {
                val text = draft
                draft = ""
                scope.launch { vm.send(text) }
            },
        )
    }

    if (shareWarningText != null) {
        AlertDialog(
            onDismissRequest = { shareWarningText = null },
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
}

// MARK: - Header

@Composable
private fun Header(
    vm: NexusViewModel,
    onNewConversation: () -> Unit,
    onLogout: () -> Unit,
    onShare: () -> Unit,
) {
    var menuOpen by remember { mutableStateOf(false) }
    Column(
        Modifier
            .fillMaxWidth()
            .background(Theme.card)
            .padding(horizontal = 16.dp)
            .padding(top = 10.dp, bottom = 12.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(
                Modifier
                    .size(34.dp)
                    .clip(RoundedCornerShape(9.dp))
                    .background(Theme.brandGradient),
                contentAlignment = Alignment.Center,
            ) { Text("✦", color = Color.White, fontWeight = FontWeight.Bold) }
            Spacer(Modifier.width(10.dp))
            Column(Modifier.weight(1f)) {
                Text("Nexus Moves", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                Text("Your moving assistant", style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            Box {
                IconButton(onClick = { menuOpen = true }) {
                    Text("⋮", style = MaterialTheme.typography.titleLarge,
                        color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }) {
                    DropdownMenuItem(text = { Text("New conversation") },
                        onClick = { menuOpen = false; onNewConversation() })
                    HorizontalDivider()
                    DropdownMenuItem(text = { Text("Log out") },
                        onClick = { menuOpen = false; onLogout() })
                }
            }
        }
        Spacer(Modifier.height(12.dp))
        ReadinessBanner(vm, onShare = onShare)
    }
}

@Composable
private fun ReadinessBanner(vm: NexusViewModel, onShare: () -> Unit) {
    val r = vm.readiness
    Row(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(Theme.cardRadius.dp))
            .background(Theme.canvas)
            .border(1.dp, Color.Black.copy(alpha = 0.06f), RoundedCornerShape(Theme.cardRadius.dp))
            .padding(12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Row {
                Text(r?.statusLabel ?: "Building your inventory",
                    style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold,
                    modifier = Modifier.weight(1f))
                Text("${r?.overall ?: 0}%", style = MaterialTheme.typography.labelMedium,
                    fontWeight = FontWeight.SemiBold, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            Spacer(Modifier.height(6.dp))
            LinearProgressIndicator(
                progress = { r?.progress ?: 0f },
                color = Theme.brand,
                trackColor = Theme.brandSoft,
                modifier = Modifier.fillMaxWidth(),
            )
        }
        Spacer(Modifier.width(12.dp))
        Column(
            Modifier
                .width(60.dp)
                .height(56.dp)
                .clip(RoundedCornerShape(12.dp))
                .background(Theme.brandGradient)
                .clickable(enabled = !vm.isPreparingShare) { onShare() }
                .alpha(if (vm.isPreparingShare) 0.6f else 1f),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center,
        ) {
            Text("⤴", color = Color.White)
            Text("Share", color = Color.White, style = MaterialTheme.typography.labelSmall,
                fontWeight = FontWeight.Bold)
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
        contentPadding = androidx.compose.foundation.layout.PaddingValues(16.dp),
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
            item { QuickStartChips(vm, onChip) }
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
    Column(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(Theme.cardRadius.dp))
            .background(Theme.card)
            .padding(18.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text("👋 Hi, I'm Nexus", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
        Text(
            "Tell me about your move and I'll build an inventory you can share with movers — in three quick steps:",
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        StepRow(1, "🏠", "Tell me about your current home")
        StepRow(2, "🎥", "Add a photo or video of each room")
        StepRow(3, "⤴", "Share your inventory with movers")
        Text(
            InlineMarkdown.parse("First — **what's your name?** Type it below to get started."),
            style = MaterialTheme.typography.bodyMedium,
        )
    }
}

@Composable
private fun StepRow(n: Int, icon: String, text: String) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Box(
            Modifier.size(32.dp).clip(CircleShape).background(Theme.brandSoft),
            contentAlignment = Alignment.Center,
        ) { Text(icon) }
        Spacer(Modifier.width(12.dp))
        Text(text, style = MaterialTheme.typography.bodyMedium)
    }
}

@Composable
private fun QuickStartChips(vm: NexusViewModel, onChip: (String) -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        vm.quickStartChips.forEach { chip ->
            Box(
                Modifier
                    .clip(CircleShape)
                    .background(Theme.brandSoft)
                    .clickable { onChip(chip.message) }
                    .padding(horizontal = 16.dp, vertical = 9.dp),
            ) {
                Text(chip.label, color = Theme.brand, style = MaterialTheme.typography.bodyMedium,
                    fontWeight = FontWeight.Medium)
            }
        }
    }
}

@Composable
private fun MessageBubble(message: ChatMessage, onButton: (AgentButton) -> Unit) {
    val isUser = message.role == ChatMessage.Role.User
    val parsed = if (isUser) null else AgentMessageParser.parse(message.text)
    val displayText = if (isUser) message.text else (parsed?.prose ?: message.text)

    Column(
        Modifier.fillMaxWidth(),
        horizontalAlignment = if (isUser) Alignment.End else Alignment.Start,
    ) {
        message.attachments.forEach { attachment ->
            Text(
                attachment.displayLabel,
                style = MaterialTheme.typography.labelMedium,
                color = if (isUser) Color.White else Theme.brand,
                modifier = Modifier
                    .padding(bottom = 4.dp)
                    .clip(CircleShape)
                    .background(if (isUser) Color.White.copy(alpha = 0.25f) else Theme.brandSoft)
                    .padding(horizontal = 12.dp, vertical = 6.dp),
            )
        }
        if (displayText.isNotEmpty()) {
            Box(
                Modifier
                    .widthIn(max = 320.dp)
                    .clip(RoundedCornerShape(Theme.bubbleRadius.dp))
                    .then(
                        if (isUser) Modifier.background(Theme.brandGradient)
                        else Modifier.background(Theme.modelBubble)
                    )
                    .padding(horizontal = 15.dp, vertical = 11.dp),
            ) {
                Text(
                    if (isUser) androidx.compose.ui.text.AnnotatedString(displayText)
                    else InlineMarkdown.parse(displayText),
                    color = if (isUser) Color.White else Color.Unspecified,
                )
            }
        }
        val buttons = parsed?.buttons
        if (!buttons.isNullOrEmpty()) {
            Spacer(Modifier.height(8.dp))
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                buttons.forEach { button ->
                    Box(
                        Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(12.dp))
                            .background(Theme.brandSoft)
                            .clickable { onButton(button) }
                            .padding(horizontal = 14.dp, vertical = 11.dp),
                    ) {
                        Text(button.label, color = Theme.brand, fontWeight = FontWeight.SemiBold)
                    }
                }
            }
        }
    }
}

@Composable
private fun ScanReviewPill(state: ChatMessage.ScanReviewState) {
    val label = when (state) {
        is ChatMessage.ScanReviewState.Pending -> "${state.count} item${plural(state.count)} found — reviewing…"
        is ChatMessage.ScanReviewState.Reviewed ->
            "Items reviewed · ${state.added} added" + if (state.skipped > 0) ", ${state.skipped} skipped" else ""
        is ChatMessage.ScanReviewState.Dismissed -> "${state.count} item${plural(state.count)} found · not added"
        is ChatMessage.ScanReviewState.Record ->
            if (state.count > 0) "${state.count} item${plural(state.count)} found · reviewed" else "Items reviewed"
    }
    val tint = if (state is ChatMessage.ScanReviewState.Reviewed) Theme.good else MaterialTheme.colorScheme.onSurfaceVariant
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.Center) {
        Text(
            label,
            style = MaterialTheme.typography.labelMedium,
            color = tint,
            modifier = Modifier
                .clip(CircleShape)
                .background(Theme.card)
                .padding(horizontal = 12.dp, vertical = 6.dp),
        )
    }
}

private fun plural(n: Int) = if (n == 1) "" else "s"

@Composable
private fun TypingIndicator(phase: String, detail: String) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Box(
            Modifier.clip(RoundedCornerShape(Theme.bubbleRadius.dp)).background(Theme.modelBubble)
                .padding(horizontal = 14.dp, vertical = 13.dp),
        ) { CircularProgressIndicator(Modifier.size(16.dp), color = Theme.brand, strokeWidth = 2.dp) }
        Spacer(Modifier.width(10.dp))
        Column {
            Text(phase.ifEmpty { "Thinking…" }, style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant)
            if (detail.isNotEmpty()) {
                Text(detail, style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}

@Composable
private fun UploadProgressRow(progress: Float, label: String) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        if (progress > 0f) {
            val animated by animateFloatAsState(progress.coerceIn(0f, 1f), label = "upload")
            LinearProgressIndicator(progress = { animated }, color = Theme.brand,
                trackColor = Theme.brandSoft, modifier = Modifier.width(160.dp))
            Spacer(Modifier.width(8.dp))
            Text("${(animated * 100).toInt()}%", style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant)
        } else {
            CircularProgressIndicator(Modifier.size(16.dp), color = Theme.brand, strokeWidth = 2.dp)
        }
        Spacer(Modifier.width(8.dp))
        Text(label.ifEmpty { "Uploading…" }, style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

// MARK: - Error + input

@Composable
private fun ErrorBar(message: String, onDismiss: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().background(Theme.danger.copy(alpha = 0.92f))
            .padding(horizontal = 16.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text("⚠️  $message", color = Color.White, style = MaterialTheme.typography.bodySmall,
            modifier = Modifier.weight(1f))
        IconButton(onClick = onDismiss) { Text("✕", color = Color.White) }
    }
}

@Composable
private fun InputBar(
    draft: String,
    onDraftChange: (String) -> Unit,
    enabled: Boolean,
    onSend: () -> Unit,
) {
    val canSend = enabled && draft.trim().isNotEmpty()
    Row(
        Modifier.fillMaxWidth().background(Theme.card).padding(horizontal = 12.dp, vertical = 8.dp),
        verticalAlignment = Alignment.Bottom,
    ) {
        // Capture (+) — disabled until Phase 3 wires photo/video capture.
        Box(
            Modifier.size(36.dp).clip(CircleShape).background(Color.Gray.copy(alpha = 0.5f)),
            contentAlignment = Alignment.Center,
        ) { Text("+", color = Color.White, fontWeight = FontWeight.Bold, style = MaterialTheme.typography.titleMedium) }
        Spacer(Modifier.width(10.dp))
        OutlinedTextField(
            value = draft,
            onValueChange = onDraftChange,
            placeholder = { Text("Message Nexus…") },
            modifier = Modifier.weight(1f),
            maxLines = 5,
            keyboardOptions = KeyboardOptions.Default,
        )
        Spacer(Modifier.width(10.dp))
        Box(
            Modifier
                .size(36.dp)
                .clip(CircleShape)
                .then(if (canSend) Modifier.background(Theme.brandGradient) else Modifier.background(Color.Gray.copy(alpha = 0.5f)))
                .clickable(enabled = canSend) { onSend() },
            contentAlignment = Alignment.Center,
        ) { Text("↑", color = Color.White, fontWeight = FontWeight.Bold, style = MaterialTheme.typography.titleMedium) }
    }
}
