package app.podcst.data

import app.podcst.database.PodcstDatabase
import app.podcst.model.Episode
import app.podcst.model.EpisodeFile
import app.podcst.model.EpisodeQuery
import app.podcst.model.EpisodeSort
import app.podcst.model.Podcast
import app.podcst.model.SortDirection
import app.podcst.network.testing.FakeServer
import app.podcst.network.testing.Reply
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.async
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
class CatalogDetailTest {
    private val context = RuntimeEnvironment.getApplication()
    private val scopes = Scopes(context, null)
    private val source = Podcast(id = 152, feed = "https://example.test/daily.xml", title = "Daily fixture", cover = "https://example.test/cover.jpg")
    private val body = """{"episodes":[{"id":"25","guid":"episode-25","title":"Latest episode","file":{"url":"https://example.test/latest.mp3"}}],"total":2000,"hasMore":true,"nextCursor":30,"freshness":{"content":"cached","state":"fresh","checkedAtMs":1000,"retryAtMs":null}}"""

    private fun episode(id: Long) = Episode(id = id, guid = "episode-$id", feed = source.feed, title = "Episode $id", file = EpisodeFile("https://example.test/$id.mp3"))
    private fun pageBody(ids: List<Long>, total: Int, next: Int?) = """{"episodes":[${ids.joinToString(",") { """{"id":"$it","guid":"episode-$it","title":"Episode $it","file":{"url":"https://example.test/$it.mp3"}}""" }}],"total":$total,"hasMore":${next != null},"nextCursor":$next,"freshness":{"content":"cached","state":"fresh","checkedAtMs":1000,"retryAtMs":null}}"""

    @After fun close() {
        scopes.close()
        PodcstDatabase.delete(context, "guest")
    }

    @Test fun firstPageIsBoundedAndNeverMarksArchiveComplete() = runTest {
        val server = FakeServer { Reply(body) }
        val catalog = CatalogRepository(server.api, scopes)
        val page = catalog.detailPage(source, EpisodeQuery(), null)
        assertEquals(1, server.calls.size)
        assertEquals("podcastId=152&limit=30&sortBy=published&sortDir=desc", server.calls.single().query)
        assertEquals(30, page.nextCursor)
        assertEquals(source.feed, page.episodes.single().feed)
        assertFalse(scopes.database.podcasts().byId(152)!!.complete)
        assertEquals(page.episodes.map { it.identity }, catalog.cachedDetail(source)!!.episodes.map { it.identity })
        assertEquals(page.episodes.map { it.file }, catalog.cachedDetail(source)!!.episodes.map { it.file })
    }

    @Test fun completeQueryAndCursorAreForwardedAndSearchCacheIsNotLatest() = runTest {
        val server = FakeServer { Reply(body) }
        val catalog = CatalogRepository(server.api, scopes)
        val query = EpisodeQuery("older", EpisodeSort.Title, SortDirection.Ascending, true)
        catalog.detailPage(source, query, 30)
        assertEquals("podcastId=152&limit=30&sortBy=title&sortDir=asc&cursor=30&search=older&unplayed=true", server.calls.single().query)
        assertTrue(catalog.cachedDetail(source)!!.episodes.isEmpty())
        assertEquals(1, scopes.database.episodes().catalog(source.feed).size)
    }

    @Test fun retiredPageCannotPopulateAnotherScopeCache() = runTest {
        val arrived = CompletableDeferred<Unit>()
        val release = CompletableDeferred<Unit>()
        val server = FakeServer {
            arrived.complete(Unit)
            runBlocking { release.await() }
            Reply(body)
        }
        val catalog = CatalogRepository(server.api, scopes)
        val reading = async { runCatching { catalog.detailPage(source, EpisodeQuery(), null) } }
        arrived.await()
        scopes.suspendSync()
        release.complete(Unit)
        assertTrue(reading.await().exceptionOrNull() is CancellationException)
        assertTrue(scopes.database.episodes().catalog(source.feed).isEmpty())
        assertNull(catalog.cachedDetail(source))
    }

    @Test fun persistedFirstPageRemainsAvailableAfterGuestSessionEpochChanges() = runTest {
        val catalog = CatalogRepository(FakeServer { Reply(body) }.api, scopes)
        catalog.detailPage(source, EpisodeQuery(), null)
        assertEquals(1, catalog.cachedDetail(source)!!.episodes.size)
        scopes.suspendSync()
        assertEquals(1, catalog.cachedDetail(source)!!.episodes.size)
    }
    @Test fun terminalAccessFailureInvalidatesDetailSnapshotButKeepsRetainedEpisodes() = runTest {
        var deny = false
        val server = FakeServer { if (deny) Reply("{}", 403) else Reply(body) }
        val catalog = CatalogRepository(server.api, scopes)
        catalog.detailPage(source, EpisodeQuery(), null)
        assertEquals(1, catalog.cachedDetail(source)!!.episodes.size)
        deny = true
        assertTrue(runCatching { catalog.detailPage(source, EpisodeQuery(), null) }.isFailure)
        assertNull(catalog.cachedDetail(source))
        assertEquals(1, scopes.database.episodes().catalog(source.feed).size)
        assertFalse(scopes.database.podcasts().byId(152)!!.complete)
    }

