package app.podcst.designsystem

import android.graphics.Bitmap
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.compositeOver
import androidx.compose.ui.graphics.luminance
import androidx.test.ext.junit.runners.AndroidJUnit4
import app.podcst.artwork.ArtworkColors
import coil3.asImage
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class ArtworkTintTest {
    @Test
    fun serverPalettePreservesTheWebArtworkHue() = runBlocking {
        val tint = ArtworkTint("server-artwork")
        val bitmap = Bitmap.createBitmap(96, 96, Bitmap.Config.ARGB_8888).apply { eraseColor(0xFF00FF00.toInt()) }
        tint.loaded(bitmap.asImage(), ArtworkColors(0xFFB8A8B0.toInt(), 0xFF706878.toInt()))
        assertEquals(Color(0xFFB8A8B0), tint.color(false))
        assertEquals(Color(0xFF706878), tint.color(true))
        for (colors in listOf(PodcstColors.Light, PodcstColors.Dark)) {
            val background = tint.headerColor(colors)
            assertEquals(1f, background.alpha)
            assertTrue(background.red > background.green)
            val high = maxOf(background.luminance(), colors.secondary.luminance())
            val low = minOf(background.luminance(), colors.secondary.luminance())
            assertTrue((high + .05f) / (low + .05f) >= 4.5f)
        }
        bitmap.recycle()
    }

    @Test
    fun refreshedArtworkUpdatesTheTintAtTheSameURL() = runBlocking {
        val tint = ArtworkTint("refresh-artwork")
        val original = Bitmap.createBitmap(96, 96, Bitmap.Config.ARGB_8888).apply { eraseColor(0xFFCB2424.toInt()) }
        tint.loaded(original.asImage())
        val previous = tint.color(false)
        val refreshed = Bitmap.createBitmap(96, 96, Bitmap.Config.ARGB_8888).apply { eraseColor(0xFF245CCB.toInt()) }
        tint.loaded(refreshed.asImage())
        assertNotEquals(previous, tint.color(false))
        assertEquals(tint.color(false), ArtworkTint("refresh-artwork").color(false))
        original.recycle()
        refreshed.recycle()
    }

    @Test
    fun coloredArtworkKeepsTextReadableInBothThemes() = runBlocking {
        val artwork = listOf(0xFF0000FF, 0xFFFFFF00, 0xFFFF0000, 0xFF00FF00, 0xFF181818, 0xFFE8E8E8)
        for (source in artwork) {
            val tint = ArtworkTint("contrast-$source")
            val bitmap = Bitmap.createBitmap(96, 96, Bitmap.Config.ARGB_8888).apply { eraseColor(source.toInt()) }
            tint.loaded(bitmap.asImage())
            for (colors in listOf(PodcstColors.Light, PodcstColors.Dark)) {
                val background = tint.headerColor(colors).compositeOver(colors.paper)
                for (foreground in listOf(colors.ink, colors.secondary)) {
                    val light = maxOf(foreground.luminance(), background.luminance())
                    val dark = minOf(foreground.luminance(), background.luminance())
                    assertTrue("$source, dark=${colors.dark}", (light + 0.05f) / (dark + 0.05f) >= 4.5f)
                }
            }
            bitmap.recycle()
        }
    }

    @Test
    fun coloredArtworkProducesATintForBothThemes() = runBlocking {
        val tint = ArtworkTint("blue-artwork")
        val bitmap = Bitmap.createBitmap(96, 96, Bitmap.Config.ARGB_8888).apply { eraseColor(0xFF245CCB.toInt()) }
        tint.loaded(bitmap.asImage())
        assertNotEquals(Color.Transparent, tint.headerColor(PodcstColors.Light))
        assertNotEquals(Color.Transparent, tint.headerColor(PodcstColors.Dark))
        bitmap.recycle()
    }

    @Test
    fun missingArtworkLeavesTheBackgroundNeutral() {
        val tint = ArtworkTint(null)
        assertEquals(Color.Transparent, tint.headerColor(PodcstColors.Light))
        assertEquals(Color.Transparent, tint.headerColor(PodcstColors.Dark))
    }
}
