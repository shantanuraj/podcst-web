package app.podcst.feature.library

import app.podcst.model.EpisodeList

import app.podcst.data.ProgressRepository
import app.podcst.data.StarRepository
import app.podcst.designsystem.EpisodeRowState
import app.podcst.designsystem.Format
import app.podcst.model.DownloadState
import app.podcst.model.Episode
import app.podcst.model.EpisodeIdentity
import app.podcst.model.EpisodeProgress
import app.podcst.playback.PlaybackCoordinator
import app.podcst.playback.media.DownloadEntry
import app.podcst.playback.media.Downloads
import app.podcst.playback.media.MediaStore
import kotlin.coroutines.cancellation.CancellationException
import kotlin.time.Instant
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch


enum class Refresh { Idle, Running, Failed }

data class Storage(val used: Long, val free: Long, val total: Long)

internal data class Listening(
    val progress: Map<String, EpisodeProgress> = emptyMap(),
    val starred: Set<String> = emptySet(),
    val downloads: Map<String, DownloadEntry> = emptyMap(),
    val current: EpisodeIdentity? = null,
    val playing: Boolean = false,
    val now: Instant,
) {
    fun row(episode: Episode): EpisodeRowState {
        val identity = episode.identity
        val current = identity == current
        return EpisodeRowState(
            episode = episode,
            progress = progress[identity.value],
            starred = identity.value in starred,
            download = downloads[MediaStore.key(episode)]?.state ?: DownloadState.None,
            playing = current && playing,
            current = current,
            fresh = fresh(episode),
        )
    }

    fun fresh(episode: Episode): Boolean =
        episode.published?.let { Format.recent(it, now) } == true && progress[episode.identity.value].unplayed
}

internal val EpisodeProgress?.unplayed: Boolean get() = this == null || !position.isPositive() && !completed

internal fun listening(
    progress: ProgressRepository,
    stars: StarRepository,
    downloads: Downloads,
    playback: PlaybackCoordinator,
    clock: () -> Instant,
): Flow<Listening> = combine(
    progress.progress,
    stars.identities,
    downloads.states,
    playback.state.map { it.episode?.identity to it.requested }.distinctUntilChanged(),
) { saved, starred, entries, (current, playing) ->
    Listening(saved, starred, entries, current, playing, clock())
}

internal fun continueAndNew(unfinished: List<Episode>, releases: List<Episode>, progress: Map<String, EpisodeProgress>): List<Episode> =
    (unfinished + releases.filterNot { progress[it.identity.value]?.completed == true })
        .distinctBy { it.identity }
        .take(CONTINUE_LIMIT)

internal fun downloaded(entries: Collection<DownloadEntry>, episodes: List<Episode>): List<Episode> {
    val byIdentity = episodes.associateBy { it.identity.value }
    return entries
        .sortedWith(compareBy<DownloadEntry> { it.state.stored }.thenByDescending { it.updated })
        .mapNotNull { byIdentity[it.identity] }
}

sealed interface ListFilter {
    fun matches(row: EpisodeRowState): Boolean

    data object All : ListFilter {
        override fun matches(row: EpisodeRowState) = true
    }

    data object Unplayed : ListFilter {
        override fun matches(row: EpisodeRowState) = row.progress.unplayed
    }

    data object InProgress : ListFilter {
        override fun matches(row: EpisodeRowState) = row.progress?.started == true
    }

    data object Downloaded : ListFilter {
        override fun matches(row: EpisodeRowState) = row.download.stored
    }

    data class Show(val feed: String, val title: String) : ListFilter {
        override fun matches(row: EpisodeRowState) = row.episode.feed == feed
    }
}

data class FacetCount(val filter: ListFilter, val count: Int)

internal fun facets(rows: List<EpisodeRowState>): List<FacetCount> {
    val shows = rows.distinctBy { it.episode.feed }.map { ListFilter.Show(it.episode.feed, it.episode.podcastTitle.orEmpty()) }
    return (listOf(ListFilter.All, ListFilter.Unplayed, ListFilter.InProgress, ListFilter.Downloaded) + shows)
        .map { filter -> FacetCount(filter, rows.count(filter::matches)) }
        .filter { it.count > 0 }
}

enum class ListSort {
    Recent,
    Newest,
    Oldest,
    ;

    internal fun apply(rows: List<EpisodeRowState>): List<EpisodeRowState> = when (this) {
        Recent -> rows
        Newest -> rows.sortedWith(compareBy(nullsLast(reverseOrder<Instant>())) { it.episode.published })
        Oldest -> rows.sortedWith(compareBy(nullsLast(naturalOrder<Instant>())) { it.episode.published })
    }
}

internal fun CoroutineScope.refresh(state: MutableStateFlow<Refresh>, work: suspend () -> Unit) {
    if (state.value == Refresh.Running) return
    state.value = Refresh.Running
    launch {
        state.value = try {
            work()
            Refresh.Idle
        } catch (cancelled: CancellationException) {
            state.value = Refresh.Idle
            throw cancelled
        } catch (failure: Exception) {
            Refresh.Failed
        }
    }
}

private const val CONTINUE_LIMIT = 5
