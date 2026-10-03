package app.podcst.data

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.ListenableWorker
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerFactory
import androidx.work.WorkerParameters
import java.util.concurrent.TimeUnit

interface WorkScheduler {
    fun syncProgress()
    fun refreshFeeds()
}

class WorkManagerScheduler(private val context: Context) : WorkScheduler {
    private val connected = Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()

    override fun syncProgress() {
        WorkManager.getInstance(context).enqueueUniqueWork(
            PROGRESS,
            ExistingWorkPolicy.APPEND_OR_REPLACE,
            OneTimeWorkRequestBuilder<ProgressSyncWorker>()
                .setConstraints(connected)
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
                .build(),
        )
    }

    override fun refreshFeeds() {
        WorkManager.getInstance(context).enqueueUniquePeriodicWork(
            FEEDS,
            ExistingPeriodicWorkPolicy.KEEP,
            PeriodicWorkRequestBuilder<FeedRefreshWorker>(6, TimeUnit.HOURS)
                .setConstraints(connected)
                .build(),
        )
    }

    private companion object {
        const val PROGRESS = "progress-sync"
        const val FEEDS = "feed-refresh"
    }
}

class ProgressSyncWorker(
    context: Context,
    parameters: WorkerParameters,
    private val progress: ProgressRepository,
) : CoroutineWorker(context, parameters) {
    override suspend fun doWork(): Result = when (progress.sync()) {
        SyncOutcome.Done -> Result.success()
        SyncOutcome.Retry -> Result.retry()
    }
}

class FeedRefreshWorker(
    context: Context,
    parameters: WorkerParameters,
    private val library: LibraryRepository,
) : CoroutineWorker(context, parameters) {
    override suspend fun doWork(): Result = runCatching { library.refresh() }.fold({ Result.success() }, { Result.retry() })
}

class PodcstWorkerFactory(
    private val progress: () -> ProgressRepository,
    private val library: () -> LibraryRepository,
) : WorkerFactory() {
    override fun createWorker(context: Context, workerClassName: String, parameters: WorkerParameters): ListenableWorker? =
        when (workerClassName) {
            ProgressSyncWorker::class.java.name -> ProgressSyncWorker(context, parameters, progress())
            FeedRefreshWorker::class.java.name -> FeedRefreshWorker(context, parameters, library())
            else -> null
        }
}
