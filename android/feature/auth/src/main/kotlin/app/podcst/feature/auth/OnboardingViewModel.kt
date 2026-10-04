package app.podcst.feature.auth

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.podcst.data.CatalogRepository
import app.podcst.data.Preferences
import app.podcst.data.SessionRepository
import app.podcst.model.Region
import kotlin.coroutines.cancellation.CancellationException
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

data class OnboardingState(
    val region: Region? = null,
    val covers: List<String> = emptyList(),
    val working: Boolean = false,
    val error: String? = null,
)

@OptIn(ExperimentalCoroutinesApi::class)
class OnboardingViewModel(
    private val catalog: CatalogRepository,
    private val preferences: Preferences,
    private val session: SessionRepository,
) : ViewModel() {
    private val working = MutableStateFlow(false)

    private val chart = preferences.region.flatMapLatest { region ->
        catalog.chart(region).map { podcasts -> region to podcasts.map { it.cover }.filter(String::isNotEmpty) }
    }

    val state: StateFlow<OnboardingState> = combine(chart, working, session.session) { (region, covers), working, session ->
        OnboardingState(region, covers, working, session.error)
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), OnboardingState())

    init {
        viewModelScope.launch {
            preferences.region.collectLatest { region ->
                try {
                    catalog.refreshChart(region)
                } catch (cancelled: CancellationException) {
                    throw cancelled
                } catch (failure: Exception) {
                    Unit
                }
            }
        }
    }

    fun setRegion(region: Region) {
        viewModelScope.launch { preferences.setRegion(region) }
    }

    fun start() {
        viewModelScope.launch { preferences.setOnboarded() }
    }

    fun signIn(authenticate: suspend (String) -> String) {
        if (working.value) return
        working.value = true
        viewModelScope.launch {
            try {
                if (session.signInWithPasskey(null, authenticate)) preferences.setOnboarded()
            } finally {
                working.value = false
            }
        }
    }
}
