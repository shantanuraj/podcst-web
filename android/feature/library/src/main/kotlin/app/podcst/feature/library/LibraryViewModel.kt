package app.podcst.feature.library

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.podcst.data.GuestProgressSelection
import app.podcst.data.LibraryRepository
import app.podcst.data.ProgressRepository
import app.podcst.data.StarRepository
import app.podcst.designsystem.EpisodeRowState
import app.podcst.model.Episode
import app.podcst.model.Podcast
import app.podcst.playback.PlaybackCoordinator
import app.podcst.playback.media.Downloads
import kotlin.time.Clock
import kotlin.time.Instant
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.stateIn

data class LibraryState(
    val podcasts: List<Podcast> = emptyList(),
    val fresh: Set<String> = emptySet(),
    val episodes: List<EpisodeRowState> = emptyList(),
    val starred: Int = 0,
    val downloads: Int = 0,
    val refresh: Refresh = Refresh.Idle,
    val loaded: Boolean = false,
    val unavailable: List<Long> = emptyList(),
    val legacyProgress: List<Episode> = emptyList(),
    val guestProgress: List<GuestProgressSelection> = emptyList(),
)

class LibraryViewModel(
    private val library: LibraryRepository,
    private val progress: ProgressRepository,
    stars: StarRepository,
    downloads: Downloads,
    playback: PlaybackCoordinator,
    clock: () -> Instant = Clock.System::now,
) : ViewModel() {
    private val refresh = MutableStateFlow(Refresh.Idle)

    val state: StateFlow<LibraryState> = combine(
        library.podcasts,
        library.newReleases,
        progress.unfinished,
        listening(progress, stars, downloads, playback, clock),
        refresh,
        ::library,
    ).combine(library.unavailable) { state, unavailable -> state.copy(unavailable = unavailable) }.combine(progress.legacyProgress) { state, legacy -> state.copy(legacyProgress = legacy) }.combine(progress.guestProgress) { state, guest -> state.copy(guestProgress = guest) }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), LibraryState())

    init {
        refresh(force = false)
    }

    fun refresh(force: Boolean = true) = viewModelScope.refresh(refresh) {
        library.refresh(force)
        progress.refresh(library.newReleases.first())
    }

    fun transferGuestProgress(selection: GuestProgressSelection) = viewModelScope.refresh(refresh) { progress.transferGuestProgress(selection) }

    fun removeUnavailable(id: Long) = viewModelScope.refresh(refresh) { library.removeUnavailable(id) }

    fun refreshProgress() = viewModelScope.refresh(refresh) {
        progress.refresh(library.newReleases.first())
    }
}

internal fun library(
    podcasts: List<Podcast>,
    releases: List<Episode>,
    unfinished: List<Episode>,
    listening: Listening,
    refresh: Refresh,
) = LibraryState(
    podcasts = podcasts,
    fresh = releases.filter(listening::fresh).mapTo(mutableSetOf()) { it.feed },
    episodes = continueAndNew(unfinished, releases, listening.progress).map(listening::row),
    starred = listening.starred.size,
    downloads = listening.downloads.size,
    refresh = refresh,
    loaded = true,
)
