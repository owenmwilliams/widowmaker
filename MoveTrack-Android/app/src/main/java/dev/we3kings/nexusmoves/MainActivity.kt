package dev.we3kings.nexusmoves

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.lifecycle.viewmodel.compose.viewModel
import dev.we3kings.nexusmoves.ui.auth.AuthViewModel
import dev.we3kings.nexusmoves.ui.chat.ChatScreen
import dev.we3kings.nexusmoves.ui.login.LoginScreen
import dev.we3kings.nexusmoves.ui.splash.SplashScreen
import dev.we3kings.nexusmoves.ui.theme.NexusTheme
import dev.we3kings.nexusmoves.ui.theme.Theme

/**
 * Nexus Moves — Android. A 1:1 port of the iOS app: the whole post-login
 * experience is the Nexus agent chat against the same movetrack-api contract.
 *
 * The root gate mirrors iOS ContentView exactly — it's reactive, not a nav
 * stack: splash while a stored session validates (401-only logout), then chat
 * or login. A state-driven gate (rather than a NavHost) is what closes the
 * double-login window PR #66 was about.
 */
class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            NexusTheme {
                Surface(modifier = Modifier.fillMaxSize(), color = Theme.canvas) {
                    NexusRoot()
                }
            }
        }
    }
}

@Composable
private fun NexusRoot(auth: AuthViewModel = viewModel()) {
    when {
        // A stored session is being validated (or the server was unreachable).
        // Never show login here — the user may well be logged in.
        auth.isCheckingAuth || auth.authCheckFailed ->
            SplashScreen(failed = auth.authCheckFailed, onRetry = { auth.retryAuthCheck() })

        auth.isAuthenticated && auth.currentUser != null ->
            ChatScreen(auth = auth)

        else ->
            LoginScreen(vm = auth)
    }
}
