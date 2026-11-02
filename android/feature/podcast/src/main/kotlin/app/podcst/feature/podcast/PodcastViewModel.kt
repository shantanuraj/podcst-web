package app.podcst.feature.podcast

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.podcst.data.CatalogRepository
import app.podcst.data.LibraryRepository
import app.podcst.data.ProgressRepository
import app.podcst.data.Preferences
import app.podcst.data.SessionRepository
import app.podcst.data.StarRepository
import app.podcst.designsystem.EpisodeRowState
import app.podcst.model.DownloadState
import app.podcst.model.Episode
import app.podcst.model.EpisodeProgress
import app.podcst.model.FeedFreshness
import app.podcst.model.Podcast
import app.podcst.model.ShowNotes
import app.podcst.playback.PlaybackCoordinator
import app.podcst.playback.media.Downloads
import app.podcst.playback.media.MediaStore
import kotlin.coroutines.cancellation.CancellationException
import kotlin.time.Instant
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.distinctUntilChangedBy
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

enum class LoadState { Loading, Refreshing, Rechecking, Loaded, Failed }

enum class EpisodeNotice { Preparing, Unavailable }

data class Current(val identity: String, val playing: Boolean)

data class EpisodeMarks(
    val progress: Map<String, EpisodeProgress> = emptyMap(),
    val starred: Set<Long> = emptySet(),
    val downloads: Map<String, DownloadState> = emptyMap(),
    val current: Current? = null,
) {
    fun row(episode: Episode): EpisodeRowState {
        val identity = episode.identity.value
        val current = current?.takeIf { it.identity == identity }
        return EpisodeRowState(
            episode = episode,
            progress = progress[identity],
            starred = episode.id in starred,
            download = downloads.takeIf { it.isNotEmpty() }?.get(MediaStore.key(episode)) ?: DownloadState.None,
            playing = current?.playing == true,
            current = current != null,
        )
    }
}

data class PodcastScreenState(
    val podcast: Podcast,
    val episodes: List<Episode> = emptyList(),
    val order: EpisodeOrder = EpisodeOrder(),
    val subscribed: Boolean = false,
    val subscribing: Boolean = false,
    val load: LoadState = LoadState.Loading,
    val marks: EpisodeMarks = EpisodeMarks(),
    val related: List<Podcast> = emptyList(),
    val loadingMore: Boolean = false,
    val pageFailed: Boolean = false,
    val hasMore: Boolean = false,
    val retryAt: Long = 0,
    val unplayed: Boolean = false,
    val canFilterUnplayed: Boolean = false,
) {
    val latest: Episode? by lazy { podcast.episodes.maxByOrNull { it.published ?: Instant.DISTANT_PAST } }
    val updated: Instant? get() = listOfNotNull(podcast.published, latest?.published).maxOrNull()
    val count: Int get() = maxOf(podcast.episodeCount, podcast.episodes.size)
    val description: String by lazy { ShowNotes.plainText(podcast.description).replace(whitespace, " ").trim() }
    val episodeNotice: EpisodeNotice? get() = when {
        podcast.episodes.isNotEmpty() -> null
        load in listOf(LoadState.Loading, LoadState.Refreshing, LoadState.Rechecking) ->
            if (podcast.freshness?.content == FeedFreshness.Content.missing) EpisodeNotice.Preparing else null
        load == LoadState.Failed || podcast.freshness?.content == FeedFreshness.Content.missing -> EpisodeNotice.Unavailable
        else -> null
    }

    fun canRetryEpisodes(now: Long): Boolean = (episodeNotice == EpisodeNotice.Unavailable || pageFailed) && maxOf(podcast.freshness?.retryAtMs ?: 0, retryAt) <= now

    private companion object {
        val whitespace = Regex("\\s+")
    }
}

class PodcastViewModel(
    route: Podcast,
    private val catalog: CatalogRepository,
    private val library: LibraryRepository,
    progress: ProgressRepository,
    stars: StarRepository,
    downloads: Downloads,
    playback: PlaybackCoordinator,
    session: SessionRepository,
    preferences: Preferences,
) : ViewModel() {
    private val reader = PodcastReader(route, viewModelScope, session.session, catalog::readerActive,
        cached = catalog::cachedDetail,
        resolve = catalog::resolveDetail,
        metadata = catalog::detailInfo,
        page = catalog::detailPage,
        refreshFeed = catalog::refreshDetail,
    )
    private val inaccessible = reader.inaccessible
    private val load = reader.load
    private val subscribing = MutableStateFlow(false)
    private val filter = MutableStateFlow("")

    val query: StateFlow<String> = filter.asStateFlow()
    private val podcast: StateFlow<Podcast> = reader.source

    private val subscription = combine(library.subscribed, subscribing, load, ::Triple)

    private val related = combine(
        podcast.distinctUntilChangedBy { it.id to it.isPrivate },
        preferences.region,
        session.session.map { it.loading to it.user?.id }.distinctUntilChanged(),
        inaccessible,
    ) { podcast, region, session, denied -> Triple(podcast, region, session.first || denied) }
        .flatMapLatest { (podcast, region, loading) ->
            flow {
                emit(emptyList<Podcast>())
                if (!loading) {
                    try {
                        emit(catalog.related(podcast, region))
                    } catch (cancelled: CancellationException) {
                        throw cancelled
                    } catch (_: Exception) {
                        emit(emptyList())
                    }
                }
            }
        }
        .stateIn(viewModelScope, SharingStarted.Lazily, emptyList())

    private val marks: Flow<EpisodeMarks> = combine(
        progress.progress,
        stars.episodeIds,
        downloads.states,
        playback.state.map { player -> player.episode?.takeIf { player.active }?.let { Current(it.identity.value, player.requested) } }.distinctUntilChanged(),
    ) { progress, starred, entries, current -> EpisodeMarks(progress, starred, entries.mapValues { it.value.state }, current) }

    val state: StateFlow<PodcastScreenState> = combine(podcast, reader.paging, subscription, marks) { podcast, page, (subscribed, subscribing, load), marks ->
        PodcastScreenState(
            podcast, page.episodes, EpisodeOrder(page.query.sort, page.query.direction),
            podcast.identity in subscribed, subscribing, load, marks,
            loadingMore = page.loading,
            pageFailed = page.failed,
            hasMore = page.nextCursor != null,
            retryAt = page.retryAt,
            unplayed = page.query.unplayed,
        )
    }.combine(related) { state, related -> state.copy(related = related) }
        .combine(session.session) { state, session -> state.copy(canFilterUnplayed = !session.loading && session.user != null) }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), PodcastScreenState(route))

    fun refresh() = reader.refresh()
    fun retry() = reader.retry()
    fun loadMore() = reader.loadMore()
    fun suspendReads() = reader.suspendReads()
    fun resumeReads() = reader.resumeReads()

    fun order(order: EpisodeOrder) {
        reader.query(reader.paging.value.query.copy(sort = order.sort, direction = order.direction))
    }

    fun filter(query: String) {
        filter.value = query
        reader.query(reader.paging.value.query.copy(search = query))
    }

    fun unplayed() = reader.query(reader.paging.value.query.let { it.copy(unplayed = !it.unplayed) })

    fun toggleSubscription(onFailure: (Exception) -> Unit) {
        if (subscribing.value) return
        val current = state.value
        subscribing.value = true
        viewModelScope.launch {
            try {
                library.toggle(current.podcast, current.subscribed)
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (error: Exception) {
                onFailure(error)
            } finally {
                subscribing.value = false
            }
        }
    }
}
