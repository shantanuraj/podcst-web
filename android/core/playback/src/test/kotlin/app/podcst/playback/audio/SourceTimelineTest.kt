package app.podcst.playback.audio

import org.junit.Assert.assertEquals
import org.junit.Test

class SourceTimelineTest {
    private val rate = 1_000

    @Test
    fun beforeAnySpanThePositionIsTheAnchor() {
        val timeline = SourceTimeline().apply { reset(5_000_000, rate) }
        assertEquals(5_000_000, timeline.positionUs(100))
    }

    @Test
    fun contiguousSpansMapOneToOne() {
        val timeline = SourceTimeline().apply {
            reset(2_000_000, rate)
            span(2_000, 0, 500)
            span(2_500, 500, 500)
        }
        assertEquals(2_000_000 + 700_000, timeline.positionUs(700))
    }

    @Test
    fun trimmedSourceJumpsForward() {
        val timeline = SourceTimeline().apply {
            reset(0, rate)
            span(0, 0, 1_000)
            span(3_000, 1_000, 1_000)
        }
        assertEquals(500_000, timeline.positionUs(500))
        assertEquals(3_200_000, timeline.positionUs(1_200))
    }

    @Test
    fun positionNeverRunsPastTheLastKnownSource() {
        val timeline = SourceTimeline().apply {
            reset(0, rate)
            span(0, 0, 1_000)
        }
        assertEquals(1_000_000, timeline.positionUs(5_000))
    }

    @Test
    fun speedSegmentsScaleOutputToEffectsFrames() {
        val timeline = SourceTimeline().apply {
            reset(0, rate)
            span(0, 0, 10_000)
            speed(1_000, 1_000, 2.0)
        }
        assertEquals(500_000, timeline.positionUs(500))
        assertEquals(3_000_000, timeline.positionUs(2_000))
    }

    @Test
    fun closedSpeedSegmentsInterpolateMeasuredCounts() {
        val timeline = SourceTimeline().apply {
            reset(0, rate)
            span(0, 0, 10_000)
            speed(0, 0, 2.0)
            speed(1_000, 2_100, 1.0)
        }
        assertEquals(1_050_000, timeline.positionUs(500))
        assertEquals(2_200_000, timeline.positionUs(1_100))
    }

    @Test
    fun capacityIsBounded() {
        val timeline = SourceTimeline(capacity = 4).apply { reset(0, rate) }
        repeat(100) { timeline.span(it * 20L, it * 10L, 10) }
        assertEquals(99 * 20_000L + 5_000, timeline.positionUs(995))
    }
}
