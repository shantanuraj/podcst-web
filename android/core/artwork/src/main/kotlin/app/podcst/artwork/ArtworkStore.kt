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
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import okio.FileSystem
import okio.Path.Companion.toOkioPath

class ArtworkStore(context: Context, private val client: OkHttpClient, scope: String) {
    private val root = File(context.noBackupFilesDir, "artwork")
    private val unscoped = listOf("artwork", "http").map { File(context.cacheDir, it) }
    private val browsing = AccountArtworkCache(File(context.cacheDir, "account-artwork"), BROWSING)
    @Volatile private var directory = File(root, scope)
    private val transfers = Semaphore(TRANSFERS)
    private val work = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var retention: Job? = null
    private val requests = mutableMapOf<Job, String>()

    val loader: ImageLoader = ImageLoader.Builder(context)
        .memoryCache { MemoryCache.Builder().maxSizeBytes(MEMORY).build() }
        .diskCache(browsing)
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

    suspend fun erase(scope: String) = withContext(Dispatchers.IO) {
        if (directory.name == scope) retention?.cancelAndJoin()
        browsing.erase(scope)
        val pending = synchronized(requests) { requests.filterValues { it == scope }.keys.toList() }
        pending.forEach { it.cancelAndJoin() }
        val target = File(root, scope)
        check(!target.exists() || target.deleteRecursively()) { "Unable to remove account artwork" }
        loader.memoryCache?.let { cache -> cache.keys.filter { it.key.startsWith("$scope:") }.forEach { cache.remove(it) } }
        check(unscoped.all { it.listFiles().isNullOrEmpty() }) { "Older caches have no account owner. Cleanup remains incomplete. Clear the app's storage in Android system settings to remove all local copies, including other accounts and guest data." }
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

    private inner class RetainedInterceptor : Interceptor {
        override suspend fun intercept(chain: Interceptor.Chain): ImageResult {
            val data = chain.request.data as? String ?: return chain.proceed()
            val target = directory
            val scope = target.name
            val job = currentCoroutineContext()[Job]
            if (job != null) synchronized(requests) { requests[job] = scope }
            try {
                val request = chain.request.newBuilder()
                    .data(File(target, name(Artwork.canonical(data))).takeIf(File::exists) ?: data)
                    .memoryCacheKey("$scope:${name(data)}")
                    .diskCacheKey("$scope:${name(data)}")
                    .build()
                return chain.withRequest(request).proceed()
            } finally {
                if (job != null) synchronized(requests) { requests.remove(job) }
            }
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

internal class AccountArtworkCache(private val root: File, override val maxSize: Long) : DiskCache {
    private val caches = mutableMapOf<String, DiskCache>()
    private val erased = mutableSetOf<String>()
    override val directory = root.toOkioPath()
    override val fileSystem = FileSystem.SYSTEM
    override val size: Long get() = synchronized(this) { caches.values.sumOf { it.size } }

    @Synchronized private fun cache(key: String): DiskCache? {
        val scope = key.substringBefore(':')
        require(scope == ArtworkStore.GUEST || scope.matches(Regex("[a-f0-9]{64}")))
        if (scope in erased) return null
        return caches.getOrPut(scope) { DiskCache.Builder().directory(File(root, scope)).maxSizeBytes(maxSize).build() }
    }

    override fun openSnapshot(key: String) = cache(key)?.openSnapshot(key)
    override fun openEditor(key: String) = cache(key)?.openEditor(key)
    override fun remove(key: String) = cache(key)?.remove(key) ?: false
    @Synchronized override fun clear() { caches.values.forEach { it.clear() } }
    @Synchronized override fun shutdown() { caches.values.forEach { it.shutdown() }; caches.clear() }

    @Synchronized fun erase(scope: String) {
        erased += scope
        caches.remove(scope)?.shutdown()
        val target = File(root, scope)
        check(!target.exists() || target.deleteRecursively()) { "Unable to remove account artwork cache" }
    }
}
