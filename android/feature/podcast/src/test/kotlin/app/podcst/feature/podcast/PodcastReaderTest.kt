package app.podcst.feature.podcast

import app.podcst.data.SessionState
import app.podcst.model.Episode
import app.podcst.model.EpisodeFile
import app.podcst.model.EpisodePage
import app.podcst.model.EpisodeQuery
import app.podcst.model.EpisodeSort
import app.podcst.model.FeedFreshness
import app.podcst.model.Podcast
import app.podcst.model.SortDirection
import app.podcst.model.User
import app.podcst.network.ApiException
import java.io.IOException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.withContext
import org.junit.Assert.*
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class PodcastReaderTest {
    private val route = Podcast(id = 152, feed = "https://example.test/daily.xml", title = "Daily fixture")
    private val fresh = FeedFreshness(FeedFreshness.Content.cached, FeedFreshness.State.fresh, 1, null)
    private val stale = fresh.copy(state = FeedFreshness.State.stale)
    private val first = episode(1)
    private fun episode(id: Long) = Episode(id = id, guid = "episode-$id", feed = route.feed, podcastTitle = route.title, title = "Episode $id", file = EpisodeFile("https://example.test/$id.mp3"))
    private fun result(episodes: List<Episode> = listOf(first), cursor: Int? = null, freshness: FeedFreshness = fresh) = EpisodePage(episodes, 2000, cursor != null, cursor, freshness)
    private fun reader(
        scope: CoroutineScope,
        session: MutableStateFlow<SessionState> = MutableStateFlow(SessionState(loading = false)),
        cached: suspend (Podcast) -> Podcast? = { null },
        metadata: suspend (Podcast) -> Podcast = { it.copy(description = "Metadata") },
        page: suspend (Podcast, EpisodeQuery, Int?) -> EpisodePage = { _, _, _ -> result() },
        refresh: suspend (Podcast) -> FeedFreshness = { fresh },
        active: () -> (() -> Boolean) = { { true } },
        clock: () -> Long = { 0 },
    ) = PodcastReader(route, scope, session, active, cached, { it }, metadata, page, refresh, clock)

    @Test fun firstPlayablePageDoesNotWaitForMetadataOrOlderPages() = runTest {
        val metadata = CompletableDeferred<Podcast>()
        val older = CompletableDeferred<EpisodePage>()
        val calls = mutableListOf<Int?>()
        val reader = reader(backgroundScope, metadata = { metadata.await() }, page = { _, _, cursor ->
            calls += cursor
            if (cursor == null) result(cursor = 30) else older.await()
        })
        reader.resumeReads(); runCurrent()
        assertEquals(listOf(first), reader.paging.value.episodes)
        assertEquals(first, PodcastScreenState(reader.source.value).latest)
        assertEquals(listOf<Int?>(null), calls)
        assertEquals(LoadState.Loaded, reader.load.value)
        reader.loadMore(); reader.loadMore(); runCurrent()
        assertEquals(listOf(null, 30), calls)
        assertEquals(listOf(first), reader.paging.value.episodes)
        metadata.complete(route.copy(description = "Ready")); runCurrent()
        assertEquals("Ready", reader.source.value.description)
        older.complete(result(listOf(first, episode(2)))); runCurrent()
        assertEquals(listOf(first, episode(2)), reader.paging.value.episodes)
    }

    @Test fun metadataDoesNotWaitForEpisodes() = runTest {
        val reader = reader(backgroundScope, page = { _, _, _ -> awaitCancellation() })
        reader.resumeReads(); runCurrent()
        assertEquals("Metadata", reader.source.value.description)
        assertTrue(reader.paging.value.loading)
        assertTrue(reader.paging.value.episodes.isEmpty())
    }

    @Test fun refreshAdmissionAndFailurePreservePlayableContent() = runTest {
        val admission = CompletableDeferred<FeedFreshness>()
        val reader = reader(backgroundScope, page = { _, _, _ -> result(freshness = stale) }, refresh = { admission.await() })
        reader.resumeReads(); runCurrent()
        assertEquals(listOf(first), reader.paging.value.episodes)
        assertEquals(LoadState.Loaded, reader.load.value)
        admission.completeExceptionally(IOException("Offline")); runCurrent()
        assertEquals(listOf(first), reader.paging.value.episodes)
        assertEquals(LoadState.Loaded, reader.load.value)
    }

    @Test fun cachedFirstPageRemainsWhenNetworkFails() = runTest {
        val reader = reader(backgroundScope, cached = { route.copy(episodes = listOf(first)) }, page = { _, _, _ -> throw IOException("Offline") })
        reader.resumeReads(); runCurrent()
        assertEquals(listOf(first), reader.paging.value.episodes)
        assertEquals(first, PodcastScreenState(reader.source.value).latest)
        assertTrue(reader.paging.value.failed)
    }

    @Test fun paginationFailureKeepsRowsAndRetriesSameCursor() = runTest {
        var failures = 1
        val cursors = mutableListOf<Int?>()
        val reader = reader(backgroundScope, page = { _, _, cursor ->
            cursors += cursor
            if (cursor == null) result(cursor = 30)
            else if (failures-- > 0) throw IOException("Offline") else result(listOf(episode(2)))
        })
        reader.resumeReads(); runCurrent(); reader.loadMore(); runCurrent()
        assertEquals(listOf(first), reader.paging.value.episodes)
        assertEquals(30, reader.paging.value.nextCursor)
        assertTrue(reader.paging.value.failed)
        reader.retry(); runCurrent()
        assertEquals(listOf(null, 30, 30), cursors)
        assertEquals(listOf(first, episode(2)), reader.paging.value.episodes)
        assertFalse(reader.paging.value.failed)
    }

    @Test fun archiveQueriesResetCursorAndCannotChangeLatest() = runTest {
        val calls = mutableListOf<Pair<EpisodeQuery, Int?>>()
        val query = EpisodeQuery("archived", EpisodeSort.Duration, SortDirection.Ascending, true)
        val reader = reader(backgroundScope, page = { _, q, cursor ->
            calls += q to cursor
            if (q == EpisodeQuery()) result(cursor = 30) else result(listOf(episode(1900)), if (cursor == null) 30 else null)
        })
        reader.resumeReads(); runCurrent()
        reader.query(query); advanceTimeBy(300); runCurrent()
        assertEquals(listOf(episode(1900)), reader.paging.value.episodes)
        assertEquals(first, PodcastScreenState(reader.source.value).latest)
        reader.loadMore(); runCurrent()
        assertEquals(listOf(EpisodeQuery() to null, query to null, query to 30), calls)
    }

    @Test fun cancelledOldQueryCannotReplaceNewResults() = runTest {
        val release = CompletableDeferred<Unit>()
        val reader = reader(backgroundScope, page = { _, q, _ ->
            if (q.search == "old") withContext(NonCancellable) { release.await() }
            result(listOf(if (q.search == "new") episode(3) else first))
        })
        reader.resumeReads(); runCurrent()
        reader.query(EpisodeQuery(search = "old")); advanceTimeBy(300); runCurrent()
        reader.query(EpisodeQuery(search = "new")); advanceTimeBy(300); runCurrent()
        release.complete(Unit); runCurrent()
        assertEquals(listOf(episode(3)), reader.paging.value.episodes)
        assertFalse(reader.paging.value.loading)
    }

    @Test fun sessionRestorationWaitsAndAccountSwitchDiscardsRows() = runTest {
        val session = MutableStateFlow(SessionState())
        var reads = 0
        val reader = reader(backgroundScope, session, page = { _, _, _ -> reads++; if (reads == 1) result() else awaitCancellation() })
        reader.resumeReads(); runCurrent()
        assertEquals(0, reads)
        session.value = SessionState(user = User("first", "first@example.test"), loading = false); runCurrent()
        assertEquals(listOf(first), reader.paging.value.episodes)
        session.value = SessionState(user = User("second", "second@example.test"), loading = false); runCurrent()
        assertTrue(reader.paging.value.episodes.isEmpty())
        assertTrue(reader.source.value.episodes.isEmpty())
    }

    @Test fun backgroundingCancelsReadsAndPendingRechecksAreBounded() = runTest {
        var reads = 0
        val pending = FeedFreshness(FeedFreshness.Content.missing, FeedFreshness.State.pending, null, 5000)
        val reader = reader(backgroundScope, page = { _, _, _ -> reads++; throw ApiException(202, "Preparing", freshness = pending) }, clock = { testScheduler.currentTime })
        reader.resumeReads(); runCurrent()
        assertEquals(LoadState.Rechecking, reader.load.value)
        reader.suspendReads(); advanceTimeBy(10_000); runCurrent()
        assertEquals(1, reads)
        reader.resumeReads(); runCurrent(); advanceTimeBy(120_000); runCurrent()
        assertTrue(reader.paging.value.failed)
        val completed = reads
        advanceTimeBy(120_000); runCurrent()
        assertEquals(completed, reads)
    }

    @Test fun backoffPreventsImmediatePaginationRetry() = runTest {
        var reads = 0
        val reader = reader(backgroundScope, page = { _, _, cursor ->
            reads++
            if (cursor == null) result(cursor = 30) else throw ApiException(429, "Busy", retryAfterSeconds = 10)
        }, clock = { testScheduler.currentTime })
        reader.resumeReads(); runCurrent(); reader.loadMore(); runCurrent()
        reader.loadMore(); runCurrent()
        assertEquals(2, reads)
        advanceTimeBy(10_000); reader.loadMore(); runCurrent()
        assertEquals(3, reads)
    }
    @Test fun failedNewQueryDoesNotPresentOldQueryOrPartialCacheAsMatches() = runTest {
        val reader = reader(backgroundScope,
            cached = { route.copy(episodes = listOf(first)) },
            page = { _, query, _ -> if (query.search.isEmpty()) result(cursor = 30) else throw IOException("Offline") },
        )
        reader.resumeReads(); runCurrent()
        reader.query(EpisodeQuery(search = "not cached")); advanceTimeBy(300); runCurrent()
        assertTrue(reader.paging.value.episodes.isEmpty())
        assertTrue(reader.paging.value.failed)
        assertNull(reader.paging.value.nextCursor)
        reader.retry(); runCurrent()
        assertTrue(reader.paging.value.episodes.isEmpty())
        assertEquals(first, PodcastScreenState(reader.source.value).latest)
    }

    @Test fun changedQueryBeforeInitialPageCompletesStillResolvesLatest() = runTest {
        var defaultReads = 0
        val reader = reader(backgroundScope, page = { _, query, _ ->
            if (query == EpisodeQuery()) {
                if (++defaultReads == 1) awaitCancellation() else result()
            } else result(listOf(episode(1900)))
        })
        reader.resumeReads(); runCurrent()
        reader.query(EpisodeQuery(search = "archive")); advanceTimeBy(300); runCurrent()
        assertEquals(listOf(episode(1900)), reader.paging.value.episodes)
        assertEquals(first, PodcastScreenState(reader.source.value).latest)
    }

    @Test fun delayedRestorationCancelsActiveRequestsAndRestartsAfterVerification() = runTest {
        val session = MutableStateFlow(SessionState(loading = false))
        var reads = 0
        var cancelled = 0
        val reader = reader(backgroundScope, session, page = { _, _, _ ->
            reads++
            if (reads == 1) try { awaitCancellation() } finally { cancelled++ } else result()
        })
        reader.resumeReads(); runCurrent()
        session.value = SessionState(loading = true); runCurrent()
        assertEquals(1, cancelled)
        session.value = SessionState(loading = false); runCurrent()
        assertEquals(2, reads)
        assertEquals(listOf(first), reader.paging.value.episodes)
    }

    @Test fun unchangedFirstPageRevalidationPreservesLoadedPages() = runTest {
        val reader = reader(backgroundScope, page = { _, _, cursor -> if (cursor == null) result(cursor = 30) else result(listOf(episode(2)), cursor = 60) })
        reader.resumeReads(); runCurrent(); reader.loadMore(); runCurrent()
        reader.refresh(); runCurrent()
        assertEquals(listOf(first, episode(2)), reader.paging.value.episodes)
        assertEquals(60, reader.paging.value.nextCursor)
    }

    @Test fun backgroundRefreshDoesNotCollapseLoadedPages() = runTest {
        val admission = CompletableDeferred<FeedFreshness>()
        var firstReads = 0
        val reader = reader(backgroundScope, page = { _, _, cursor ->
            if (cursor != null) result(listOf(episode(2)), cursor = 60)
            else if (++firstReads == 1) result(cursor = 30, freshness = stale)
            else result(listOf(episode(3)), cursor = 30, freshness = fresh.copy(checkedAtMs = 2))
        }, refresh = { admission.await() })
        reader.resumeReads(); runCurrent(); reader.loadMore(); runCurrent()
        admission.complete(fresh.copy(checkedAtMs = 2)); runCurrent()
        assertEquals(listOf(first, episode(2)), reader.paging.value.episodes)
        assertEquals(60, reader.paging.value.nextCursor)
        assertEquals(episode(3), PodcastScreenState(reader.source.value).latest)
    }

    @Test fun successfulMissingContentResponsePreservesPreviouslyPlayableRows() = runTest {
        var missing = false
        val pending = FeedFreshness(FeedFreshness.Content.missing, FeedFreshness.State.pending, null, 5000)
        val reader = reader(backgroundScope, page = { _, _, _ -> if (missing) result(emptyList(), freshness = pending) else result() }, clock = { testScheduler.currentTime })
        reader.resumeReads(); runCurrent()
        missing = true
        reader.refresh(); runCurrent()
        assertEquals(listOf(first), reader.paging.value.episodes)
        advanceTimeBy(120_000); runCurrent()
        assertEquals(listOf(first), reader.paging.value.episodes)
        assertTrue(reader.paging.value.failed)
    }

    @Test fun restoredWindowRemainsVisibleUntilCursorIsValidatedWithNewInsertion() = runTest {
        val old = (90L downTo 31L).map(::episode)
        val secondPage = CompletableDeferred<EpisodePage>()
        val cursors = mutableListOf<Int?>()
        val reader = reader(backgroundScope, cached = { route.copy(episodes = old, episodeCount = 90) }, page = { _, _, cursor ->
            cursors += cursor
            when (cursor) {
                null -> result((91L downTo 62L).map(::episode), 30)
                30 -> secondPage.await()
                else -> result((31L downTo 1L).map(::episode))
            }
        })
        reader.resumeReads(); runCurrent()
        assertEquals(old, reader.paging.value.episodes)
        assertEquals(episode(91), PodcastScreenState(reader.source.value).latest)
        assertTrue(reader.paging.value.loading)
        secondPage.complete(result((61L downTo 32L).map(::episode), 60)); runCurrent()
        assertEquals((91L downTo 32L).map(::episode), reader.paging.value.episodes)
        assertEquals(60, reader.paging.value.nextCursor)
        reader.loadMore(); runCurrent()
        assertEquals(listOf(null, 30, 60), cursors)
        assertEquals((91L downTo 1L).map(::episode), reader.paging.value.episodes)
    }

    @Test fun restoredOlderWindowSurvivesRevalidationFailureAndRetriesFromFirstPage() = runTest {
        val cached = (90L downTo 1L).map(::episode)
        var offline = true
        val cursors = mutableListOf<Int?>()
        val reader = reader(backgroundScope, cached = { route.copy(episodes = cached) }, page = { _, _, cursor ->
            cursors += cursor
            if (cursor != null && offline) throw IOException("Offline")
            val offset = cursor ?: 0
            result(cached.drop(offset).take(30), (offset + 30).takeIf { it < 90 })
        })
        reader.resumeReads(); runCurrent()
        assertEquals(cached, reader.paging.value.episodes)
        assertTrue(reader.paging.value.failed)
        assertNull(reader.paging.value.nextCursor)
        offline = false
        reader.retry(); runCurrent()
        assertEquals(listOf(null, 30, null, 30, 60), cursors)
        assertEquals(cached, reader.paging.value.episodes)
        assertFalse(reader.paging.value.failed)
    }

    @Test fun failedChangedPrefixRevalidationDoesNotResumeOldContinuation() = runTest {
        var revision = 0
        val cursors = mutableListOf<Int?>()
        val reader = reader(backgroundScope, page = { _, _, cursor ->
            cursors += cursor
            if (revision == 1 && cursor == 30) throw IOException("Offline")
            val offset = cursor ?: 0
            val newest = if (revision == 0) 90L else 91L
            result((newest downTo 1L).drop(offset).take(30).map(::episode), offset + 30)
        })
        reader.resumeReads(); runCurrent(); reader.loadMore(); runCurrent()
        revision = 1
        reader.refresh(); runCurrent()
        assertEquals((90L downTo 31L).map(::episode), reader.paging.value.episodes)
        assertTrue(reader.paging.value.failed)
        assertNull(reader.paging.value.nextCursor)
        revision = 2
        reader.retry(); runCurrent()
        assertEquals(listOf(null, 30, null, 30, null, 30), cursors)
        assertEquals((91L downTo 32L).map(::episode), reader.paging.value.episodes)
        assertEquals(60, reader.paging.value.nextCursor)
    }

}
