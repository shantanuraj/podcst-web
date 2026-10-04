package app.podcst.feature.discover

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.podcst.data.CatalogRepository
import app.podcst.data.Preferences
import app.podcst.data.SessionRepository
import app.podcst.model.Podcast
import app.podcst.model.Region
import kotlin.coroutines.cancellation.CancellationException
import kotlin.time.Duration.Companion.milliseconds
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.transformLatest
import kotlinx.coroutines.launch

private val feedPattern = Regex("^(https?:|[a-z][a-z0-9+.-]*://)", RegexOption.IGNORE_CASE)

internal val searchDebounce = 300.milliseconds

internal fun isFeedUrl(term: String): Boolean = feedPattern.containsMatchIn(term)

internal fun recentTerm(query: String): String? = query.trim().takeUnless { it.isEmpty() || isFeedUrl(it) }

sealed interface SearchOutcome {
    data object Idle : SearchOutcome
    data object Searching : SearchOutcome
    data class Found(val podcasts: List<Podcast>) : SearchOutcome
    data class Failed(val message: String?) : SearchOutcome
}

internal data class SearchRequest(val term: String, val region: Region, val user: String?, val loading: Boolean) {
    val ready: Boolean get() = term.isNotEmpty() && !loading && (user != null || !isFeedUrl(term))
}

internal fun searches(requests: Flow<SearchRequest>, search: suspend (String, Region) -> List<Podcast>): Flow<SearchOutcome> =
    requests.distinctUntilChanged().transformLatest { request ->
        emit(SearchOutcome.Idle)
        delay(searchDebounce)
        if (!request.ready) return@transformLatest
        emit(SearchOutcome.Searching)
        emit(
            try {
                SearchOutcome.Found(search(request.term, request.region))
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (failure: Exception) {
                SearchOutcome.Failed(failure.message)
            },
        )
    }

data class SearchState(
    val outcome: SearchOutcome = SearchOutcome.Idle,
    val recent: List<String> = emptyList(),
    val signedIn: Boolean = false,
)

class SearchViewModel(
    catalog: CatalogRepository,
    private val preferences: Preferences,
    session: SessionRepository,
) : ViewModel() {
    var query by mutableStateOf("")

    val state: StateFlow<SearchState> = combine(
        searches(
            combine(snapshotFlow { query.trim() }, preferences.region, session.session) { term, region, current ->
                SearchRequest(term, region, current.user?.id, current.loading)
            },
            catalog::search,
        ),
        preferences.recentSearches,
        session.session,
    ) { outcome, recent, current -> SearchState(outcome, recent, current.user != null) }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), SearchState(signedIn = session.user != null))

    fun remember() {
        val term = recentTerm(query) ?: return
        viewModelScope.launch { preferences.remember(term) }
    }

    fun clearRecent() {
        viewModelScope.launch { preferences.clearRecent() }
    }
}
