package app.podcst.audio

import androidx.media3.common.C
import androidx.media3.common.audio.AudioProcessor.AudioFormat
import androidx.media3.common.audio.AudioProcessor.StreamMetadata
import java.lang.management.ManagementFactory
import java.nio.ByteBuffer
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class BoundedMemoryTest {
    private val sampleRate = 44_100
    private val channels = 2
    private val threads = ManagementFactory.getThreadMXBean() as com.sun.management.ThreadMXBean

    private val pattern = speechPattern(sampleRate, channels, 10)

    private inline fun stream(
        pattern: ByteBuffer = this.pattern,
        channels: Int = this.channels,
        streamFrames: Long = thirtyMinutes(sampleRate),
        blocks: Long = Long.MAX_VALUE,
        block: (ByteBuffer, Long) -> Unit,
    ) {
        val patternFrames = pattern.capacity() / (channels * 4)
        var source = 0L
        var index = 0L
        while (source < streamFrames && index < blocks) {
            val offset = (source % patternFrames).toInt()
            val frames = minOf(MAX_BLOCK_FRAMES - (index % 7).toInt() * 1_000, patternFrames - offset)
            pattern.limit((offset + frames) * channels * 4).position(offset * channels * 4)
            block(pattern, index)
            source += frames
            index++
        }
    }

    @Test
    fun effectsStorageStaysConstantAcrossThirtyMinutes() {
        EffectsProcessor(sampleRate, channels, true, true).use { effects ->
            val baseline = effects.info()
            val output = direct(MAX_BLOCK_FRAMES * channels * 4)
            val spans = SpanBuffer()
            var consumed = 0L
            var emitted = 0L
            stream { input, index ->
                while (input.hasRemaining()) {
                    val report = effects.process(input, output.clear() as ByteBuffer, spans)
                    consumed += report.consumedFrames
                    emitted += report.emittedFrames
                }
                if (index % 64 == 0L) {
                    val info = effects.info()
                    assertEquals(baseline.allocatedBytes, info.allocatedBytes)
                    assertTrue(info.pendingFrames <= info.maxBufferedFrames)
                }
            }
            do {
                val report = effects.finish(output.clear() as ByteBuffer, spans)
                emitted += report.emittedFrames
            } while (!report.finished)
            assertEquals(thirtyMinutes(sampleRate), consumed)
            assertTrue(emitted < consumed)
            assertEquals(baseline.allocatedBytes, effects.info().allocatedBytes)
        }
    }

    @Test
    fun limiterStorageStaysConstantAcrossThirtyMinutes() {
        Limiter(8_000, 1).use { limiter ->
            val baseline = limiter.info()
            val output = direct(MAX_BLOCK_FRAMES * 4)
            var emitted = 0L
            stream(speechPattern(8_000, 1, 10), 1, thirtyMinutes(8_000)) { input, index ->
                while (input.hasRemaining()) emitted += limiter.process(input, output.clear() as ByteBuffer).emittedFrames
                if (index % 64 == 0L) assertEquals(baseline.allocatedBytes, limiter.info().allocatedBytes)
            }
            do {
                val report = limiter.finish(output.clear() as ByteBuffer)
                emitted += report.emittedFrames
            } while (!report.finished)
            assertEquals(thirtyMinutes(8_000), emitted)
        }
    }

    @Test
    fun wrapperProcessingAllocatesNothingOnTheJavaHeap() {
        EffectsProcessor(sampleRate, channels, true, true).use { effects ->
            Limiter(sampleRate, channels).use { limiter ->
                val effectsOutput = direct(MAX_BLOCK_FRAMES * channels * 4)
                val limiterOutput = direct(MAX_BLOCK_FRAMES * channels * 4)
                val spans = SpanBuffer()
                fun run(blocks: Long) = stream(blocks = blocks) { input, _ ->
                    while (input.hasRemaining()) {
                        effects.process(input, effectsOutput.clear() as ByteBuffer, spans)
                        effectsOutput.flip()
                        while (effectsOutput.hasRemaining()) limiter.process(effectsOutput, limiterOutput.clear() as ByteBuffer)
                    }
                }
                run(500)
                val before = threads.currentThreadAllocatedBytes
                run(500)
                assertEquals(0L, threads.currentThreadAllocatedBytes - before)
            }
        }
    }

    @Test
    fun media3ProcessingAllocatesNothingOnTheJavaHeap() {
        var spans = 0L
        val effects = RustEffectsAudioProcessor { _, _, frames -> spans += frames }
        val limiter = RustLimiterAudioProcessor()
        val format = AudioFormat(sampleRate, channels, C.ENCODING_PCM_FLOAT)
        limiter.configure(effects.configure(format))
        effects.flush(StreamMetadata.DEFAULT)
        limiter.flush(StreamMetadata.DEFAULT)
        fun run(blocks: Long) = stream(blocks = blocks) { input, _ ->
            while (input.hasRemaining()) {
                effects.queueInput(input)
                val processed = effects.output
                while (processed.hasRemaining()) {
                    limiter.queueInput(processed)
                    limiter.output.let { it.position(it.limit()) }
                }
            }
        }
        run(500)
        val before = threads.currentThreadAllocatedBytes
        run(500)
        assertEquals(0L, threads.currentThreadAllocatedBytes - before)
        assertTrue(spans > 0)
        effects.reset()
        limiter.reset()
    }

    private fun thirtyMinutes(sampleRate: Int) = 30L * 60 * sampleRate
}
