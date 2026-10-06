package app.podcst.audio

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class CreationTest {
    @Test
    fun effectsCreationRetainsTheInitializedRustHandle() {
        for (channels in 1..2) {
            EffectsProcessor(48_000, channels, true, false).use { effects ->
                effects.reset(1234)
                val info = effects.info()
                assertTrue(info.boostEnabled)
                assertFalse(info.trimEnabled)
                assertTrue(info.allocatedBytes > 0)
            }
        }
    }

    @Test
    fun limiterCreationRetainsTheInitializedRustHandle() {
        for (channels in 1..2) {
            Limiter(48_000, channels).use { limiter ->
                limiter.reset()
                val info = limiter.info()
                assertEquals(limiter.latencyFrames, info.latencyFrames)
                assertTrue(info.maxBlockFrames > 0)
                assertTrue(info.allocatedBytes > 0)
            }
        }
    }
}
