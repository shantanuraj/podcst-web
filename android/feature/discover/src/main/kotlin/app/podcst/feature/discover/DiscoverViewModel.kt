package app.podcst.feature.discover

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.podcst.data.CatalogRepository
import app.podcst.data.LibraryRepository
import app.podcst.data.Preferences
import app.podcst.data.SessionRepository
import app.podcst.model.Podcast
import app.podcst.model.Region
import app.podcst.model.User
import kotlin.coroutines.cancellation.CancellationException
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.onStart
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

enum class ChartLoad { Loading, Loaded, Failed }

data class RankedPodcast(val rank: Int, val podcast: Podcast)

data class DiscoverState(
    val region: Region = Region.DEFAULT,
    val chart: List<Podcast> = emptyList(),
    val load: ChartLoad = ChartLoad.Loading,
    val subscribed: Set<String> = emptySet(),
    val user: User? = null,
) {
    val featured: Podcast? = chart.firstOrNull()
    val ranked: List<RankedPodcast> = chart.drop(1).mapIndexed { index, podcast -> RankedPodcast(index + 2, podcast) }
    val refreshing: Boolean = load == ChartLoad.Loading && chart.isNotEmpty()
    val initial: String? = user?.let { (it.name?.takeIf(String::isNotBlank) ?: it.email).firstOrNull()?.lowercase() }

    fun subscribed(podcast: Podcast): Boolean = podcast.identity in subscribed
}

class DiscoverViewModel(
    private val catalog: CatalogRepository,
    private val library: LibraryRepository,
    preferences: Preferences,
    session: SessionRepository,
) : ViewModel() {
    private val load = MutableStateFlow(ChartLoad.Loading)
    private val requests = MutableSharedFlow<Boolean>(extraBufferCapacity = 1)
    private val failures = Channel<String?>(Channel.BUFFERED)
    val subscriptionFailures: Flow<String?> = failures.receiveAsFlow()

    val state: StateFlow<DiscoverState> = combine(
        preferences.region.flatMapLatest { region -> catalog.chart(region).map { region to it } },
        load,
        library.subscribed,
        session.session,
    ) { (region, chart), load, subscribed, current ->
        DiscoverState(region, chart, load, subscribed, current.user)
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), DiscoverState(user = session.user))

    init {
        viewModelScope.launch {
            combine(preferences.region, session.session.map { it.user?.id }.distinctUntilChanged()) { region, _ -> region }
                .flatMapLatest { region -> requests.onStart { emit(false) }.map { force -> region to force } }
                .collectLatest { (region, force) -> refresh(region, force) }
        }
    }

    fun refresh() {
        requests.tryEmit(true)
    }

    fun toggle(podcast: Podcast) {
        val subscribed = state.value.subscribed(podcast)
        viewModelScope.launch {
            try {
                library.toggle(podcast, subscribed)
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (failure: Exception) {
                failures.send(failure.message)
            }
        }
    }

    private suspend fun refresh(region: Region, force: Boolean) {
        load.value = ChartLoad.Loading
        load.value = try {
            catalog.refreshChart(region, force)
            ChartLoad.Loaded
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (failure: Exception) {
            ChartLoad.Failed
        }
    }
}
