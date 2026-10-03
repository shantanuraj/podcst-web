package app.podcst.designsystem

import androidx.compose.material3.Typography
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontVariation
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.LineHeightStyle
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp

private val interWeights = listOf(FontWeight.Normal, FontWeight.Medium, FontWeight.SemiBold)

val Inter = FontFamily(
    interWeights.map { weight ->
        Font(R.font.inter, weight, variationSettings = FontVariation.Settings(FontVariation.weight(weight.weight)))
    },
)

val InstrumentSerif = FontFamily(
    Font(R.font.instrument_serif, FontWeight.Normal),
    Font(R.font.instrument_serif_italic, FontWeight.Normal, FontStyle.Italic),
)

private fun serif(size: TextUnit, height: Float, tracking: TextUnit = 0.sp, italic: Boolean = false) = TextStyle(
    fontFamily = InstrumentSerif,
    fontWeight = FontWeight.Normal,
    fontStyle = if (italic) FontStyle.Italic else FontStyle.Normal,
    fontSize = size,
    lineHeight = size * height,
    letterSpacing = tracking,
    lineHeightStyle = LineHeightStyle(LineHeightStyle.Alignment.Center, LineHeightStyle.Trim.None),
)

private fun sans(size: TextUnit, weight: FontWeight = FontWeight.Normal, height: Float = 1.4f, tracking: TextUnit = 0.sp) = TextStyle(
    fontFamily = Inter,
    fontWeight = weight,
    fontSize = size,
    lineHeight = size * height,
    letterSpacing = tracking,
)

@Immutable
data class PodcstType(
    val display: TextStyle = serif(72.sp, 1f, (-0.02).em, italic = true),
    val largeTitle: TextStyle = serif(40.sp, 1.1f, (-0.02).em),
    val title: TextStyle = serif(32.sp, 1.1f, (-0.02).em),
    val headline: TextStyle = serif(26.sp, 1.15f),
    val section: TextStyle = serif(22.sp, 1.1f),
    val rowTitle: TextStyle = serif(18.sp, 1.2f),
    val episodeTitle: TextStyle = serif(17.sp, 1.25f),
    val compactTitle: TextStyle = serif(16.sp, 1.25f),
    val dateDay: TextStyle = serif(24.sp, 1f),
    val rank: TextStyle = serif(24.sp, 1f, italic = true),
    val coverTitle: TextStyle = serif(17.sp, 1.05f, italic = true),
    val lede: TextStyle = serif(20.sp, 1.35f),
    val body: TextStyle = sans(15.sp, height = 1.5f),
    val notes: TextStyle = sans(15.sp, height = 1.75f),
    val callout: TextStyle = sans(16.sp, FontWeight.Medium),
    val label: TextStyle = sans(14.sp, FontWeight.Medium),
    val button: TextStyle = sans(15.sp, FontWeight.SemiBold),
    val caption: TextStyle = sans(13.sp),
    val meta: TextStyle = sans(12.sp),
    val chip: TextStyle = sans(13.sp, FontWeight.Medium),
    val eyebrow: TextStyle = sans(11.sp, FontWeight.Medium, height = 1.3f, tracking = 0.05.em),
    val navigation: TextStyle = sans(12.sp, FontWeight.Medium),
    val tabular: TextStyle = sans(12.sp, FontWeight.Medium).copy(fontFeatureSettings = "tnum"),
) {
    val material: Typography
        get() = Typography(
            displayLarge = display,
            headlineLarge = largeTitle,
            headlineMedium = title,
            headlineSmall = headline,
            titleLarge = section,
            titleMedium = rowTitle,
            titleSmall = label,
            bodyLarge = sans(16.sp),
            bodyMedium = body,
            bodySmall = caption,
            labelLarge = button,
            labelMedium = chip,
            labelSmall = meta,
        )

    companion object {
        val Default = PodcstType()
    }
}

val LocalPodcstType = staticCompositionLocalOf { PodcstType.Default }
