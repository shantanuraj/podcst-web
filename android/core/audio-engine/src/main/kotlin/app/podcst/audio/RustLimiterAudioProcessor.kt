package app.podcst.audio

import androidx.media3.common.C
import androidx.media3.common.audio.AudioProcessor.AudioFormat
import androidx.media3.common.audio.AudioProcessor.StreamMetadata
import androidx.media3.common.util.UnstableApi
import java.nio.ByteBuffer

@UnstableApi
class RustLimiterAudioProcessor : RustAudioProcessor<Limiter>() {
    val latencyFrames: Int get() = processor?.latencyFrames ?: 0

    override fun accepts(encoding: Int) = encoding == C.ENCODING_PCM_FLOAT

    override fun create(format: AudioFormat) = Limiter(format.sampleRate, format.channelCount)

    override fun start(processor: Limiter, streamMetadata: StreamMetadata) = processor.reset()

    override fun render(processor: Limiter, input: ByteBuffer, output: ByteBuffer) = processor.process(input, output)

    override fun drain(processor: Limiter, output: ByteBuffer) = processor.finish(output)
}
