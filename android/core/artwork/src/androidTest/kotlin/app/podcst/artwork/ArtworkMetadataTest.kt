package app.podcst.artwork

import android.graphics.Bitmap
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import coil3.decode.DataSource
import coil3.request.ImageRequest
import coil3.request.SuccessResult
import app.podcst.model.Artwork
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.IOException
import java.security.MessageDigest
import java.util.concurrent.atomic.AtomicInteger
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
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
    @Test fun legacyRetainedImagesProbeOnceAndPreserveOfflineArtwork() = runBlocking {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        for (mode in listOf("tint", "none", "offline")) {
            val source = "https://assets.podcst.app/?p=https%3A%2F%2Fexample.test%2Flegacy-$mode.png"
            val name = MessageDigest.getInstance("SHA-256").digest(source.toByteArray()).joinToString("") { "%02x".format(it) }
            val retained = File(context.noBackupFilesDir, "artwork/guest/$name")
            retained.parentFile!!.mkdirs()
            val bytes = pixels()
            retained.writeBytes(bytes)
            val sidecar = File(retained.path + ".tint").apply { delete() }
            var offline = mode == "offline"
            val calls = AtomicInteger()
            val client = OkHttpClient.Builder().addInterceptor { chain ->
                calls.incrementAndGet()
                assertEquals("HEAD", chain.request().method)
                Thread.sleep(50)
                if (offline) throw IOException("Offline")
                Response.Builder().request(chain.request()).protocol(Protocol.HTTP_1_1).code(200).message("OK")
                    .apply { if (mode != "none") { header("X-Artwork-Tint-Light", "#c0e0d8"); header("X-Artwork-Tint-Dark", "#00b8e0") } }
                    .body(ByteArray(0).toResponseBody()).build()
            }.build()
            val store = ArtworkStore(context, client, ArtworkStore.GUEST)
            suspend fun load(width: Int): SuccessResult {
                val result = store.loader.execute(ImageRequest.Builder(context).data(Artwork.url(source, width)).size(8).build())
                assertTrue(result.toString(), result is SuccessResult)
                return result as SuccessResult
            }
            try {
                val first = awaitAll(async { load(160) }, async { load(384) })
                val expected = if (mode == "tint") ArtworkColors(0xFFC0E0D8.toInt(), 0xFF00B8E0.toInt()) else null
                first.forEach { assertEquals(expected, it.request.extras[ArtworkMetadata.Key]?.colors) }
                assertEquals(1, calls.get())
                assertArrayEquals(bytes, retained.readBytes())
                assertEquals(!offline, sidecar.exists())
                offline = false
                store.switch(ArtworkStore.GUEST)
                load(512)
                assertEquals(if (mode == "offline") 2 else 1, calls.get())
                assertTrue(sidecar.exists())
            } finally { store.loader.shutdown(); retained.delete(); sidecar.delete() }
        }
    }

    @Test fun tintHeadersTravelWithNetworkMemoryAndDiskImages() = runBlocking {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val pixels = pixels()
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

    private fun pixels() = ByteArrayOutputStream().also { out ->
        Bitmap.createBitmap(8, 8, Bitmap.Config.ARGB_8888).apply {
            eraseColor(0xFF00FF00.toInt())
            compress(Bitmap.CompressFormat.PNG, 100, out)
            recycle()
        }
    }.toByteArray()
}
