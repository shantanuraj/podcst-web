package app.podcst.feature.podcast

import app.podcst.model.Episode
import app.podcst.model.EpisodeFile
import app.podcst.model.FeedFreshness
import app.podcst.model.Podcast
import org.junit.Assert.*
import org.junit.Test

class PodcastScreenStateTest {
    private val episode = Episode(guid = "episode", feed = "https://example.test/feed", title = "Episode", file = EpisodeFile("https://example.test/audio.mp3"))
    private val source = Podcast(feed = episode.feed, title = "Podcast", episodes = listOf(episode))
    private fun freshness(state: FeedFreshness.State, content: FeedFreshness.Content = FeedFreshness.Content.cached) =
        FeedFreshness(content, state, 1000, if (state in listOf(FeedFreshness.State.pending, FeedFreshness.State.backoff)) 5000 else null)

    @Test fun availableEpisodesKeepEveryBackgroundStateQuietEvenWhenFilteredOut() {
        for (feedState in FeedFreshness.State.entries) for (load in LoadState.entries) {
            val state = PodcastScreenState(source.copy(freshness = freshness(feedState)), episodes = emptyList(), load = load)
            assertNull(state.episodeNotice)
            assertFalse(state.canRetryEpisodes(10_000))
        }
    }

    @Test fun retainedEpisodesStayQuietWhenServerContentIsMissing() {
        val state = PodcastScreenState(source.copy(freshness = freshness(FeedFreshness.State.pending, FeedFreshness.Content.missing)), load = LoadState.Rechecking)
        assertNull(state.episodeNotice)
    }

    @Test fun missingEpisodesPrepareUntilAutomaticRecoveryEnds() {
        val podcast = source.copy(episodes = emptyList(), freshness = freshness(FeedFreshness.State.pending, FeedFreshness.Content.missing))
        for (load in listOf(LoadState.Loading, LoadState.Refreshing, LoadState.Rechecking)) {
            val state = PodcastScreenState(podcast, load = load)
            assertEquals(EpisodeNotice.Preparing, state.episodeNotice)
            assertFalse(state.canRetryEpisodes(10_000))
        }
        val stopped = PodcastScreenState(podcast, load = LoadState.Loaded)
        assertEquals(EpisodeNotice.Unavailable, stopped.episodeNotice)
        assertFalse(stopped.canRetryEpisodes(4999))
        assertTrue(stopped.canRetryEpisodes(5000))
    }

    @Test fun failuresOnlyNeedRecoveryWhenNoEpisodesAreAvailable() {
        val state = PodcastScreenState(source.copy(episodes = emptyList()), load = LoadState.Failed)
        assertEquals(EpisodeNotice.Unavailable, state.episodeNotice)
        assertTrue(state.canRetryEpisodes(0))
        assertNull(state.copy(podcast = source).episodeNotice)
    }

    @Test fun successfullyLoadedEmptyFeedsDoNotAskForRecovery() {
        val state = PodcastScreenState(source.copy(episodes = emptyList(), freshness = freshness(FeedFreshness.State.stale)), load = LoadState.Loaded)
        assertNull(state.episodeNotice)
    }
}
