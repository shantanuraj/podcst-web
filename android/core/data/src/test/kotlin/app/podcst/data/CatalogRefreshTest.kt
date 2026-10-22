package app.podcst.data

import app.podcst.database.PodcstDatabase
import app.podcst.model.FeedFreshness
import app.podcst.model.Podcast
import app.podcst.network.ApiException
import app.podcst.network.testing.FakeServer
import app.podcst.network.testing.Reply
import java.io.IOException
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.async
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class CatalogRefreshTest {
    private val context = RuntimeEnvironment.getApplication()
    private val scopes = Scopes(context, null)
    private val source = Podcast(id = 152, feed = "https://example.test/daily.xml", title = "Daily fixture")

    @After fun close() {
        val key = scopes.current.value.key
        scopes.close()
        PodcstDatabase.delete(context, key)
    }

    @Test fun firstGuestOpenPublishesEpisodesThenAdmitsAndRechecksOnce() = runTest {
        val arrived = CompletableDeferred<Unit>()
        val release = CompletableDeferred<Unit>()
        var ready = false
        val server = FakeServer { call ->
            when (call.path) {
                "/api/feed/info" -> Reply(info)
                "/api/feed/episodes" -> Reply(page(if (ready) "fresh" else "stale", if (ready) listOf(3, 2, 1) else listOf(2, 1)))
                "/api/feed/refresh" -> {
                    assertEquals("""{"podcastId":"152"}""", call.body)
                    arrived.complete(Unit)
                    runBlocking { release.await() }
                    Reply(refresh("pending"), code = 202)
                }
                else -> error("Unexpected request: $call")
            }
        }
        val catalog = CatalogRepository(server.api, scopes)
        var visible = source.copy(feed = "", episodes = emptyList())
        val opening = async { catalog.load(visible, recheck = true, refreshIfStale = true, onRead = { visible = it }) }
        arrived.await()
        try {
            assertNull(scopes.current.value.accountId)
            assertEquals(source.feed, visible.feed)
            assertEquals(setOf(1L, 2L), visible.episodes.map { it.id }.toSet())
            assertEquals(setOf(1L, 2L), catalog.podcast(source.feed).first()!!.episodes.map { it.id }.toSet())
        } finally { release.complete(Unit) }
        val pending = opening.await()
        assertEquals(FeedFreshness.State.pending, pending.freshness?.state)
        assertEquals(pending.freshness, catalog.podcast(source.feed).first()!!.freshness)

        ready = true
        val updated = catalog.load(pending, recheck = true)
        assertEquals(setOf(1L, 2L, 3L), updated.episodes.map { it.id }.toSet())
        assertEquals(FeedFreshness.State.fresh, updated.freshness?.state)
        assertEquals(1, server.calls.count { it.path == "/api/feed/refresh" })
    }

    @Test fun completionBetweenReadAndAdmissionLoadsTheNewEpisodes() = runTest {
        var ready = false
        val server = FakeServer { call ->
            when (call.path) {
                "/api/feed/info" -> Reply(info)
                "/api/feed/episodes" -> Reply(page(if (ready) "fresh" else "stale", if (ready) listOf(2, 1) else listOf(1), checked = if (ready) 2000 else 1000))
                "/api/feed/refresh" -> { ready = true; Reply(refresh("fresh", checked = 2000)) }
                else -> error("Unexpected request: $call")
            }
        }
        val updated = CatalogRepository(server.api, scopes).load(source, recheck = true, refreshIfStale = true)
        assertEquals(setOf(1L, 2L), updated.episodes.map { it.id }.toSet())
        assertEquals(FeedFreshness.State.fresh, updated.freshness?.state)
        assertEquals(2, server.calls.count { it.path == "/api/feed/episodes" })
        assertEquals(1, server.calls.count { it.path == "/api/feed/refresh" })
    }

    @Test fun temporaryAdmissionFailuresKeepAvailableEpisodesWithoutInventingPending() = runTest {
        for (status in listOf(0, 429, 503)) {
            val server = FakeServer { call ->
                when (call.path) {
                    "/api/feed/info" -> Reply(info)
                    "/api/feed/episodes" -> Reply(page("stale"))
                    "/api/feed/refresh" -> if (status == 0) throw IOException("Offline") else Reply("""{"message":"Busy"}""", code = status)
                    else -> error("Unexpected request: $call")
                }
            }
            val updated = CatalogRepository(server.api, scopes).load(source, recheck = true, refreshIfStale = true)
            assertEquals(listOf(1L), updated.episodes.map { it.id })
            assertEquals(FeedFreshness.State.stale, updated.freshness?.state)
            assertEquals(1, server.calls.count { it.path == "/api/feed/refresh" })
        }
    }

    @Test fun admissionDoesNotHideLostAccess() = runTest {
        for (status in listOf(401, 403, 404)) {
            val server = FakeServer { call ->
                when (call.path) {
                    "/api/feed/info" -> Reply(info)
                    "/api/feed/episodes" -> Reply(page("stale"))
                    "/api/feed/refresh" -> Reply("""{"message":"Unavailable"}""", code = status)
                    else -> error("Unexpected request: $call")
                }
            }
            val failure = runCatching { CatalogRepository(server.api, scopes).load(source, recheck = true, refreshIfStale = true) }.exceptionOrNull()
            assertEquals(status, (failure as? ApiException)?.status)
        }
    }

    @Test fun freshOrAlreadyScheduledFeedsDoNotCreateMoreDemand() = runTest {
        for (state in listOf("fresh", "pending", "backoff", "unavailable")) {
            val server = FakeServer { call ->
                when (call.path) {
                    "/api/feed/info" -> Reply(info)
                    "/api/feed/episodes" -> Reply(page(state))
                    else -> error("Unexpected request: $call")
                }
            }
            val updated = CatalogRepository(server.api, scopes).load(source, recheck = true, refreshIfStale = true)
            assertEquals(state, updated.freshness?.state?.name)
            assertEquals(2, server.calls.size)
        }
    }

    @Test fun retiredReaderCannotPublishAdmissionIntoANewerEpoch() = runTest {
        val arrived = CompletableDeferred<Unit>()
        val release = CompletableDeferred<Unit>()
        val server = FakeServer { call ->
            when (call.path) {
                "/api/feed/info" -> Reply(info)
                "/api/feed/episodes" -> Reply(page("stale"))
                "/api/feed/refresh" -> {
                    arrived.complete(Unit)
                    runBlocking { release.await() }
                    Reply(refresh("pending"), code = 202)
                }
                else -> error("Unexpected request: $call")
            }
        }
        val catalog = CatalogRepository(server.api, scopes)
        val opening = async { runCatching { catalog.load(source, recheck = true, refreshIfStale = true) } }
        arrived.await()
        scopes.suspendSync()
        release.complete(Unit)
        assertTrue(opening.await().exceptionOrNull() is CancellationException)
        assertTrue(catalog.freshness.first().isEmpty())
    }

    @Test fun feedOnlyNavigationKeepsTheAutomaticRefreshIntentAfterResolution() = runTest {
        val server = FakeServer { call ->
            when (call.path) {
                "/api/feed" -> Reply("""{"id":"152","feed":"${source.feed}","title":"Daily fixture","episodes":[],"freshness":${freshness("stale")}}""")
                "/api/feed/info" -> Reply(info)
                "/api/feed/episodes" -> Reply(page("stale"))
                "/api/feed/refresh" -> Reply(refresh("pending"), code = 202)
                else -> error("Unexpected request: $call")
            }
        }
        val updated = CatalogRepository(server.api, scopes).load(source.copy(id = null), recheck = true, refreshIfStale = true)
        assertEquals(FeedFreshness.State.pending, updated.freshness?.state)
        assertEquals(1, server.calls.count { it.path == "/api/feed/refresh" })
    }

    private val info = """{"id":"152","feed":"${source.feed}","title":"Daily fixture","episodeCount":1}"""
    private fun freshness(state: String, checked: Long = 1000) =
        """{"content":"cached","state":"$state","checkedAtMs":$checked,"retryAtMs":${if (state in listOf("pending", "backoff")) 5000 else "null"}}"""
    private fun refresh(state: String, checked: Long = 1000) = """{"podcastId":"152","freshness":${freshness(state, checked)}}"""
    private fun page(state: String, ids: List<Int> = listOf(1), checked: Long = 1000): String {
        val episodes = ids.joinToString(",") { """{"id":"$it","podcastId":"152","guid":"episode-$it","feed":"${source.feed}","title":"Episode $it","file":{"url":"https://example.test/$it.mp3"}}""" }
        return """{"episodes":[$episodes],"total":${ids.size},"hasMore":false,"freshness":${freshness(state, checked)}}"""
    }
}
