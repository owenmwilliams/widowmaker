package dev.we3kings.nexusmoves

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.ChevronRight
import androidx.compose.material.icons.outlined.IosShare
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import dev.we3kings.nexusmoves.model.DetectedItem
import dev.we3kings.nexusmoves.model.DetectedItemsReview
import dev.we3kings.nexusmoves.model.ShareReadinessDTO
import dev.we3kings.nexusmoves.ui.components.AssistantAvatar
import dev.we3kings.nexusmoves.ui.components.Banner
import dev.we3kings.nexusmoves.ui.components.BannerTone
import dev.we3kings.nexusmoves.ui.components.NexusProgressBar
import dev.we3kings.nexusmoves.ui.components.StatusPill
import dev.we3kings.nexusmoves.ui.components.SuggestionButton
import dev.we3kings.nexusmoves.ui.readiness.ReadinessSheet
import dev.we3kings.nexusmoves.ui.review.ReviewItemsSheet
import androidx.compose.material.icons.outlined.CheckCircle
import dev.we3kings.nexusmoves.ui.theme.NexusRadii
import dev.we3kings.nexusmoves.ui.theme.NexusTheme
import dev.we3kings.nexusmoves.ui.theme.nexus

/**
 * Debug-only gallery so the restyled surfaces can be screenshotted without a
 * live session. `am start -n …/.DesignGalleryActivity[?section=…]`.
 */
class DesignGalleryActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val section = intent.getStringExtra("section") ?: intent.data?.getQueryParameter("section") ?: "chat"
        setContent {
            NexusTheme {
                Box(Modifier.fillMaxSize().background(nexus.bg)) {
                    when (section) {
                        "readiness" -> ReadinessSheet(sampleReadiness, {}, {}, {}, {})
                        "review" -> ReviewItemsSheet(sampleReview, {}, {}, {})
                        else -> ChatGallery()
                    }
                }
            }
        }
    }
}

@Composable
private fun ChatGallery() {
    val c = nexus
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()),
    ) {
        // Header
        Column(Modifier.fillMaxWidth().background(c.surface).padding(16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                AssistantAvatar(size = 44)
                Spacer(Modifier.width(12.dp))
                Column(Modifier.weight(1f)) {
                    Text("Nexus Moves", style = androidx.compose.material3.MaterialTheme.typography.titleLarge, color = c.textPrimary)
                    Text("Your moving assistant", style = androidx.compose.material3.MaterialTheme.typography.bodySmall, color = c.textSecondary)
                }
            }
            Spacer(Modifier.height(14.dp))
            Row(
                Modifier.fillMaxWidth().clip(RoundedCornerShape(NexusRadii.bubble.dp)).background(Color.Black).padding(16.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(Modifier.weight(1f)) {
                    Row(verticalAlignment = Alignment.Bottom) {
                        Text("In progress", style = androidx.compose.material3.MaterialTheme.typography.titleMedium, color = Color.White, modifier = Modifier.weight(1f))
                        Text("64%", color = c.textSecondary)
                    }
                    Spacer(Modifier.height(12.dp))
                    NexusProgressBar(value = 0.64f)
                    Spacer(Modifier.height(10.dp))
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text("See what's left", color = c.accent, fontWeight = FontWeight.Bold)
                        Icon(Icons.Outlined.ChevronRight, null, tint = c.accent)
                    }
                }
                Spacer(Modifier.width(14.dp))
                Column(
                    Modifier.width(64.dp).height(60.dp).clip(RoundedCornerShape(NexusRadii.button.dp)).background(c.accent),
                    horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center,
                ) {
                    Icon(Icons.Outlined.IosShare, null, tint = Color.White)
                    Text("Share", color = Color.White, style = androidx.compose.material3.MaterialTheme.typography.labelMedium, fontWeight = FontWeight.Bold)
                }
            }
        }

        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            Bubble(false, "Great, those 7 items are added! I checked for duplicates and we're all clear. What else should we add to the Hallway, Owen?")
            Bubble(true, "Everything in this closet")
            StatusPill("Items reviewed · 8 added", Icons.Outlined.CheckCircle, success = true)
            Bubble(true, "Added 8 of the 10 items from the closet scan.")
            SuggestionButton(label = "Catalog more Hallway items", onClick = {})
            SuggestionButton(label = "Catalog Storage", onClick = {})
            Banner("Only ~43 lbs logged for a 3-bedroom home — worth a second pass before sharing.", BannerTone.Warning)
            Banner("Connection interrupted — please try again.", BannerTone.Danger)
        }
    }
}

@Composable
private fun Bubble(self: Boolean, text: String) {
    val c = nexus
    val tail = 7.dp
    val shape = RoundedCornerShape(
        topStart = NexusRadii.bubble.dp, topEnd = NexusRadii.bubble.dp,
        bottomEnd = if (self) tail else NexusRadii.bubble.dp,
        bottomStart = if (self) NexusRadii.bubble.dp else tail,
    )
    Row(Modifier.fillMaxWidth(), horizontalArrangement = if (self) Arrangement.End else Arrangement.Start) {
        Box(Modifier.widthIn(max = 320.dp).clip(shape).background(if (self) c.bubbleSelf else c.bubbleOther).padding(horizontal = 16.dp, vertical = 12.dp)) {
            Text(text, color = if (self) c.bubbleSelfText else c.bubbleOtherText, fontWeight = if (self) FontWeight.SemiBold else FontWeight.Normal)
        }
    }
}

private val sampleReadiness = ShareReadinessDTO(
    overall = 64,
    status = "in_progress",
    summary = "13 items across 9 rooms. 43 lbs, ~6 cu ft.",
    nextSteps = listOf(
        "Catalog items in empty rooms: Bedroom 3, Bedroom 2, Living Room",
        "Keep adding items — 13 logged so far, most moves have 50+",
    ),
    reasonableness = ShareReadinessDTO.Reasonableness(
        hasBenchmark = true, status = "too_low", severity = "high",
        message = "Only ~43 lbs logged for a 3-bedroom home, which usually totals around 8,000 lbs. You've likely missed rooms or items — worth a second pass before sharing.",
    ),
)

private val sampleReview = DetectedItemsReview(
    mediaKind = "photo",
    room = "Hallway",
    items = listOf(
        DetectedItem(name = "Dining table", quantity = 1, weightLbs = 150.0, lengthIn = 84.0, widthIn = 36.0, heightIn = 30.0, fragile = false),
        DetectedItem(name = "Armchair", quantity = 2, weightLbs = 35.0, fragile = false),
        DetectedItem(name = "Framed artwork", quantity = 3, weightLbs = 8.0, fragile = true),
    ),
)
