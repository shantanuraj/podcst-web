package app.podcst.audio

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class DeviceBridgeVectorTest {
    private val vectors = InstrumentationRegistry.getInstrumentation().context.assets.let { assets ->
        loadVectors { name -> assets.open(name).use { it.readBytes() } }
    }

    @Test
    fun embeddedVectorsCoverEffectsAndLimiter() {
        assertEquals(4, vectors.size)
        assertEquals(setOf(true, false), vectors.map { it.effects }.toSet())
        assertEquals(setOf(true, false), vectors.map { it.pcm16 }.toSet())
    }

    @Test
    fun wrappersReplayEmbeddedVectorsBitExactly() {
        for (case in vectors) assertReplayed(case, replayWrapper(case))
    }

    @Test
    fun media3ProcessorsReplayEmbeddedVectorsBitExactly() {
        for (case in vectors) assertReplayed(case, replayMedia3(case, 1))
    }
}
