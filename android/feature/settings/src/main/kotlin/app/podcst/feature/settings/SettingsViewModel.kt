package app.podcst.feature.settings

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.podcst.data.AccountRepository
import app.podcst.data.Appearance
import app.podcst.data.LibraryRepository
import app.podcst.data.Preferences
import app.podcst.data.SessionRepository
import app.podcst.model.AudioOptions
import app.podcst.model.ImportResult
import app.podcst.model.Opml
import app.podcst.model.Passkey
import app.podcst.model.Region
import app.podcst.model.User
import kotlin.coroutines.cancellation.CancellationException
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

data class SettingsState(
    val user: User? = null,
    val appearance: Appearance = Appearance.System,
    val region: Region? = null,
    val audio: AudioOptions = AudioOptions(),
    val passkeys: List<Passkey> = emptyList(),
    val subscribed: Boolean = false,
    val importing: Boolean = false,
)

sealed interface SettingsEvent {
    data class Imported(val result: ImportResult) : SettingsEvent
    data class Failed(val message: String?) : SettingsEvent
    data object SignedOut : SettingsEvent
}

class SettingsViewModel(
    private val session: SessionRepository,
    private val preferences: Preferences,
    private val library: LibraryRepository,
    private val account: AccountRepository,
) : ViewModel() {
    private val importing = MutableStateFlow(false)
    private val channel = Channel<SettingsEvent>(Channel.BUFFERED)
    val events: Flow<SettingsEvent> = channel.receiveAsFlow()

    val state: StateFlow<SettingsState> = combine(
        combine(session.session.map { it.user }, preferences.appearance, preferences.region, preferences.audio.map { it.defaults }) { user, appearance, region, audio ->
            SettingsState(user, appearance, region, audio)
        },
        library.subscribed.map { it.isNotEmpty() },
        account.account.map { it?.passkeys.orEmpty() },
        importing,
    ) { state, subscribed, passkeys, importing -> state.copy(subscribed = subscribed, passkeys = passkeys, importing = importing) }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), SettingsState(user = session.user))

    fun setAppearance(value: Appearance) {
        viewModelScope.launch { preferences.setAppearance(value) }
    }

    fun setRegion(value: Region) {
        viewModelScope.launch { preferences.setRegion(value) }
    }

    fun setSpeed(value: Double) = updateDefaults { it.copy(speed = value) }

    fun setVolumeBoost(on: Boolean) = updateDefaults { it.copy(effects = it.effects.copy(volumeBoost = on)) }

    fun setTrimSilence(on: Boolean) = updateDefaults { it.copy(effects = it.effects.copy(trimSilence = on)) }

    fun addPasskey(create: suspend (String) -> String) {
        viewModelScope.launch {
            if (!session.registerPasskey(create)) channel.send(SettingsEvent.Failed(session.session.value.error))
        }
    }

    fun removePasskey(id: String) {
        viewModelScope.launch {
            try {
                account.removePasskey(id)
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (failure: Exception) {
                channel.send(SettingsEvent.Failed(failure.message))
            }
        }
    }

    fun signOut() {
        viewModelScope.launch {
            session.signOut()
            channel.send(SettingsEvent.SignedOut)
        }
    }

    fun importScope(): () -> Boolean = library.importScope()

    fun import(document: String, current: () -> Boolean = importScope()) {
        if (importing.value) return
        importing.value = true
        viewModelScope.launch {
            val event = try {
                check(current()) { "Account changed. Select the file again." }
                val feeds = Opml.feeds(document)
                check(current()) { "Account changed. Select the file again." }
                val result = library.import(feeds, current)
                if (!current()) throw CancellationException("Account changed")
                SettingsEvent.Imported(result)
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (failure: Exception) {
                SettingsEvent.Failed(failure.message)
            } finally {
                importing.value = false
            }
            channel.send(event)
        }
    }

    suspend fun opml(): String = library.opml()

    private fun updateDefaults(transform: (AudioOptions) -> AudioOptions) {
        viewModelScope.launch { preferences.updateAudio { it.with(transform(it.defaults)) } }
    }
}
