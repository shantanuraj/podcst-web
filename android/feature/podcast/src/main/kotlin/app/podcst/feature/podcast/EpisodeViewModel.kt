package app.podcst.feature.podcast

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.podcst.data.CatalogRepository
import app.podcst.data.ProgressRepository
import app.podcst.data.StarRepository
import app.podcst.model.DownloadState
import app.podcst.model.Episode
import app.podcst.model.EpisodeIdentity
import app.podcst.model.EpisodeProgress
import app.podcst.playback.PlaybackCoordinator
import app.podcst.playback.PlayerState
import app.podcst.playback.media.Downloads
import app.podcst.playback.media.MediaStore
import kotlin.time.Duration
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn

data class EpisodeScreenState(
    val episode: Episode,
    val progress: EpisodeProgress? = null,
    val starred: Boolean = false,
    val download: DownloadState = DownloadState.None,
    val playhead: Playhead? = null,
) {
    internal val button: PlayButton get() = PlayButton.of(progress, playhead)
}

class EpisodeViewModel(
    route: Episode,
    catalog: CatalogRepository,
    progress: ProgressRepository,
    stars: StarRepository,
    downloads: Downloads,
    private val playback: PlaybackCoordinator,
) : ViewModel() {
    private val identity = route.identity

    val state: StateFlow<EpisodeScreenState> = combine(
        catalog.episode(identity.value).map { it ?: route },
        progress.progress.map { it[identity.value] }.distinctUntilChanged(),
        stars.episodeIds,
        downloads.states,
        playback.state.map { player ->
            player.takeIf { it.plays(identity) }?.let { Playhead(it.position, it.duration, it.requested) }
        }.distinctUntilChanged(),
    ) { episode, saved, starred, entries, playhead ->
        EpisodeScreenState(episode, saved, episode.id in starred, entries[MediaStore.key(episode)]?.state ?: DownloadState.None, playhead)
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), EpisodeScreenState(route))

    fun seek(to: Duration) {
        if (playback.state.value.plays(identity)) playback.seek(to) else playback.play(state.value.episode, to)
    }
}

private fun PlayerState.plays(identity: EpisodeIdentity): Boolean = active && episode?.identity == identity
