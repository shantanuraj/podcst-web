package app.podcst.data

import app.podcst.model.Account
import app.podcst.model.AudioOptions
import app.podcst.network.PodcstApi
import kotlin.coroutines.cancellation.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

class AccountRepository(
    private val api: PodcstApi,
    private val session: SessionRepository,
    private val preferences: Preferences,
) {
    private val state = MutableStateFlow<Account?>(null)
    val account: StateFlow<Account?> = state.asStateFlow()

    private var synced: AudioOptions? = null
    private var pending = false

    fun start(scope: CoroutineScope) {
        scope.launch {
            var current: String? = null
            session.session.map { it.user?.id to it.loading }.distinctUntilChanged().collect { (accountId, loading) ->
                if (accountId != current) {
                    current = accountId
                    state.value = null
                    synced = null
                    pending = false
                }
                if (accountId != null && !loading) attempt { load(accountId) }
            }
        }
        scope.launch {
            preferences.audio.map { it.defaults }.distinctUntilChanged().collect { defaults ->
                if (synced != null && defaults != synced) attempt { push(defaults) }
            }
        }
    }

    suspend fun removePasskey(id: String) {
        val accountId = session.user?.id ?: return
        api.removePasskey(id)
        if (session.user?.id == accountId) {
            state.update { account -> account?.copy(passkeys = account.passkeys.filterNot { it.id == id }) }
            session.restore()
        }
    }

    private suspend fun load(accountId: String) {
        val account = api.account()
        if (session.user?.id != accountId) return
        state.value = account
        val server = account.preferences
        if (server == null || pending) push(preferences.audioSettings().defaults)
        else {
            synced = server
            preferences.updateAudio { it.with(server) }
        }
    }

    private suspend fun push(defaults: AudioOptions) {
        val accountId = session.user?.id ?: return
        pending = true
        val saved = api.savePreferences(defaults)
        if (session.user?.id != accountId) return
        pending = false
        synced = saved
        state.update { it?.copy(preferences = saved) }
    }

    private suspend fun attempt(block: suspend () -> Unit) {
        try {
            block()
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (_: Exception) {
        }
    }
}
