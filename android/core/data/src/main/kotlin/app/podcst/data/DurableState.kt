package app.podcst.data

import android.util.AtomicFile
import app.podcst.model.*
import java.io.File
import java.io.IOException
import java.util.UUID
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject

@Serializable
internal data class ProgressFlight(val batch: StateBatch<StateProgressChange>, val ack: StateAcknowledgement<StateProgressResult>? = null)
@Serializable
internal data class FollowFlight(val batch: StateBatch<StateFollowChange>, val ack: StateAcknowledgement<StateFollowResult>? = null)

internal data class ProgressProjection(val positionSeconds: Int, val completed: Boolean)

@Serializable
internal data class DurableAccount(
    val generation: String? = null,
    val progressClient: String = UUID.randomUUID().toString(),
    val followClient: String = UUID.randomUUID().toString(),
    val progressSequence: Long = 0,
    val followSequence: Long = 0,
    val progressRevision: Long = 0,
    val followRevision: Long = 0,
    val progress: Map<Long, StateProgress?> = emptyMap(),
    val follows: List<StateFollowItem> = emptyList(),
    val progressCompletion: Map<Long, Boolean> = emptyMap(),
    val progressQueued: List<StateProgressChange> = emptyList(),
    val followQueued: List<StateFollowChange> = emptyList(),
    val progressFlight: ProgressFlight? = null,
    val followFlight: FollowFlight? = null,
    val progressBlocked: String? = null,
    val followBlocked: String? = null,
    val guestProgressTransfers: Map<String, GuestProgressSource> = emptyMap(),
    val reappliedLegacy: Map<String, Long> = emptyMap(),
    val importFeeds: List<String> = emptyList(),
    val importRetryAt: Map<String, Long> = emptyMap(),
    val failures: Set<String> = emptySet(),
) {
    fun progressOverlay(): Map<Long, ProgressProjection> {
        val result = mutableMapOf<Long, ProgressProjection>()
        for (change in progressFlight?.batch?.changes.orEmpty() + progressQueued) {
            val id = change.episodeId.value.toLong()
            val previous = result[id]?.completed ?: progress[id]?.completed ?: progressCompletion[id] ?: false
            result[id] = ProgressProjection(change.positionSeconds, change.completed ?: previous)
        }
        return result
    }
    fun followed(): Set<Long> {
        val result = follows.mapTo(mutableSetOf()) { it.podcastId.value.toLong() }
        for (change in followFlight?.batch?.changes.orEmpty() + followQueued) {
            if (change.followed) result.add(change.podcastId.value.toLong()) else result.remove(change.podcastId.value.toLong())
        }
        return result
    }
    val pending: Boolean get() = progressFlight != null || followFlight != null || progressQueued.isNotEmpty() || followQueued.isNotEmpty()
}

@Serializable
private data class DurableRoot(val version: Int = 1, val accounts: Map<String, DurableAccount> = emptyMap(), val guestFollows: Map<String, Podcast> = emptyMap(), val guestImported: Boolean = false, val guestImportFeeds: List<String> = emptyList())

data class DurableStatus(val pending: Boolean = false, val error: String? = null, val blocked: Boolean = false)

class DurableState(file: File, private val writer: ((ByteArray) -> Unit)? = null) {
    private val file = AtomicFile(file)
    private val json = Json { encodeDefaults = true; explicitNulls = true }
    private var readable = true
    private var root = try {
        if (this.file.baseFile.exists() || File(file.path + ".bak").exists()) decode(this.file.readFully())
        else DurableRoot()
    } catch (_: Exception) { readable = false; DurableRoot() }
    private val changes = MutableStateFlow(0L)
    val revision = changes.asStateFlow()
    private val errors = mutableMapOf<String?, String>()
    private var visible: String? = null
    private val state = MutableStateFlow(DurableStatus(error = if (readable) null else "Saved state cannot be opened. Source data has been preserved.", blocked = !readable))
    val status = state.asStateFlow()

    @Synchronized internal fun account(id: String): DurableAccount { check(readable) { "Saved state is unreadable" }; return root.accounts[id] ?: DurableAccount() }
    @Synchronized fun activate(account: String?) { visible = account; publish() }
    @Synchronized fun error(account: String?, message: String) { errors[account] = message; publish() }
    @Synchronized fun clearError(account: String?) { errors.remove(account); publish() }

    @Synchronized internal fun change(id: String, transform: (DurableAccount) -> DurableAccount): DurableAccount {
        val next = transform(account(id))
        commit(root.copy(accounts = root.accounts + (id to next)))
        return next
    }

