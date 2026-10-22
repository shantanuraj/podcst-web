package app.podcst.designsystem

import android.util.LruCache
import androidx.compose.foundation.background
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.compositeOver
import androidx.compose.ui.graphics.luminance
import androidx.palette.graphics.Palette
import app.podcst.model.Artwork
import coil3.Image
import coil3.toBitmap
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

@Stable
class ArtworkTint internal constructor(private val source: String?) {
    private var palette by mutableStateOf(source?.let(palettes::get))

    fun color(dark: Boolean): Color? {
        val palette = palette ?: return null
        val swatch = if (dark) palette.darkMutedSwatch ?: palette.darkVibrantSwatch ?: palette.dominantSwatch
        else palette.lightMutedSwatch ?: palette.lightVibrantSwatch ?: palette.dominantSwatch
        return swatch?.rgb?.let { Color(it) }
    }

    internal fun headerColor(colors: PodcstColors): Color {
        val color = color(colors.dark) ?: return Color.Transparent
        val foreground = colors.secondary.luminance()
        var strength = if (colors.dark) 0.32f else 0.24f
        repeat(8) {
            val tint = color.copy(alpha = strength)
            val background = tint.compositeOver(colors.paper).luminance()
            if ((maxOf(foreground, background) + 0.05f) / (minOf(foreground, background) + 0.05f) >= 4.5f) return tint
            strength *= 0.75f
        }
        return Color.Transparent
    }

    internal suspend fun loaded(image: Image) {
        val source = source ?: return
        if (palette != null) return
        palette = withContext(Dispatchers.Default) {
            synchronized(palettes) {
                palettes.get(source) ?: Palette.from(image.toBitmap()).resizeBitmapArea(96 * 96).generate().also {
                    palettes.put(source, it)
                }
            }
        }
    }

    private companion object {
        val palettes = LruCache<String, Palette>(64)
    }
}

@Composable
fun rememberArtworkTint(source: String?): ArtworkTint {
    val canonical = source?.takeIf(String::isNotBlank)?.let(Artwork::canonical)
    return remember(canonical) { ArtworkTint(canonical) }
}

@Composable
fun Modifier.artworkTint(tint: ArtworkTint): Modifier {
    val colors = Podcst.colors
    return background(
        Brush.verticalGradient(
            0f to tint.headerColor(colors),
            1f to Color.Transparent,
        ),
    )
}
