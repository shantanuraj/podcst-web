package app.podcst.network

import app.podcst.model.FeedFreshness
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.ensureActive

suspend fun <T> awaitFeedContent(
    read: suspend () -> T,
    active: () -> Boolean,
    pending: (FeedFreshness) -> Unit,
    clock: () -> Long = System::currentTimeMillis,
    wait: suspend (Long) -> Unit = { delay(it) },
): T {
    val startedAt = clock()
    suspend fun check() {
        currentCoroutineContext().ensureActive()
        if (!active()) throw CancellationException("Read intent retired")
    }
    while (true) {
        check()
        try {
            val result = read()
            check()
            return result
        } catch (failure: ApiException) {
            check()
            val freshness = failure.freshness ?: throw failure
            val pause = freshness.recheckDelay(startedAt, clock()) ?: throw failure
            pending(freshness)
            wait(pause)
        }
    }
}
