package dev.we3kings.nexusmoves.ui.theme

import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color

/**
 * Semantic color aliases — the Android theme layer over design/tokens/tokens.json.
 * This class is the ONE place token values are transcribed; feature code reads
 * these aliases (never raw ramps, never literals). Names map 1:1 to the
 * `--*` semantic aliases in tokens.json. Provided via [LocalNexusColors] so the
 * whole app themes off it; dark is the default, light is fully wired.
 */
@Immutable
data class NexusColors(
    val bg: Color,
    val surface: Color,
    val surfaceSunk: Color,
    val surfaceCard: Color,
    val surfaceHover: Color,
    val border: Color,
    val borderSoft: Color,
    val textPrimary: Color,
    val textSecondary: Color,
    val textTertiary: Color,
    val textOnAccent: Color,
    val accent: Color,
    val accentHover: Color,
    val accentPress: Color,
    val accentQuiet: Color,
    val accentQuiet2: Color,
    val onAccent: Color,
    /** The one warm color — arrival/streak moments and the logo dot only. */
    val beacon: Color,
    val success: Color,
    val successQuiet: Color,
    val warning: Color,
    val warningSurface: Color,
    val warningInk: Color,
    val danger: Color,
    val dangerQuiet: Color,
    val bubbleSelf: Color,
    val bubbleSelfText: Color,
    val bubbleOther: Color,
    val bubbleOtherText: Color,
    // Shimmer gradient stops (same in both themes) — the signature "intelligence"
    // gradient. Reserved for the assistant avatar, readiness progress fill, and
    // one hero CTA. Never a generic button style.
    val shimmerBlue: Color,
    val shimmerMid: Color,
    val shimmerCyan: Color,
    val isDark: Boolean,
)

/** Dark theme (app default) — the `dark` block of tokens.json. */
val NexusDarkColors = NexusColors(
    bg = Color(0xFF0B0B0F),
    surface = Color(0xFF151519),
    surfaceSunk = Color(0xFF1C1C22),
    surfaceCard = Color(0xFF26262C),
    surfaceHover = Color(0xFF2E2E36),
    border = Color(0xFF33333D),
    borderSoft = Color(0xFF26262E),
    textPrimary = Color(0xFFF5F6FA),
    textSecondary = Color(0xFFA2A2AE),
    textTertiary = Color(0xFF6E6E7A),
    textOnAccent = Color(0xFFFFFFFF),
    accent = Color(0xFF4F5BF0),
    accentHover = Color(0xFF6E82F4),
    accentPress = Color(0xFF3D45D9),
    accentQuiet = Color(0xFF4F5BF0).copy(alpha = 0.16f),
    accentQuiet2 = Color(0xFF4F5BF0).copy(alpha = 0.26f),
    onAccent = Color(0xFFFFFFFF),
    beacon = Color(0xFFF98D5B),
    success = Color(0xFF43D98A),
    successQuiet = Color(0xFF2FB878).copy(alpha = 0.18f),
    warning = Color(0xFFE8A54B),
    warningSurface = Color(0xFF2C2410),
    warningInk = Color(0xFFF2D79A),
    danger = Color(0xFFF0666B),
    dangerQuiet = Color(0xFFE5484D).copy(alpha = 0.18f),
    bubbleSelf = Color(0xFF4F5BF0),
    bubbleSelfText = Color(0xFFFFFFFF),
    bubbleOther = Color(0xFF26262C),
    bubbleOtherText = Color(0xFFF5F6FA),
    shimmerBlue = Color(0xFF3B6FE0),
    shimmerMid = Color(0xFF2F8FE0),
    shimmerCyan = Color(0xFF34C8E0),
    isDark = true,
)

/** Light theme (dashboard/marketing) — the `light` overrides of tokens.json. */
val NexusLightColors = NexusColors(
    bg = Color(0xFFF4F6FB),
    surface = Color(0xFFFFFFFF),
    surfaceSunk = Color(0xFFFBFCFE),
    surfaceCard = Color(0xFFFFFFFF),
    surfaceHover = Color(0xFFF1F4FA),
    border = Color(0xFFE4E8F1),
    borderSoft = Color(0xFFEEF1F7),
    textPrimary = Color(0xFF16204A),
    textSecondary = Color(0xFF5A6379),
    textTertiary = Color(0xFF8A92A6),
    textOnAccent = Color(0xFFFFFFFF),
    accent = Color(0xFF4F5BF0),
    accentHover = Color(0xFF3D45D9),
    accentPress = Color(0xFF2F35B4),
    accentQuiet = Color(0xFFEDEFFE),
    accentQuiet2 = Color(0xFFDCDFFC),
    onAccent = Color(0xFFFFFFFF),
    beacon = Color(0xFFF98D5B),
    success = Color(0xFF1F9A62),
    successQuiet = Color(0xFFE4F7EE),
    warning = Color(0xFFD98A2B),
    warningSurface = Color(0xFFFBF0D9),
    warningInk = Color(0xFF7A5A1E),
    danger = Color(0xFFE5484D),
    dangerQuiet = Color(0xFFFBE7E8),
    bubbleSelf = Color(0xFF4F5BF0),
    bubbleSelfText = Color(0xFFFFFFFF),
    bubbleOther = Color(0xFFF1F4FA),
    bubbleOtherText = Color(0xFF16204A),
    shimmerBlue = Color(0xFF3B6FE0),
    shimmerMid = Color(0xFF2F8FE0),
    shimmerCyan = Color(0xFF34C8E0),
    isDark = false,
)

val LocalNexusColors = staticCompositionLocalOf { NexusDarkColors }

/** Ergonomic accessor: `nexus.accent`, `nexus.surfaceCard`, … */
val nexus: NexusColors
    @Composable @ReadOnlyComposable get() = LocalNexusColors.current
