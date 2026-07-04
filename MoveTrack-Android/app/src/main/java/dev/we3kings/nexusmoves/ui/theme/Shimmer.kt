package dev.we3kings.nexusmoves.ui.theme

import android.provider.Settings
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.composed
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext

/**
 * The signature "intelligence" gradient — blue→mid→cyan at ~115° (tokens.json
 * `--shimmer`). Reserved for the assistant avatar, the readiness progress fill,
 * and ONE hero CTA per screen (Share inventory). Never a generic button style.
 */
@Composable
fun shimmerBrush(): Brush {
    val c = nexus
    return Brush.linearGradient(
        colorStops = arrayOf(
            0.0f to c.shimmerBlue,
            0.48f to c.shimmerMid,
            1.0f to c.shimmerCyan,
        ),
        start = Offset(0f, 0f),
        end = Offset(Float.POSITIVE_INFINITY, Float.POSITIVE_INFINITY),
    )
}

/** True unless the OS animator scale is 0 (reduced motion) — gates the sweep. */
@Composable
fun animationsEnabled(): Boolean {
    val context = LocalContext.current
    return remember {
        Settings.Global.getFloat(context.contentResolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f) != 0f
    }
}

/**
 * Fill with the shimmer gradient plus the looping highlight sweep (the "Nexus is
 * working" signal). The sweep is skipped when reduced-motion is on or [sweep] is
 * false — the gradient still shows, just static.
 */
fun Modifier.shimmerSurface(sweep: Boolean = true): Modifier = composed {
    val brush = shimmerBrush()
    val sweepOn = sweep && animationsEnabled()
    val phase = if (sweepOn) {
        rememberInfiniteTransition(label = "shimmer").animateFloat(
            initialValue = -0.4f,
            targetValue = 1.4f,
            animationSpec = infiniteRepeatable(
                animation = tween(durationMillis = 2200, easing = LinearEasing),
                repeatMode = RepeatMode.Restart,
            ),
            label = "shimmer-phase",
        ).value
    } else -10f

    background(brush).drawWithContent {
        drawContent()
        if (phase > -1f) {
            val band = size.width * 0.4f
            val x = phase * size.width - band
            drawRect(
                brush = Brush.horizontalGradient(
                    colors = listOf(Color.Transparent, Color.White.copy(alpha = 0.32f), Color.Transparent),
                    startX = x,
                    endX = x + band,
                ),
            )
        }
    }
}

/** dp radii by name — the shape scale (tokens.json `--r-*`). */
object NexusRadii {
    const val button = 14
    const val card = 18
    const val bubble = 22
    const val sheet = 28
}
