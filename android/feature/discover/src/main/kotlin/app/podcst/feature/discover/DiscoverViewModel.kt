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
import kotlinx.coroutines.flow.distinctUntilChangedBy
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.onStart
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.flow.shareIn
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
    val featuredInfo: Podcast? = null,
) {
    val featured: Podcast? = chart.firstOrNull()?.let { first -> featuredInfo?.takeIf { it.identity == first.identity } ?: first }
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
    private data class FeaturedRequest(val identity: String?, val region: Region, val accountId: String?, val loading: Boolean)
    private data class FeaturedInfo(val request: FeaturedRequest, val podcast: Podcast)

    private val load = MutableStateFlow(ChartLoad.Loading)
    private val requests = MutableSharedFlow<Boolean>(extraBufferCapacity = 1)
    private val failures = Channel<String?>(Channel.BUFFERED)
    val subscriptionFailures: Flow<String?> = failures.receiveAsFlow()

    private val chart = preferences.region.flatMapLatest { region -> catalog.chart(region).map { region to it } }
        .shareIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), replay = 1)

    private val featuredInfo = combine(chart, session.session) { (region, chart), current ->
        FeaturedRequest(chart.firstOrNull()?.identity, region, current.user?.id, current.loading) to chart.firstOrNull()
    }.distinctUntilChangedBy { it.first }.flatMapLatest { (request, podcast) ->
        flow<FeaturedInfo?> {
            emit(null)
            if (!request.loading && podcast != null) {
                try {
                    emit(FeaturedInfo(request, catalog.info(podcast)))
                } catch (cancelled: CancellationException) {
                    throw cancelled
                } catch (_: Exception) {
                    emit(null)
                }
            }
        }
    }.stateIn(viewModelScope, SharingStarted.Lazily, null)

    val state: StateFlow<DiscoverState> = combine(
        chart,
        load,
        library.subscribed,
        session.session,
        featuredInfo,
    ) { (region, chart), load, subscribed, current, info ->
        val request = FeaturedRequest(chart.firstOrNull()?.identity, region, current.user?.id, current.loading)
        DiscoverState(region, chart, load, subscribed, current.user, info?.takeIf { it.request == request }?.podcast)
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
