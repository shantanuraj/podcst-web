package app.podcst.network

import app.podcst.model.FeedFreshness
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.test.runTest
import org.junit.Assert.*
import org.junit.Test

class FeedReadinessTest {
    private val pending = FeedFreshness(FeedFreshness.Content.missing, FeedFreshness.State.pending, null, 5000)
    private fun waiting() = ApiException(202, "Preparing episode", "content_pending", freshness = pending)

    @Test fun honorsAdviceAndReturnsReadyContentWithoutAnotherRefreshWrite() = runTest {
        var now = 0L
        var reads = 0
        var notices = 0
        val result = awaitFeedContent(
            read = { reads++; if (reads == 1) throw waiting(); "ready" }, active = { true },
            pending = { notices++ }, clock = { now }, wait = { now += it },
        )
        assertEquals("ready", result)
        assertEquals(2, reads)
        assertEquals(1, notices)
        assertEquals(5000, now)
    }

    @Test fun retiredIntentDiscardsLateSuccessAndStopsBetweenRechecks() = runTest {
        var active = true
        assertTrue(runCatching {
            awaitFeedContent(read = { active = false; "late" }, active = { active }, pending = {})
        }.exceptionOrNull() is CancellationException)
        active = true
        var reads = 0
        assertTrue(runCatching {
            awaitFeedContent<String>(read = { reads++; throw waiting() }, active = { active }, pending = {}, clock = { 0 }, wait = { active = false })
        }.exceptionOrNull() is CancellationException)
        assertEquals(1, reads)
    }

    @Test fun windowExpiryRetainsPendingOutcomeInsteadOfInventingFailureOrCompletion() = runTest {
        var now = 0L
        var reads = 0
        val failure = runCatching {
            awaitFeedContent<String>(read = { reads++; throw waiting() }, active = { true }, pending = {}, clock = { now }, wait = { now += it })
        }.exceptionOrNull() as ApiException
        assertEquals("content_pending", failure.code)
        assertEquals(pending, failure.freshness)
        assertTrue(now < 120000)
        assertEquals(24, reads)
    }
}
