package app.podcst.audio

import androidx.media3.common.C
import androidx.media3.common.audio.AudioProcessor.AudioFormat
import androidx.media3.common.audio.AudioProcessor.StreamMetadata
import androidx.media3.common.audio.AudioProcessor.UnhandledAudioFormatException
import java.nio.ByteBuffer
import java.nio.ByteOrder
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Test

class MalformedInputTest {
    private fun floats(vararg samples: Float): ByteBuffer =
        direct(samples.size * 4).apply { samples.forEach(::putFloat) }.flip() as ByteBuffer

    @Test
    fun heapBuffersAreRejected() {
        val heap = ByteBuffer.allocate(64).order(ByteOrder.nativeOrder())
        EffectsProcessor(48_000, 2, false, false).use { effects ->
            assertEquals(AudioStatus.INVALID_ARGUMENT, failure { effects.process(heap, direct(64), SpanBuffer()) })
            assertEquals(AudioStatus.INVALID_ARGUMENT, failure { effects.process(direct(64), heap, SpanBuffer()) })
            assertEquals(AudioStatus.INVALID_ARGUMENT, failure { effects.finish(heap, SpanBuffer()) })
        }
        Limiter(48_000, 2).use { limiter ->
            assertEquals(AudioStatus.INVALID_ARGUMENT, failure { limiter.process(heap, direct(64)) })
            assertEquals(AudioStatus.INVALID_ARGUMENT, failure { limiter.finish(heap) })
        }
        assertEquals(0, heap.position())
    }

    @Test
    fun misalignedAndPartialFramesAreRejectedWithoutConsumingInput() {
        EffectsProcessor(48_000, 2, false, false).use { effects ->
            val input = direct(68)
            val output = direct(64)
            input.position(1).limit(65)
            assertEquals(AudioStatus.INVALID_ARGUMENT, failure { effects.process(input, output, SpanBuffer()) })
            assertEquals(1, input.position())
            input.position(0).limit(12)
            assertEquals(AudioStatus.INVALID_ARGUMENT, failure { effects.process(input, output, SpanBuffer()) })
            input.position(0).limit(16)
            output.position(2)
            assertEquals(AudioStatus.INVALID_ARGUMENT, failure { effects.process(input, output, SpanBuffer()) })
            assertEquals(0, input.position())
            output.clear()
            assertEquals(2, effects.process(input, output, SpanBuffer()).consumedFrames)
        }
        Limiter(48_000, 1).use { limiter ->
            val input = direct(16).position(2) as ByteBuffer
            assertEquals(AudioStatus.INVALID_ARGUMENT, failure { limiter.process(input, direct(16)) })
            assertEquals(AudioStatus.INVALID_ARGUMENT, failure { limiter.process(direct(6), direct(16)) })
        }
    }

    @Test
    fun nonFiniteSamplesAreInvalidArguments() {
        EffectsProcessor(8_000, 1, true, true).use { effects ->
            for (invalid in listOf(Float.NaN, Float.POSITIVE_INFINITY, Float.NEGATIVE_INFINITY, Float.MAX_VALUE)) {
                val input = floats(0.1f, invalid, 0.2f)
                assertEquals(AudioStatus.INVALID_ARGUMENT, failure { effects.process(input, direct(64), SpanBuffer()) })
                assertEquals(0, input.position())
            }
            assertEquals(0L, effects.info().appliedSourceFrame)
            assertEquals(0, effects.info().pendingFrames)
        }
        Limiter(8_000, 1).use { limiter ->
            assertEquals(AudioStatus.INVALID_ARGUMENT, failure { limiter.process(floats(Float.NaN), direct(64)) })
        }
    }

    @Test
    fun unsupportedConfigurationsAreRejectedAtCreation() {
        for ((rate, channels) in listOf(7_999 to 1, 192_001 to 1, 48_000 to 3, 48_000 to 0, -1 to 1, 48_000 to -2)) {
            assertEquals(AudioStatus.INVALID_CONFIG, failure { EffectsProcessor(rate, channels, false, false) })
            assertEquals(AudioStatus.INVALID_CONFIG, failure { Limiter(rate, channels) })
        }
    }

