package dev.we3kings.nexusmoves.ui.theme

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp

/** Filled brand button (primary CTA) — port of iOS PrimaryButtonStyle. */
@Composable
fun PrimaryButton(text: String, enabled: Boolean = true, onClick: () -> Unit) {
    Box(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(Theme.controlRadius.dp))
            .then(if (enabled) Modifier.background(Theme.brandGradient) else Modifier.background(Color.Gray.copy(alpha = 0.4f)))
            .clickable(enabled = enabled) { onClick() }
            .padding(vertical = 14.dp)
            .alpha(if (enabled) 1f else 1f),
        contentAlignment = Alignment.Center,
    ) {
        Text(text, color = Color.White, fontWeight = FontWeight.SemiBold, style = MaterialTheme.typography.bodyLarge)
    }
}

/** Outlined/tinted secondary button — port of iOS SecondaryButtonStyle. */
@Composable
fun SecondaryButton(text: String, modifier: Modifier = Modifier, onClick: () -> Unit) {
    Box(
        modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(Theme.controlRadius.dp))
            .background(Theme.brandSoft)
            .clickable { onClick() }
            .padding(vertical = 13.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(text, color = Theme.brand, fontWeight = FontWeight.Medium, style = MaterialTheme.typography.bodyLarge)
    }
}
