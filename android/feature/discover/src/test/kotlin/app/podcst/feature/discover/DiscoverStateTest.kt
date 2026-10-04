package app.podcst.feature.discover

import app.podcst.model.Podcast
import app.podcst.model.User
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class DiscoverStateTest {
    private val chart = List(4) { Podcast(feed = "feed$it", title = "Podcast $it") }

    @Test
    fun splitsTheChartIntoFeaturedAndRanked() {
        val state = DiscoverState(chart = chart, load = ChartLoad.Loaded)
        assertEquals(chart[0], state.featured)
        assertEquals(listOf(2, 3, 4), state.ranked.map { it.rank })
        assertEquals(chart.drop(1), state.ranked.map { it.podcast })
    }

    @Test
    fun anEmptyChartHasNothingToFeature() {
        val state = DiscoverState()
        assertNull(state.featured)
        assertTrue(state.ranked.isEmpty())
    }

    @Test
    fun aSinglePodcastIsOnlyFeatured() {
        val state = DiscoverState(chart = chart.take(1))
        assertEquals(chart[0], state.featured)
        assertTrue(state.ranked.isEmpty())
    }

    @Test
    fun refreshesVisiblyOnlyOverAnExistingChart() {
        assertFalse(DiscoverState(load = ChartLoad.Loading).refreshing)
        assertTrue(DiscoverState(chart = chart, load = ChartLoad.Loading).refreshing)
        assertFalse(DiscoverState(chart = chart, load = ChartLoad.Loaded).refreshing)
        assertFalse(DiscoverState(chart = chart, load = ChartLoad.Failed).refreshing)
    }

    @Test
    fun marksSubscribedPodcastsByFeed() {
        val state = DiscoverState(chart = chart, subscribed = setOf("feed2"))
        assertTrue(state.subscribed(chart[2]))
        assertFalse(state.subscribed(chart[1]))
    }

    @Test
    fun derivesTheAccountInitial() {
        assertNull(DiscoverState().initial)
        assertEquals("s", DiscoverState(user = User("1", "Shantanu@example.com")).initial)
        assertEquals("r", DiscoverState(user = User("1", "s@example.com", name = "Raj")).initial)
        assertEquals("s", DiscoverState(user = User("1", "s@example.com", name = " ")).initial)
    }
}