    @Test
    fun media3RejectsUnsupportedFormats() {
        val effects = RustEffectsAudioProcessor { _, _, _ -> }
        for (format in listOf(
            AudioFormat(48_000, 3, C.ENCODING_PCM_FLOAT),
            AudioFormat(7_999, 1, C.ENCODING_PCM_16BIT),
            AudioFormat(192_001, 2, C.ENCODING_PCM_FLOAT),
            AudioFormat(48_000, 2, C.ENCODING_PCM_8BIT),
            AudioFormat(48_000, 2, C.ENCODING_PCM_24BIT),
        )) {
            assertThrows(UnhandledAudioFormatException::class.java) { effects.configure(format) }
        }
        assertFalse(effects.isActive)
        val limiter = RustLimiterAudioProcessor()
        for (format in listOf(
            AudioFormat(48_000, 2, C.ENCODING_PCM_16BIT),
            AudioFormat(48_000, 3, C.ENCODING_PCM_FLOAT),
            AudioFormat(4_000, 1, C.ENCODING_PCM_FLOAT),
        )) {
            assertThrows(UnhandledAudioFormatException::class.java) { limiter.configure(format) }
        }
        assertFalse(limiter.isActive)
    }

    @Test
    fun media3RejectsPartialFrames() {
        val effects = RustEffectsAudioProcessor { _, _, _ -> }
        effects.configure(AudioFormat(48_000, 2, C.ENCODING_PCM_16BIT))
        effects.flush(StreamMetadata.DEFAULT)
        assertEquals(AudioStatus.INVALID_ARGUMENT, failure { effects.queueInput(direct(6)) })
        effects.configure(AudioFormat(48_000, 2, C.ENCODING_PCM_FLOAT))
        effects.flush(StreamMetadata.DEFAULT)
        assertEquals(AudioStatus.INVALID_ARGUMENT, failure { effects.queueInput(direct(12)) })
        assertEquals(AudioStatus.INVALID_ARGUMENT, failure { effects.queueInput(floats(Float.NaN, 0f)) })
        effects.reset()
    }

    @Test
    fun closedProcessorsReportClosed() {
        val effects = EffectsProcessor(8_000, 1, false, false)
        effects.close()
        effects.close()
        assertEquals(AudioStatus.CLOSED, failure { effects.process(floats(0f), direct(16), SpanBuffer()) })
        assertEquals(AudioStatus.CLOSED, failure { effects.info() })
        assertEquals(AudioStatus.CLOSED, failure { effects.reset(0) })
        val limiter = Limiter(8_000, 1)
        limiter.close()
        limiter.close()
        assertEquals(AudioStatus.CLOSED, failure { limiter.finish(direct(16)) })
    }

    @Test
    fun processingAfterFinishIsInvalidUntilReset() {
        EffectsProcessor(8_000, 1, false, false).use { effects ->
            effects.process(floats(0.1f, 0.2f), direct(16), SpanBuffer())
            val output = direct(64)
            do {
                val report = effects.finish(output.clear() as ByteBuffer, SpanBuffer())
            } while (!report.finished)
            assertEquals(AudioStatus.INVALID_STATE, failure { effects.process(floats(0.1f), direct(16), SpanBuffer()) })
            assertEquals(AudioStatus.INVALID_STATE, failure { effects.configure(true, true, 1) })
            assertEquals(AudioStatus.INVALID_ARGUMENT, failure { effects.reset(-1) })
            effects.reset(7)
            assertEquals(7L, effects.info().appliedSourceFrame)
            assertEquals(1, effects.process(floats(0.1f), direct(16), SpanBuffer()).consumedFrames)
        }
        Limiter(8_000, 1).use { limiter ->
            limiter.finish(direct(16))
            assertEquals(AudioStatus.INVALID_STATE, failure { limiter.process(floats(0.1f), direct(16)) })
            limiter.reset()
            assertEquals(1, limiter.process(floats(0.1f), direct(16)).consumedFrames)
        }
    }
}