    @Test fun missingContentRecheckDoesNotReplaceUsableFirstPage() = runTest {
        var missing = false
        val server = FakeServer { Reply(if (!missing) body else """{"episodes":[],"total":0,"hasMore":false,"nextCursor":null,"freshness":{"content":"missing","state":"pending","checkedAtMs":null,"retryAtMs":5000}}""") }
        val catalog = CatalogRepository(server.api, scopes)
        val available = catalog.detailPage(source, EpisodeQuery(), null)
        missing = true
        assertTrue(catalog.detailPage(source, EpisodeQuery(), null).episodes.isEmpty())
        assertEquals(available.episodes.map { it.identity }, catalog.cachedDetail(source)!!.episodes.map { it.identity })
        assertEquals(available.episodes.map { it.file }, catalog.cachedDetail(source)!!.episodes.map { it.file })
    }

    @Test fun firstPageMembershipSurvivesProcessRestartWithoutNetworkOrSearchContamination() = runTest {
        val server = FakeServer { Reply(body) }
        val catalog = CatalogRepository(server.api, scopes)
        val first = catalog.detailPage(source, EpisodeQuery(), null)
        scopes.close()
        val restarted = Scopes(context, null)
        try {
            val offline = FakeServer { error("Offline reads must not touch network") }
            val cached = CatalogRepository(offline.api, restarted).cachedDetail(source)!!
            assertEquals(first.episodes.map { it.identity }, cached.episodes.map { it.identity })
            assertEquals(first.episodes.map { it.file }, cached.episodes.map { it.file })
            assertTrue(offline.calls.isEmpty())
        } finally { restarted.close() }
    }

    @Test fun deepLinkPageBeforeMetadataCanBeRestoredAfterRestart() = runTest {
        val info = """{"id":"152","feed":"${source.feed}","title":"${source.title}","cover":"${source.cover}"}"""
        val server = FakeServer { if (it.path.endsWith("info")) Reply(info) else Reply(body) }
        val catalog = CatalogRepository(server.api, scopes)
        val route = source.copy(feed = "", cover = "")
        catalog.detailPage(route, EpisodeQuery(), null)
        catalog.detailInfo(route)
        scopes.close()
        val restarted = Scopes(context, null)
        try {
            val restored = CatalogRepository(server.api, restarted).cachedDetail(route)!!
            assertEquals(source.feed, restored.episodes.single().feed)
            assertEquals(source.cover, restored.episodes.single().cover)
        } finally { restarted.close() }
    }

    @Test fun completeArchiveRemainsAccessibleAfterPartialPagesAndRestart() = runTest {
        val server = FakeServer { call ->
            Reply(if (call.query.orEmpty().contains("search=")) pageBody(listOf(999), 1, null)
                else pageBody((91L downTo 62L).toList(), 91, 30))
        }
        val catalog = CatalogRepository(server.api, scopes)
        catalog.store(listOf(source.copy(episodes = (90L downTo 1L).map(::episode), episodeCount = 90)), complete = true)
        assertEquals(90, catalog.cachedDetail(source)!!.episodes.size)
        catalog.detailPage(source, EpisodeQuery(search = "unrelated"), null)
        catalog.detailPage(source, EpisodeQuery(), null)
        scopes.close()
        val restarted = Scopes(context, null)
        try {
            val offline = FakeServer { error("Offline reads must not touch network") }
            val cached = CatalogRepository(offline.api, restarted).cachedDetail(source)!!
            assertEquals((91L downTo 1L).toList(), cached.episodes.map { it.id })
            assertEquals(91L, cached.episodes.first().id)
            assertTrue(offline.calls.isEmpty())
        } finally { restarted.close() }
    }

    @Test fun loadedOlderPagesRemainAccessibleAfterRestartWithoutSearchRows() = runTest {
        val server = FakeServer { call -> Reply(when {
            call.path.endsWith("info") -> """{"id":"152","feed":"${source.feed}","title":"${source.title}","cover":"${source.cover}"}"""
            call.query.orEmpty().contains("search=") -> pageBody(listOf(999), 1, null)
            call.query.orEmpty().contains("cursor=30") -> pageBody((60L downTo 31L).toList(), 90, 60)
            else -> pageBody((90L downTo 61L).toList(), 90, 30)
        }) }
        val catalog = CatalogRepository(server.api, scopes)
        catalog.detailPage(source, EpisodeQuery(), null)
        catalog.detailPage(source, EpisodeQuery(), 30)
        catalog.detailInfo(source)
        catalog.detailPage(source, EpisodeQuery(search = "unrelated"), null)
        scopes.close()
        val restarted = Scopes(context, null)
        try {
            val offline = FakeServer { error("Offline reads must not touch network") }
            val cached = CatalogRepository(offline.api, restarted).cachedDetail(source)!!
            assertEquals((90L downTo 31L).toList(), cached.episodes.map { it.id })
            assertTrue(offline.calls.isEmpty())
        } finally { restarted.close() }
    }

}
