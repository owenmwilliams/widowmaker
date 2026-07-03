package dev.we3kings.nexusmoves.ui.splash

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.navigation.NavController

/**
 * Launch gate — port of iOS LaunchSplashView + AuthViewModel.checkAuthStatus:
 * - stored token? validate via GET /auth/me while showing logo + spinner
 * - ONLY a real 401 ends the session (network failure → "Try Again", token kept)
 * - never show login while a stored session is undecided (double-login window)
 *
 * TODO(android-port): wire AuthRepository.checkAuthStatus(); navigate to
 * "chat" on success, "login" only on definitive 401/no-token.
 */
@Composable
fun SplashScreen(nav: NavController) {
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        CircularProgressIndicator()
        Text("Nexus Moves") // TODO(android-port): brand block per LoginView/LaunchSplashView
    }
}
