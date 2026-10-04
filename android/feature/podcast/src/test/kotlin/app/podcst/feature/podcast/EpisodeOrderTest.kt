package app.podcst.feature.podcast

import app.podcst.model.Episode
import app.podcst.model.EpisodeFile
import app.podcst.model.EpisodeSort
import app.podcst.model.SortDirection
import java.text.Collator
import java.util.Locale
import kotlin.time.Duration
import kotlin.time.Duration.Companion.minutes
import kotlin.time.Instant
import org.junit.Assert.assertEquals
import org.junit.Test

class EpisodeOrderTest {
    private val collator = Collator.getInstance(Locale.ENGLISH)

    private fun episode(guid: String, title: String = guid, published: Long? = null, duration: Duration? = null) = Episode(
        guid = guid,
        feed = "https://example.com/feed",
        title = title,
        published = published?.let(Instant::fromEpochSeconds),
        duration = duration,
        file = EpisodeFile("https://example.com/$guid.mp3"),
    )

    private val episodes = listOf(
        episode("a", "beta", published = 200, duration = 30.minutes),
        episode("b", "Émile", published = null, duration = null),
        episode("c", "alpha", published = 300, duration = 10.minutes),
        episode("d", "Zulu", published = 100, duration = 60.minutes),
    )

    private fun arranged(sort: EpisodeSort, direction: SortDirection, query: String = "") =
        episodes.arranged(EpisodeOrder(sort, direction), query, collator).map { it.guid }

    @Test
    fun newestFirstPutsUndatedLast() = assertEquals(listOf("c", "a", "d", "b"), arranged(EpisodeSort.Published, SortDirection.Descending))

    @Test
    fun oldestFirstPutsUndatedFirst() = assertEquals(listOf("b", "d", "a", "c"), arranged(EpisodeSort.Published, SortDirection.Ascending))

    @Test
    fun titleAscendingIsLocaleAware() = assertEquals(listOf("c", "a", "b", "d"), arranged(EpisodeSort.Title, SortDirection.Ascending))

    @Test
    fun titleDescendingReversesCollation() = assertEquals(listOf("d", "b", "a", "c"), arranged(EpisodeSort.Title, SortDirection.Descending))

    @Test
    fun longestFirstPutsUnknownDurationLast() = assertEquals(listOf("d", "a", "c", "b"), arranged(EpisodeSort.Duration, SortDirection.Descending))

    @Test
    fun shortestFirstPutsUnknownDurationFirst() = assertEquals(listOf("b", "c", "a", "d"), arranged(EpisodeSort.Duration, SortDirection.Ascending))

    @Test
    fun filterMatchesTitleIgnoringCase() = assertEquals(listOf("c", "a"), arranged(EpisodeSort.Published, SortDirection.Descending, "  A "))

    @Test
    fun filterMatchesAccentedTitleIgnoringCase() = assertEquals(listOf("b"), arranged(EpisodeSort.Title, SortDirection.Ascending, "émi"))

    @Test
    fun filterWithoutMatchesIsEmpty() = assertEquals(emptyList<String>(), arranged(EpisodeSort.Title, SortDirection.Ascending, "missing"))

    @Test
    fun equalKeysKeepCatalogOrder() {
        val twins = listOf(episode("x", "Same", published = 5), episode("y", "same", published = 5))
        assertEquals(listOf("x", "y"), twins.arranged(EpisodeOrder(), "", collator).map { it.guid })
        assertEquals(listOf("x", "y"), twins.arranged(EpisodeOrder(EpisodeSort.Published, SortDirection.Ascending), "", collator).map { it.guid })
    }

    @Test
    fun everyOrderIsOffered() = assertEquals(6, EpisodeOrder.all.toSet().size)
}