    @Synchronized fun guestFollow(podcast: Podcast, followed: Boolean) {
        commit(root.copy(guestFollows = if (followed) root.guestFollows + (podcast.feed to podcast) else root.guestFollows - podcast.feed))
    }
    @Synchronized fun importGuestSource(podcasts: List<Podcast>) {
        if (!root.guestImported) commit(root.copy(guestImported = true, guestFollows = podcasts.associateBy { it.feed } + root.guestFollows))
    }
    @Synchronized fun guestFollows(): List<Podcast> { check(readable); return root.guestFollows.values.toList() }

    @Synchronized fun guestImportFeeds(): List<String> { check(readable); return root.guestImportFeeds }
    @Synchronized fun queueGuestImports(feeds: List<String>) {
        val merged = (root.guestImportFeeds + feeds).distinct()
        check(merged.size <= FeedLimits.PENDING_PER_SCOPE || merged.size == root.guestImportFeeds.size) { "Too many unresolved imports. Retry pending feeds first." }
        commit(root.copy(guestImportFeeds = merged))
    }
    @Synchronized fun completeGuestImport(feed: String, podcast: Podcast) {
        check(!podcast.isPrivate)
        commit(root.copy(guestFollows = root.guestFollows + (podcast.feed to podcast), guestImportFeeds = root.guestImportFeeds - feed))
    }

    @Synchronized fun unionGuest(account: String, resolved: List<Podcast>) {
        var target = account(account)
        val consumed = mutableSetOf<String>()
        for (podcast in resolved) {
            if (podcast.feed !in root.guestFollows || podcast.id == null) continue
            val change = StateFollowChange(StateID(podcast.id.toString()), true)
            target = target.copy(followQueued = target.followQueued.filterNot { it.podcastId == change.podcastId } + change)
            consumed += podcast.feed
        }
        commit(root.copy(accounts = root.accounts + (account to target), guestFollows = root.guestFollows - consumed))
    }

    @Synchronized internal fun guestProgressRecipient(sourceToken: String): String? {
        check(readable) { "Saved state is unreadable" }
        return root.accounts.entries.firstOrNull { sourceToken in it.value.guestProgressTransfers }?.key
    }

    @Synchronized internal fun transferGuestProgress(account: String, source: GuestProgressSource): Boolean {
        val recipient = guestProgressRecipient(source.sourceToken)
        if (recipient != null) {
            check(recipient == account && root.accounts.getValue(account).guestProgressTransfers[source.sourceToken] == source) { "This guest position was already transferred to another account" }
            return false
        }
        val change = source.change()
        val saved = account(account)
        commit(root.copy(accounts = root.accounts + (account to saved.copy(
            progressQueued = saved.progressQueued.filterNot { it.episodeId == change.episodeId } + change,
            guestProgressTransfers = saved.guestProgressTransfers + (source.sourceToken to source),
            failures = saved.failures - "Episode ${change.episodeId.value} unavailable",
        ))))
        return true
    }

    internal fun retainPending(account: String) = change(account) {
        it.copy(progress = it.progress.filterKeys { id -> id in it.progressOverlay() }, follows = emptyList())
    }

    @Synchronized fun erase(account: String) { commit(root.copy(accounts = root.accounts - account)); errors.remove(account) }
    @Synchronized fun checkpoint() { check(readable); }

