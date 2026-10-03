package app.podcst.playback.media

import android.app.Notification
import androidx.media3.exoplayer.offline.Download
import androidx.media3.exoplayer.offline.DownloadManager
import androidx.media3.exoplayer.offline.DownloadNotificationHelper
import androidx.media3.exoplayer.offline.DownloadService
import androidx.media3.exoplayer.scheduler.PlatformScheduler
import androidx.media3.exoplayer.scheduler.Requirements
import app.podcst.playback.R

interface DownloadsHost {
    val media: MediaStore
}

class DownloadsService : DownloadService(
    NOTIFICATION,
    DEFAULT_FOREGROUND_NOTIFICATION_UPDATE_INTERVAL,
    CHANNEL,
    R.string.downloads_channel,
    0,
) {
    private val notifications by lazy { DownloadNotificationHelper(this, CHANNEL) }

    override fun getDownloadManager(): DownloadManager = (application as DownloadsHost).media.downloadManager

    override fun getScheduler() = PlatformScheduler(this, JOB)

    override fun getForegroundNotification(downloads: MutableList<Download>, notMetRequirements: @Requirements.RequirementFlags Int): Notification =
        notifications.buildProgressNotification(this, R.drawable.ic_notification, null, getString(R.string.downloading), downloads, notMetRequirements)

    private companion object {
        const val NOTIFICATION = 2
        const val JOB = 3
        const val CHANNEL = "downloads"
    }
}
