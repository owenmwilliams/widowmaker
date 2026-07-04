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
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import dev.we3kings.nexusmoves.model.ShareReadinessDTO
import dev.we3kings.nexusmoves.ui.theme.PrimaryButton
import dev.we3kings.nexusmoves.ui.theme.SecondaryButton
import dev.we3kings.nexusmoves.ui.theme.Theme

/**
 * "Get ready to share" — port of iOS ReadinessSheet. Progress ring, optional
 * reasonableness warning, a Next Steps checklist (one bullet per gap), and the
 * primary Share action plus Estimate weights / Add a room.
 *
 * Each Next Steps row is tappable (iOS PR #70): tapping dismisses the sheet and
 * sends the step text as the user's chat message, so the agent acts on it.
 */
@Composable
fun ReadinessSheet(
    readiness: ShareReadinessDTO?,
    onShare: () -> Unit,
    onEstimateWeights: () -> Unit,
    onAddVideo: () -> Unit,
    onStep: (String) -> Unit,
) {
    val overall = readiness?.overall ?: 0
    val progress = readiness?.progress ?: 0f
    val steps = readiness?.nextSteps ?: emptyList()

    Column(Modifier.fillMaxWidth().fillMaxHeight(0.94f).background(Theme.canvas)) {
        Text(
            "Get ready to share",
            style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold,
            modifier = Modifier.fillMaxWidth().padding(16.dp), textAlign = TextAlign.Center,
        )

        Column(
            Modifier.weight(1f).fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = 20.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(22.dp),
        ) {
            // Progress ring
            Box(Modifier.size(132.dp), contentAlignment = Alignment.Center) {
                Canvas(Modifier.size(132.dp)) {
                    val stroke = 14.dp.toPx()
                    val inset = stroke / 2
                    val arcSize = Size(size.width - stroke, size.height - stroke)
                    drawArc(
                        color = Theme.brandSoft, startAngle = 0f, sweepAngle = 360f, useCenter = false,
                        topLeft = androidx.compose.ui.geometry.Offset(inset, inset), size = arcSize,
                        style = Stroke(width = stroke),
                    )
                    drawArc(
                        color = Theme.brand, startAngle = -90f, sweepAngle = 360f * progress, useCenter = false,
                        topLeft = androidx.compose.ui.geometry.Offset(inset, inset), size = arcSize,
                        style = Stroke(width = stroke, cap = StrokeCap.Round),
                    )
                }
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Text("$overall%", style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold)
                    Text("ready", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
            Text(readiness?.statusLabel ?: "Building your inventory",
                style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
            readiness?.summary?.let {
                Text(it, style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center)
            }

            readiness?.shareWarning?.let { WarningCard(it) }

            // Next steps checklist
            Column(
                Modifier.fillMaxWidth().clip(RoundedCornerShape(Theme.cardRadius.dp)).background(Theme.card).padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(14.dp),
            ) {
                Text(if (steps.isEmpty()) "You're all set" else "Next steps",
                    style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                if (steps.isEmpty()) {
                    Text("✅  Your inventory looks ready to share.",
                        style = MaterialTheme.typography.bodyMedium, color = Theme.good)
                } else {
                    steps.forEach { step ->
                        Row(
                            Modifier.fillMaxWidth().clickable { onStep(step) },
                            horizontalArrangement = Arrangement.spacedBy(12.dp),
                            verticalAlignment = Alignment.Top,
                        ) {
                            Text("○", color = Theme.brand)
                            Text(step, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
                            Text("›", style = MaterialTheme.typography.bodyMedium,
                                fontWeight = FontWeight.SemiBold, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                }
            }
            Spacer(Modifier.size(4.dp))
        }

        // CTA bar
        Column(Modifier.fillMaxWidth().background(Theme.card).padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            PrimaryButton("Share inventory", onClick = onShare)
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                SecondaryButton("Estimate weights", Modifier.weight(1f)) { onEstimateWeights() }
                SecondaryButton("Add a room", Modifier.weight(1f)) { onAddVideo() }
            }
        }
    }
}

@Composable
private fun WarningCard(text: String) {
    Row(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(Theme.cardRadius.dp)).background(Theme.warnSoft).padding(14.dp),
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Text("⚠️", color = Theme.warn)
        Text(text, style = MaterialTheme.typography.bodyMedium, color = Theme.warnText)
    }
}
