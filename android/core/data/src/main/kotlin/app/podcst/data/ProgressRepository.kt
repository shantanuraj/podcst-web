package app.podcst.data

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

class ProgressRepository(
    private val api: PodcstApi,
    private val scopes: Scopes,
    private val scheduler: WorkScheduler,
    private val clock: () -> Long = System::currentTimeMillis,
) {
    val progress: Flow<Map<String, EpisodeProgress>> = scopes.current.flatMapLatest { scope ->
        scope.database.progress().observeAll().map { rows -> rows.associate { it.identity to it.domain() } }
    }

    val unfinished: Flow<List<Episode>> = scopes.current.flatMapLatest { scope ->
        scope.database.episodes().observeUnfinished(UNFINISHED_LIMIT).map { rows -> rows.map { it.domain() } }
    }

    suspend fun record(episode: Episode, position: Duration, completed: Boolean) {
        val scope = scopes.current.value
        val database = scope.database
        val duration = episode.duration
        val done = completed || EpisodeProgress.completes(position, duration)
        val now = clock()
        database.episodes().upsert(listOf(episode.entity()))
        database.progress().upsert(
            ProgressEntity(episode.identity.value, position.inWholeMilliseconds, duration?.inWholeMilliseconds, done, now),
        )
        val id = episode.id ?: return
        if (scope.accountId == null) return
        database.outbox().enqueue(OutboxEntity(id, position.inWholeMilliseconds / 1000.0, done, now))
        scheduler.syncProgress()
    }

    suspend fun restoreLatest(): PlaybackProgress? {
        val scope = scopes.current.value
        if (scope.accountId == null) return null
        val latest = api.currentProgress() ?: return null
        if (scopes.current.value !== scope) return null
        val local = scope.database.progress().get(latest.episode.identity.value)
        if (local == null || local.positionMs < (latest.position * 1000).toLong() && !local.completed) {
            scope.database.episodes().upsert(listOf(latest.episode.entity()))
            scope.database.progress().upsert(
                ProgressEntity(
                    latest.episode.identity.value,
                    latest.position.seconds.inWholeMilliseconds,
                    latest.episode.duration?.inWholeMilliseconds,
                    false,
                    clock(),
                ),
            )
        }
        return latest
    }

    suspend fun sync(): SyncOutcome {
        val scope = scopes.current.value
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
