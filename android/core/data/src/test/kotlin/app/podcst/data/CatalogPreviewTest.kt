package app.podcst.data

import app.podcst.database.PodcstDatabase
import app.podcst.model.Podcast
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
class CatalogPreviewTest {
    private val context = RuntimeEnvironment.getApplication()
    private val scopes = Scopes(context, null)
    private val source = Podcast(id = 152, feed = "https://example.test/daily.xml", title = "Daily fixture", cover = "https://example.test/cover.jpg")
    private val info = """{"id":"152","feed":"${source.feed}","title":"Daily fixture","description":"A show about everyday life."}"""

    @After fun close() {
        scopes.close()
        PodcstDatabase.delete(context, "guest")
    }

    @Test fun readsOnlyMetadataWithoutFetchingOrStoringEpisodes() = runTest {
        val server = FakeServer { Reply(info) }
        val result = CatalogRepository(server.api, scopes).info(source)
        assertEquals("A show about everyday life.", result.description)
        assertEquals("/api/feed/info", server.calls.single().path)
        assertEquals("id=152", server.calls.single().query)
        assertTrue(result.episodes.isEmpty())
        assertNull(scopes.database.podcasts().byId(152))
    }

    @Test fun readsOnlyTheNewestEpisodeWithoutFollowingPagination() = runTest {
        val server = FakeServer {
            Reply("""{"episodes":[{"id":"25","guid":"episode-25","title":"Latest episode","file":{"url":"https://example.test/latest.mp3"}}],"total":2000,"hasMore":true,"nextCursor":1,"freshness":{"content":"cached","state":"fresh","checkedAtMs":1000,"retryAtMs":null}}""")
        }
        val result = CatalogRepository(server.api, scopes).latest(source)!!
        assertEquals(25L, result.id)
        assertEquals(152L, result.podcastId)
        assertEquals(source.feed, result.feed)
        assertEquals(source.title, result.podcastTitle)
        assertEquals(source.cover, result.cover)
        assertEquals("/api/feed/episodes", server.calls.single().path)
        assertEquals("podcastId=152&limit=1&sortBy=published&sortDir=desc", server.calls.single().query)
        assertNull(scopes.database.episodes().get(result.identity.value))
    }

    @Test fun privateGuestAndUnresolvedSourcesDoNotReachTheNetwork() = runTest {
        val server = FakeServer { error("Unexpected request") }
        val catalog = CatalogRepository(server.api, scopes)
        val privatePodcast = source.copy(isPrivate = true)
        assertTrue(runCatching { catalog.info(privatePodcast) }.exceptionOrNull() is CancellationException)
        assertTrue(runCatching { catalog.latest(privatePodcast) }.exceptionOrNull() is CancellationException)
        for (id in listOf(null, 0L, -1L)) {
            val unresolved = source.copy(id = id)
            assertEquals(unresolved, catalog.info(unresolved))
            assertNull(catalog.latest(unresolved))
        }
        assertTrue(server.calls.isEmpty())
    }

    @Test fun delayedMetadataCannotReturnToARetiredReader() = runTest {
        val arrived = CompletableDeferred<Unit>()
        val release = CompletableDeferred<Unit>()
        val server = FakeServer {
            arrived.complete(Unit)
            runBlocking { release.await() }
            Reply(info)
        }
        val catalog = CatalogRepository(server.api, scopes)
        val pending = async { runCatching { catalog.info(source) } }
        arrived.await()
        scopes.suspendSync()
        release.complete(Unit)
        assertTrue(pending.await().exceptionOrNull() is CancellationException)
    }
}
