package app.podcst.data

import app.podcst.database.PodcstDatabase
import app.podcst.database.RelatedPodcastsEntity
import app.podcst.model.Podcast
import app.podcst.model.Region
import app.podcst.network.testing.FakeServer
import app.podcst.network.testing.Reply
import app.podcst.network.ApiException
import java.io.IOException
import java.util.concurrent.atomic.AtomicInteger
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.async
import kotlinx.coroutines.cancelAndJoin
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
class RelatedPodcastsTest {
    private val context = RuntimeEnvironment.getApplication()
    private var scopes = Scopes(context, null)
    private val podcast = Podcast(id = 1, feed = "https://example.test/daily.xml", title = "The Daily")
    private val response = """[{"id":"42","feed":"https://example.test/related.xml","title":"Related show"}]"""

    @After fun close() {
        scopes.close()
        PodcstDatabase.delete(context, "guest")
    }

    @Test fun recommendationsSurviveRestartWithoutPopulatingTheLibrary() = runTest {
        val server = FakeServer { Reply(response) }
        val catalog = CatalogRepository(server.api, scopes)
        assertNull(catalog.cachedRelated(podcast, Region.DEFAULT))
        val result = catalog.related(podcast, Region.DEFAULT)
        assertEquals(listOf(42L), result.map { it.id })
        assertEquals(result, catalog.cachedRelated(podcast, Region.DEFAULT))
        assertNull(scopes.database.podcasts().byId(42))
        assertEquals("/api/feed/related", server.calls.single().path)
        assertEquals("id=1&locale=${Region.DEFAULT.code}", server.calls.single().query)
        scopes.close()
        scopes = Scopes(context, null)
        val restored = CatalogRepository(server.api, scopes)
        assertEquals(result, restored.cachedRelated(podcast, Region.DEFAULT))
        assertEquals(result, restored.related(podcast, Region.DEFAULT))
        assertEquals(1, server.calls.size)
    }

    @Test fun emptyRecommendationsAreCachedAndUncachedFailuresStillThrow() = runTest {
        val server = FakeServer { Reply("[]") }
        val catalog = CatalogRepository(server.api, scopes)
        assertNull(catalog.cachedRelated(podcast, Region.DEFAULT))
        assertTrue(catalog.related(podcast, Region.DEFAULT).isEmpty())
        assertEquals(emptyList<Podcast>(), catalog.cachedRelated(podcast, Region.DEFAULT))
        val offline = CatalogRepository(FakeServer { throw IOException("offline") }.api, scopes)
        assertTrue(offline.related(podcast, Region.DEFAULT).isEmpty())
        assertTrue(runCatching { offline.related(podcast.copy(id = 2), Region.DEFAULT) }.exceptionOrNull() is IOException)
    }

    @Test fun recommendationsAreSeparatedBySourceRegionAndAccount() = runTest {
        val server = FakeServer { Reply(response) }
        val catalog = CatalogRepository(server.api, scopes)
        val region = requireNotNull(Region.of("nl"))
        val saved = catalog.related(podcast, region)
        assertNull(catalog.cachedRelated(podcast.copy(id = 2), region))
        assertNull(catalog.cachedRelated(podcast, Region.DEFAULT))
        assertEquals(saved, catalog.cachedRelated(podcast, requireNotNull(Region.of("NL"))))
        scopes.switch("listener")
        try {
            assertTrue(runCatching { catalog.cachedRelated(podcast, region) }.exceptionOrNull() is CancellationException)
            scopes.resumeSync("listener")
            assertNull(catalog.cachedRelated(podcast, region))
            assertEquals(saved, catalog.related(podcast, region))
            assertEquals(2, server.calls.size)
            scopes.switch(null)
            assertEquals(saved, catalog.cachedRelated(podcast, region))
        } finally {
            if (scopes.current.value.accountId != null) scopes.switch(null)
            PodcstDatabase.delete(context, Scope.key("listener"))
        }
    }

    @Test fun staleRecommendationsRemainAvailableDuringRefreshAndSuccessfulEmptyResultsReplaceThem() = runTest {
        var now = 1000L
        val arrived = CompletableDeferred<Unit>()
        val release = CompletableDeferred<Unit>()
        val requests = AtomicInteger()
        val server = FakeServer {
            if (requests.incrementAndGet() == 1) Reply(response) else {
                arrived.complete(Unit)
                runBlocking { release.await() }
                Reply("[]")
            }
        }
        val catalog = CatalogRepository(server.api, scopes) { now }
        val saved = catalog.related(podcast, Region.DEFAULT)
        now += 3_600_000
        val refresh = async { catalog.related(podcast, Region.DEFAULT) }
        arrived.await()
        assertEquals(saved, catalog.cachedRelated(podcast, Region.DEFAULT))
        release.complete(Unit)
        assertTrue(refresh.await().isEmpty())
        assertEquals(emptyList<Podcast>(), catalog.cachedRelated(podcast, Region.DEFAULT))
        assertTrue(catalog.related(podcast, Region.DEFAULT).isEmpty())
        assertEquals(2, server.calls.size)
    }

