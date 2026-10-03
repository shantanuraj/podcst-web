package app.podcst.model

sealed interface DownloadState {
    data object None : DownloadState
    data class Queued(val received: Long, val total: Long?) : DownloadState
    data class Downloading(val received: Long, val total: Long?) : DownloadState
    data class Paused(val received: Long, val total: Long?) : DownloadState
    data class Available(val bytes: Long) : DownloadState
    data class Failed(val reason: String) : DownloadState

    val active: Boolean get() = this is Queued || this is Downloading
    val stored: Boolean get() = this is Available
    val fraction: Float?
        get() = when (this) {
            is Downloading -> total?.takeIf { it > 0 }?.let { received.toFloat() / it }
            is Paused -> total?.takeIf { it > 0 }?.let { received.toFloat() / it }
            else -> null
        }
}
