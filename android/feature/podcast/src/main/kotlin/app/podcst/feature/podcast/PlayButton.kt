package app.podcst.feature.podcast

import app.podcst.model.EpisodeProgress
import kotlin.time.Duration

data class Playhead(val position: Duration, val duration: Duration, val playing: Boolean) {
    val fraction: Float? get() = duration.takeIf { it.isPositive() }?.let { (position / it).toFloat().coerceIn(0f, 1f) }
    val remaining: Duration? get() = duration.takeIf { it.isPositive() }?.let { (it - position).coerceAtLeast(Duration.ZERO) }
}

internal sealed interface PlayButton {
    data object Play : PlayButton
    data object Played : PlayButton
    data class Resume(val remaining: Duration?, val fraction: Float?) : PlayButton
    data class Pause(val fraction: Float?) : PlayButton

    companion object {
        fun of(progress: EpisodeProgress?, playhead: Playhead?): PlayButton = when {
            playhead != null -> when {
                playhead.playing -> Pause(playhead.fraction)
                playhead.position.isPositive() -> Resume(playhead.remaining, playhead.fraction)
                else -> Play
            }
            progress?.completed == true -> Played
            progress?.started == true -> Resume(progress.remaining, progress.fraction)
            else -> Play
        }
    }
}
