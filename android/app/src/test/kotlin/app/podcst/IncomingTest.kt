package app.podcst

import app.podcst.model.Moment
import kotlin.time.Duration.Companion.seconds
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class IncomingTest {
    @Test
    fun sharedLinksUseTheSharingContract() {
        val shared = Incoming.link("https://podcst.app/episodes/42/1001?ch=2&t=1m-2m") as Incoming.Shared
        assertEquals(42L, shared.link.podcastId)
        assertEquals(1001L, shared.link.episodeId)
        assertEquals(Moment.Chapter(2, 60.seconds, 120.seconds), shared.link.moment)
    }

    @Test
    fun itunesAndShortLinks() {
        assertEquals(123L, (Incoming.link("https://www.podcst.app/itunes/123") as Incoming.Show).podcast.itunesId)
        assertEquals("abc", (Incoming.link("https://www.podcst.app/s/abc") as Incoming.Short).slug)
    }

    @Test
    fun foreignAndRetiredLinksAreIgnored() {
        assertNull(Incoming.link("https://example.com/episodes/1"))
        assertNull(Incoming.link("http://www.podcst.app/episodes/1"))
        assertNull(Incoming.link("https://www.podcst.app/profile"))
        assertNull(Incoming.link("https://www.podcst.app/episodes/https%3A%2F%2Fexample.com%2Ff.xml/abc"))
    }
}
