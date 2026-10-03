package app.podcst.audio

import java.nio.ByteBuffer

class Limiter(sampleRate: Int, channels: Int) : AutoCloseable {
    private val handle = NativeHandle(
        NativeAudio.limiterCreate(sampleRate, channels),
        NativeAudio::limiterRelease,
        NativeAudio::limiterClose,
    )
    private val frameBytes = channels * Float.SIZE_BYTES
    val latencyFrames: Int = info().latencyFrames

    fun process(input: ByteBuffer, output: ByteBuffer): AudioReport {
        val report = handle.use {
            NativeAudio.report(
                NativeAudio.limiterProcess(
                    it,
                    input,
                    input.position(),
                    input.remaining(),
                    output,
                    output.position(),
                    output.remaining(),
                ),
            )
        }
        input.advance(report.consumedFrames * frameBytes)
        output.advance(report.emittedFrames * frameBytes)
        return report
    }

    fun finish(output: ByteBuffer): AudioReport {
        val report = handle.use {
            NativeAudio.report(NativeAudio.limiterFinish(it, output, output.position(), output.remaining()))
        }
        output.advance(report.emittedFrames * frameBytes)
        return report
    }

    fun reset() = handle.use { NativeAudio.verify(NativeAudio.limiterReset(it)) }

    fun info(): LimiterInfo = handle.use {
        val info = nativeBuffer(24)
        NativeAudio.verify(NativeAudio.limiterInfo(it, info))
        with(info) {
            LimiterInfo(
                reductionDb = getFloat(0),
                latencyFrames = getInt(4),
                maxBlockFrames = getInt(8),
                allocatedBytes = getLong(16),
            )
        }
    }

    override fun close() = handle.close()
}

data class LimiterInfo(
    val reductionDb: Float,
    val latencyFrames: Int,
    val maxBlockFrames: Int,
    val allocatedBytes: Long,
)
