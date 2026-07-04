package dev.we3kings.nexusmoves.ui.theme

import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.unit.dp
import dev.we3kings.nexusmoves.R

/** The app logo block shared by the splash and login screens (iOS Image("AppLogo")). */
@Composable
fun BrandLogo(size: Int = 88) {
    Image(
        painter = painterResource(R.drawable.app_logo),
        contentDescription = "Nexus Moves",
        modifier = Modifier
            .size(size.dp)
            .shadow(8.dp, RoundedCornerShape(20.dp))
            .clip(RoundedCornerShape(20.dp)),
    )
}
