package app.podcst.feature.player

import android.graphics.Bitmap
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.palette.graphics.Palette
import app.podcst.designsystem.Podcst
import app.podcst.model.Artwork
import coil3.SingletonImageLoader
import coil3.request.ImageRequest
import coil3.request.SuccessResult
import coil3.request.allowHardware
import coil3.toBitmap
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

@Composable
fun rememberArtworkTint(url: String?): Color? {
    val context = LocalContext.current
    val dark = Podcst.colors.dark
    var tint by remember(url, dark) { mutableStateOf<Color?>(null) }
    LaunchedEffect(url, dark) {
        if (url.isNullOrBlank()) return@LaunchedEffect
        val result = SingletonImageLoader.get(context).execute(
            ImageRequest.Builder(context).data(Artwork.url(url, 160)).size(96).allowHardware(false).build(),
        ) as? SuccessResult ?: return@LaunchedEffect
        val bitmap: Bitmap = result.image.toBitmap()
        tint = withContext(Dispatchers.Default) {
            val palette = Palette.from(bitmap).generate()
            val swatch = if (dark) palette.darkMutedSwatch ?: palette.darkVibrantSwatch ?: palette.dominantSwatch
            else palette.lightMutedSwatch ?: palette.lightVibrantSwatch ?: palette.dominantSwatch
            swatch?.rgb?.let { Color(it) }
        }
    }
    return tint
}
