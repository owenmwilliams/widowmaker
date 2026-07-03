package dev.we3kings.nexusmoves.ui.login

import androidx.compose.foundation.layout.Column
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.navigation.NavController

/**
 * Email + 6-digit OTP login — port of iOS LoginView:
 *   POST /auth/request-code  { email }
 *   POST /auth/verify-code   { email, code } → sessionToken (store encrypted)
 * TODO(android-port): two-step form, error surface, resend, keyboard types.
 */
@Composable
fun LoginScreen(nav: NavController) {
    Column { Text("TODO: LoginScreen (see MoveTrack-iOS LoginView.swift)") }
}
