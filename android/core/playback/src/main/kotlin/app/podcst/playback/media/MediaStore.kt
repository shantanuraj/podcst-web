package app.podcst.playback.media

import android.content.Context
import androidx.media3.database.StandaloneDatabaseProvider
import androidx.media3.datasource.DataSource
import androidx.media3.datasource.cache.CacheDataSource
import androidx.media3.datasource.cache.LeastRecentlyUsedCacheEvictor
import androidx.media3.datasource.cache.NoOpCacheEvictor
import androidx.media3.datasource.cache.SimpleCache
import androidx.media3.datasource.okhttp.OkHttpDataSource
import androidx.media3.exoplayer.offline.DownloadManager
import app.podcst.model.Episode
import app.podcst.model.PlaybackRules
import java.io.File
import java.security.MessageDigest
import java.util.concurrent.Executors
import okhttp3.OkHttpClient

class MediaStore(context: Context, client: OkHttpClient) {
    private val root = File(context.noBackupFilesDir, "media")
    private val database = StandaloneDatabaseProvider(context)
    private val network = OkHttpDataSource.Factory(client)
    val downloads = SimpleCache(File(root, "downloads"), NoOpCacheEvictor(), database)
    private val streaming = SimpleCache(File(root, "streaming"), LeastRecentlyUsedCacheEvictor(PlaybackRules.TRANSIENT_CACHE_BYTES), database)

    val dataSource: DataSource.Factory = CacheDataSource.Factory()
        .setCache(downloads)
        .setCacheWriteDataSinkFactory(null)
        .setUpstreamDataSourceFactory(
            CacheDataSource.Factory()
                .setCache(streaming)
                .setUpstreamDataSourceFactory(network)
                .setFlags(CacheDataSource.FLAG_IGNORE_CACHE_ON_ERROR),
        )

    val downloadManager = DownloadManager(
        context,
        database,
        downloads,
        CacheDataSource.Factory().setCache(streaming).setUpstreamDataSourceFactory(network),
        Executors.newFixedThreadPool(DOWNLOAD_THREADS),
    ).apply { maxParallelDownloads = DOWNLOAD_THREADS }

    fun usedBytes(): Long = downloads.cacheSpace

    fun purgeStreaming() {
        streaming.keys.toList().forEach(streaming::removeResource)
    }

    companion object {
        private const val DOWNLOAD_THREADS = 2

        fun key(episode: Episode): String {
            val identity = episode.id?.let { "episode:$it" }
                ?: episode.podcastId?.let { "podcast:$it:${episode.guid}" }
                ?: episode.identity.value
            return MessageDigest.getInstance("SHA-256").digest(identity.toByteArray()).joinToString("") { "%02x".format(it) }
        }
    }
}
