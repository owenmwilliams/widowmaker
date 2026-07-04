package dev.we3kings.nexusmoves.ui.splash

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import dev.we3kings.nexusmoves.ui.theme.BrandLogo
import dev.we3kings.nexusmoves.ui.theme.nexus

/**
 * Launch gate — port of iOS ContentView.LaunchSplashView. Shown while the stored
 * session validates against /auth/me, and as the retry surface when the server
 * can't be reached at launch. ONLY a real 401 ends the session (handled in the
 * view model); here a failure just offers "Try Again" with the token kept.
 */
@Composable
fun SplashScreen(failed: Boolean, onRetry: () -> Unit) {
    val c = nexus
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(horizontal = 24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        BrandLogo()
        Spacer(Modifier.padding(6.dp))
        Text(
            "Nexus Moves",
            style = MaterialTheme.typography.headlineMedium,
            fontWeight = FontWeight.Bold,
        )

        Spacer(Modifier.padding(12.dp))

        if (failed) {
            Text(
                "Can't reach the server right now.\nYou're still signed in.",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center,
            )
            Spacer(Modifier.padding(8.dp))
            Button(
                onClick = onRetry,
                colors = ButtonDefaults.buttonColors(containerColor = c.accent, contentColor = c.onAccent),
                shape = RoundedCornerShape(14.dp),
                modifier = Modifier.widthIn(min = 220.dp),
            ) {
                Text("Try Again", fontWeight = FontWeight.SemiBold)
            }
        } else {
            CircularProgressIndicator(color = c.accent)
        }
    }
}
