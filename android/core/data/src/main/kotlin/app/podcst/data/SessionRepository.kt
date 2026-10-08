package app.podcst.data

import android.content.Context
import app.podcst.model.User
import app.podcst.network.ApiException
import app.podcst.network.PodcstApi
import java.io.File
import kotlin.coroutines.cancellation.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.json.Json

data class SessionState(
    val user: User? = null,
    val loading: Boolean = true,
    val error: String? = null,
)

fun interface AccountChange {
    suspend fun prepare(accountId: String?)
}

class SessionRepository(context: Context, private val api: PodcstApi) {
    private val file = File(context.noBackupFilesDir, "session.json")
    private val mutex = Mutex()
    private val state = MutableStateFlow(SessionState(user = cachedUser()))
    val session: StateFlow<SessionState> = state.asStateFlow()
    val user: User? get() = state.value.user
    private var verified = false
    private var prepared = false
    var checkpointAccountWork: (suspend () -> Unit)? = null
    var accountChange: AccountChange? = null
    var suspendAccountWork: (() -> Unit)? = null
    var resumeAccountWork: ((String?) -> Unit)? = null

    suspend fun restore() = mutex.withLock {
        verified = false
        suspendAccountWork?.invoke()
        state.update { it.copy(loading = true) }
        try {
            update(api.sessionUser())
            verified = true
            if (state.value.user == null) api.clearSession()
            state.update { it.copy(error = null) }
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (failure: Exception) {
            if (failure is ApiException && failure.status in listOf(401, 403)) {
                update(null)
                api.clearSession()
            }
            state.update { it.copy(error = failure.message) }
        } finally {
            state.update { it.copy(loading = false) }
            if (verified) resumeAccountWork?.invoke(state.value.user?.id) else suspendAccountWork?.invoke()
        }
    }

    suspend fun sendCode(email: String): Boolean = attempt { api.sendCode(email) }

    suspend fun signIn(email: String, code: String): Boolean = changing { api.signIn(email, code) }

    suspend fun signInWithPasskey(email: String?, authenticate: suspend (String) -> String): Boolean = changing {
        val challenge = api.passkeyChallenge()
        api.signInWithPasskey(authenticate(challenge.requestJson), challenge)
    }

    suspend fun registerPasskey(create: suspend (String) -> String): Boolean = attempt {
        val challenge = api.passkeyRegistration()
        api.registerPasskey(create(challenge.requestJson), challenge)
        mutex.withLock { update(api.sessionUser()) }
    }

    suspend fun signOut() = mutex.withLock {
        checkpointAccountWork?.invoke()
        suspendAccountWork?.invoke()
        state.update { it.copy(loading = true) }
        try {
            update(null)
            verified = true
            api.signOut()
            state.update { it.copy(error = null) }
        } finally {
            state.update { it.copy(loading = false) }
            if (verified) resumeAccountWork?.invoke(state.value.user?.id) else suspendAccountWork?.invoke()
        }
    }

    fun dismissError() = state.update { it.copy(error = null) }

    private suspend fun changing(block: suspend () -> User?): Boolean = mutex.withLock {
        checkpointAccountWork?.invoke()
        suspendAccountWork?.invoke()
        verified = false
        state.update { it.copy(loading = true) }
        try {
            update(block())
            verified = true
            state.update { it.copy(error = null) }
            state.value.user != null
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (failure: Exception) {
            state.update { it.copy(error = failure.message) }
            false
        } finally {
            state.update { it.copy(loading = false) }
            if (verified) resumeAccountWork?.invoke(state.value.user?.id) else suspendAccountWork?.invoke()
        }
    }

    private suspend fun attempt(block: suspend () -> Unit): Boolean = try {
        block()
        state.update { it.copy(error = null) }
        true
    } catch (cancelled: CancellationException) {
        throw cancelled
    } catch (failure: Exception) {
        state.update { it.copy(error = failure.message) }
        false
    }

    private suspend fun update(value: User?) {
        if (!prepared || state.value.user?.id != value?.id) {
            file.delete()
            accountChange?.prepare(value?.id)
            prepared = true
        }
        state.update { it.copy(user = value) }
        if (value != null) file.writeText(json.encodeToString(User.serializer(), value)) else file.delete()
    }

    private fun cachedUser(): User? =
        if (!api.hasSession) null else runCatching { json.decodeFromString(User.serializer(), file.readText()) }.getOrNull()

    private companion object {
        val json = Json { ignoreUnknownKeys = true }
    }
}
