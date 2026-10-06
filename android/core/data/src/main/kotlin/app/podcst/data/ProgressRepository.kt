package app.podcst.data

import androidx.room.withTransaction
import app.podcst.database.OutboxEntity
import app.podcst.database.ProgressEntity
import app.podcst.database.domain
import app.podcst.database.entity
import app.podcst.model.Episode
import app.podcst.model.EpisodeProgress
import app.podcst.model.PlaybackProgress
import app.podcst.network.ApiException
import app.podcst.network.PodcstApi
import kotlin.time.Duration
import kotlin.time.Duration.Companion.milliseconds
import kotlin.time.Duration.Companion.seconds
import kotlin.time.Instant
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

class ProgressRepository(
    private val api: PodcstApi,
    private val scopes: Scopes,
    private val scheduler: WorkScheduler,
    private val clock: () -> Long = System::currentTimeMillis,
) {
    private val syncMutex = Mutex()

    val progress: Flow<Map<String, EpisodeProgress>> = scopes.current.flatMapLatest { scope ->
        scope.database.progress().observeAll().map { rows -> rows.associate { it.identity to it.domain() } }
    }

    val unfinished: Flow<List<Episode>> = scopes.current.flatMapLatest { scope ->
        scope.database.episodes().observeUnfinished(UNFINISHED_LIMIT).map { rows -> rows.map { it.domain() } }
    }

    suspend fun record(episode: Episode, position: Duration, completed: Boolean, owner: Scope = scopes.current.value) {
        if (scopes.current.value !== owner) return
        val database = owner.database
        val duration = episode.duration
        val done = completed || EpisodeProgress.completes(position, duration)
        val now = clock()
        val queued = database.withTransaction {
            if (scopes.current.value !== owner) return@withTransaction false
            database.episodes().upsert(listOf(episode.entity()))
            database.progress().upsert(
                ProgressEntity(episode.identity.value, position.inWholeMilliseconds, duration?.inWholeMilliseconds, done, now),
            )
            val id = episode.id ?: return@withTransaction false
            if (owner.accountId == null) return@withTransaction false
            val previous = database.outbox().get(id)
            val queuedAt = maxOf(now, previous?.queuedAt?.plus(1) ?: now)
            database.outbox().enqueue(OutboxEntity(id, position.inWholeMilliseconds / 1000.0, done, queuedAt))
            true
        }
        if (queued) scheduler.syncProgress()
    }

    suspend fun restoreLatest(): PlaybackProgress? {
        val owner = scopes.current.value
        return syncMutex.withLock {
            if (owner.accountId == null || scopes.current.value !== owner) return@withLock null
            if (syncPending(owner) != SyncOutcome.Done || scopes.current.value !== owner) return@withLock null
            val database = owner.database
            if (database.outbox().pending().isNotEmpty()) return@withLock null
            val latest = api.currentProgress() ?: return@withLock null
            if (scopes.current.value !== owner) return@withLock null
            database.withTransaction {
                if (scopes.current.value !== owner || database.outbox().pending().isNotEmpty()) return@withTransaction null
                database.episodes().upsert(listOf(latest.episode.entity()))
                database.progress().upsert(
                    ProgressEntity(
                        latest.episode.identity.value,
                        latest.position.seconds.inWholeMilliseconds,
                        latest.episode.duration?.inWholeMilliseconds,
                        false,
                        clock(),
                    ),
                )
                latest
            }
        }
    }

    suspend fun sync(): SyncOutcome {
        val owner = scopes.current.value
        return syncMutex.withLock { syncPending(owner) }
    }

    private suspend fun syncPending(scope: Scope): SyncOutcome {
        if (scopes.current.value !== scope) return SyncOutcome.Done
        if (scope.accountId == null) return SyncOutcome.Done
        val outbox = scope.database.outbox()
        for (update in outbox.pending()) {
            if (scopes.current.value !== scope) return SyncOutcome.Done
            try {
                api.saveProgress(update.episodeId, update.position, update.completed)
            } catch (failure: ApiException) {
                when {
                    failure.status == 401 || failure.status == 403 -> return SyncOutcome.Done
                    failure.status in 400..499 && failure.status !in RETRYABLE -> Unit
                    else -> return SyncOutcome.Retry
                }
            } catch (failure: java.io.IOException) {
                return SyncOutcome.Retry
            }
            if (scopes.current.value !== scope) return SyncOutcome.Done
            outbox.sent(update.episodeId, update.queuedAt)
        }
        return SyncOutcome.Done
    }

    private companion object {
        const val UNFINISHED_LIMIT = 50
        val RETRYABLE = setOf(408, 425, 429)
    }
}

enum class SyncOutcome { Done, Retry }

internal fun ProgressEntity.domain() = EpisodeProgress(
    position = positionMs.milliseconds,
    duration = durationMs?.milliseconds,
    completed = completed,
    updated = Instant.fromEpochMilliseconds(updatedAt),
)
