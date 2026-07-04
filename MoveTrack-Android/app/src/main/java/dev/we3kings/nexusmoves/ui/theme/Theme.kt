package dev.we3kings.nexusmoves.ui.theme

import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp

/**
 * The Nexus Moves Android theme — the generated layer over
 * design/tokens/tokens.json. Dark is the default (the app ships dark); the light
 * theme is fully wired for parity. M3 roles are mapped from the [NexusColors]
 * semantic aliases; non-M3 tokens (beacon, bubbleSelf, shimmer, warn cream) ride
 * on [LocalNexusColors]. Radii come from the token shape scale.
 */

// Shape scale — tokens.json --r-* : buttons/inputs 14, cards 18, bubbles/panels
// 22, sheets/app-icon 28, pills fully rounded.
val NexusShapes = Shapes(
    extraSmall = RoundedCornerShape(NexusRadii.button.dp),
    small = RoundedCornerShape(NexusRadii.button.dp),
    medium = RoundedCornerShape(NexusRadii.card.dp),
    large = RoundedCornerShape(NexusRadii.bubble.dp),
    extraLarge = RoundedCornerShape(NexusRadii.sheet.dp),
)

private fun schemeFrom(c: NexusColors) = if (c.isDark) {
    darkColorScheme(
        primary = c.accent,
        onPrimary = c.onAccent,
        primaryContainer = c.surfaceHover,
        onPrimaryContainer = c.textPrimary,
        secondary = c.accent,
        onSecondary = c.onAccent,
        secondaryContainer = c.accentQuiet2,
        onSecondaryContainer = c.accent,
        background = c.bg,
        onBackground = c.textPrimary,
        surface = c.surface,
        onSurface = c.textPrimary,
        surfaceVariant = c.surfaceCard,
        onSurfaceVariant = c.textSecondary,
        surfaceContainerLowest = c.bg,
        surfaceContainerLow = c.surface,
        surfaceContainer = c.surfaceSunk,
        surfaceContainerHigh = c.surfaceCard,
        surfaceContainerHighest = c.surfaceHover,
        outline = c.border,
        outlineVariant = c.borderSoft,
        error = c.danger,
        onError = Color.White,
        errorContainer = c.dangerQuiet,
        onErrorContainer = c.danger,
        scrim = Color.Black,
    )
} else {
    lightColorScheme(
        primary = c.accent,
        onPrimary = c.onAccent,
        primaryContainer = c.accentQuiet,
        onPrimaryContainer = c.accentPress,
        secondary = c.accent,
        onSecondary = c.onAccent,
        secondaryContainer = c.accentQuiet,
        onSecondaryContainer = c.accentPress,
        background = c.bg,
        onBackground = c.textPrimary,
        surface = c.surface,
        onSurface = c.textPrimary,
        surfaceVariant = c.surfaceHover,
        onSurfaceVariant = c.textSecondary,
        surfaceContainerLowest = Color.White,
        surfaceContainerLow = c.surface,
        surfaceContainer = c.surfaceSunk,
        surfaceContainerHigh = c.surfaceHover,
        surfaceContainerHighest = c.surfaceHover,
        outline = c.border,
        outlineVariant = c.borderSoft,
        error = c.danger,
        onError = Color.White,
        errorContainer = c.dangerQuiet,
        onErrorContainer = c.danger,
        scrim = Color.Black,
    )
}

@Composable
fun NexusTheme(
    darkTheme: Boolean = true, // app ships dark; light is wired for parity
    content: @Composable () -> Unit,
) {
    val colors = if (darkTheme) NexusDarkColors else NexusLightColors
    CompositionLocalProvider(LocalNexusColors provides colors) {
        MaterialTheme(
            colorScheme = schemeFrom(colors),
            typography = NexusType.typography,
            shapes = NexusShapes,
            content = content,
        )
    }
}
