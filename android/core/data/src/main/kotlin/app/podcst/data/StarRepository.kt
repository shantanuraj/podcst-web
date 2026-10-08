package app.podcst.data

import android.util.AtomicFile
import app.podcst.model.AccountEpisodeList
import app.podcst.model.AccountLists
import app.podcst.model.validateStateScope
import app.podcst.model.Episode
import app.podcst.model.ListAcknowledgement
import app.podcst.model.ListBatch
import app.podcst.model.ListChange
import app.podcst.model.ListEpisodePage
import app.podcst.model.ListSnapshot
import app.podcst.network.ApiException
import app.podcst.network.PodcstApi
import java.io.File
import java.io.IOException
import java.util.concurrent.atomic.AtomicLong
import kotlin.coroutines.cancellation.CancellationException
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject

interface StarRemote {
    suspend fun accountId(): String?
    suspend fun lists(): AccountLists
    suspend fun membership(id: String): ListSnapshot
    suspend fun episodes(id: String, cursor: String?): ListEpisodePage
    suspend fun change(id: String, batch: ListBatch, accountId: String, generation: String, legacy: Boolean): ListAcknowledgement
}

fun PodcstApi.starRemote(): StarRemote = object : StarRemote {
    override suspend fun accountId() = sessionUser()?.id
    override suspend fun lists() = this@starRemote.lists()
    override suspend fun membership(id: String) = listMembership(id)
    override suspend fun episodes(id: String, cursor: String?) = listEpisodes(id, cursor)
    override suspend fun change(id: String, batch: ListBatch, accountId: String, generation: String, legacy: Boolean) = changeList(id, batch, accountId, generation, legacy)
}

data class StarsState(
    val accountId: String?,
    val items: List<StarItem> = emptyList(),
    val pending: Boolean = false,
    val error: String? = null,
    val ready: Boolean = true,
    val revision: Long = 0,
)

