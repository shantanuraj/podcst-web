package app.podcst.audio

import androidx.media3.common.C
import androidx.media3.common.audio.AudioProcessor
import androidx.media3.common.audio.AudioProcessor.AudioFormat
import androidx.media3.common.audio.AudioProcessor.StreamMetadata
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class Media3LifecycleTest {
    @Test
    fun finishIsOnlyReachedThroughQueueEndOfStream() {
        val case = hostVector("effects-mono-8000-both")
        val spans = SpanCollector()
        val processor = RustEffectsAudioProcessor(spans::add)
        processor.setEffects(case.boost, case.trim)
        processor.configure(AudioFormat(case.sampleRate, case.channels, C.ENCODING_PCM_FLOAT))
        processor.flush(StreamMetadata.DEFAULT)
        val input = case.rawInput()
        val collector = OutputCollector(case.output.size)
        fun collect() {
            val output = processor.output
            collector.add(output, output.position(), output.remaining() / 4)
        }
        while (input.hasRemaining()) {
            input.limit(minOf(input.position() + 700 * 4, input.capacity()))
            while (input.hasRemaining()) {
                processor.queueInput(input)
                collect()
            }
            input.limit(input.capacity())
            repeat(3) {
                processor.queueInput(AudioProcessor.EMPTY_BUFFER)
                collect()
                assertFalse(processor.isEnded)
            }
        }
        processor.queueEndOfStream()
        while (!processor.isEnded) collect()
        assertEquals(0, processor.output.remaining())
        assertTrue(processor.isEnded)
        assertReplayed(case, Replayed(collector.result(), spans.spans))
        processor.reset()
    }

    @Test
    fun flushMapsThePositionOffsetToTheSourceOrigin() {
        for ((positionOffsetUs, sampleRate, origin) in listOf(
            Triple(0L, 8_000, 0L),
            Triple(1_000_000L, 44_100, 44_100L),
            Triple(22_675L, 44_100, 1_000L),
            Triple(62L, 8_000, 0L),
            Triple(63L, 8_000, 1L),
            Triple(C.TIME_UNSET, 48_000, 0L),
            Triple(3_600_000_000_000L, 48_000, 172_800_000_000L),
        )) {
            val sources = mutableListOf<Long>()
            val processor = RustEffectsAudioProcessor { source, output, _ -> if (output == 0L) sources += source }
            processor.configure(AudioFormat(sampleRate, 1, C.ENCODING_PCM_FLOAT))
            processor.flush(StreamMetadata.DEFAULT)
            processor.flush(StreamMetadata.Builder().setPositionOffsetUs(positionOffsetUs).build())
            val input = speechPattern(sampleRate, 1, 1)
            while (input.hasRemaining()) {
                processor.queueInput(input)
                processor.output
            }
            assertEquals("$positionOffsetUs us at $sampleRate Hz", listOf(origin), sources)
            processor.reset()
        }
    }

    @Test
    fun activityFollowsConfigureAndReset() {
        val processor = RustEffectsAudioProcessor { _, _, _ -> }
        assertFalse(processor.isActive)
        val output = processor.configure(AudioFormat(22_050, 2, C.ENCODING_PCM_16BIT))
        assertEquals(AudioFormat(22_050, 2, C.ENCODING_PCM_FLOAT), output)
        assertTrue(processor.isActive)
        processor.flush(StreamMetadata.DEFAULT)
        processor.reset()
        assertFalse(processor.isActive)
    }

    @Test
    fun limiterExposesLatencyAndPreservesFrameCount() {
        val processor = RustLimiterAudioProcessor()
        assertEquals(0, processor.latencyFrames)
        processor.configure(AudioFormat(48_000, 2, C.ENCODING_PCM_FLOAT))
        processor.flush(StreamMetadata.DEFAULT)
        assertEquals(255, processor.latencyFrames)
        val input = speechPattern(48_000, 2, 1, amplitude = 2f)
        var frames = 0
        var peak = 0f
        fun collect() {
            val output = processor.output
            frames += output.remaining() / 8
            while (output.hasRemaining()) peak = maxOf(peak, kotlin.math.abs(output.getFloat()))
        }
        processor.queueInput(input.duplicate().order(input.order()).limit(100 * 8) as java.nio.ByteBuffer)
        collect()
        assertEquals(0, frames)
        while (input.hasRemaining()) {
            processor.queueInput(input)
            collect()
        }
        processor.queueEndOfStream()
        while (!processor.isEnded) collect()
        assertEquals(48_000 + 100, frames)
        assertTrue(peak <= 0.9f)
        processor.reset()
        assertEquals(0, processor.latencyFrames)
    }

    @Test
    fun effectsChangesApplyWithoutBusyFailuresFromOtherThreads() {
        val processor = RustEffectsAudioProcessor { _, _, _ -> }
        processor.configure(AudioFormat(48_000, 2, C.ENCODING_PCM_FLOAT))
        processor.flush(StreamMetadata.DEFAULT)
        val input = speechPattern(48_000, 2, 2)
        val toggler = kotlin.concurrent.thread {
            repeat(10_000) { processor.setEffects(it % 2 == 0, it % 3 == 0) }
        }
        while (input.hasRemaining()) {
            processor.queueInput(input)
            processor.output
        }
        toggler.join()
        processor.reset()
    }
}
