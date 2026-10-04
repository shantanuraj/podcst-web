package app.podcst.feature.library

import app.podcst.model.EpisodeList

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.podcst.data.CatalogRepository
import app.podcst.data.LibraryRepository
import app.podcst.data.ProgressRepository
import app.podcst.data.StarRepository
import app.podcst.designsystem.EpisodeRowState
import app.podcst.model.Episode
import app.podcst.playback.PlaybackCoordinator
import app.podcst.playback.media.DownloadEntry
import app.podcst.playback.media.Downloads
import kotlin.time.Clock
import kotlin.time.Instant
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.flowOn
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update

data class EpisodeListState(
    val list: EpisodeList,
    val rows: List<EpisodeRowState> = emptyList(),
    val filter: ListFilter = ListFilter.All,
    val sort: ListSort = ListSort.Recent,
    val storage: Storage? = null,
    val refresh: Refresh = Refresh.Idle,
    val loaded: Boolean = false,
) {
    val facets: List<FacetCount> by lazy { facets(rows) }
    val selected: FacetCount? by lazy { facets.firstOrNull { it.filter == filter } ?: facets.firstOrNull() }
    val visible: List<EpisodeRowState> by lazy { sort.apply(rows.filter((selected?.filter ?: ListFilter.All)::matches)) }
}

class EpisodeListViewModel(
    private val list: EpisodeList,
    catalog: CatalogRepository,
    private val library: LibraryRepository,
    progress: ProgressRepository,
    stars: StarRepository,
    private val downloads: Downloads,
    private val playback: PlaybackCoordinator,
    storage: () -> Storage,
    clock: () -> Instant = Clock.System::now,
) : ViewModel() {
    private data class Selection(val filter: ListFilter = ListFilter.All, val sort: ListSort = ListSort.Recent)

    private val selection = MutableStateFlow(Selection())
    private val refresh = MutableStateFlow(Refresh.Idle)

    private val source: Flow<List<Episode>> = when (list) {
        EpisodeList.Starred -> stars.starred
        EpisodeList.NewReleases -> library.newReleases
        EpisodeList.Downloads -> combine(
            downloads.states,
            downloads.states
                .map { entries -> entries.values.map(DownloadEntry::identity).sorted() }
                .distinctUntilChanged()
                .flatMapLatest(catalog::episodes),
        ) { entries, episodes -> downloaded(entries.values, episodes) }
    }

    private val storage: Flow<Storage?> =
        if (list == EpisodeList.Downloads) downloads.states.map { storage() }.flowOn(Dispatchers.IO) else flowOf(null)

    val state: StateFlow<EpisodeListState> = combine(
        source,
        listening(progress, stars, downloads, playback, clock),
        selection,
        this.storage,
        refresh,
    ) { episodes, listening, selection, storage, refresh ->
        EpisodeListState(list, episodes.map(listening::row), selection.filter, selection.sort, storage, refresh, loaded = true)
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), EpisodeListState(list))

    fun select(filter: ListFilter) = selection.update { it.copy(filter = filter) }

    fun sort(sort: ListSort) = selection.update { it.copy(sort = sort) }

    fun refresh() = viewModelScope.refresh(refresh) { library.refresh(force = true) }

    fun playAll() {
        val rows = state.value.visible
        val first = rows.firstOrNull() ?: return
        playback.play(first.episode, first.progress?.takeIf { it.started }?.position)
        rows.drop(1).asReversed().forEach { playback.enqueue(it.episode, next = true) }
    }

    fun enqueueAll(): Int {
        val rows = state.value.visible
        rows.forEach { playback.enqueue(it.episode) }
        return rows.size
    }

    fun pause(episode: Episode) = downloads.pause(episode)

    fun resume(episode: Episode) = downloads.resume(episode)
}