class StarRepository(
    file: File,
    private val remote: StarRemote,
    private val scope: CoroutineScope,
    accountId: String? = null,
    private val clock: () -> Long = System::currentTimeMillis,
    private val io: CoroutineDispatcher = Dispatchers.IO,
    private val write: ((ByteArray) -> Unit)? = null,
) {
    private val file = AtomicFile(file)
    private val migrationSource = AtomicFile(File(file.path + ".migration-source"))
    private val mutex = Mutex()
    private val sender = Mutex()
    private val generation = AtomicLong()
    private var readable = true
    @Volatile private var authenticationPaused = accountId != null
    private var root: Map<String, StarScope> = try {
        if (file.exists() || File(file.path + ".bak").exists()) decode(this.file.readFully()) else emptyMap()
    } catch (_: Exception) { readable = false; emptyMap() }
    private val state = MutableStateFlow(StarsState(accountId, ready = readable && accountId == null, error = if (readable) null else "Saved episodes could not be opened. Pending work has not been reset."))
    val status = state.asStateFlow()
    val starred = status.map { state -> state.items.mapNotNull { it.episode } }.distinctUntilChanged()
    val episodeIds = status.map { state -> state.items.map { it.id }.toSet() }.distinctUntilChanged()
    private var nextAttempt = 0L
    private var lastSync = 0L
    private var attempts = 0

    init { publish(generation.get(), accountId, root[Scope.key(accountId)] ?: StarScope(identityVersion = 2)) }

    suspend fun star(episode: Episode): Boolean = edit(episode.id, ListChange.Operation.Add, episode)
    suspend fun unstar(episode: Episode): Boolean = edit(episode.id, ListChange.Operation.Remove)
    suspend fun remove(id: Long): Boolean = edit(id, ListChange.Operation.Remove)
    suspend fun toggle(episode: Episode): Boolean = edit(episode.id, null, episode)

    private suspend fun edit(id: Long?, operation: ListChange.Operation?, episode: Episode? = null): Boolean {
        val token = generation.get()
        val account = state.value.accountId
        if (!state.value.ready || !validStarId(id)) {
            view(token) { it.copy(error = "A canonical episode ID and an active account scope are required.") }
            return false
        }
        return try {
            change(token, account) { current ->
                val op = operation ?: if (current.project().any { it.id == id }) ListChange.Operation.Remove else ListChange.Operation.Add
                current.enqueue(id!!, op, clock(), episode)
                if (account == null) {
                    val items = current.project()
                    current.queued = items.map { StarIntent(ListChange(ListChange.Operation.Add, it.id), it.membership.addedAt) }
                    current.episodes = items.mapNotNull { item -> item.episode?.let { item.id to it } }.toMap()
                }
            }
            checkCurrent(token)
            scope.launch { refresh() }
            true
        } catch (cancelled: CancellationException) { throw cancelled }
        catch (_: Exception) {
            view(token) { it.copy(error = "Unable to save this change on your device.") }
            false
        }
    }

    fun suspendSync() {
        authenticationPaused = true
        val token = generation.incrementAndGet()
        state.update { it.copy(items = emptyList(), ready = false, revision = token) }
    }

    fun resumeSync(accountId: String?) {
        if (state.value.accountId != accountId) return
        authenticationPaused = false
        scope.launch { refresh() }
    }

    suspend fun switchAccount(accountId: String?, activate: Boolean = false) {
        suspendSync()
        val token = generation.get()
        val old = state.value.accountId
        withContext(io) {
            mutex.withLock {
                val next = root.toMutableMap()
                if (old != null) next[Scope.key(old)]?.let { next[Scope.key(old)] = it.copy(episodes = emptyMap(), snapshot = null) }
                commit(next)
                checkCurrent(token)
                view(token) { StarsState(accountId, ready = readable && activate, revision = token) }
                publish(token, accountId, next[Scope.key(accountId)] ?: StarScope(identityVersion = 2))
            }
        }
        authenticationPaused = !activate
        nextAttempt = 0
    }

    suspend fun checkpoint() = withContext(io) { mutex.withLock { check(readable) } }
    suspend fun erase(accountId: String) = withContext(io) {
        mutex.withLock {
            check(state.value.accountId != accountId) { "Suspend and leave the erased account first" }
            if (migrationSource.baseFile.exists()) {
                val source = json.parseToJsonElement(migrationSource.readFully().decodeToString()).jsonObject
                atomicWrite(migrationSource, JsonObject(source - Scope.key(accountId)).toString().encodeToByteArray())
            }
            commit(root - Scope.key(accountId))
        }
    }

    suspend fun poll() { if (state.value.pending || clock() - lastSync >= 60_000) refresh() }

    suspend fun refresh() {
        if (authenticationPaused || !readable || clock() < nextAttempt || !sender.tryLock()) return
        val token = generation.get()
        val account = state.value.accountId
        try {
            if (account == null) {
                view(token) { it.copy(ready = true) }
                change(token, null) {}
                return
            }
            val confirmed = remote.accountId()
            checkCurrent(token)
            if (confirmed != account) {
                view(token) { it.copy(ready = false, items = emptyList()) }
                change(token, account) { it.episodes = emptyMap(); it.snapshot = null }
                throw IOException("Session changed")
            }
            view(token) { it.copy(ready = true, error = null) }
            withContext(io) {
                mutex.withLock {
                    checkCurrent(token)
                    val next = root.toMutableMap()
                    mergeGuest(next, account)
                    commit(next)
                }
            }
            var current = change(token, account) {}
            if (current.blocked != null) return
            val envelope = remote.lists()
            checkCurrent(token)
            validateStateScope(envelope.protocol, envelope.accountId, envelope.generation, account, current.generation)
            current = change(token, account) {
                it.accountId = account
                it.generation = envelope.generation
                if (it.identityVersion == 1 && it.queued.any { queued -> queued.change.episodeId > 9_007_199_254_740_991L }) it.blocked = 409
                if (it.listId == null) it.listId = envelope.lists.first { list -> list.kind == "starred" }.id
            }
            if (current.blocked != null) return
            val id = checkNotNull(current.listId)
            do {
                checkCurrent(token)
                current = change(token, account) { it.freeze() }
                current.flight?.takeIf { it.legacy || it.acknowledgement == null }?.let { flight ->
                    try {
                        val ack = remote.change(id, flight.batch, account, checkNotNull(current.generation), flight.legacy)
                        checkCurrent(token)
                        change(token, account) { it.acknowledge(ack) }
                    } catch (failure: ApiException) {
                        checkCurrent(token)
                        if (failure.status in listOf(400, 403, 404, 409, 413, 426)) change(token, account) { it.blocked = failure.status }
                        throw failure
                    }
                }
                checkCurrent(token)
                val snapshot = remote.membership(id)
                checkCurrent(token)
                current = change(token, account) { it.install(snapshot) }
            } while (current.queued.isNotEmpty())
            var cursor: String? = null
            val cursors = mutableSetOf<String>()
            do {
                checkCurrent(token)
                val page = remote.episodes(id, cursor)
                checkCurrent(token)
                change(token, account) { it.hydrate(page) }
                cursor = page.nextCursor
                check(cursor == null || cursors.add(cursor))
            } while (cursor != null)
            attempts = 0
            nextAttempt = 0
            lastSync = clock()
        } catch (cancelled: CancellationException) { throw cancelled }
        catch (failure: Exception) {
            if (generation.get() == token) {
                if (failure is IllegalArgumentException || failure is IllegalStateException || failure is ApiException && failure.code == "invalid_response") {
                    runCatching { change(token, account) { it.blocked = 409 } }
                }
                if (failure is ApiException && failure.status in listOf(401, 403)) {
                    authenticationPaused = true
                    view(token) { it.copy(ready = false, items = emptyList()) }
                    runCatching { change(token, account) { it.episodes = emptyMap(); it.snapshot = null } }
                }
                nextAttempt = clock() + ((failure as? ApiException)?.retryAfterSeconds?.coerceIn(1, 86400)?.times(1000) ?: minOf(60_000L, 1000L shl minOf(attempts++, 6)))
                view(token) { it.copy(error = it.error ?: "Star sync paused. Changes remain saved on this device.") }
            }
        } finally { sender.unlock() }
    }

    private suspend fun change(token: Long, account: String?, change: (StarScope) -> Unit): StarScope = withContext(io) {
        mutex.withLock {
            checkCurrent(token)
            val key = Scope.key(account)
            val next = root.toMutableMap()
            val current = next[key]?.copy() ?: StarScope(identityVersion = 2)
            change(current)
            next[key] = current
            commit(next)
            publish(token, account, current)
            current
        }
    }

    private fun decode(bytes: ByteArray): Map<String, StarScope> {
        val raw = json.parseToJsonElement(bytes.decodeToString()).jsonObject
        raw.values.forEach { check(it.jsonObject.keys.containsAll(listOf("clientId", "sequence"))) }
        return json.decodeFromString<Map<String, StarScope>>(bytes.decodeToString()).also { scopes ->
            scopes.forEach { (key, saved) ->
                check(saved.identityVersion in 1..2 && saved.sequence >= 0)
                validateStateScope(1, "stored", saved.clientId, "stored")
                saved.generation?.let { validateStateScope(1, checkNotNull(saved.accountId), it, checkNotNull(saved.accountId)); check(Scope.key(saved.accountId) == key) }
                saved.flight?.let { flight ->
                    check(flight.batch.clientId == saved.clientId && flight.batch.sequence == saved.sequence.toString())
                    check(flight.batch.changes.size in 1..100 && flight.intents.map { it.change } == flight.batch.changes)
                    flight.acknowledgement?.let { ack ->
                        check(ack.clientId == saved.clientId && ack.sequence == flight.batch.sequence && ack.listId == saved.listId)
                        app.podcst.model.StateRevision(ack.revision)
                        check(ack.results.map { it.episodeId } == flight.batch.changes.map { it.episodeId })
                        if (!flight.legacy) validateStateScope(checkNotNull(ack.protocol), checkNotNull(ack.accountId), checkNotNull(ack.generation), checkNotNull(saved.accountId), saved.generation)
                    }
                }
            }
        }
    }

    private fun commit(next: Map<String, StarScope>) {
        check(readable)
        file.baseFile.parentFile?.mkdirs()
        if (!migrationSource.baseFile.exists() && file.baseFile.exists() && root.values.any { it.identityVersion == 1 }) {
            val source = file.readFully()
            decode(source)
            atomicWrite(migrationSource, source)
        }
        val bytes = json.encodeToString(next).encodeToByteArray()
        if (write != null) write.invoke(bytes) else {
            val output = file.startWrite()
            try {
                output.write(bytes)
                output.fd.sync()
                file.finishWrite(output)
                if (!file.readFully().contentEquals(bytes)) throw IOException("Atomic write failed")
            } catch (failure: Exception) { file.failWrite(output); throw failure }
        }
        root = next
        if (migrationSource.baseFile.exists()) {
            val source = json.parseToJsonElement(migrationSource.readFully().decodeToString()).jsonObject
            val retained = source.filterKeys { key -> next[key]?.let { it.identityVersion == 1 || it.flight?.legacy == true } == true }
            if (retained.isEmpty()) migrationSource.delete() else atomicWrite(migrationSource, JsonObject(retained).toString().encodeToByteArray())
        }
    }

    private fun atomicWrite(target: AtomicFile, bytes: ByteArray) {
        val output = target.startWrite()
        try { output.write(bytes); output.fd.sync(); target.finishWrite(output) }
        catch (failure: Exception) { target.failWrite(output); throw failure }
        if (!target.readFully().contentEquals(bytes)) throw IOException("Migration source write failed")
    }

    private fun publish(token: Long, account: String?, current: StarScope) {
        view(token) { previous -> previous.copy(
            accountId = account,
            items = if (previous.ready) current.project() else emptyList(),
            pending = account != null && (current.flight != null || current.queued.isNotEmpty()),
            error = when {
                !readable -> previous.error
                current.blocked != null -> "Star sync needs attention. Pending edits have been kept."
                current.failures.isNotEmpty() -> "${current.failures.size} episode(s) could not be added."
                else -> null
            },
        ) }
    }

    private fun view(token: Long, change: (StarsState) -> StarsState) {
        state.update { if (it.revision == token) change(it) else it }
    }

    private fun checkCurrent(token: Long) { check(generation.get() == token) { "Session changed" } }

    private companion object { val json = Json { encodeDefaults = true } }
}
