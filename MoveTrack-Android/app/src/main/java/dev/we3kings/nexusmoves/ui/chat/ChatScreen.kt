package dev.we3kings.nexusmoves.ui.chat

import androidx.compose.foundation.layout.Column
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.navigation.NavController

/**
 * The whole product post-login — port of iOS NexusChatView + NexusViewModel:
 * message list (markdown, scan-review pills, upload progress row), composer
 * with +, up-to-5-photo batch / single video attachments as chips, readiness
 * banner, review/duplicate/readiness sheets, share flow.
 *
 * TODO(android-port): this is the big one — port section by section per the
 * scaffold issue checklist, keeping the wire contract identical to
 * MoveTrack-iOS NexusService.swift / NexusModels.swift.
 */
@Composable
fun ChatScreen(nav: NavController) {
    Column { Text("TODO: ChatScreen (see MoveTrack-iOS NexusChatView.swift)") }
}
