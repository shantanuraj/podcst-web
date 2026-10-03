package app.podcst.audio

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class BridgeVectorTest {
    @Test
    fun vectorSetCoversTheBridgeMatrix() {
        assertEquals(14, hostVectors.size)
        assertTrue(hostVectors.any { it.pcm16 })
        assertTrue(hostVectors.any { !it.effects })
        assertEquals(setOf(1, 2), hostVectors.map { it.channels }.toSet())
        assertEquals(setOf(8_000, 22_050, 44_100, 48_000), hostVectors.map { it.sampleRate }.toSet())
        assertTrue(hostVectors.any { case -> case.steps.any { it is VectorStep.Reset && it.origin > 0 } })
        assertTrue(hostVectors.any { case -> case.steps.any { it is VectorStep.Configure } })
    }

    @Test
    fun wrappersReplayEveryVectorBitExactly() {
        for (case in hostVectors) assertReplayed(case, replayWrapper(case))
    }

    @Test
    fun media3ProcessorsReplayEveryVectorBitExactly() {
        for (case in hostVectors) {
            for (seed in 1L..3L) assertReplayed(case, replayMedia3(case, seed))
        }
    }
}