    internal fun queueProgress(account: String, change: StateProgressChange, legacyToken: String? = null, knownCompleted: Boolean? = null) = change(account) {
        require(change.positionSeconds >= 0)
        val id = change.episodeId.value.toLong()
        val queued = it.progressQueued.filterNot { old -> old.episodeId == change.episodeId && (change.completed != null || old.completed == null) } + change
        it.copy(progressQueued = queued, progressCompletion = if (knownCompleted == null || id in it.progressCompletion) it.progressCompletion else it.progressCompletion + (id to knownCompleted), reappliedLegacy = if (legacyToken == null) it.reappliedLegacy else it.reappliedLegacy + (legacyToken to change.episodeId.value.toLong()), failures = it.failures - "Episode ${change.episodeId.value} unavailable")
    }
    internal fun queueFollow(account: String, change: StateFollowChange) = change(account) {
        it.copy(followQueued = it.followQueued.filterNot { old -> old.podcastId == change.podcastId } + change, failures = it.failures - "Podcast ${change.podcastId.value} unavailable")
    }
    internal fun freezeProgress(account: String) = change(account) {
        if (it.progressFlight != null || it.progressQueued.isEmpty() || it.progressBlocked != null) it else {
            check(it.progressSequence < Long.MAX_VALUE)
            val sequence = it.progressSequence + 1
            val queued = it.progressQueued.take(100)
            it.copy(progressSequence = sequence, progressQueued = it.progressQueued.drop(queued.size), progressFlight = ProgressFlight(StateBatch(1, account, checkNotNull(it.generation), it.progressClient, StateID(sequence.toString()), queued)))
        }
    }
    internal fun freezeFollows(account: String) = change(account) {
        if (it.followFlight != null || it.followQueued.isEmpty() || it.followBlocked != null) it else {
            check(it.followSequence < Long.MAX_VALUE)
            val sequence = it.followSequence + 1
            val queued = it.followQueued.take(100)
            it.copy(followSequence = sequence, followQueued = it.followQueued.drop(queued.size), followFlight = FollowFlight(StateBatch(1, account, checkNotNull(it.generation), it.followClient, StateID(sequence.toString()), queued)))
        }
    }
    internal fun acknowledgeProgress(account: String, ack: StateAcknowledgement<StateProgressResult>) = change(account) {
        val flight = checkNotNull(it.progressFlight)
        validateStateScope(ack.protocol, ack.accountId, ack.generation, account, it.generation)
        check(ack.clientId == flight.batch.clientId && ack.sequence == flight.batch.sequence)
        check(ack.results.map { it.episodeId } == flight.batch.changes.map { it.episodeId })
        it.copy(progressFlight = flight.copy(ack = ack), failures = it.failures + ack.results.filter { it.status == StateResult.not_found }.map { "Episode ${it.episodeId.value} unavailable" })
    }
    internal fun acknowledgeFollows(account: String, ack: StateAcknowledgement<StateFollowResult>) = change(account) {
        val flight = checkNotNull(it.followFlight)
        validateStateScope(ack.protocol, ack.accountId, ack.generation, account, it.generation)
        check(ack.clientId == flight.batch.clientId && ack.sequence == flight.batch.sequence)
        check(ack.results.map { it.podcastId } == flight.batch.changes.map { it.podcastId })
        it.copy(followFlight = flight.copy(ack = ack), failures = it.failures + ack.results.filter { it.status == StateResult.not_found }.map { "Podcast ${it.podcastId.value} unavailable" })
    }
    internal fun installProgress(account: String, snapshot: StateSnapshot<StateProgressItem>, requested: List<Long>? = null) = change(account) {
        validateStateScope(snapshot.protocol, snapshot.accountId, snapshot.generation, account, it.generation)
        val head = snapshot.revision.value.toLong()
        if (head < it.progressRevision || head < (it.progressFlight?.ack?.revision?.value?.toLong() ?: 0)) throw IOException("Progress snapshot is behind; overlay retained")
        val ids = snapshot.items.map { it.episodeId.value.toLong() }
        check(ids.size <= 200 && ids.distinct().size == ids.size)
        if (requested != null) check(ids.toSet() == requested.toSet())
        snapshot.items.forEach { row -> row.progress?.let { p -> check(p.positionSeconds >= 0 && p.revision.value.toLong() <= head && (p.updatedAtMs == null || p.updatedAtMs in 0..8640000000000000L)) } }
        val retire = it.progressFlight?.let { flight -> flight.ack != null && requested != null && requested.containsAll(flight.batch.changes.map { it.episodeId.value.toLong() }) } == true
        val next = it.copy(generation = snapshot.generation, progressRevision = head, progress = it.progress + snapshot.items.associate { it.episodeId.value.toLong() to it.progress }, progressFlight = if (retire) null else it.progressFlight)
        next.copy(progressCompletion = next.progressCompletion.filterKeys { id -> id in next.progressOverlay() })
    }
    internal fun installFollows(account: String, snapshot: StateSnapshot<StateFollowItem>) = change(account) {
        validateStateScope(snapshot.protocol, snapshot.accountId, snapshot.generation, account, it.generation)
        val head = snapshot.revision.value.toLong()
        if (head < it.followRevision || head < (it.followFlight?.ack?.revision?.value?.toLong() ?: 0)) throw IOException("Follow snapshot is behind; overlay retained")
        check(snapshot.items.map { it.podcastId }.distinct().size == snapshot.items.size)
        snapshot.items.forEach { row -> check(row.revision.value.toLong() <= head && (row.followedAtMs == null || row.followedAtMs in 0..8640000000000000L)) }
        it.copy(generation = snapshot.generation, followRevision = head, follows = snapshot.items, followFlight = if (it.followFlight?.ack != null) null else it.followFlight)
    }

