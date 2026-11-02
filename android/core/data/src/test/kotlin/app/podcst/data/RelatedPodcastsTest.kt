package app.podcst.data

import app.podcst.database.PodcstDatabase
import app.podcst.model.Podcast
import app.podcst.model.Region
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
class RelatedPodcastsTest {
    private val context = RuntimeEnvironment.getApplication()
    private val scopes = Scopes(context, null)
    private val podcast = Podcast(id = 1, feed = "https://example.test/daily.xml", title = "The Daily")
    private val response = """[{"id":"42","feed":"https://example.test/related.xml","title":"Related show"}]"""

    @After fun close() {
        scopes.close()
        PodcstDatabase.delete(context, "guest")
    }

    @Test fun recommendationsStayTransientAndDoNotPopulateTheLibrary() = runTest {
        val server = FakeServer { Reply(response) }
        val result = CatalogRepository(server.api, scopes).related(podcast, Region.DEFAULT)
        assertEquals(listOf(42L), result.map { it.id })
        assertNull(scopes.database.podcasts().byId(42))
        assertEquals("/api/feed/related", server.calls.single().path)
        assertEquals("id=1&locale=${Region.DEFAULT.code}", server.calls.single().query)
    }

    @Test fun privateAndUnresolvedSourcesDoNotReachTheNetwork() = runTest {
        val server = FakeServer { error("Unexpected request") }
        val catalog = CatalogRepository(server.api, scopes)
        assertTrue(catalog.related(podcast.copy(isPrivate = true), Region.DEFAULT).isEmpty())
        assertTrue(catalog.related(podcast.copy(id = null), Region.DEFAULT).isEmpty())
        assertTrue(catalog.related(podcast.copy(id = 0), Region.DEFAULT).isEmpty())
        assertTrue(catalog.related(podcast.copy(id = -1), Region.DEFAULT).isEmpty())
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
    }
}
