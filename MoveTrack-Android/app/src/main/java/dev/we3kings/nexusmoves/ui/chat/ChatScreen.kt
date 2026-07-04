package dev.we3kings.nexusmoves.ui.chat

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import dev.we3kings.nexusmoves.ui.auth.AuthViewModel
import dev.we3kings.nexusmoves.ui.theme.Theme

/**
 * The whole product post-login — port of iOS NexusChatView + NexusViewModel.
 *
 * PHASE 1: a placeholder that proves the auth gate end-to-end (shows the signed-in
 * user and a working Log out). Phase 2 replaces this with the real Nexus chat:
 * message list (markdown, scan-review pills, upload progress), composer with the
 * up-to-5-photo batch / single-video attachment rules, readiness banner, and the
 * review/duplicate/readiness sheets — all against NexusService.
 */
@Composable
fun ChatScreen(auth: AuthViewModel) {
    Column(
        modifier = Modifier.fillMaxSize().padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Text("Nexus Moves", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
        Spacer(Modifier.height(8.dp))
        Text(
            "Signed in as ${auth.currentUser?.displayName ?: "you"}",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Spacer(Modifier.height(8.dp))
        Text(
            "Chat UI lands in Phase 2.",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Spacer(Modifier.height(24.dp))
        Button(
            onClick = { auth.logout() },
            colors = ButtonDefaults.buttonColors(containerColor = Theme.brand),
        ) {
            Text("Log out")
        }
    }
}
