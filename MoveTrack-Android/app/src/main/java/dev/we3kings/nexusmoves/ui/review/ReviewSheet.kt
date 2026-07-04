package dev.we3kings.nexusmoves.ui.review

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
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.Inventory2
import androidx.compose.material.icons.outlined.RadioButtonUnchecked
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material.icons.outlined.Remove
import androidx.compose.material3.Icon
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshots.SnapshotStateList
import androidx.compose.runtime.toMutableStateList
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import dev.we3kings.nexusmoves.model.DetectedItem
import dev.we3kings.nexusmoves.model.DetectedItemsReview
import dev.we3kings.nexusmoves.model.EditableItem
import dev.we3kings.nexusmoves.ui.components.NexusButton
import dev.we3kings.nexusmoves.ui.components.NexusButtonVariant
import dev.we3kings.nexusmoves.ui.theme.NexusRadii
import dev.we3kings.nexusmoves.ui.theme.NexusType
import dev.we3kings.nexusmoves.ui.theme.nexus

/**
 * Scan review card — port of iOS ReviewItemsSheet. The modal IS the response to
 * a scan: check/uncheck detected items, edit names/quantities inline, then add
 * them in one tap (commit keyed on scanId). Rescan re-runs analysis (#43).
 *
 * Hosted inside a ModalBottomSheet by ChatScreen. Every close path (Add, Cancel,
 * Rescan, swipe) funnels through the view model so the backing job is consumed
 * exactly once and the pill records the outcome.
 */
private class ReviewRow(item: DetectedItem) {
    val base = item
    var name by mutableStateOf(item.name)
    var quantity by mutableIntStateOf(item.quantity)
    var keep by mutableStateOf(true)

    fun toEditable(): EditableItem = EditableItem(base).also {
        it.name = name
        it.quantity = quantity
        it.keep = keep
    }
}

@Composable
fun ReviewItemsSheet(
    review: DetectedItemsReview,
    onCommit: (List<EditableItem>) -> Unit,
    onCancel: () -> Unit,
    onRescan: (() -> Unit)?,
) {
    val rows: SnapshotStateList<ReviewRow> = remember(review.id) {
        review.items.map { ReviewRow(it) }.toMutableStateList()
    }
    val keptCount by remember {
        derivedKeptCount(rows)
    }

    val c = nexus
    Column(Modifier.fillMaxWidth().fillMaxHeight(0.92f)) {
        // Top bar
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            TextButton(onClick = onCancel) { Text("Cancel", color = c.accent) }
            Spacer(Modifier.weight(1f))
            if (onRescan != null) {
                TextButton(onClick = onRescan) {
                    Icon(Icons.Outlined.Refresh, null, tint = c.accent, modifier = Modifier.size(18.dp))
                    Spacer(Modifier.width(6.dp))
                    Text("Rescan", color = c.accent)
                }
            }
        }
        val roomBit = review.room?.let { " in the $it" } ?: ""
        Text(
            "${rows.size} item${if (rows.size == 1) "" else "s"} found$roomBit",
            style = NexusType.typography.titleMedium, color = c.textPrimary,
            modifier = Modifier.padding(horizontal = 16.dp),
        )
        Text(
            "Tap the circle to drop anything that's wrong. Edit names and quantities inline.",
            style = NexusType.typography.bodySmall, color = c.textSecondary,
            modifier = Modifier.padding(horizontal = 16.dp, vertical = 6.dp),
        )

        LazyColumn(
            Modifier.weight(1f).fillMaxWidth(),
            contentPadding = androidx.compose.foundation.layout.PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            items(rows, key = { it.base.clientId }) { row -> ReviewRowView(row) }
        }

        Box(Modifier.fillMaxWidth().padding(16.dp)) {
            NexusButton(
                label = if (keptCount == 0) "Select at least one" else "Add $keptCount item${if (keptCount == 1) "" else "s"}",
                enabled = keptCount > 0,
                variant = NexusButtonVariant.Primary,
                onClick = { onCommit(rows.map { it.toEditable() }) },
                modifier = Modifier.fillMaxWidth(),
            )
        }
    }
}

@Composable
private fun ReviewRowView(row: ReviewRow) {
    val c = nexus
    Row(
        Modifier.fillMaxWidth().alpha(if (row.keep) 1f else 0.4f),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Icon(
            if (row.keep) Icons.Outlined.CheckCircle else Icons.Outlined.RadioButtonUnchecked,
            contentDescription = if (row.keep) "Keep item" else "Drop item",
            tint = if (row.keep) c.accent else c.textTertiary,
            modifier = Modifier.size(24.dp).clickable { row.keep = !row.keep }.padding(top = 1.dp),
        )
        // Thumbnail
        val url = row.base.pictureUrl
        Box(
            Modifier.size(44.dp).clip(RoundedCornerShape(NexusRadii.button.dp)).background(c.accentQuiet),
            contentAlignment = Alignment.Center,
        ) {
            if (url != null) {
                AsyncImage(model = url, contentDescription = null, modifier = Modifier.fillMaxWidth())
            } else {
                Icon(Icons.Outlined.Inventory2, null, tint = c.accent, modifier = Modifier.size(20.dp))
            }
        }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            OutlinedTextField(
                value = row.name,
                onValueChange = { row.name = it },
                singleLine = true,
                textStyle = NexusType.typography.bodyLarge,
                modifier = Modifier.fillMaxWidth(),
            )
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                row.base.specLine?.let {
                    Text(it, style = NexusType.dataReadout, color = c.textSecondary)
                }
                if (row.base.fragile) {
                    Text(
                        "Fragile",
                        style = NexusType.typography.labelSmall,
                        color = c.warning,
                        modifier = Modifier.clip(CircleShape).background(c.warning.copy(alpha = 0.15f))
                            .padding(horizontal = 8.dp, vertical = 2.dp),
                    )
                }
            }
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("Qty", style = NexusType.typography.bodySmall, color = c.textSecondary)
                Text("×${row.quantity}", style = NexusType.dataReadout, color = c.textPrimary, fontWeight = FontWeight.SemiBold)
                Icon(Icons.Outlined.Remove, "Decrease quantity", tint = c.accent,
                    modifier = Modifier.size(26.dp).clickable { if (row.quantity > 1) row.quantity-- })
                Icon(Icons.Outlined.Add, "Increase quantity", tint = c.accent,
                    modifier = Modifier.size(26.dp).clickable { if (row.quantity < 99) row.quantity++ })
            }
        }
    }
}

/** Recomputes the kept count whenever any row's keep/name changes. */
private fun derivedKeptCount(rows: SnapshotStateList<ReviewRow>) =
    androidx.compose.runtime.derivedStateOf {
        rows.count { it.keep && it.name.trim().isNotEmpty() }
    }