    private fun decode(bytes: ByteArray): DurableRoot {
        val text = bytes.decodeToString()
        val raw = json.parseToJsonElement(text).jsonObject
        check(raw.keys.containsAll(listOf("version", "accounts", "guestFollows", "guestImported")))
        raw.getValue("accounts").jsonObject.values.forEach {
            check(it.jsonObject.keys.containsAll(listOf("progressClient", "followClient", "progressSequence", "followSequence", "progressRevision", "followRevision")))
        }
        return json.decodeFromString<DurableRoot>(text).also { root ->
            check(root.version == 1)
            val transferred = root.accounts.values.flatMap { it.guestProgressTransfers.keys }
            check(transferred.distinct().size == transferred.size)
            for ((account, saved) in root.accounts) {
                saved.guestProgressTransfers.forEach { (token, source) -> check(token == source.sourceToken); source.change() }
                check(account.length in 1..128)
                validateStateScope(1, account, saved.progressClient, account)
                validateStateScope(1, account, saved.followClient, account)
                saved.generation?.let { validateStateScope(1, account, it, account) }
                check(saved.progressSequence >= 0 && saved.followSequence >= 0 && saved.progressRevision >= 0 && saved.followRevision >= 0)
                check(saved.progress.keys.all { it > 0 } && saved.progressCompletion.keys.all { it > 0 })
                check(saved.progressQueued.all { it.positionSeconds >= 0 })
                saved.progressFlight?.let { flight ->
                    validateStateScope(flight.batch.protocol, flight.batch.accountId, flight.batch.generation, account, checkNotNull(saved.generation))
                    check(flight.batch.clientId == saved.progressClient && flight.batch.sequence.value == saved.progressSequence.toString())
                    check(flight.batch.changes.size in 1..100 && flight.batch.changes.all { it.positionSeconds >= 0 })
                    flight.ack?.let { ack ->
                        validateStateScope(ack.protocol, ack.accountId, ack.generation, account, saved.generation)
                        check(ack.clientId == flight.batch.clientId && ack.sequence == flight.batch.sequence && ack.results.map { it.episodeId } == flight.batch.changes.map { it.episodeId })
                    }
                }
                saved.followFlight?.let { flight ->
                    validateStateScope(flight.batch.protocol, flight.batch.accountId, flight.batch.generation, account, checkNotNull(saved.generation))
                    check(flight.batch.clientId == saved.followClient && flight.batch.sequence.value == saved.followSequence.toString() && flight.batch.changes.size in 1..100)
                    flight.ack?.let { ack ->
                        validateStateScope(ack.protocol, ack.accountId, ack.generation, account, saved.generation)
                        check(ack.clientId == flight.batch.clientId && ack.sequence == flight.batch.sequence && ack.results.map { it.podcastId } == flight.batch.changes.map { it.podcastId })
                    }
                }
            }
        }
    }

    private fun commit(next: DurableRoot) {
        check(readable) { "Saved state cannot be overwritten" }
        try {
            file.baseFile.parentFile?.mkdirs()
            val bytes = json.encodeToString(next).encodeToByteArray()
            if (writer != null) writer.invoke(bytes) else {
                val output = file.startWrite()
                try { output.write(bytes); output.fd.sync(); file.finishWrite(output) }
                catch (failure: Exception) { file.failWrite(output); throw failure }
                if (!file.readFully().contentEquals(bytes)) throw IOException("Atomic state write failed")
            }
            root = next
            changes.value++
            publish()
        } catch (failure: Exception) { error(visible, "Unable to save state on this device. Retry before leaving."); throw failure }
    }
    private fun publish() {
        val account = visible?.let { root.accounts[it] }
        val importFeeds = if (visible == null) root.guestImportFeeds else account?.importFeeds.orEmpty()
        state.value = DurableStatus(account?.pending == true, if (!readable) "Saved state cannot be opened; source retained." else errors[visible] ?: account?.progressBlocked ?: account?.followBlocked ?: account?.failures?.firstOrNull() ?: importFeeds.takeIf { it.isNotEmpty() }?.let { "${it.size} imported feeds need resolution — Retry" }, !readable || account?.progressBlocked != null || account?.followBlocked != null)
    }
}
