package dev.we3kings.nexusmoves.ui.components

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.Info
import androidx.compose.material.icons.outlined.WarningAmber
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import dev.we3kings.nexusmoves.ui.theme.NexusRadii
import dev.we3kings.nexusmoves.ui.theme.NexusType
import dev.we3kings.nexusmoves.ui.theme.nexus
import dev.we3kings.nexusmoves.ui.theme.shimmerSurface
import androidx.compose.foundation.clickable

/**
 * Shared design-system components (Android renderings of the design/components).
 * They honor the .d.ts prop intent and the readme interaction states: press
 * ~0.97 scale, disabled 45%, and the shimmer reserved for the avatar / readiness
 * fill / one hero CTA.
 */

/** AssistantAvatar — sparkles on the signature shimmer. The one filled brand mark. */
@Composable
fun AssistantAvatar(size: Int = 44, circle: Boolean = false, sweep: Boolean = true) {
    val shape = if (circle) CircleShape else RoundedCornerShape(NexusRadii.button.dp)
    Box(
        Modifier.size(size.dp).clip(shape).shimmerSurface(sweep = sweep),
        contentAlignment = Alignment.Center,
    ) {
        Icon(
            Icons.Filled.AutoAwesome,
            contentDescription = "Nexus assistant",
            tint = Color.White,
            modifier = Modifier.size((size * 0.5f).dp),
        )
    }
}

/** SuggestionButton (block variant) — full-width accent-tinted next action. */
@Composable
fun SuggestionButton(
    label: String,
    icon: ImageVector? = null,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val c = nexus
    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    val scale by animateFloatAsState(if (pressed) 0.985f else 1f, label = "sug")
    Row(
        modifier
            .fillMaxWidth()
            .scale(scale)
            .clip(RoundedCornerShape(NexusRadii.card.dp))
            .background(if (pressed) c.accentQuiet2 else c.accentQuiet)
            .clickable(interactionSource = interaction, indication = null, role = Role.Button, onClick = onClick)
            .padding(horizontal = 18.dp, vertical = 16.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        if (icon != null) Icon(icon, null, tint = c.accent, modifier = Modifier.size(20.dp))
        Text(label, color = c.accent, style = NexusType.typography.bodyLarge, fontWeight = FontWeight.Bold)
    }
}

/** StatusPill — centered inline status divider in the chat stream. */
@Composable
fun StatusPill(label: String, icon: ImageVector? = null, success: Boolean = false) {
    val c = nexus
    val tint = if (success) c.success else c.textSecondary
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.Center) {
        Row(
            Modifier.clip(CircleShape).background(c.surfaceCard).padding(horizontal = 16.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            if (icon != null) Icon(icon, null, tint = tint, modifier = Modifier.size(16.dp))
            Text(label, color = tint, style = NexusType.typography.labelLarge, fontWeight = FontWeight.SemiBold)
        }
    }
}

enum class BannerTone { Warning, Success, Info, Danger }

/** Banner — inline callout for honest nudges, confirmations, and alerts. */
@Composable
fun Banner(text: String, tone: BannerTone = BannerTone.Warning, modifier: Modifier = Modifier) {
    val c = nexus
    val (bg, ink, icon) = when (tone) {
        BannerTone.Warning -> Triple(c.warningSurface, c.warningInk, Icons.Outlined.WarningAmber)
        BannerTone.Danger -> Triple(c.dangerQuiet, c.danger, Icons.Outlined.WarningAmber)
        BannerTone.Success -> Triple(c.successQuiet, c.success, Icons.Outlined.CheckCircle)
        BannerTone.Info -> Triple(c.accentQuiet, c.accent, Icons.Outlined.Info)
    }
    Row(
        modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(NexusRadii.card.dp))
            .background(bg)
            .padding(horizontal = 16.dp, vertical = 14.dp),
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Icon(icon, null, tint = if (tone == BannerTone.Warning) c.warning else ink, modifier = Modifier.size(20.dp))
        Text(text, color = ink, style = NexusType.typography.bodyMedium)
    }
}

/** ProgressBar — shimmer-filled readiness/upload progress. */
@Composable
fun NexusProgressBar(
    value: Float,
    modifier: Modifier = Modifier,
    height: Int = 9,
    sweep: Boolean = true,
) {
    val c = nexus
    val animated by animateFloatAsState(value.coerceIn(0f, 1f), label = "progress")
    val sweeping = sweep && animated > 0f && animated < 1f
    Box(
        modifier
            .fillMaxWidth()
            .height(height.dp)
            .clip(CircleShape)
            .background(c.surfaceHover),
    ) {
        Box(
            Modifier
                .fillMaxWidth(animated)
                .height(height.dp)
                .clip(CircleShape)
                .shimmerSurface(sweep = sweeping),
        )
    }
}

/** IconButton — icon-only control; always pass [contentDescription]. */
@Composable
fun NexusIconButton(
    icon: ImageVector,
    contentDescription: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    size: Int = 44,
    background: Color = Color.Transparent,
    tint: Color = LocalContentColor.current,
    borderColor: Color? = null,
    enabled: Boolean = true,
) {
    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    val scale by animateFloatAsState(if (pressed) 0.94f else 1f, label = "iconbtn")
    Box(
        modifier
            .size(size.dp)
            .scale(scale)
            .clip(CircleShape)
            .background(background)
            .then(if (borderColor != null) Modifier.border(1.5.dp, borderColor, CircleShape) else Modifier)
            .clickable(
                interactionSource = interaction, indication = null,
                enabled = enabled, role = Role.Button, onClick = onClick,
            ),
        contentAlignment = Alignment.Center,
    ) {
        Icon(icon, contentDescription, tint = tint, modifier = Modifier.size((size * 0.46f).dp))
    }
}

enum class NexusButtonVariant { Primary, Shimmer, Secondary }

/**
 * The Nexus button. primary = solid accent; shimmer = the signature gradient
 * (reserve for the ONE hero CTA per screen); secondary = quiet accent fill.
 */
@Composable
fun NexusButton(
    label: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    variant: NexusButtonVariant = NexusButtonVariant.Primary,
    icon: ImageVector? = null,
    enabled: Boolean = true,
    height: Int = 54,
) {
    val c = nexus
    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    val scale by animateFloatAsState(if (pressed) 0.97f else 1f, label = "btn")
    val content = when (variant) {
        NexusButtonVariant.Secondary -> c.accent
        else -> Color.White
    }
    val base = Modifier
        .fillMaxWidth()
        .height(height.dp)
        .scale(scale)
        .clip(RoundedCornerShape(NexusRadii.card.dp))
    val filled = when (variant) {
        NexusButtonVariant.Shimmer -> base.shimmerSurface(sweep = enabled)
        NexusButtonVariant.Secondary -> base.background(c.accentQuiet)
        NexusButtonVariant.Primary -> base.background(if (pressed) c.accentPress else c.accent)
    }
    Row(
        filled
            .clickable(interactionSource = interaction, indication = null, enabled = enabled, role = Role.Button, onClick = onClick)
            .padding(horizontal = 18.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.Center,
    ) {
        if (icon != null) {
            Icon(icon, null, tint = content, modifier = Modifier.size(20.dp))
            Spacer(Modifier.width(10.dp))
        }
        Text(label, color = content, style = NexusType.typography.titleMedium)
    }
}
