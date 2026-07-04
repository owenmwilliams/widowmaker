package dev.we3kings.nexusmoves

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.runtime.Composable
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import dev.we3kings.nexusmoves.ui.chat.ChatScreen
import dev.we3kings.nexusmoves.ui.login.LoginScreen
import dev.we3kings.nexusmoves.ui.splash.SplashScreen
import dev.we3kings.nexusmoves.ui.theme.NexusTheme

/**
 * Nexus Moves — Android. A 1:1 port of the iOS app in MoveTrack-iOS: the whole
 * post-login experience is the Nexus agent chat against the same movetrack-api
 * contract. Screen inventory and porting order live in the "Android app:
 * populate the scaffold" GitHub issue.
 *
 * Navigation mirrors iOS ContentView: splash while the stored session
 * validates (401-only logout), then chat or login.
 */
class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent { NexusTheme { NexusNavHost() } }
    }
}

@Composable
fun NexusNavHost() {
    val nav = rememberNavController()
    NavHost(navController = nav, startDestination = "splash") {
        composable("splash") { SplashScreen(nav) }
        composable("login") { LoginScreen(nav) }
        composable("chat") { ChatScreen(nav) }
    }
}
