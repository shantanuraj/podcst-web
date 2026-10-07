package app.podcst.feature.library

import app.podcst.model.EpisodeList

import app.podcst.designsystem.EpisodeRowState
import app.podcst.model.DownloadState
import app.podcst.model.Episode
import app.podcst.model.EpisodeFile
import app.podcst.model.EpisodeProgress
import app.podcst.playback.media.DownloadEntry
import kotlin.time.Duration.Companion.days
import kotlin.time.Duration.Companion.hours
import kotlin.time.Duration.Companion.minutes
import kotlin.time.Instant
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class EpisodeListsTest {
    private val now = Instant.parse("2026-10-04T12:00:00Z")

    private fun episode(guid: String, feed: String = "feed", published: Instant? = now - 1.days, title: String = feed) =
        Episode(guid = guid, feed = feed, podcastTitle = title, title = guid, published = published, duration = 60.minutes, file = EpisodeFile("https://x/$guid.mp3"))

    private fun progress(minutes: Int, completed: Boolean = false) =
        EpisodeProgress(minutes.minutes, 60.minutes, completed, now)

    private fun Episode.key() = identity.value

    @Test
    fun continueAndNewPlacesUnfinishedFirstAndRetainsCompletedReleases() {
        val unfinished = episode("a")
        val done = episode("b")
        val fresh = episode("c")
        val result = continueAndNew(listOf(unfinished), listOf(done, unfinished, fresh), mapOf(unfinished.key() to progress(10), done.key() to progress(60, completed = true)))
        assertEquals(listOf("a", "b", "c"), result.map { it.guid })
    }

    @Test
    fun completedReleaseIsPlayedNotFreshAndReplayRestoresEmphasis() {
        val done = episode("done")
        val listening = Listening(progress = mapOf(done.key() to progress(0, completed = true)), now = now)
        val state = library(emptyList(), listOf(done), emptyList(), listening, Refresh.Idle)
        assertEquals(listOf(done), state.episodes.map { it.episode })
        assertTrue(state.episodes.single().played)
        assertFalse(state.episodes.single().fresh)
        assertFalse(listening.copy(current = done.identity, playing = true).row(done).played)
    }

    @Test
    fun aCompletedEpisodeLeavesContinueWithoutChangingItsReleasePosition() {
        val done = episode("done")
        val fresh = episode("fresh")
        assertEquals(listOf(fresh, done), continueAndNew(listOf(done), listOf(fresh, done), mapOf(done.key() to progress(0, completed = true))))
    }

    @Test
    fun continueAndNewIsLimitedToFiveRows() {
        val unfinished = (1..3).map { episode("u$it") }
        val releases = (1..4).map { episode("r$it") }
        assertEquals(listOf("u1", "u2", "u3", "r1", "r2"), continueAndNew(unfinished, releases, emptyMap()).map { it.guid })
    }

    @Test
    fun freshOnlyMarksRecentUnplayedEpisodes() {
        val recent = episode("recent", published = now - 2.days)
        val old = episode("old", published = now - 8.days)
        val started = episode("started")
        val finished = episode("finished")
        val undated = episode("undated", published = null)
        val listening = Listening(progress = mapOf(started.key() to progress(5), finished.key() to progress(60, completed = true)), now = now)
        assertTrue(listening.fresh(recent))
        assertFalse(listening.fresh(old))
        assertFalse(listening.fresh(started))
        assertFalse(listening.fresh(finished))
        assertFalse(listening.fresh(undated))
        assertTrue(listening.row(recent).fresh)
    }

    @Test
    fun libraryMarksShowsWithFreshEpisodes() {
        val listening = Listening(progress = mapOf(episode("played", feed = "b").key() to progress(60, completed = true)), now = now)
        val state = library(
            emptyList(),
            listOf(episode("new", feed = "a"), episode("played", feed = "b"), episode("old", feed = "c", published = now - 30.days)),
            emptyList(),
            listening,
            Refresh.Idle,
        )
        assertEquals(setOf("a"), state.fresh)
    }

    private fun row(episode: Episode, progress: EpisodeProgress? = null, download: DownloadState = DownloadState.None) =
        EpisodeRowState(episode, progress = progress, download = download)

    @Test
    fun facetsCountAndHideEmptyFilters() {
        val rows = listOf(
            row(episode("a", feed = "one", title = "One")),
            row(episode("b", feed = "one", title = "One"), progress = progress(5)),
            row(episode("c", feed = "two", title = "Two"), download = DownloadState.Available(10)),
        )
        assertEquals(
            listOf(
                FacetCount(ListFilter.All, 3),
                FacetCount(ListFilter.Unplayed, 2),
                FacetCount(ListFilter.InProgress, 1),
                FacetCount(ListFilter.Downloaded, 1),
                FacetCount(ListFilter.Show("one", "One"), 2),
                FacetCount(ListFilter.Show("two", "Two"), 1),
            ),
            facets(rows),
        )
        assertEquals(listOf(ListFilter.All, ListFilter.Unplayed, ListFilter.Show("one", "One")), facets(rows.take(1)).map { it.filter })
    }

    @Test
    fun filteringNeverProducesAnEmptyList() {
        val rows = listOf(row(episode("a")), row(episode("b"), download = DownloadState.Available(10)))
        val downloaded = EpisodeListState(EpisodeList.Starred, rows, filter = ListFilter.Downloaded, loaded = true)
        assertEquals(listOf("b"), downloaded.visible.map { it.episode.guid })
        val gone = EpisodeListState(EpisodeList.Starred, rows, filter = ListFilter.InProgress, loaded = true)
        assertEquals(FacetCount(ListFilter.All, 2), gone.selected)
        assertEquals(listOf("a", "b"), gone.visible.map { it.episode.guid })
    }

    @Test
    fun starredSortsByStarOrderOrPublication() {
        val rows = listOf(
            row(episode("middle", published = now - 2.days)),
            row(episode("undated", published = null)),
            row(episode("newest", published = now - 1.hours)),
            row(episode("oldest", published = now - 9.days)),
        )
        assertEquals(listOf("middle", "undated", "newest", "oldest"), ListSort.Recent.apply(rows).map { it.episode.guid })
        assertEquals(listOf("newest", "middle", "oldest", "undated"), ListSort.Newest.apply(rows).map { it.episode.guid })
        assertEquals(listOf("oldest", "middle", "newest", "undated"), ListSort.Oldest.apply(rows).map { it.episode.guid })
    }

    @Test
    fun downloadsListActiveFirstThenMostRecent() {
        val episodes = listOf("ready-old", "ready-new", "active", "paused", "missing-episode").map { episode(it) }
        val entries = listOf(
            DownloadEntry(episodes[0].key(), DownloadState.Available(1), updated = 1),
            DownloadEntry(episodes[1].key(), DownloadState.Available(1), updated = 5),
            DownloadEntry(episodes[2].key(), DownloadState.Downloading(1, 2), updated = 3),
            DownloadEntry(episodes[3].key(), DownloadState.Paused(1, 2), updated = 4),
            DownloadEntry("unknown", DownloadState.Available(1), updated = 9),
        )
        assertEquals(listOf("paused", "active", "ready-new", "ready-old"), downloaded(entries, episodes.dropLast(1)).map { it.guid })
    }
}
