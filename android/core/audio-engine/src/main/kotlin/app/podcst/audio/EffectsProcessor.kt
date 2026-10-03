package app.podcst.audio

import java.nio.ByteBuffer

class EffectsProcessor(sampleRate: Int, channels: Int, boost: Boolean, trim: Boolean) : AutoCloseable {
    private val handle = NativeHandle(
        NativeAudio.effectsCreate(sampleRate, channels, boost, trim),
        NativeAudio::effectsRelease,
        NativeAudio::effectsClose,
    )
    private val frameBytes = channels * Float.SIZE_BYTES

    fun configure(boost: Boolean, trim: Boolean, revision: Long) =
        handle.use { NativeAudio.verify(NativeAudio.effectsConfigure(it, boost, trim, revision)) }

    fun process(input: ByteBuffer, output: ByteBuffer, spans: SpanBuffer): AudioReport {
        val report = handle.use {
            NativeAudio.report(
                NativeAudio.effectsProcess(
                    it,
                    input,
                    input.position(),
                    input.remaining(),
                    output,
                    output.position(),
                    output.remaining(),
                    spans.buffer,
                    spans.buffer.capacity(),
                ),
            )
        }
        input.advance(report.consumedFrames * frameBytes)
        output.advance(report.emittedFrames * frameBytes)
        return report
    }

    fun finish(output: ByteBuffer, spans: SpanBuffer): AudioReport {
        val report = handle.use {
            NativeAudio.report(
                NativeAudio.effectsFinish(
                    it,
                    output,
                    output.position(),
                    output.remaining(),
                    spans.buffer,
                    spans.buffer.capacity(),
                ),
            )
        }
        output.advance(report.emittedFrames * frameBytes)
        return report
    }

    fun reset(sourceOrigin: Long) = handle.use { NativeAudio.verify(NativeAudio.effectsReset(it, sourceOrigin)) }

    fun info(): EffectsInfo = handle.use {
        val info = nativeBuffer(48)
        NativeAudio.verify(NativeAudio.effectsInfo(it, info))
        with(info) {
            EffectsInfo(
                maxBlockFrames = getInt(0),
                maxBufferedFrames = getInt(4),
                pendingFrames = getInt(8),
                boostEnabled = getInt(12) != 0,
                trimEnabled = getInt(16) != 0,
                boostGainDb = getFloat(20),
                allocatedBytes = getLong(24),
                appliedRevision = getLong(32),
                appliedSourceFrame = getLong(40),
            )
        }
    }

    override fun close() = handle.close()
}

data class EffectsInfo(
    val maxBlockFrames: Int,
    val maxBufferedFrames: Int,
    val pendingFrames: Int,
    val boostEnabled: Boolean,
    val trimEnabled: Boolean,
    val boostGainDb: Float,
    val allocatedBytes: Long,
    val appliedRevision: Long,
    val appliedSourceFrame: Long,
)
