package app.podcst.feature.player

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.podcst.data.StarRepository
import app.podcst.model.AudioEffects
import app.podcst.model.Episode
import app.podcst.model.PlaybackRules
import app.podcst.playback.PlaybackCoordinator
import app.podcst.playback.PlayerState
import app.podcst.playback.SleepTimer
import app.podcst.model.DownloadState
import app.podcst.playback.media.Downloads
import app.podcst.playback.media.MediaStore
import kotlin.time.Duration
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

data class PlayerScreenState(
    val player: PlayerState = PlayerState(),
    val starred: Set<Long> = emptySet(),
    val downloads: Map<String, DownloadState> = emptyMap(),
) {
    val episode: Episode? get() = player.episode
    val currentStarred: Boolean get() = episode?.id in starred
    fun download(episode: Episode): DownloadState = downloads[MediaStore.key(episode)] ?: DownloadState.None
}

class PlayerViewModel(
    private val playback: PlaybackCoordinator,
    private val stars: StarRepository,
    downloads: Downloads,
) : ViewModel() {
    val state: StateFlow<PlayerScreenState> = combine(playback.state, stars.episodeIds, downloads.states) { player, starred, entries ->
        PlayerScreenState(player, starred, entries.mapValues { it.value.state })
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), PlayerScreenState(playback.state.value))

    fun toggle() = playback.toggle()
    fun seek(to: Duration) = playback.seek(to)
    fun skipBack() = playback.skipBack()
    fun skipForward() = playback.skipForward()
    fun previousChapter() = playback.previousChapter()
    fun nextChapter() = playback.nextChapter()
    fun next() = playback.next()
    fun previous() = playback.previous()
    fun stop() = playback.stop()
    fun reopen() = playback.reopen()
    fun markPlayed() = playback.markPlayed()
    fun holdDoubleSpeed(held: Boolean) = playback.holdDoubleSpeed(held)
    fun setSpeed(speed: Double) = playback.setSpeed(speed)
    fun setSleepTimer(timer: SleepTimer?) = playback.setSleepTimer(timer)
    fun play(episode: Episode) = playback.play(episode)
    fun removeUpNext(offset: Int) = playback.removeUpNext(setOf(offset))
    fun moveUpNext(from: Int, to: Int) = playback.moveUpNext(from, to)
    fun clear() = playback.clear()

    fun cycleSpeed() {
        val speeds = PlaybackRules.speeds
        val current = speeds.indexOf(state.value.player.speed).takeIf { it >= 0 } ?: speeds.indexOf(PlaybackRules.DEFAULT_SPEED)
        setSpeed(speeds[(current + 1) % speeds.size])
    }

    fun toggleBoost() = updateEffects { it.copy(volumeBoost = !it.volumeBoost) }

    fun toggleTrim() = updateEffects { it.copy(trimSilence = !it.trimSilence) }

    fun toggleStar() {
        val episode = state.value.episode ?: return
        viewModelScope.launch { if (state.value.currentStarred) stars.unstar(episode) else stars.star(episode) }
    }

    private fun updateEffects(transform: (AudioEffects) -> AudioEffects) = playback.setEffects(transform(state.value.player.effects))
}
