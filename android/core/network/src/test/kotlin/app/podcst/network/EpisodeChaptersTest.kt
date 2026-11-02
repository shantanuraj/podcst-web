package app.podcst.network

import app.podcst.model.ChapterSource
import app.podcst.model.Episode
import app.podcst.model.EpisodeFile
import java.util.concurrent.TimeUnit
import kotlin.coroutines.cancellation.CancellationException
import kotlin.time.Duration.Companion.seconds
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.withContext
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import okhttp3.OkHttpClient
import org.junit.Assert.*
import org.junit.Test

class EpisodeChaptersTest {
    private val episode = Episode(id = 330322021, guid = "900", feed = "https://example.test/feed", title = "Talk Me Into It", file = EpisodeFile("https://example.test/audio.mp3"))
    private val response = """{"chapters":[{"title":"Prologue","start":0},{"title":"Act One","start":450}],"source":"shownotes"}"""

    @Test fun chaptersLoadWithoutPlaybackAndUseTheCurrentSessionWithoutCaching() = runTest {
        MockWebServer().use { server ->
            server.start()
            val cookies = MemoryCookies()
            val api = PodcstApi(OkHttpClient(), cookies, server.url("/"))
            for (session in listOf(null, "current")) {
                if (session != null) cookies.write(session)
                server.enqueue(MockResponse.Builder().body(response).build())
                val chapters = api.episodeChapters(episode)
                assertEquals(ChapterSource.ShowNotes, chapters.source)
                assertEquals(listOf(0.seconds, 450.seconds), chapters.chapters.map { it.start })
                val request = server.takeRequest()
                assertEquals("GET", request.method)
                assertEquals("/api/episodes/330322021/chapters", request.url.encodedPath)
                assertEquals(session?.let { "session=$it" }, request.headers["Cookie"])
                assertTrue(request.headers["Cache-Control"].orEmpty().contains("no-store"))
            }
        }
    }

    @Test fun privateGuestAndDeletingAccountsCannotFetchChapters() = runTest {
        MockWebServer().use { server ->
            server.start()
            val api = PodcstApi(OkHttpClient(), MemoryCookies(), server.url("/"))
            assertTrue(runCatching { api.episodeChapters(episode.copy(isPrivate = true)) }.exceptionOrNull() is CancellationException)
            api.deletionBlocked = { true }
            assertTrue(runCatching { api.episodeChapters(episode) }.exceptionOrNull() is IllegalStateException)
            assertTrue(api.episodeChapters(episode.copy(id = null)).chapters.isEmpty())
            assertEquals(0, server.requestCount)
        }
    }

    @Test fun retiredResponsesCannotReturnChaptersOrRestoreCookies() = runTest {
        MockWebServer().use { server ->
            server.start()
            val cookies = MemoryCookies().apply { write("old") }
            val api = PodcstApi(OkHttpClient(), cookies, server.url("/"))
            server.enqueue(MockResponse.Builder().body(response).headersDelay(250, TimeUnit.MILLISECONDS).addHeader("Set-Cookie", "session=stale; Path=/").build())
            val pending = async { runCatching { api.episodeChapters(episode) } }
            withContext(Dispatchers.IO) { server.takeRequest() }
            api.clearSession()
            assertTrue(pending.await().exceptionOrNull() is CancellationException)
            assertNull(cookies.read())
        }
    }

    @Test fun malformedTimelinesAreRejectedBeforeTheyReachTheScreen() {
        for (entries in listOf(emptyList(), listOf(WireChapter("One", 0.0)), listOf(WireChapter("One", 0.0), WireChapter("Two", 0.0)), listOf(WireChapter("One", -1.0), WireChapter("Two", 1.0)), listOf(WireChapter("One", 0.0), WireChapter("Two", Double.NaN)))) {
            assertTrue(runCatching { WireEpisodeChapters(entries, WireChapterSource.Embedded).domain() }.isFailure)
        }
        assertTrue(runCatching { WireEpisodeChapters(listOf(WireChapter("One", 0.0)), WireChapterSource.None).domain() }.isFailure)
        assertEquals(ChapterSource.None, WireEpisodeChapters(emptyList(), WireChapterSource.None).domain().source)
    }
}
