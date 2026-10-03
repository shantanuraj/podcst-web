package app.podcst.audio

import androidx.media3.common.C
import androidx.media3.common.audio.AudioProcessor.AudioFormat
import androidx.media3.common.audio.AudioProcessor.StreamMetadata
import androidx.media3.common.audio.AudioProcessor.UnhandledAudioFormatException
import androidx.media3.common.audio.BaseAudioProcessor
import androidx.media3.common.util.UnstableApi
import java.nio.ByteBuffer

@UnstableApi
sealed class RustAudioProcessor<P : AutoCloseable> : BaseAudioProcessor() {
    private var pending: P? = null
    protected var processor: P? = null
        private set
    private var ready = false
    private var ending = false
    private var finished = false

    protected abstract fun accepts(encoding: Int): Boolean

    protected abstract fun create(format: AudioFormat): P

    protected abstract fun start(processor: P, streamMetadata: StreamMetadata)

    protected abstract fun render(processor: P, input: ByteBuffer, output: ByteBuffer): AudioReport

    protected abstract fun drain(processor: P, output: ByteBuffer): AudioReport

    final override fun onConfigure(inputAudioFormat: AudioFormat): AudioFormat {
        if (!accepts(inputAudioFormat.encoding)) throw UnhandledAudioFormatException(inputAudioFormat)
        val created = try {
            create(inputAudioFormat)
        } catch (error: AudioEngineException) {
            if (error.status != AudioStatus.INVALID_CONFIG) throw error
            throw UnhandledAudioFormatException(inputAudioFormat)
        }
        pending?.close()
        pending = created
        return AudioFormat(inputAudioFormat.sampleRate, inputAudioFormat.channelCount, C.ENCODING_PCM_FLOAT)
    }

    final override fun queueInput(inputBuffer: ByteBuffer) {
        if (ending || !inputBuffer.hasRemaining() && !ready) return
        val target = checkNotNull(processor)
        val output = replaceOutputBuffer(MAX_BLOCK_FRAMES * outputAudioFormat.bytesPerFrame)
        do {
            val report = render(target, inputBuffer, output)
            ready = report.outputFull
        } while (
            output.hasRemaining() &&
            (inputBuffer.hasRemaining() || ready) &&
            (report.consumedFrames > 0 || report.emittedFrames > 0)
        )
        output.flip()
    }

    final override fun onQueueEndOfStream() {
        ending = true
    }

    final override fun getOutput(): ByteBuffer {
        if (ending && !finished && !hasPendingOutput()) {
            val target = checkNotNull(processor)
            val output = replaceOutputBuffer(MAX_BLOCK_FRAMES * outputAudioFormat.bytesPerFrame)
            while (!finished && output.hasRemaining()) finished = drain(target, output).finished
            output.flip()
        }
        return super.getOutput()
    }

    final override fun isEnded(): Boolean = finished && super.isEnded()

    final override fun onFlush(streamMetadata: StreamMetadata) {
        ready = false
        ending = false
        finished = false
        pending?.let {
            processor?.close()
            processor = it
            pending = null
        }
        processor?.let { start(it, streamMetadata) }
    }

    final override fun onReset() {
        ready = false
        ending = false
        finished = false
        pending?.close()
        processor?.close()
        pending = null
        processor = null
    }
}
