package app.podcst.artwork

import android.content.Context
import app.podcst.model.Artwork
import coil3.ImageLoader
import coil3.disk.DiskCache
import coil3.disk.directory
import coil3.intercept.Interceptor
import coil3.memory.MemoryCache
import coil3.network.okhttp.OkHttpNetworkFetcherFactory
import coil3.request.ImageResult
import coil3.request.crossfade
import java.io.File
import java.security.MessageDigest
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request

class ArtworkStore(context: Context, private val client: OkHttpClient, scope: String) {
    private val root = File(context.noBackupFilesDir, "artwork")
    @Volatile private var directory = File(root, scope)
    private val transfers = Semaphore(TRANSFERS)
    private val work = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var retention: Job? = null

    val loader: ImageLoader = ImageLoader.Builder(context)
        .memoryCache { MemoryCache.Builder().maxSizeBytes(MEMORY).build() }
        .diskCache { DiskCache.Builder().directory(File(context.cacheDir, "artwork")).maxSizeBytes(BROWSING).build() }
        .components {
            add(RetainedInterceptor())
            add(OkHttpNetworkFetcherFactory(callFactory = { client }))
        }
        .fetcherCoroutineContext(Dispatchers.IO.limitedParallelism(TRANSFERS))
        .crossfade(true)
        .build()

    fun retain(sources: Set<String>) {
        val wanted = sources.filter { it.isNotBlank() }.associateBy { name(Artwork.canonical(it)) }
        val target = directory
        val previous = retention
        retention = work.launch {
            previous?.cancelAndJoin()
            target.mkdirs()
            target.listFiles().orEmpty().filter { it.name !in wanted.keys && !it.name.endsWith(".part") }.forEach(File::delete)
            wanted.forEach { (name, source) ->
                val file = File(target, name)
                if (!file.exists()) transfers.withPermit { download(Artwork.url(source, RETAINED_WIDTH), file) }
            }
        }
    }

    suspend fun switch(scope: String) = withContext(Dispatchers.IO) {
        retention?.cancelAndJoin()
        val previous = directory
        directory = File(root, scope)
        if (previous != directory && previous.name != GUEST) previous.deleteRecursively()
        loader.memoryCache?.clear()
    }

    private fun download(url: String, file: File) {
        val partial = File(file.parentFile, file.name + ".part")
        runCatching {
            client.newCall(Request.Builder().url(url).build()).execute().use { response ->
                if (!response.isSuccessful) return
                partial.outputStream().use { response.body.byteStream().copyTo(it) }
                partial.renameTo(file)
            }
        }
        partial.delete()
    }

    private fun retained(source: String): File? = File(directory, name(Artwork.canonical(source))).takeIf(File::exists)

    private inner class RetainedInterceptor : Interceptor {
        override suspend fun intercept(chain: Interceptor.Chain): ImageResult {
            val data = chain.request.data as? String ?: return chain.proceed()
            val file = retained(data) ?: return chain.proceed()
            return chain.withRequest(chain.request.newBuilder().data(file).build()).proceed()
        }
    }

    companion object {
        const val GUEST = "guest"
        private const val TRANSFERS = 3
        private const val RETAINED_WIDTH = 1024
        private const val MEMORY = 32L * 1024 * 1024
        private const val BROWSING = 64L * 1024 * 1024

        private fun name(canonical: String) =
            MessageDigest.getInstance("SHA-256").digest(canonical.toByteArray()).joinToString("") { "%02x".format(it) }
    }
}
