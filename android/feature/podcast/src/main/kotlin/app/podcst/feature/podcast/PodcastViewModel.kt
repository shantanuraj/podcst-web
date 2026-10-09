package app.podcst.feature.podcast

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.podcst.data.CatalogRepository
import app.podcst.data.LibraryRepository
import app.podcst.data.ProgressRepository
import app.podcst.data.StarRepository
import app.podcst.designsystem.EpisodeRowState
import app.podcst.model.DownloadState
import app.podcst.model.Episode
import app.podcst.model.EpisodeProgress
import app.podcst.model.Podcast
import app.podcst.network.ApiException
import app.podcst.model.ShowNotes
import app.podcst.playback.PlaybackCoordinator
import app.podcst.playback.media.Downloads
import app.podcst.playback.media.MediaStore
import java.text.Collator
import kotlin.coroutines.cancellation.CancellationException
import kotlin.time.Instant
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOn
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

enum class LoadState { Loading, Refreshing, Loaded, Failed }

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
) {
    val latest: Episode? by lazy { podcast.episodes.maxByOrNull { it.published ?: Instant.DISTANT_PAST } }
    val updated: Instant? get() = listOfNotNull(podcast.published, latest?.published).maxOrNull()
    val count: Int get() = maxOf(podcast.episodeCount, podcast.episodes.size)
    val description: String by lazy { ShowNotes.plainText(podcast.description).replace(whitespace, " ").trim() }

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
) : ViewModel() {
    private val source = MutableStateFlow(route)
    private val inaccessible = MutableStateFlow(false)
    private val load = MutableStateFlow(LoadState.Loading)
    private val subscribing = MutableStateFlow(false)
    private val order = MutableStateFlow(EpisodeOrder())
    private val filter = MutableStateFlow("")
    private var loading: Job? = null

    val query: StateFlow<String> = filter.asStateFlow()

    private val podcast: StateFlow<Podcast> = combine(
        source.map { it.feed }.distinctUntilChanged().flatMapLatest { feed -> catalog.podcast(feed) },
        source,
        inaccessible,
    ) { stored, fallback, denied -> if (denied) Podcast(id = fallback.id, feed = "", title = "Podcast unavailable", isPrivate = fallback.isPrivate) else stored?.copy(freshness = stored.freshness ?: fallback.freshness) ?: fallback }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), route)

    private val episodes: Flow<List<Episode>> = combine(podcast.map { it.episodes }.distinctUntilChanged(), order, filter) { episodes, order, query ->
        episodes.arranged(order, query, Collator.getInstance())
    }.flowOn(Dispatchers.Default)

    private val subscription = combine(library.subscribed, subscribing, load, ::Triple)

    private val marks: Flow<EpisodeMarks> = combine(
        progress.progress,
        stars.episodeIds,
        downloads.states,
        playback.state.map { player -> player.episode?.takeIf { player.active }?.let { Current(it.identity.value, player.requested) } }.distinctUntilChanged(),
    ) { progress, starred, entries, current -> EpisodeMarks(progress, starred, entries.mapValues { it.value.state }, current) }

    val state: StateFlow<PodcastScreenState> = combine(podcast, episodes, order, subscription, marks) { podcast, episodes, order, (subscribed, subscribing, load), marks ->
        PodcastScreenState(podcast, episodes, order, podcast.identity in subscribed, subscribing, load, marks)
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), PodcastScreenState(route))

    init {
        fetch(force = false)
    }

    fun refresh() { if ((source.value.freshness?.retryAtMs ?: 0) <= System.currentTimeMillis()) fetch(force = true) }

    fun retry() { if ((source.value.freshness?.retryAtMs ?: 0) <= System.currentTimeMillis()) fetch(force = false) }

    fun suspendReads() { loading?.cancel(); load.value = LoadState.Loaded }

    fun order(order: EpisodeOrder) {
        this.order.value = order
    }

    fun filter(query: String) {
        filter.value = query
    }

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

    private fun fetch(force: Boolean) {
        loading?.cancel()
        val active = catalog.readerActive()
        loading = viewModelScope.launch {
            val startedAt = System.currentTimeMillis()
            load.value = if (force) LoadState.Refreshing else LoadState.Loading
            load.value = try {
                if (!active()) throw CancellationException("Account changed")
                source.value = catalog.load(source.value, force, recheck = true)
                inaccessible.value = false
                load.value = LoadState.Loaded
                while (active()) {
                    val wait = source.value.freshness?.recheckDelay(startedAt) ?: break
                    delay(wait)
                    if (!active()) throw CancellationException("Account changed")
                    source.value = catalog.load(source.value, recheck = true)
                }
                LoadState.Loaded
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (error: Exception) {
                if (error is ApiException && error.status in listOf(401, 403, 404)) inaccessible.value = true
                LoadState.Failed
            }
        }
    }
}
