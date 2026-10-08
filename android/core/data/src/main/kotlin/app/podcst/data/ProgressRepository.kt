package app.podcst.data

import androidx.room.withTransaction
import app.podcst.database.ProgressEntity
import app.podcst.database.domain
import app.podcst.database.entity
import app.podcst.model.*
import app.podcst.network.ApiException
import app.podcst.network.PodcstApi
import kotlin.time.Duration
import kotlin.time.Duration.Companion.milliseconds
import kotlin.time.Duration.Companion.seconds
import kotlin.time.Instant
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

class ProgressRepository(
    private val api: PodcstApi,
    private val scopes: Scopes,
    private val scheduler: WorkScheduler,
    private val clock: () -> Long = System::currentTimeMillis,
) {
    private val syncMutex = Mutex()
    private val edits = Mutex()
    private val durable = scopes.durable
    private var retryAt = 0L
    val status = durable.status

    val guestProgress: Flow<List<GuestProgressSelection>> = combine(scopes.current, scopes.verification) { owner, verified -> owner to verified }
        .flatMapLatest { (owner, verified) ->
            val account = owner.accountId
            val epoch = scopes.epoch
            if (account == null || !verified) flowOf(emptyList()) else {
                combine(scopes.guestDatabase.progress().observeAll(), durable.revision) { rows, _ ->
                    val selections = rows.mapNotNull { row ->
                        if (durable.guestProgressRecipient(row.sourceToken) != null) return@mapNotNull null
                        val episode = scopes.guestDatabase.episodes().get(row.identity)?.domain() ?: return@mapNotNull null
                        GuestProgressSelection(account, epoch, episode, row.guestSource(episode))
                    }
                    if (active(owner, epoch)) selections else emptyList()
                }.catch { failure ->
                    if (failure is CancellationException) throw failure
                    durable.error(account, "Guest progress could not be read. Original source is retained.")
                }
            }
        }

    suspend fun transferGuestProgress(selection: GuestProgressSelection) = edits.withLock {
        val owner = scopes.current.value
        val account = selection.accountId
        try {
            check(owner.accountId == account) { "Account changed; select the guest position again" }
            check(active(owner, selection.epoch)) { "Account verification changed; select the guest position again" }
            scopes.guestDatabase.withTransaction {
                val recipient = durable.guestProgressRecipient(selection.sourceToken)
                if (recipient == null) {
                    val row = scopes.guestDatabase.progress().get(selection.source.identity)
                    val episode = scopes.guestDatabase.episodes().get(selection.source.identity)?.domain()
                    check(row != null && episode != null && row.guestSource(episode) == selection.source) { "Guest progress changed; select its current position again" }
                }
                scopes.withVerifiedAccount(owner, selection.epoch) { durable.transferGuestProgress(account, selection.source) }
            }
            if (active(owner, selection.epoch)) {
                try {
                    owner.database.withTransaction {
                        if (!active(owner, selection.epoch)) return@withTransaction
                        owner.database.episodes().upsert(listOf(selection.episode.entity()))
                        val id = checkNotNull(selection.source.episodeId)
                        val saved = durable.account(account)
                        val overlay = saved.progressOverlay()[id]
                        val accepted = saved.progress[id]
                        if (overlay != null || accepted != null) owner.database.progress().upsert(ProgressEntity(
                            selection.episode.identity.value,
                            (overlay?.positionSeconds ?: checkNotNull(accepted).positionSeconds) * 1000L,
                            selection.source.durationMs,
                            overlay?.completed ?: checkNotNull(accepted).completed,
                            accepted?.updatedAtMs ?: clock(),
                        ))
                    }
                    cleanupGuestProgress(owner, selection.epoch)
                } catch (failure: Exception) {
                    if (failure is CancellationException) throw failure
                    durable.error(account, "Guest position is saved for this account. Local cleanup needs retry; source evidence is retained.")
                }
                scheduler.syncProgress()
            }
        } catch (failure: Exception) {
            if (failure is CancellationException) throw failure
            durable.error(account, "Guest position transfer could not finish: ${failure.message}")
            throw failure
        }
    }

    internal suspend fun cleanupGuestProgress(owner: Scope = scopes.current.value, epoch: Long = scopes.epoch) {
        val account = owner.accountId ?: return
        if (!active(owner, epoch) || durable.account(account).guestProgressTransfers.isEmpty()) return
        scopes.guestDatabase.withTransaction {
            scopes.withVerifiedAccount(owner, epoch) {
                for (source in durable.account(account).guestProgressTransfers.values) {
                    scopes.guestDatabase.openHelper.writableDatabase.execSQL(
                        "DELETE FROM progress WHERE identity = ? AND sourceToken = ?", arrayOf(source.identity, source.sourceToken),
                    )
                }
            }
        }
    }

    val progress: Flow<Map<String, EpisodeProgress>> = scopes.current.flatMapLatest { scope ->
        combine(scope.database.progress().observeAll(), durable.revision) { rows, _ ->
            val result = rows.associate { it.identity to it.domain() }.toMutableMap()
            scope.accountId?.let { account ->
                val saved = runCatching { durable.account(account) }.getOrNull()
                saved?.progress?.forEach { (id, progress) ->
                    val key = "episode:$id"
                    if (progress == null) result.remove(key) else result[key] = EpisodeProgress(progress.positionSeconds.seconds, result[key]?.duration, progress.completed, Instant.fromEpochMilliseconds(progress.updatedAtMs ?: 0))
                }
                saved?.progressOverlay()?.forEach { (id, change) ->
                    val key = "episode:$id"
                    result[key] = EpisodeProgress(change.positionSeconds.seconds, result[key]?.duration, change.completed, result[key]?.updated ?: Instant.fromEpochMilliseconds(clock()))
                }
            }
            result
        }
    }
    val legacyProgress: Flow<List<Episode>> = scopes.current.flatMapLatest { owner ->
        combine(owner.database.episodes().observeLegacyProgress(), owner.database.outbox().observePending(), durable.revision) { episodes, pending, _ ->
            val reapplied = owner.accountId?.let { runCatching { durable.account(it).reappliedLegacy }.getOrNull() }.orEmpty()
            val ids = pending.filter { "${it.episodeId}:${it.queuedAt}" !in reapplied }.map { it.episodeId }.toSet()
            episodes.filter { it.id in ids || it.mediaIdentity?.removePrefix("episode:")?.toLongOrNull() in ids }.map { it.domain() }
        }
    }

    val unfinished: Flow<List<Episode>> = scopes.current.flatMapLatest { scope ->
        scope.database.episodes().observeUnfinished(50).map { rows -> rows.map { it.domain() } }
    }

    suspend fun record(episode: Episode, position: Duration, completed: Boolean, owner: Scope = scopes.current.value) =
        event(episode, position, if (completed) StateProgressEvent.ended else StateProgressEvent.checkpoint, owner)

    suspend fun event(episode: Episode, position: Duration, event: StateProgressEvent, owner: Scope = scopes.current.value, legacyToken: String? = null) = edits.withLock {
        if (scopes.current.value !== owner) return@withLock
        try {
            val previous = owner.database.progress().get(episode.identity.value)
            val account = owner.accountId
            val state = account?.let(durable::account)
            val completed = episode.id?.let { state?.progressOverlay()?.get(it)?.completed ?: state?.progress?.get(it)?.completed } ?: previous?.completed ?: false
            require(position >= Duration.ZERO && position.inWholeSeconds <= Int.MAX_VALUE) { "Source position is outside the supported range" }
            val (seconds, done) = event.intent(position.inWholeSeconds.toInt(), completed)
            if (account != null && episode.id != null) durable.queueProgress(account, StateProgressChange(StateID(episode.id.toString()), seconds, done), legacyToken)
            try {
                owner.database.withTransaction {
                    owner.database.episodes().upsert(listOf(episode.entity()))
                    owner.database.progress().upsert(ProgressEntity(episode.identity.value, seconds * 1000L, episode.duration?.inWholeMilliseconds, done, clock()))
                }
            } catch (failure: Exception) {
                if (failure is CancellationException || account == null || episode.id == null) throw failure
                durable.error(account, "Progress is saved in the durable journal; its presentation cache could not be updated.")
            }
            if (account != null && episode.id != null) scheduler.syncProgress()
        } catch (failure: Exception) { durable.error(owner.accountId, "Progress could not be saved: ${failure.message}"); throw failure }
    }

    suspend fun reapplyLegacy(episode: Episode) {
        val owner = scopes.current.value
        val id = episode.id ?: error("Resolve this episode before reapplying")
        val stored = owner.database.episodes().get(episode.identity.value) ?: error("Resolve this episode before reapplying")
        val retainedId = stored.mediaIdentity?.takeIf { it.startsWith("episode:") }?.removePrefix("episode:")?.toLongOrNull()
        val originalId = retainedId ?: run {
            val db = owner.database.openHelper.readableDatabase
            val hasSource = db.query("SELECT name FROM sqlite_master WHERE name='legacy_episode_source'").use { it.moveToFirst() }
            if (hasSource) db.query("SELECT id FROM legacy_episode_source WHERE feed = ? AND guid = ?", arrayOf(episode.feed, episode.guid)).use { row ->
                if (row.count == 1 && row.moveToFirst()) row.getLong(0) else null
            } else id
        }
        val old = originalId?.let { owner.database.outbox().get(it) } ?: error("No ambiguous saved progress remains for this episode")
        event(episode, old.position.seconds, if (old.completed) StateProgressEvent.played else StateProgressEvent.replay, owner, "${old.episodeId}:${old.queuedAt}")
    }

    suspend fun restoreLatest(): PlaybackProgress? {
        val owner = scopes.current.value
        val epoch = scopes.epoch
        return syncMutex.withLock {
            if (!active(owner, epoch) || syncPending(owner, epoch) != SyncOutcome.Done) return@withLock null
            val account = owner.accountId ?: return@withLock null
            val saved = durable.account(account)
            if (saved.progressFlight != null || saved.progressQueued.isNotEmpty() || saved.progressBlocked != null) return@withLock null
            val latest = api.currentProgress() ?: return@withLock null
            if (!active(owner, epoch)) return@withLock null
            val snapshot = api.progressState(listOfNotNull(latest.episode.id))
            if (!active(owner, epoch)) return@withLock null
            durable.installProgress(account, snapshot, listOfNotNull(latest.episode.id))
            if (durable.account(account).progressOverlay().isNotEmpty()) return@withLock null
            val truth = snapshot.items.singleOrNull()?.progress ?: return@withLock null
            if (truth.completed) return@withLock null
            owner.database.episodes().upsert(listOf(latest.episode.entity()))
            installProjection(owner)
            latest.copy(episode = owner.database.episodes().get(latest.episode.identity.value)?.domain() ?: latest.episode, position = truth.positionSeconds.toDouble())
        }
    }

    suspend fun refresh(episodes: List<Episode>) {
        val owner = scopes.current.value
        val epoch = scopes.epoch
        val account = owner.accountId ?: return
        if (!active(owner, epoch)) return
        syncMutex.withLock {
            for (ids in episodes.mapNotNull { it.id }.distinct().chunked(200)) {
                val snapshot = api.progressState(ids)
                if (!active(owner, epoch)) return@withLock
                durable.installProgress(account, snapshot, ids)
            }
            installProjection(owner)
        }
    }
    suspend fun sync(): SyncOutcome {
        val owner = scopes.current.value
        val epoch = scopes.epoch
        return syncMutex.withLock { syncPending(owner, epoch) }
    }
    private fun active(owner: Scope, epoch: Long) = scopes.current.value === owner && scopes.epoch == epoch && scopes.verified && owner.accountId != null

    private suspend fun syncPending(owner: Scope, epoch: Long): SyncOutcome {
        val account = owner.accountId ?: return SyncOutcome.Done
        if (!active(owner, epoch)) return SyncOutcome.Done
        try { cleanupGuestProgress(owner, epoch) }
        catch (cancelled: CancellationException) { throw cancelled }
        catch (failure: Exception) {
            durable.error(account, "Guest position cleanup needs retry. Source evidence and pending account work are retained.")
            return SyncOutcome.Retry
        }
        if (clock() < retryAt) return SyncOutcome.Retry
        try {
            if (durable.account(account).progressBlocked != null) return SyncOutcome.Done
            if (durable.account(account).generation == null) {
                val snapshot = api.progressState()
                if (!active(owner, epoch)) return SyncOutcome.Done
                durable.installProgress(account, snapshot)
            }
            do {
                if (!active(owner, epoch)) return SyncOutcome.Done
                val current = durable.freezeProgress(account)
                val flight = current.progressFlight ?: break
                if (flight.ack == null) {
                    val ack = api.changeProgress(flight.batch)
                    if (!active(owner, epoch)) return SyncOutcome.Done
                    durable.acknowledgeProgress(account, ack)
                }
                val ids = flight.batch.changes.map { it.episodeId.value.toLong() }.distinct()
                val snapshot = api.progressState(ids)
                if (!active(owner, epoch)) return SyncOutcome.Done
                durable.installProgress(account, snapshot, ids)
                installProjection(owner)
            } while (durable.account(account).progressQueued.isNotEmpty())
            installProjection(owner)
            retireReappliedSource(owner)
            if (owner.database.outbox().pending().any { "${it.episodeId}:${it.queuedAt}" !in durable.account(account).reappliedLegacy }) durable.error(account, "Old progress is kept locally. Use Reapply saved progress to send a new action.") else durable.clearError(account)
            return SyncOutcome.Done
        } catch (cancelled: CancellationException) { throw cancelled }
        catch (failure: Exception) {
            if (!active(owner, epoch)) return SyncOutcome.Done
            durable.error(account, "Progress sync paused: ${failure.message}. Pending work retained.")
            if (failure is ApiException && failure.status == 401) { scopes.suspendSync(); return SyncOutcome.Done }
            if (failure is IllegalArgumentException || failure is IllegalStateException || failure is ApiException && (failure.code == "invalid_response" || failure.status in listOf(400, 403, 404, 409, 413, 426))) {
                durable.change(account) { it.copy(progressBlocked = "Progress sync blocked: ${failure.message}") }
                return SyncOutcome.Done
            }
            retryAt = clock() + ((failure as? ApiException)?.retryAfterSeconds?.coerceIn(1, 86400) ?: 30) * 1000
            return SyncOutcome.Retry
        }
    }
    private suspend fun retireReappliedSource(owner: Scope) {
        val account = owner.accountId ?: return
        val saved = durable.account(account)
        for ((token, canonicalId) in saved.reappliedLegacy) {
            if (canonicalId in saved.progressOverlay() || canonicalId !in saved.progress || "Episode $canonicalId unavailable" in saved.failures) continue
            val (oldId, queuedAt) = token.split(':').map(String::toLong)
            owner.database.withTransaction {
                owner.database.outbox().sent(oldId, queuedAt)
                val db = owner.database.openHelper.writableDatabase
                val archived = db.query("SELECT name FROM sqlite_master WHERE name='legacy_episode_source'").use { it.moveToFirst() }
                if (archived) db.execSQL("DELETE FROM legacy_episode_source WHERE id = ? AND id NOT IN (SELECT episodeId FROM progress_outbox)", arrayOf<Any>(oldId))
            }
            durable.change(account) { it.copy(reappliedLegacy = it.reappliedLegacy - token) }
        }
    }

    private suspend fun installProjection(owner: Scope) {
        val account = owner.accountId ?: return
        val saved = durable.account(account)
        owner.database.withTransaction {
            for ((id, progress) in saved.progress) {
                val key = "episode:$id"
                if (id in saved.progressOverlay()) continue
                if (progress == null) owner.database.progress().delete(key) else {
                    val old = owner.database.progress().get(key)
                    owner.database.progress().upsert(ProgressEntity(key, progress.positionSeconds * 1000L, old?.durationMs, progress.completed, progress.updatedAtMs ?: clock()))
                }
            }
        }
    }
}

enum class SyncOutcome { Done, Retry }
internal fun ProgressEntity.domain() = EpisodeProgress(positionMs.milliseconds, durationMs?.milliseconds, completed, Instant.fromEpochMilliseconds(updatedAt))
