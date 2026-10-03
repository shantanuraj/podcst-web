package app.podcst.audio

import androidx.media3.common.C
import androidx.media3.common.audio.AudioProcessor
import androidx.media3.common.audio.AudioProcessor.AudioFormat
import androidx.media3.common.audio.AudioProcessor.StreamMetadata
import androidx.media3.common.util.UnstableApi
import androidx.media3.common.util.Util
import java.math.RoundingMode
import java.nio.ByteBuffer
import java.util.concurrent.atomic.AtomicLong

@UnstableApi
class RustEffectsAudioProcessor(private val spans: SourceSpanSink) : RustAudioProcessor<EffectsProcessor>() {
    private val requested = AtomicLong()
    private var applied = 0L
    private val spanBuffer = SpanBuffer()
    private var scratch: ByteBuffer = AudioProcessor.EMPTY_BUFFER
    private var outputFrame = 0L

    fun setEffects(boost: Boolean, trim: Boolean) {
        requested.updateAndGet { ((it ushr 2) + 1 shl 2) or (if (trim) 2L else 0L) or (if (boost) 1L else 0L) }
    }

    override fun accepts(encoding: Int) = encoding == C.ENCODING_PCM_FLOAT || encoding == C.ENCODING_PCM_16BIT

    override fun create(format: AudioFormat): EffectsProcessor {
        val settings = requested.get()
        return EffectsProcessor(format.sampleRate, format.channelCount, boost(settings), trim(settings))
    }

    override fun start(processor: EffectsProcessor, streamMetadata: StreamMetadata) {
        val origin = Util.scaleLargeValue(
            streamMetadata.positionOffsetUs.coerceAtLeast(0),
            inputAudioFormat.sampleRate.toLong(),
            C.MICROS_PER_SECOND,
            RoundingMode.HALF_UP,
        )
        processor.reset(origin)
        applied = requested.get()
        processor.configure(boost(applied), trim(applied), applied ushr 2)
        outputFrame = 0
        val scratchBytes = MAX_BLOCK_FRAMES * inputAudioFormat.channelCount * Float.SIZE_BYTES
        if (inputAudioFormat.encoding == C.ENCODING_PCM_16BIT && scratch.capacity() < scratchBytes) {
            scratch = nativeBuffer(scratchBytes)
        }
    }

    override fun render(processor: EffectsProcessor, input: ByteBuffer, output: ByteBuffer): AudioReport {
        val settings = requested.get()
        if (settings != applied) {
            processor.configure(boost(settings), trim(settings), settings ushr 2)
            applied = settings
        }
        val report = if (inputAudioFormat.encoding == C.ENCODING_PCM_FLOAT) {
            processor.process(input, output, spanBuffer)
        } else {
            processor.process(convert(input), output, spanBuffer).also {
                input.advance(it.consumedFrames * inputAudioFormat.bytesPerFrame)
            }
        }
        deliver(report)
        return report
    }

    override fun drain(processor: EffectsProcessor, output: ByteBuffer): AudioReport =
        processor.finish(output, spanBuffer).also(::deliver)

    private fun convert(input: ByteBuffer): ByteBuffer {
        if (input.remaining() % inputAudioFormat.bytesPerFrame != 0) {
            throw AudioEngineException(AudioStatus.INVALID_ARGUMENT)
        }
        val samples = minOf(input.remaining() / inputAudioFormat.bytesPerFrame, MAX_BLOCK_FRAMES) *
            inputAudioFormat.channelCount
        val start = input.position()
        scratch.clear()
        for (index in 0 until samples) scratch.putFloat(input.getShort(start + index * 2) / 32_768f)
        scratch.flip()
        return scratch
    }

    private fun deliver(report: AudioReport) {
        for (index in 0 until report.spanCount) {
            spans.onSpan(
                spanBuffer.sourceStartFrame(index),
                outputFrame + spanBuffer.outputStartFrame(index),
                spanBuffer.frameCount(index),
            )
        }
        outputFrame += report.emittedFrames
    }

    private fun boost(settings: Long) = settings and 1L != 0L

    private fun trim(settings: Long) = settings and 2L != 0L
}
