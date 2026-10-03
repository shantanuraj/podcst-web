package app.podcst.playback.media

import android.content.Context
import android.net.Uri
import androidx.media3.exoplayer.offline.Download
import androidx.media3.exoplayer.offline.DownloadManager
import androidx.media3.exoplayer.offline.DownloadRequest
import androidx.media3.exoplayer.offline.DownloadService
import app.podcst.model.DownloadState
import app.podcst.model.Episode
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

data class DownloadEntry(val identity: String, val state: DownloadState, val updated: Long)

class Downloads(
    private val context: Context,
    private val media: MediaStore,
    private val service: Class<out DownloadService>,
    private val scope: CoroutineScope,
) {
    private val manager: DownloadManager = media.downloadManager
    private val entries = MutableStateFlow<Map<String, DownloadEntry>>(emptyMap())
    val states: StateFlow<Map<String, DownloadEntry>> = entries.asStateFlow()
    private var polling: Job? = null

    init {
        manager.addListener(object : DownloadManager.Listener {
            override fun onInitialized(downloadManager: DownloadManager) = publish()
            override fun onDownloadChanged(downloadManager: DownloadManager, download: Download, finalException: Exception?) = publish()
            override fun onDownloadRemoved(downloadManager: DownloadManager, download: Download) = publish()
            override fun onIdle(downloadManager: DownloadManager) = publish()
        })
        publish()
    }

    fun state(episode: Episode): DownloadState = entries.value[MediaStore.key(episode)]?.state ?: DownloadState.None

    fun download(episode: Episode) {
        val key = MediaStore.key(episode)
        val request = DownloadRequest.Builder(key, Uri.parse(episode.file.url))
            .setCustomCacheKey(key)
            .setMimeType(episode.file.type.takeIf { it.startsWith("audio/") })
            .setData(episode.identity.value.toByteArray())
            .build()
        DownloadService.sendAddDownload(context, service, request, false)
    }

    fun pause(episode: Episode) =
        DownloadService.sendSetStopReason(context, service, MediaStore.key(episode), STOPPED_BY_USER, false)

    fun resume(episode: Episode) =
        DownloadService.sendSetStopReason(context, service, MediaStore.key(episode), Download.STOP_REASON_NONE, false)

    fun remove(episode: Episode) = DownloadService.sendRemoveDownload(context, service, MediaStore.key(episode), false)

    fun purge() {
        DownloadService.sendRemoveAllDownloads(context, service, false)
        media.purgeStreaming()
    }

    private fun publish() {
        val cursor = manager.downloadIndex.getDownloads()
        val next = buildMap {
            cursor.use { while (it.moveToNext()) entry(it.download)?.let { entry -> put(it.download.request.id, entry) } }
        }
        entries.value = next
        val active = next.values.any { it.state is DownloadState.Downloading || it.state is DownloadState.Queued }
        if (active && polling?.isActive != true) {
            polling = scope.launch {
                while (isActive) {
                    delay(PROGRESS_INTERVAL)
                    publish()
                }
            }
        } else if (!active) {
            polling?.cancel()
            polling = null
        }
    }

    private fun entry(download: Download): DownloadEntry? {
        val identity = download.request.data.takeIf { it.isNotEmpty() }?.let(::String) ?: return null
        val total = download.contentLength.takeIf { it > 0 }
        val state = when (download.state) {
            Download.STATE_COMPLETED -> DownloadState.Available(download.bytesDownloaded)
            Download.STATE_DOWNLOADING -> DownloadState.Downloading(download.bytesDownloaded, total)
            Download.STATE_QUEUED, Download.STATE_RESTARTING -> DownloadState.Queued(download.bytesDownloaded, total)
            Download.STATE_STOPPED -> DownloadState.Paused(download.bytesDownloaded, total)
            Download.STATE_FAILED -> DownloadState.Failed("Download failed")
            else -> return null
        }
        return DownloadEntry(identity, state, download.updateTimeMs)
    }

    private companion object {
        const val STOPPED_BY_USER = 1
        const val PROGRESS_INTERVAL = 500L
    }
}
