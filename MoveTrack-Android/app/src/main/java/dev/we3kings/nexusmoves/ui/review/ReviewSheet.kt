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
import androidx.compose.material3.MaterialTheme
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
import dev.we3kings.nexusmoves.ui.theme.PrimaryButton
import dev.we3kings.nexusmoves.ui.theme.Theme

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

    Column(Modifier.fillMaxWidth().fillMaxHeight(0.92f)) {
        // Top bar
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            TextButton(onClick = onCancel) { Text("Cancel") }
            Spacer(Modifier.weight(1f))
            if (onRescan != null) {
                TextButton(onClick = onRescan) { Text("↻ Rescan", color = Theme.brand) }
            }
        }
        val roomBit = review.room?.let { " in the $it" } ?: ""
        Text(
            "${rows.size} item${if (rows.size == 1) "" else "s"} found$roomBit",
            style = MaterialTheme.typography.titleMedium,
            fontWeight = FontWeight.Bold,
            modifier = Modifier.padding(horizontal = 16.dp),
        )
        Text(
            "Tap the circle to drop anything that's wrong. Edit names and quantities inline.",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
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
            PrimaryButton(
                text = if (keptCount == 0) "Select at least one" else "Add $keptCount item${if (keptCount == 1) "" else "s"}",
                enabled = keptCount > 0,
                onClick = { onCommit(rows.map { it.toEditable() }) },
            )
        }
    }
}

@Composable
private fun ReviewRowView(row: ReviewRow) {
    Row(
        Modifier.fillMaxWidth().alpha(if (row.keep) 1f else 0.4f),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text(
            if (row.keep) "☑" else "☐",
            color = if (row.keep) Theme.brand else MaterialTheme.colorScheme.onSurfaceVariant,
            style = MaterialTheme.typography.titleLarge,
            modifier = Modifier.clickable { row.keep = !row.keep }.padding(top = 2.dp),
        )
        // Thumbnail
        val url = row.base.pictureUrl
        Box(
            Modifier.size(44.dp).clip(RoundedCornerShape(8.dp)).background(Theme.brandSoft),
            contentAlignment = Alignment.Center,
        ) {
            if (url != null) {
                AsyncImage(model = url, contentDescription = null, modifier = Modifier.fillMaxWidth())
            } else {
                Text("📦")
            }
        }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            OutlinedTextField(
                value = row.name,
                onValueChange = { row.name = it },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                row.base.specLine?.let {
                    Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                if (row.base.fragile) {
                    Text(
                        "Fragile",
                        style = MaterialTheme.typography.labelSmall,
                        color = Theme.warn,
                        modifier = Modifier.clip(CircleShape).background(Theme.warn.copy(alpha = 0.15f))
                            .padding(horizontal = 6.dp, vertical = 2.dp),
                    )
                }
            }
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("Qty", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Text("×${row.quantity}", fontWeight = FontWeight.SemiBold)
                Text("−", style = MaterialTheme.typography.titleLarge, color = Theme.brand,
                    modifier = Modifier.clickable { if (row.quantity > 1) row.quantity-- }.padding(horizontal = 8.dp))
                Text("+", style = MaterialTheme.typography.titleLarge, color = Theme.brand,
                    modifier = Modifier.clickable { if (row.quantity < 99) row.quantity++ }.padding(horizontal = 8.dp))
            }
        }
    }
}

/** Recomputes the kept count whenever any row's keep/name changes. */
private fun derivedKeptCount(rows: SnapshotStateList<ReviewRow>) =
    androidx.compose.runtime.derivedStateOf {
        rows.count { it.keep && it.name.trim().isNotEmpty() }
    }
