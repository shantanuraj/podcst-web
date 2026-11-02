package app.podcst.feature.podcast

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.podcst.data.CatalogRepository
import app.podcst.data.ProgressRepository
import app.podcst.data.StarRepository
import app.podcst.model.DownloadState
import app.podcst.model.Episode
import app.podcst.model.ChapterSource
import app.podcst.model.EpisodeChapters
import app.podcst.model.EpisodeIdentity
import app.podcst.model.EpisodeProgress
import app.podcst.playback.PlaybackCoordinator
import app.podcst.playback.PlayerState
import app.podcst.playback.media.Downloads
import app.podcst.playback.media.MediaStore
import kotlin.time.Duration
import kotlin.coroutines.cancellation.CancellationException
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.onStart
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
    val chapters: EpisodeChapters? = null,
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
    private val readerActive = catalog.readerActive()
    private val chapters = flow<EpisodeChapters?> { emit(catalog.chapters(route)) }
        .catch { if (it is CancellationException) throw it else emit(null) }
        .onStart { emit(null) }

    val state: StateFlow<EpisodeScreenState> = combine(
        catalog.episode(identity.value).map { it ?: route },
        progress.progress.map { it[identity.value] }.distinctUntilChanged(),
        stars.episodeIds,
        downloads.states,
        combine(playback.state, chapters) { player, remote ->
            val current = player.takeIf { it.plays(identity) }
            val embedded = current?.chapterMetadata?.navigation?.takeIf { it.size >= 2 }
            val chapters = if (!readerActive()) null else embedded?.let { EpisodeChapters(it, ChapterSource.Embedded) }
                ?: remote?.takeIf { it.chapters.isNotEmpty() }
            current?.let { Playhead(it.position, it.duration, it.requested) } to chapters
        }.distinctUntilChanged(),
    ) { episode, saved, starred, entries, player ->
        EpisodeScreenState(episode, saved, episode.id in starred, entries[MediaStore.key(episode)]?.state ?: DownloadState.None, player.first, player.second)
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), EpisodeScreenState(route))

    fun seek(to: Duration) {
        if (playback.state.value.plays(identity)) playback.seek(to) else playback.play(state.value.episode, to)
    }
}

private fun PlayerState.plays(identity: EpisodeIdentity): Boolean = active && episode?.identity == identity
