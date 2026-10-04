package app.podcst.feature.podcast

import app.podcst.model.EpisodeProgress
import kotlin.time.Duration
import kotlin.time.Duration.Companion.minutes
import kotlin.time.Instant
import org.junit.Assert.assertEquals
import org.junit.Test

class PlayButtonTest {
    private fun saved(position: Duration, duration: Duration? = 60.minutes, completed: Boolean = false) =
        EpisodeProgress(position, duration, completed, Instant.fromEpochSeconds(0))

    @Test
    fun unplayedEpisodePlays() = assertEquals(PlayButton.Play, PlayButton.of(null, null))

    @Test
    fun savedProgressResumesWithRemainingTime() =
        assertEquals(PlayButton.Resume(45.minutes, 0.25f), PlayButton.of(saved(15.minutes), null))

    @Test
    fun savedProgressWithoutDurationResumesWithoutRemainingTime() =
        assertEquals(PlayButton.Resume(null, null), PlayButton.of(saved(15.minutes, duration = null), null))

    @Test
    fun completedEpisodeIsPlayed() = assertEquals(PlayButton.Played, PlayButton.of(saved(60.minutes, completed = true), null))

    @Test
    fun zeroProgressPlays() = assertEquals(PlayButton.Play, PlayButton.of(saved(Duration.ZERO), null))

    @Test
    fun playingCurrentEpisodePauses() =
        assertEquals(PlayButton.Pause(0.5f), PlayButton.of(saved(5.minutes), Playhead(30.minutes, 60.minutes, playing = true)))

    @Test
    fun pausedCurrentEpisodeResumesFromPlayhead() =
        assertEquals(PlayButton.Resume(20.minutes, 40f / 60f), PlayButton.of(saved(5.minutes), Playhead(40.minutes, 60.minutes, playing = false)))

    @Test
    fun currentEpisodeAtStartPlaysEvenWhenCompleted() =
        assertEquals(PlayButton.Play, PlayButton.of(saved(60.minutes, completed = true), Playhead(Duration.ZERO, 60.minutes, playing = false)))

    @Test
    fun playheadWithUnknownDurationHasNoProgress() =
        assertEquals(PlayButton.Pause(null), PlayButton.of(null, Playhead(3.minutes, Duration.ZERO, playing = true)))
}
