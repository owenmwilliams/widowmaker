package dev.we3kings.nexusmoves.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

// Mirror MoveTrack-iOS Theme (brand purple gradient, soft brand fills).
// TODO(android-port): copy exact color values from MoveTrack-iOS Theme.swift.
val Brand = Color(0xFF6D28D9)
val BrandSoft = Color(0xFFEDE9FE)

private val Colors = lightColorScheme(
    primary = Brand,
    secondaryContainer = BrandSoft,
)

@Composable
fun NexusTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = Colors, content = content)
}
