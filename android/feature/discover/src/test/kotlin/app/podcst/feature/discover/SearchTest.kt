package app.podcst.feature.discover

import app.cash.turbine.test
import app.podcst.model.Podcast
import app.podcst.model.Region
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class SearchTest {
    private val podcast = Podcast(feed = "https://example.com/feed", title = "Example")

    @Test
    fun detectsFeedUrls() {
        listOf(
            "https://example.com/feed.xml",
            "HTTP://EXAMPLE.COM",
            "http:example.com",
            "feed://example.com/rss",
            "itpc://example.com/rss",
            "podcast+rss://example.com",
        ).forEach { assertTrue(it, isFeedUrl(it)) }
        listOf(
            "",
            "history",
            "example.com/feed",
            "https",
            "1x://example.com",
            " https://example.com",
            "the https://example.com show",
        ).forEach { assertFalse(it, isFeedUrl(it)) }
    }

    @Test
    fun remembersTrimmedTermsButNeverFeedsOrBlanks() {
        assertEquals("science weekly", recentTerm("  science weekly \n"))
        assertNull(recentTerm(""))
        assertNull(recentTerm("   "))
        assertNull(recentTerm("https://example.com/feed.xml"))
        assertNull(recentTerm("  feed://example.com/rss"))
    }

    @Test
    fun waitsForTheDebounceBeforeSearching() = runTest {
        val calls = mutableListOf<Pair<String, Region>>()
        val requests = MutableStateFlow(request("history"))
        searches(requests) { term, region -> calls += term to region; listOf(podcast) }.test {
            assertEquals(SearchOutcome.Idle, awaitItem())
            advanceTimeBy(searchDebounce.inWholeMilliseconds - 1)
            runCurrent()
            assertTrue(calls.isEmpty())
            advanceTimeBy(1)
            assertEquals(SearchOutcome.Searching, awaitItem())
            assertEquals(SearchOutcome.Found(listOf(podcast)), awaitItem())
            assertEquals(listOf("history" to Region.US), calls)
        }
    }

    @Test
    fun typingWithinTheDebounceSearchesOnlyTheLatestTerm() = runTest {
        val calls = mutableListOf<String>()
        val requests = MutableStateFlow(request("h"))
        searches(requests) { term, _ -> calls += term; emptyList() }.test {
            assertEquals(SearchOutcome.Idle, awaitItem())
            advanceTimeBy(200)
            requests.value = request("hi")
            advanceTimeBy(200)
            requests.value = request("his")
            advanceTimeBy(searchDebounce.inWholeMilliseconds)
            runCurrent()
            assertEquals(SearchOutcome.Found(emptyList()), expectMostRecentItem())
            assertEquals(listOf("his"), calls)
        }
    }

    @Test
    fun aNewRequestCancelsTheSearchInFlight() = runTest {
        val first = CompletableDeferred<List<Podcast>>()
        var cancelled = false
        val requests = MutableStateFlow(request("history"))
        searches(requests) { term, _ ->
            if (term == "history") {
                try {
                    first.await()
                } catch (cancellation: kotlinx.coroutines.CancellationException) {
                    cancelled = true
                    throw cancellation
                }
            } else {
                listOf(podcast)
            }
        }.test {
            assertEquals(SearchOutcome.Idle, awaitItem())
            assertEquals(SearchOutcome.Searching, awaitItem())
            requests.value = request("history", region = Region.NL)
            assertEquals(SearchOutcome.Idle, awaitItem())
            assertTrue(cancelled)
            first.complete(listOf(podcast))
            assertEquals(SearchOutcome.Searching, awaitItem())
            awaitItem()
        }
    }

    @Test
    fun rerunsWhenTheSessionUserOrRegionChanges() = runTest {
        val calls = mutableListOf<SearchRequest>()
        val requests = MutableStateFlow(request("history"))
        searches(requests) { term, region -> calls += request(term, region); emptyList() }.test {
            skipItems(3)
            requests.value = request("history", user = "user")
            skipItems(3)
            requests.value = request("history", user = "user", region = Region.NL)
            skipItems(3)
            requests.value = request("history", user = "user", region = Region.NL)
            advanceTimeBy(searchDebounce.inWholeMilliseconds * 2)
            expectNoEvents()
            assertEquals(listOf(Region.US, Region.US, Region.NL), calls.map { it.region })
        }
    }

    @Test
    fun feedUrlsRequireASignedInUser() = runTest {
        val calls = mutableListOf<String>()
        val feed = "https://example.com/private.xml"
        val requests = MutableStateFlow(request(feed))
        searches(requests) { term, _ -> calls += term; listOf(podcast) }.test {
            assertEquals(SearchOutcome.Idle, awaitItem())
            advanceTimeBy(searchDebounce.inWholeMilliseconds * 2)
            expectNoEvents()
            assertTrue(calls.isEmpty())
            requests.value = request(feed, user = "user")
            assertEquals(SearchOutcome.Idle, awaitItem())
            assertEquals(SearchOutcome.Searching, awaitItem())
            assertEquals(SearchOutcome.Found(listOf(podcast)), awaitItem())
            assertEquals(listOf(feed), calls)
        }
    }

    @Test
    fun waitsForTheSessionAndIgnoresBlankTerms() = runTest {
        val calls = mutableListOf<String>()
        val requests = MutableStateFlow(request("history", loading = true))
        searches(requests) { term, _ -> calls += term; emptyList() }.test {
            assertEquals(SearchOutcome.Idle, awaitItem())
            advanceTimeBy(searchDebounce.inWholeMilliseconds * 2)
            requests.value = request("")
            assertEquals(SearchOutcome.Idle, awaitItem())
            advanceTimeBy(searchDebounce.inWholeMilliseconds * 2)
            expectNoEvents()
            assertTrue(calls.isEmpty())
        }
    }

    @Test
    fun reportsFailures() = runTest {
        searches(MutableStateFlow(request("history"))) { _, _ -> error("offline") }.test {
            assertEquals(SearchOutcome.Idle, awaitItem())
            assertEquals(SearchOutcome.Searching, awaitItem())
            assertEquals(SearchOutcome.Failed("offline"), awaitItem())
        }
    }

    private fun request(term: String, region: Region = Region.US, user: String? = null, loading: Boolean = false) =
        SearchRequest(term, region, user, loading)
}
