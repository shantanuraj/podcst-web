package app.podcst.feature.podcast

import app.podcst.data.SessionState
import app.podcst.model.Episode
import app.podcst.model.EpisodeFile
import app.podcst.model.FeedFreshness
import app.podcst.model.Podcast
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.*
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class PodcastReaderTest {
    private val route = Podcast(id = 152, feed = "", title = "Daily fixture")
    private val resolved = route.copy(feed = "https://example.test/daily.xml", episodes = listOf(
        Episode(guid = "episode", feed = "https://example.test/daily.xml", title = "Episode", file = EpisodeFile("https://example.test/audio.mp3")),
    ))

    @Test fun waitsForInitialSessionRestorationBeforeReading() = runTest {
        val session = MutableStateFlow(SessionState())
        var reads = 0
        val reader = PodcastReader(route, backgroundScope, session, { { true } },
            read = { _, _, _ -> reads++; resolved }, recheck = { error("Unexpected recheck") })
        reader.resumeReads()
        runCurrent()
        assertEquals(0, reads)
        session.value = SessionState(loading = false)
        runCurrent()
        assertEquals(1, reads)
        assertEquals(resolved, reader.source.value)
        assertEquals(LoadState.Loaded, reader.load.value)
    }

    @Test fun delayedForegroundRestorationCancelsAndRestartsTheRead() = runTest {
        val session = MutableStateFlow(SessionState(loading = false))
        var epoch = 0
        var reads = 0
        var cancellations = 0
        val reader = PodcastReader(route, backgroundScope, session,
            readerActive = { val started = epoch; { epoch == started } },
            read = { _, _, _ ->
                reads++
                if (reads == 2) try { awaitCancellation() } finally { cancellations++ }
                resolved
            }, recheck = { error("Unexpected recheck") })
        reader.resumeReads()
        runCurrent()
        reader.suspendReads()
        runCurrent()
        reader.resumeReads()
        runCurrent()
        assertEquals(2, reads)

        // MainActivity begins restoring after the screen's ON_START callback.
        epoch++
        session.value = SessionState(loading = true)
        runCurrent()
        advanceTimeBy(5000)
        runCurrent()
        assertEquals(1, cancellations)
        assertEquals(2, reads)
        session.value = SessionState(loading = false)
        runCurrent()
        assertEquals(3, reads)
        assertEquals(LoadState.Loaded, reader.load.value)
    }

    @Test fun emptyFeedDeepLinkPublishesEpisodesWhileAdmissionIsBlocked() = runTest {
        val admission = CompletableDeferred<Unit>()
        val reader = PodcastReader(route, backgroundScope, MutableStateFlow(SessionState(loading = false)), { { true } },
            read = { _, _, publish -> publish(resolved); admission.await(); resolved },
            recheck = { error("Unexpected recheck") })
        reader.resumeReads()
        runCurrent()
        assertEquals(resolved.feed, reader.source.value.feed)
        assertEquals(resolved.episodes, reader.source.value.episodes)
        assertFalse(admission.isCompleted)
        admission.complete(Unit)
        runCurrent()
        assertEquals(LoadState.Loaded, reader.load.value)
    }

    @Test fun backgroundingCancelsRechecksAndSessionCompletionDoesNotRestartThem() = runTest {
        val session = MutableStateFlow(SessionState(loading = false))
        val pending = resolved.copy(freshness = FeedFreshness(FeedFreshness.Content.cached, FeedFreshness.State.pending, 1, 5000))
        var reads = 0
        var rechecks = 0
        val reader = PodcastReader(route, backgroundScope, session, { { true } },
            read = { _, _, _ -> reads++; pending }, recheck = { rechecks++; resolved }, clock = { testScheduler.currentTime })
        reader.resumeReads()
        runCurrent()
        assertEquals(LoadState.Rechecking, reader.load.value)
        reader.suspendReads()
        session.value = SessionState(loading = true)
        runCurrent()
        session.value = SessionState(loading = false)
        advanceTimeBy(10_000)
        runCurrent()
        assertEquals(1, reads)
        assertEquals(0, rechecks)
        assertEquals(LoadState.Loaded, reader.load.value)
        reader.resumeReads()
        runCurrent()
        advanceTimeBy(5000)
        runCurrent()
        assertEquals(2, reads)
        assertEquals(1, rechecks)
        assertEquals(LoadState.Loaded, reader.load.value)
    }

    @Test fun pendingFeedRechecksQuietlyWithoutRepeatedAdmissionAndEventuallyStops() = runTest {
        val pending = route.copy(freshness = FeedFreshness(FeedFreshness.Content.missing, FeedFreshness.State.pending, null, 5000))
        var reads = 0
        var rechecks = 0
        val reader = PodcastReader(pending, backgroundScope, MutableStateFlow(SessionState(loading = false)), { { true } },
            read = { _, _, _ -> reads++; pending }, recheck = { rechecks++; pending }, clock = { testScheduler.currentTime })
        reader.resumeReads()
        runCurrent()
        advanceTimeBy(4999)
        runCurrent()
        assertEquals(0, rechecks)
        val preparing = PodcastScreenState(reader.source.value, load = reader.load.value)
        assertEquals(EpisodeNotice.Preparing, preparing.episodeNotice)
        assertFalse(preparing.canRetryEpisodes(testScheduler.currentTime))
        advanceTimeBy(120_000)
        runCurrent()
        assertEquals(1, reads)
        assertTrue(rechecks > 0)
        assertEquals(LoadState.Loaded, reader.load.value)
        val completed = rechecks
        advanceTimeBy(120_000)
        runCurrent()
        assertEquals(completed, rechecks)
        assertTrue(PodcastScreenState(reader.source.value, load = reader.load.value).canRetryEpisodes(testScheduler.currentTime))
    }
}
