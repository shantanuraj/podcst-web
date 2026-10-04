package app.podcst

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class IncomingTest {
    private fun parse(path: String, host: String = "www.podcst.app", scheme: String = "https") =
        Incoming.link(scheme, host, path.trim('/').split('/').filter { it.isNotEmpty() })

    @Test
    fun podcastById() {
        val show = parse("/episodes/42") as Incoming.Show
        assertEquals(42L, show.podcast.id)
    }

    @Test
    fun podcastByEncodedFeed() {
        val show = parse("/episodes/https%3A%2F%2Ffeeds.example.com%2Fshow.xml") as Incoming.Show
        assertEquals("https://feeds.example.com/show.xml", show.podcast.feed)
    }

    @Test
    fun episodeByIds() {
        val item = parse("/episodes/42/1001") as Incoming.Item
        assertEquals(42L, item.podcast.id)
        assertEquals(1001L, item.episodeId)
    }

    @Test
    fun episodeByFeedAndGuid() {
        val item = parse("/episodes/https%3A%2F%2Fexample.com%2Ff.xml/abc%2F1") as Incoming.Item
        assertEquals("https://example.com/f.xml", item.podcast.feed)
        assertEquals("abc/1", item.guid)
    }

    @Test
    fun itunesAndShortLinks() {
        assertEquals(123L, (parse("/itunes/123") as Incoming.Show).podcast.itunesId)
        assertEquals("abc", (parse("/s/abc") as Incoming.Short).slug)
    }

    @Test
    fun foreignLinksAreIgnored() {
        assertNull(parse("/episodes/1", host = "example.com"))
        assertNull(parse("/episodes/1", scheme = "http"))
        assertNull(parse("/profile"))
    }
}