    @Test fun transientFailuresKeepStaleRecommendationsAndPermanentFailuresDoNot() = runTest {
        var now = 1000L
        val seed = CatalogRepository(FakeServer { Reply(response) }.api, scopes) { now }
        val saved = seed.related(podcast, Region.DEFAULT)
        now += 3_600_000
        val offline = CatalogRepository(FakeServer { throw IOException("offline") }.api, scopes) { now }
        assertEquals(saved, offline.related(podcast, Region.DEFAULT))
        for (status in listOf(429, 500, 503)) {
            val busy = CatalogRepository(FakeServer { Reply("""{"message":"Try later"}""", status) }.api, scopes) { now }
            assertEquals(saved, busy.related(podcast, Region.DEFAULT))
        }
        val invalid = CatalogRepository(FakeServer { Reply("""{"message":"Invalid request"}""", 400) }.api, scopes) { now }
        assertEquals(400, (runCatching { invalid.related(podcast, Region.DEFAULT) }.exceptionOrNull() as ApiException).status)
        for (status in listOf(401, 403, 404)) {
            val denied = CatalogRepository(FakeServer { Reply("""{"message":"Unavailable"}""", status) }.api, scopes) { now }
            assertEquals(status, (runCatching { denied.related(podcast, Region.DEFAULT) }.exceptionOrNull() as ApiException).status)
            assertNull(denied.cachedRelated(podcast, Region.DEFAULT))
            seed.related(podcast, Region.DEFAULT)
            now += 3_600_000
        }
    }

    @Test fun concurrentReadersShareOneRequestAndCancellingAWaiterDoesNotCancelIt() = runTest {
        val arrived = CompletableDeferred<Unit>()
        val release = CompletableDeferred<Unit>()
        val server = FakeServer {
            arrived.complete(Unit)
            runBlocking { release.await() }
            Reply(response)
        }
        val catalog = CatalogRepository(server.api, scopes)
        val first = async { catalog.related(podcast, Region.DEFAULT) }
        arrived.await()
        val cancelled = async(start = CoroutineStart.UNDISPATCHED) { catalog.related(podcast, Region.DEFAULT) }
        val second = async(start = CoroutineStart.UNDISPATCHED) { catalog.related(podcast, Region.DEFAULT) }
        cancelled.cancelAndJoin()
        release.complete(Unit)
        assertEquals(first.await(), second.await())
        assertEquals(1, server.calls.size)
    }

    @Test fun activeWaiterRetriesWhenTheInitiatingReaderIsCancelled() = runTest {
        val arrived = CompletableDeferred<Unit>()
        val release = CompletableDeferred<Unit>()
        val requests = AtomicInteger()
        val server = FakeServer {
            if (requests.incrementAndGet() == 1) {
                arrived.complete(Unit)
                runBlocking { release.await() }
            }
            Reply(response)
        }
        val catalog = CatalogRepository(server.api, scopes)
        val first = async { catalog.related(podcast, Region.DEFAULT) }
        arrived.await()
        val second = async(start = CoroutineStart.UNDISPATCHED) { catalog.related(podcast, Region.DEFAULT) }
        try {
            first.cancelAndJoin()
            assertEquals(listOf(42L), second.await().map { it.id })
            assertEquals(2, server.calls.size)
        } finally {
            release.complete(Unit)
        }
    }

    @Test fun cacheRetainsFortySnapshotsWithoutEvictingAnotherServer() = runTest {
        var now = 1000L
        val server = FakeServer { Reply(response) }
        val catalog = CatalogRepository(server.api, scopes) { now }
        val unrelated = RelatedPodcastsEntity("https://podcst.test.other/", 1, "us", "[]", now)
        scopes.database.relatedPodcasts().write(unrelated)
        for (id in 1L..41L) {
            catalog.related(podcast.copy(id = id), Region.DEFAULT)
            now += 1
        }
        assertNull(catalog.cachedRelated(podcast, Region.DEFAULT))
        for (id in 2L..41L) assertEquals(listOf(42L), catalog.cachedRelated(podcast.copy(id = id), Region.DEFAULT)?.map { it.id })
        assertEquals(unrelated, scopes.database.relatedPodcasts().get(unrelated.server, 1, "us"))
    }

    @Test fun privateAndUnresolvedSourcesDoNotReachTheNetwork() = runTest {
        val server = FakeServer { error("Unexpected request") }
        val catalog = CatalogRepository(server.api, scopes)
        assertTrue(catalog.related(podcast.copy(isPrivate = true), Region.DEFAULT).isEmpty())
        assertTrue(catalog.related(podcast.copy(id = null), Region.DEFAULT).isEmpty())
        assertTrue(catalog.related(podcast.copy(id = 0), Region.DEFAULT).isEmpty())
        assertTrue(catalog.related(podcast.copy(id = -1), Region.DEFAULT).isEmpty())
        assertNull(catalog.cachedRelated(podcast.copy(isPrivate = true), Region.DEFAULT))
        assertNull(catalog.cachedRelated(podcast.copy(id = null), Region.DEFAULT))
        assertTrue(server.calls.isEmpty())
    }

    @Test fun delayedResponsesCannotReturnToARetiredReader() = runTest {
        val arrived = CompletableDeferred<Unit>()
        val release = CompletableDeferred<Unit>()
        val server = FakeServer {
            arrived.complete(Unit)
            runBlocking { release.await() }
            Reply(response)
        }
        val catalog = CatalogRepository(server.api, scopes)
        val pending = async { runCatching { catalog.related(podcast, Region.DEFAULT) } }
        arrived.await()
        scopes.suspendSync()
        release.complete(Unit)
        assertTrue(pending.await().exceptionOrNull() is CancellationException)
        assertNull(scopes.database.podcasts().byId(42))
        assertNull(catalog.cachedRelated(podcast, Region.DEFAULT))
    }
}
