package app.podcst.designsystem

import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

class ContentLayout(private val width: Dp, fontScale: Float) {
    private val scale = fontScale.coerceAtLeast(1f)
    val gutter = 24.dp
    val twoColumns: Boolean get() = width >= 600.dp * scale + gutter
    val supportingWidth: Dp get() = (width * 0.36f).coerceIn(240.dp * scale, 340.dp * scale)
    val primaryWidth: Dp get() = width - gutter - supportingWidth
}
