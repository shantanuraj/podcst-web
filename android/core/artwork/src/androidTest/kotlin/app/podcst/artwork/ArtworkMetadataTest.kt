package app.podcst.artwork

import android.graphics.Bitmap
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import coil3.decode.DataSource
import coil3.request.ImageRequest
import coil3.request.SuccessResult
import java.io.ByteArrayOutputStream
import java.util.concurrent.atomic.AtomicInteger
import kotlinx.coroutines.runBlocking
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class ArtworkMetadataTest {
    @Test fun tintHeadersTravelWithNetworkMemoryAndDiskImages() = runBlocking {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val pixels = ByteArrayOutputStream().also { out ->
            Bitmap.createBitmap(8, 8, Bitmap.Config.ARGB_8888).apply {
                eraseColor(0xFF00FF00.toInt())
                compress(Bitmap.CompressFormat.PNG, 100, out)
                recycle()
            }
        }.toByteArray()
        val calls = AtomicInteger()
        val client = OkHttpClient.Builder().addInterceptor { chain ->
            calls.incrementAndGet()
            Response.Builder().request(chain.request()).protocol(Protocol.HTTP_1_1).code(200).message("OK")
                .header("Content-Type", "image/png").header("X-Artwork-Tint-Light", "#b8a8b0").header("X-Artwork-Tint-Dark", "#706878")
                .body(pixels.toResponseBody("image/png".toMediaType())).build()
        }.build()
        val store = ArtworkStore(context, client, ArtworkStore.GUEST)
        try {
            store.loader.diskCache?.clear()
            val request = ImageRequest.Builder(context).data("https://example.test/artwork.png").size(8).build()
            suspend fun load(source: DataSource) {
                val result = store.loader.execute(request)
                assertTrue(result.toString(), result is SuccessResult)
                result as SuccessResult
                assertEquals(source, result.dataSource)
                assertEquals(ArtworkColors(0xFFB8A8B0.toInt(), 0xFF706878.toInt()), result.request.extras[ArtworkMetadata.Key]?.colors)
            }
            load(DataSource.NETWORK)
            load(DataSource.MEMORY_CACHE)
            store.switch(ArtworkStore.GUEST)
            load(DataSource.DISK)
            assertEquals(1, calls.get())
        } finally { store.loader.shutdown() }
    }
}
