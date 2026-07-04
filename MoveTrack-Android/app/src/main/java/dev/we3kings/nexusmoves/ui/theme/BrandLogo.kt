package dev.we3kings.nexusmoves.ui.theme

import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.unit.dp
import dev.we3kings.nexusmoves.R

/**
 * The Nexus Moves brand mark — the white N-route + beacon dot
 * (design/assets/logo-mark.svg), shown bare on the dark login/splash surfaces.
 */
@Composable
fun BrandLogo(size: Int = 96) {
    Image(
        painter = painterResource(R.drawable.logo_mark),
        contentDescription = "Nexus Moves",
        modifier = Modifier.size(size.dp),
    )
}
