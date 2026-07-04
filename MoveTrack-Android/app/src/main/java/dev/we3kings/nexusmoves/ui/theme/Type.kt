package dev.we3kings.nexusmoves.ui.theme

import androidx.compose.material3.Typography
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.LineHeightStyle
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import dev.we3kings.nexusmoves.R

/**
 * Type layer over tokens.json. UI font is the system stack (Roboto on Android) —
 * cheap and native-feeling, honoring Dynamic Type. JetBrains Mono (bundled, OFL)
 * is for eyebrows and data readouts (weights/volumes). Display ("Bricolage" on
 * web) falls back to system bold on Android in v1 per the brief.
 *
 * Sizes use sp (scalable). Floors from the brief: UI body ≥15sp, chat body 17sp,
 * mobile titles 22sp+.
 */
object NexusType {
    val mono = FontFamily(Font(R.font.jetbrains_mono))

    private val lh = LineHeightStyle(
        alignment = LineHeightStyle.Alignment.Center,
        trim = LineHeightStyle.Trim.None,
    )

    /** Uppercase, letter-spaced eyebrow label (JetBrains Mono). */
    val eyebrow = TextStyle(
        fontFamily = mono,
        fontSize = 11.sp,
        fontWeight = FontWeight.Medium,
        letterSpacing = 0.14.em,
        lineHeightStyle = lh,
    )

    /** Data readout — weights/volumes/percentages (JetBrains Mono). */
    val dataReadout = TextStyle(
        fontFamily = mono,
        fontSize = 15.sp,
        fontWeight = FontWeight.Medium,
        lineHeightStyle = lh,
    )

    val typography = Typography().run {
        copy(
            displaySmall = displaySmall.copy(fontSize = 34.sp, fontWeight = FontWeight.ExtraBold, lineHeight = 38.sp, letterSpacing = (-0.02).em),
            headlineMedium = headlineMedium.copy(fontSize = 28.sp, fontWeight = FontWeight.Bold, lineHeight = 34.sp, letterSpacing = (-0.01).em),
            headlineSmall = headlineSmall.copy(fontSize = 22.sp, fontWeight = FontWeight.Bold, lineHeight = 28.sp, letterSpacing = (-0.01).em),
            // Mobile titles 22sp+.
            titleLarge = titleLarge.copy(fontSize = 22.sp, fontWeight = FontWeight.ExtraBold, lineHeight = 27.sp, letterSpacing = (-0.01).em),
            titleMedium = titleMedium.copy(fontSize = 18.sp, fontWeight = FontWeight.Bold, lineHeight = 23.sp),
            titleSmall = titleSmall.copy(fontSize = 15.sp, fontWeight = FontWeight.SemiBold, lineHeight = 20.sp),
            // Chat body 17sp.
            bodyLarge = bodyLarge.copy(fontSize = 17.sp, fontWeight = FontWeight.Normal, lineHeight = 25.sp),
            // UI body floor 15sp.
            bodyMedium = bodyMedium.copy(fontSize = 15.sp, fontWeight = FontWeight.Normal, lineHeight = 22.sp),
            bodySmall = bodySmall.copy(fontSize = 13.sp, fontWeight = FontWeight.Normal, lineHeight = 18.sp),
            labelLarge = labelLarge.copy(fontSize = 15.sp, fontWeight = FontWeight.SemiBold, lineHeight = 20.sp),
            labelMedium = labelMedium.copy(fontSize = 13.sp, fontWeight = FontWeight.Medium, lineHeight = 16.sp),
            labelSmall = labelSmall.copy(fontSize = 11.sp, fontWeight = FontWeight.Medium, lineHeight = 14.sp),
        )
    }

    @Suppress("unused")
    private val centered = TextAlign.Center
}
