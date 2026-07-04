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
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import dev.we3kings.nexusmoves.model.DuplicatePair
import dev.we3kings.nexusmoves.model.DuplicateReview
import dev.we3kings.nexusmoves.ui.theme.PrimaryButton
import dev.we3kings.nexusmoves.ui.theme.Theme

/**
 * Duplicate review — port of iOS DuplicateReviewSheet. Resolve each pair by
 * keeping one, the other, or both; apply removes the chosen ids via
 * /inventory/resolve-duplicates. Defaults to the safe choice (keep both).
 */
private enum class DupChoice { KeepA, KeepB, Both }

@Composable
fun DuplicateReviewSheet(
    review: DuplicateReview,
    onApply: (List<Int>) -> Unit,
    onCancel: () -> Unit,
) {
    val choices = remember(review.id) {
        mutableStateMapOf<String, DupChoice>().apply {
            review.pairs.forEach { put(it.clientId, DupChoice.Both) }
        }
    }

    fun removeItemIds(): List<Int> = review.pairs.mapNotNull { pair ->
        when (choices[pair.clientId] ?: DupChoice.Both) {
            DupChoice.KeepA -> pair.itemB.id
            DupChoice.KeepB -> pair.itemA.id
            DupChoice.Both -> null
        }
    }.filter { it > 0 }

    Column(Modifier.fillMaxWidth().fillMaxHeight(0.9f)) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            TextButton(onClick = onCancel) { Text("Skip") }
            Spacer(Modifier.weight(1f))
        }
        Text(
            "${review.pairs.size} possible duplicate${if (review.pairs.size == 1) "" else "s"}",
            style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold,
            modifier = Modifier.padding(horizontal = 16.dp),
        )
        Text(
            "These look similar. Keep one, the other, or both.",
            style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(horizontal = 16.dp, vertical = 6.dp),
        )

        LazyColumn(
            Modifier.weight(1f).fillMaxWidth(),
            contentPadding = androidx.compose.foundation.layout.PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            items(review.pairs, key = { it.clientId }) { pair ->
                DuplicateRow(pair, choices[pair.clientId] ?: DupChoice.Both) { choices[pair.clientId] = it }
            }
        }

        Box(Modifier.fillMaxWidth().padding(16.dp)) {
            val ids = removeItemIds()
            PrimaryButton(
                text = if (ids.isEmpty()) "Keep everything" else "Remove ${ids.size}",
                onClick = { onApply(removeItemIds()) },
            )
        }
    }
}

@Composable
private fun DuplicateRow(pair: DuplicatePair, choice: DupChoice, onChoice: (DupChoice) -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        pair.similarity?.let {
            Text("${it.toInt()}% match", style = MaterialTheme.typography.labelMedium,
                color = Theme.brand, fontWeight = FontWeight.SemiBold)
        }
        ItemLine("A", pair.itemA)
        ItemLine("B", pair.itemB)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
            SegmentButton("Keep A", choice == DupChoice.KeepA, Modifier.weight(1f)) { onChoice(DupChoice.KeepA) }
            SegmentButton("Keep B", choice == DupChoice.KeepB, Modifier.weight(1f)) { onChoice(DupChoice.KeepB) }
            SegmentButton("Keep both", choice == DupChoice.Both, Modifier.weight(1f)) { onChoice(DupChoice.Both) }
        }
    }
}

@Composable
private fun androidx.compose.foundation.layout.RowScope.SegmentButton(
    label: String,
    selected: Boolean,
    modifier: Modifier,
    onClick: () -> Unit,
) {
    Box(
        modifier
            .clip(RoundedCornerShape(8.dp))
            .background(if (selected) Theme.brand else Theme.brandSoft)
            .clickable { onClick() }
            .padding(vertical = 8.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(label, color = if (selected) Color.White else Theme.brand,
            style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.Medium)
    }
}

@Composable
private fun ItemLine(tag: String, item: DuplicatePair.DupItem) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Box(Modifier.size(18.dp).clip(CircleShape).background(Theme.brand), contentAlignment = Alignment.Center) {
            Text(tag, color = Color.White, style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.Bold)
        }
        Column(Modifier.weight(1f)) {
            Text(item.name ?: "Item", style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium)
            item.room?.takeIf { it.isNotEmpty() }?.let {
                Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        item.quantity?.takeIf { it > 1 }?.let {
            Text("×$it", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}
