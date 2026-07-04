package dev.we3kings.nexusmoves.ui.readiness

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.ChevronRight
import androidx.compose.material.icons.outlined.IosShare
import androidx.compose.material.icons.outlined.RadioButtonUnchecked
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import dev.we3kings.nexusmoves.model.ShareReadinessDTO
import dev.we3kings.nexusmoves.ui.components.Banner
import dev.we3kings.nexusmoves.ui.components.BannerTone
import dev.we3kings.nexusmoves.ui.components.NexusButton
import dev.we3kings.nexusmoves.ui.components.NexusButtonVariant
import dev.we3kings.nexusmoves.ui.theme.NexusRadii
import dev.we3kings.nexusmoves.ui.theme.NexusType
import dev.we3kings.nexusmoves.ui.theme.nexus
import dev.we3kings.nexusmoves.ui.theme.shimmerBrush

/**
 * "Get ready to share" — port of iOS ReadinessSheet, on the design language.
 * Progress ring (shimmer arc — one of the allowed shimmer moments), optional
 * reasonableness Banner, a tappable Next Steps checklist (iOS #70: tap dismisses
 * and sends the step as a chat message), and the shimmer Share hero CTA.
 */
@Composable
fun ReadinessSheet(
    readiness: ShareReadinessDTO?,
    onShare: () -> Unit,
    onEstimateWeights: () -> Unit,
    onAddVideo: () -> Unit,
    onStep: (String) -> Unit,
) {
    val c = nexus
    val shimmer = shimmerBrush()
    val overall = readiness?.overall ?: 0
    val progress = readiness?.progress ?: 0f
    val steps = readiness?.nextSteps ?: emptyList()

    Column(Modifier.fillMaxWidth().fillMaxHeight(0.94f).background(c.surfaceSunk)) {
        Text(
            "Get ready to share",
            style = NexusType.typography.titleMedium, color = c.textPrimary,
            modifier = Modifier.fillMaxWidth().padding(16.dp), textAlign = TextAlign.Center,
        )

        Column(
            Modifier.weight(1f).fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = 20.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(22.dp),
        ) {
            // Progress ring — shimmer arc.
            Box(Modifier.size(132.dp), contentAlignment = Alignment.Center) {
                Canvas(Modifier.size(132.dp)) {
                    val stroke = 14.dp.toPx()
                    val inset = stroke / 2
                    val arcSize = Size(size.width - stroke, size.height - stroke)
                    drawArc(
                        color = c.surfaceHover, startAngle = 0f, sweepAngle = 360f, useCenter = false,
                        topLeft = Offset(inset, inset), size = arcSize, style = Stroke(width = stroke),
                    )
                    drawArc(
                        brush = shimmer, startAngle = -90f, sweepAngle = 360f * progress, useCenter = false,
                        topLeft = Offset(inset, inset), size = arcSize,
                        style = Stroke(width = stroke, cap = StrokeCap.Round),
                    )
                }
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Text("$overall%", style = NexusType.typography.headlineMedium, color = c.textPrimary)
                    Text("ready", style = NexusType.typography.bodySmall, color = c.textSecondary)
                }
            }
            Text(readiness?.statusLabel ?: "Building your inventory",
                style = NexusType.typography.titleMedium, color = c.textPrimary)
            readiness?.summary?.let {
                Text(it, style = NexusType.typography.bodyMedium, color = c.textSecondary, textAlign = TextAlign.Center)
            }

            readiness?.shareWarning?.let { Banner(text = it, tone = BannerTone.Warning) }

            // Next steps checklist.
            Column(
                Modifier.fillMaxWidth().clip(RoundedCornerShape(NexusRadii.card.dp)).background(c.surfaceCard).padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(14.dp),
            ) {
                Text(if (steps.isEmpty()) "You're all set" else "Next steps",
                    style = NexusType.typography.titleMedium, color = c.textPrimary)
                if (steps.isEmpty()) {
                    Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Outlined.CheckCircle, null, tint = c.success, modifier = Modifier.size(20.dp))
                        Text("Your inventory looks ready to share.",
                            style = NexusType.typography.bodyMedium, color = c.success)
                    }
                } else {
                    steps.forEach { step ->
                        Row(
                            Modifier.fillMaxWidth().clickable { onStep(step) },
                            horizontalArrangement = Arrangement.spacedBy(12.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Icon(Icons.Outlined.RadioButtonUnchecked, null, tint = c.accent, modifier = Modifier.size(22.dp))
                            Text(step, style = NexusType.typography.bodyMedium, color = c.textPrimary, modifier = Modifier.weight(1f))
                            Icon(Icons.Outlined.ChevronRight, null, tint = c.textTertiary, modifier = Modifier.size(18.dp))
                        }
                    }
                }
            }
            Spacer(Modifier.size(4.dp))
        }

        // CTA bar — the ONE shimmer hero CTA, plus quiet secondaries.
        Column(Modifier.fillMaxWidth().background(c.surface).padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            NexusButton("Share inventory", onClick = onShare, variant = NexusButtonVariant.Shimmer, icon = Icons.Outlined.IosShare, modifier = Modifier.fillMaxWidth())
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                NexusButton("Estimate weights", onClick = onEstimateWeights, variant = NexusButtonVariant.Secondary, modifier = Modifier.weight(1f))
                NexusButton("Add a room", onClick = onAddVideo, variant = NexusButtonVariant.Secondary, modifier = Modifier.weight(1f))
            }
        }
    }
}
