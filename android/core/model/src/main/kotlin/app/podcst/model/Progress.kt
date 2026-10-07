package app.podcst.model

import kotlin.time.Duration
import kotlin.time.Instant
import kotlinx.serialization.Serializable

@Serializable
data class SavedEpisodeProgress(val episodeId: Long, val position: Double, val completed: Boolean)

data class EpisodeProgress(
    val position: Duration,
    val duration: Duration?,
    val completed: Boolean,
    val updated: Instant,
) {
    val fraction: Float? get() = duration?.takeIf { it.isPositive() }?.let { (position / it).toFloat().coerceIn(0f, 1f) }
    val remaining: Duration? get() = duration?.let { (it - position).coerceAtLeast(Duration.ZERO) }
    val started: Boolean get() = position.isPositive() && !completed

    companion object {
        fun completes(position: Duration, duration: Duration?): Boolean =
            duration?.takeIf { it.isPositive() }?.let { position >= it * PlaybackRules.COMPLETION_THRESHOLD } ?: false
    }
}
