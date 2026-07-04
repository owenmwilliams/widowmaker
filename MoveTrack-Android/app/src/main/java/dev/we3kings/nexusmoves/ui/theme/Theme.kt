package dev.we3kings.nexusmoves.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color

/**
 * Port of MoveTrack-iOS Theme.swift — one brand color, a few semantic colors,
 * spacing/radii, and the brand gradient. Values are copied exactly from the iOS
 * RGB literals so the two apps read as the same product.
 */
object Theme {
    // Brand
    val brand = Color(0xFF5B5BD9)      // 0.357, 0.357, 0.851 indigo
    val brandDeep = Color(0xFF4946C4)  // 0.286, 0.275, 0.769 gradient end / pressed
    val brandSoft = brand.copy(alpha = 0.12f)

    // Surfaces (iOS systemGroupedBackground / secondarySystemGroupedBackground,
    // light appearance — the app is used in light mode).
    val canvas = Color(0xFFF2F2F7)
    val card = Color(0xFFFFFFFF)
    val modelBubble = Color(0xFFFFFFFF)

    // Semantic
    val warn = Color(0xFFD48500)       // 0.83, 0.52, 0.0
    val warnSoft = Color(0xFFFFF7EB)   // 1.0, 0.97, 0.92
    val danger = Color(0xFFC72229)     // 0.78, 0.13, 0.16
    val good = Color(0xFF219E66)       // 0.13, 0.62, 0.40

    // The fixed dark text used on warnSoft (iOS ReadinessSheet.warnText) so a
    // warning card never renders white-on-cream.
    val warnText = Color(0xFF6B4505)   // 0.42, 0.27, 0.02

    // Geometry (dp)
    const val bubbleRadius = 20
    const val cardRadius = 18
    const val controlRadius = 14

    /** brand → brandDeep, topLeading → bottomTrailing (matches iOS). */
    val brandGradient: Brush
        get() = Brush.linearGradient(
            colors = listOf(brand, brandDeep),
            start = Offset(0f, 0f),
            end = Offset(Float.POSITIVE_INFINITY, Float.POSITIVE_INFINITY),
        )
}

private val LightColors = lightColorScheme(
    primary = Theme.brand,
    onPrimary = Color.White,
    secondaryContainer = Theme.brandSoft,
    background = Theme.canvas,
    surface = Theme.card,
)

@Composable
fun NexusTheme(content: @Composable () -> Unit) {
    // The iOS app is effectively light; force the light scheme for surface parity
    // rather than letting Material recolor the brand surfaces.
    MaterialTheme(colorScheme = LightColors, content = content)
}
