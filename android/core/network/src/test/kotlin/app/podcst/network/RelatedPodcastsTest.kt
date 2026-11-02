package app.podcst.network

import app.podcst.model.Podcast
import kotlinx.coroutines.test.runTest
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import okhttp3.OkHttpClient
import org.junit.Assert.*
import org.junit.Test

class RelatedPodcastsTest {
    private val podcast = Podcast(id = 1, feed = "https://example.test/daily.xml", title = "The Daily")

    @Test fun recommendationsUseTheCanonicalIdAndRegionWithoutSendingOrUpdatingSessionCookies() = runTest {
        MockWebServer().use { server ->
            server.start()
            val cookies = MemoryCookies().apply { write("current") }
            val api = PodcstApi(OkHttpClient(), cookies, server.url("/"))
            server.enqueue(MockResponse.Builder().body("""[{"id":"42","itunes_id":"1234","title":"Related show","author":"Publisher","cover":"https://example.test/art.jpg","count":17}]""")
                .addHeader("Set-Cookie", "session=unrelated; Path=/").build())

            val result = api.related(podcast, "nl").single()
            assertEquals(42L, result.id)
            assertEquals(1234L, result.itunesId)
            assertEquals(17, result.episodeCount)
            assertTrue(result.episodes.isEmpty())
            assertEquals("Related show", result.title)
            val request = server.takeRequest()
            assertEquals("GET", request.method)
            assertEquals("/api/feed/related?id=1&locale=nl", request.url.encodedPath + "?" + request.url.encodedQuery)
            assertNull(request.headers["Cookie"])
            assertEquals("current", cookies.read())
        }
    }

    @Test fun privateAndUnresolvedPodcastsNeverRequestRecommendations() = runTest {
        MockWebServer().use { server ->
            server.start()
            val api = PodcstApi(OkHttpClient(), MemoryCookies(), server.url("/"))
            assertTrue(api.related(podcast.copy(isPrivate = true), "us").isEmpty())
            assertTrue(api.related(podcast.copy(id = null), "us").isEmpty())
            assertTrue(api.related(podcast.copy(id = 0), "us").isEmpty())
            assertTrue(api.related(podcast.copy(id = -1), "us").isEmpty())
            assertEquals(0, server.requestCount)
        }
    }

    @Test fun emptyResultsAreValidAndFailuresRemainSeparateFromPodcastLoading() = runTest {
        MockWebServer().use { server ->
            server.start()
            val api = PodcstApi(OkHttpClient(), MemoryCookies(), server.url("/"))
            server.enqueue(MockResponse.Builder().body("[]").build())
            assertTrue(api.related(podcast, "us").isEmpty())
            server.enqueue(MockResponse.Builder().code(404).body("""{"message":"Podcast unavailable"}""").build())
            assertEquals(404, (runCatching { api.related(podcast, "us") }.exceptionOrNull() as ApiException).status)
        }
    }
}
