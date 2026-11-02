package app.podcst.designsystem

import android.util.LruCache
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.colorspace.ColorSpaces
import androidx.compose.ui.graphics.luminance
import androidx.palette.graphics.Palette
import app.podcst.artwork.ArtworkColors
import app.podcst.model.Artwork
import coil3.Image
import coil3.toBitmap
import java.lang.ref.WeakReference
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

@Stable
class ArtworkTint internal constructor(private val source: String?) {
    private var loaded by mutableStateOf(source?.let(palettes::get))

    fun color(dark: Boolean): Color? {
        val loaded = loaded ?: return null
        loaded.colors?.let { return Color(if (dark) it.dark else it.light) }
        val palette = loaded.palette
        val swatch = if (dark) palette.darkMutedSwatch ?: palette.darkVibrantSwatch ?: palette.dominantSwatch
        else palette.lightMutedSwatch ?: palette.lightVibrantSwatch ?: palette.dominantSwatch
        return swatch?.rgb?.let { Color(it) }
    }

    internal fun headerColor(colors: PodcstColors): Color {
        val color = color(colors.dark) ?: return Color.Transparent
        val foreground = colors.secondary.luminance()
        val lab = color.convert(ColorSpaces.Oklab)
        var lightness = if (colors.dark) minOf(lab.red, 0.35f) else maxOf(lab.red, 0.88f)
        repeat(101) {
            val tint = Color(lightness, lab.green, lab.blue, colorSpace = ColorSpaces.Oklab).convert(ColorSpaces.Srgb)
            val background = tint.luminance()
            if ((maxOf(foreground, background) + 0.05f) / (minOf(foreground, background) + 0.05f) >= 4.6f) return tint
            lightness = (lightness + if (colors.dark) -0.01f else 0.01f).coerceIn(0f, 1f)
        }
        return colors.paper
    }

    internal suspend fun loaded(image: Image, colors: ArtworkColors? = null) {
        val source = source ?: return
        loaded = withContext(Dispatchers.Default) {
            val cached = palettes.get(source)
            if (cached?.image?.get() === image && cached.colors == colors) cached
            else CachedPalette(WeakReference(image), Palette.from(image.toBitmap()).resizeBitmapArea(96 * 96).generate(), colors).also {
                palettes.put(source, it)
            }
        }
    }

    private data class CachedPalette(val image: WeakReference<Image>, val palette: Palette, val colors: ArtworkColors?)

    private companion object {
        val palettes = LruCache<String, CachedPalette>(64)
    }
}

@Composable
fun rememberArtworkTint(source: String?): ArtworkTint {
    val canonical = source?.takeIf(String::isNotBlank)?.let(Artwork::canonical)
    return remember(canonical) { ArtworkTint(canonical) }
}

@Composable
fun Modifier.artworkTint(
    tint: ArtworkTint,
    headerHeight: () -> Int,
    toolbarHeight: () -> Int,
    scrollOffset: () -> Int,
): Modifier {
    val color = tint.headerColor(Podcst.colors)
    return drawBehind {
        val header = headerHeight()
        if (header <= 0) return@drawBehind
        val offset = scrollOffset().coerceIn(0, header)
        val visibility = 1f - offset.toFloat() / header
        if (visibility <= 0f) return@drawBehind
        drawRect(
            Brush.verticalGradient(
                colors = listOf(color.copy(alpha = color.alpha * visibility), Color.Transparent),
                endY = toolbarHeight() + header.toFloat() - offset,
            ),
        )
    }
}
