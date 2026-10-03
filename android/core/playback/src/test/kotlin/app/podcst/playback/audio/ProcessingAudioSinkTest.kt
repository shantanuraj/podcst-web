package app.podcst.playback.audio

import androidx.media3.common.AudioAttributes
import androidx.media3.common.AuxEffectInfo
import androidx.media3.common.C
import androidx.media3.common.Format
import androidx.media3.common.MimeTypes
import androidx.media3.common.PlaybackParameters
import androidx.media3.common.audio.AudioProcessor
import androidx.media3.common.audio.BaseAudioProcessor
import androidx.media3.exoplayer.audio.AudioSink
import app.podcst.model.AudioEffects
import java.nio.ByteBuffer
import java.nio.ByteOrder
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ProcessingAudioSinkTest {
    private val rate = 8_000

    @Test
    fun trimmedOutputReportsOriginalSourceTime() {
        val stages = FakeStages(dropEveryOtherBlock = true)
        val inner = RecordingSink()
        val sink = configured(inner, stages)
        feed(sink, frames = 3 * BLOCK)
        assertEquals(2L * BLOCK, inner.frames)
        assertEquals(3L * BLOCK * 1_000_000 / rate, sink.getCurrentPositionUs(false))
        feed(sink, frames = 7 * BLOCK, start = 3L * BLOCK)
        drain(sink)
        assertEquals(5L * BLOCK, inner.frames)
        assertEquals(1, stages.effects.endings)
        assertTrue(inner.ended)
    }

    @Test
    fun speedChangesDrainOnlySpeedProcessing() {
        val stages = FakeStages(dropEveryOtherBlock = false)
        val inner = RecordingSink()
        val sink = configured(inner, stages)
        feed(sink, frames = 2 * BLOCK)
        sink.setPlaybackParameters(PlaybackParameters(2f))
        feed(sink, frames = 4 * BLOCK, start = 2L * BLOCK)
        assertEquals(0, stages.effects.endings)
        sink.setPlaybackParameters(PlaybackParameters(1f))
        feed(sink, frames = 2 * BLOCK, start = 6L * BLOCK)
        assertEquals(0, stages.effects.endings)
        drain(sink)
        assertEquals(1, stages.effects.endings)
        val expected = 2 * BLOCK + 4 * BLOCK / 2 + 2 * BLOCK
        assertTrue("written ${inner.frames}", kotlin.math.abs(inner.frames - expected) < BLOCK / 4)
        assertEquals((8L * BLOCK * 1_000_000 / rate).toDouble(), sink.getCurrentPositionUs(false).toDouble(), 30_000.0)
    }

    @Test
    fun starvationNeverFinishesEffects() {
        val stages = FakeStages(dropEveryOtherBlock = false)
        val sink = configured(RecordingSink(), stages)
        feed(sink, frames = BLOCK)
        repeat(10) { sink.getCurrentPositionUs(false) }
        assertEquals(0, stages.effects.endings)
    }

    @Test
    fun seekingReanchorsSourceTime() {
        val stages = FakeStages(dropEveryOtherBlock = false)
        val inner = RecordingSink()
        val sink = configured(inner, stages)
        feed(sink, frames = BLOCK)
        sink.flush()
        inner.frames = 0
        feed(sink, frames = BLOCK, start = 40L * BLOCK)
        assertEquals(41L * BLOCK * 1_000_000 / rate, sink.getCurrentPositionUs(false))
        assertEquals(0, stages.effects.endings)
    }

    @Test
    fun unsupportedFormatsPassThroughWithEffectsUnavailable() {
        val inner = RecordingSink()
        val sink = ProcessingAudioSink(inner, FakeStages(false))
        sink.setEffects(AudioEffects(trimSilence = true))
        sink.configure(AudioSink.AudioSinkConfig.Builder(format(channels = 6)).build())
        assertTrue(sink.effectState.value is EffectState.Unavailable)
        assertEquals(6, inner.format?.channelCount)
    }

    private fun configured(inner: RecordingSink, stages: FakeStages) = ProcessingAudioSink(inner, stages).apply {
        configure(AudioSink.AudioSinkConfig.Builder(format(channels = 1)).build())
        play()
    }

    private fun format(channels: Int) = Format.Builder()
        .setSampleMimeType(MimeTypes.AUDIO_RAW)
        .setPcmEncoding(C.ENCODING_PCM_FLOAT)
        .setSampleRate(rate)
        .setChannelCount(channels)
        .build()

    private fun feed(sink: ProcessingAudioSink, frames: Int, start: Long = 0) {
        var offset = 0
        while (offset < frames) {
            val count = minOf(CHUNK, frames - offset)
            val buffer = ByteBuffer.allocateDirect(count * 4).order(ByteOrder.LITTLE_ENDIAN)
            repeat(count) { buffer.putFloat(0.25f) }
            buffer.flip()
            val presentationUs = (start + offset) * 1_000_000 / rate
            while (!sink.handleBuffer(buffer, presentationUs, 1)) Unit
            offset += count
        }
    }

    private fun drain(sink: ProcessingAudioSink) {
        repeat(100) { if (!sink.isEnded) sink.playToEndOfStream() }
    }

    private companion object {
        const val BLOCK = 8_000
        const val CHUNK = 777
    }
}

private class FakeStages(dropEveryOtherBlock: Boolean) : AudioStages {
    val effects = TrimmingStage(dropEveryOtherBlock)
    override fun effects(timeline: SourceTimeline): EffectsStage = effects.also { it.timeline = timeline }
    override fun limiter(): LimiterStage = PassStage()
}

private class TrimmingStage(private val drop: Boolean) : BaseAudioProcessor(), EffectsStage {
    lateinit var timeline: SourceTimeline
    var endings = 0
    private var source = 0L
    private var emitted = 0L

    override fun setEffects(effects: AudioEffects) = Unit

    override fun onConfigure(inputAudioFormat: AudioProcessor.AudioFormat) =
        AudioProcessor.AudioFormat(inputAudioFormat.sampleRate, inputAudioFormat.channelCount, C.ENCODING_PCM_FLOAT)

    override fun queueInput(inputBuffer: ByteBuffer) {
        val frames = inputBuffer.remaining() / 4
        val output = replaceOutputBuffer(inputBuffer.remaining())
        repeat(frames) {
            val sample = inputBuffer.getFloat()
            if (!drop || (source / 8_000) % 2 == 0L) {
                output.putFloat(sample)
                timeline.span(source, emitted, 1)
                emitted++
            }
            source++
        }
        output.flip()
    }

    override fun onQueueEndOfStream() {
        endings++
    }

    override fun onFlush(streamMetadata: AudioProcessor.StreamMetadata) {
        source = Math.round(streamMetadata.positionOffsetUs * 8_000 / 1_000_000.0)
        emitted = 0
    }
}

private class PassStage : BaseAudioProcessor(), LimiterStage {
    override val latencyFrames = 0

    override fun onConfigure(inputAudioFormat: AudioProcessor.AudioFormat) = inputAudioFormat

    override fun queueInput(inputBuffer: ByteBuffer) {
        val output = replaceOutputBuffer(inputBuffer.remaining())
        output.put(inputBuffer)
        output.flip()
    }
}

private class RecordingSink : AudioSink {
    var frames = 0L
    var ended = false
    var format: Format? = null
    private var parameters = PlaybackParameters.DEFAULT

    override fun setListener(listener: AudioSink.Listener) = Unit
    override fun supportsFormat(format: Format) = true
    override fun getFormatSupport(format: Format) = AudioSink.SINK_FORMAT_SUPPORTED_DIRECTLY
    override fun getCurrentPositionUs(sourceEnded: Boolean): Long = frames * 1_000_000 / (format?.sampleRate ?: 1)
    override fun configure(audioSinkConfig: AudioSink.AudioSinkConfig) { format = audioSinkConfig.format }
    override fun play() = Unit
    override fun handleDiscontinuity() = Unit
    override fun handleBuffer(buffer: ByteBuffer, presentationTimeUs: Long, encodedAccessUnitCount: Int): Boolean {
        frames += buffer.remaining() / (4 * (format?.channelCount ?: 1))
        buffer.position(buffer.limit())
        return true
    }
    override fun playToEndOfStream() { ended = true }
    override fun isEnded() = ended
    override fun hasPendingData() = false
    override fun setPlaybackParameters(playbackParameters: PlaybackParameters) { parameters = playbackParameters }
    override fun getPlaybackParameters() = parameters
    override fun setSkipSilenceEnabled(skipSilenceEnabled: Boolean) = Unit
    override fun getSkipSilenceEnabled() = false
    override fun setAudioAttributes(audioAttributes: AudioAttributes) = Unit
    override fun getAudioAttributes(): AudioAttributes? = null
    override fun setAudioSessionId(audioSessionId: Int) = Unit
    override fun setAuxEffectInfo(auxEffectInfo: AuxEffectInfo) = Unit
    override fun getAudioTrackBufferSizeUs() = 0L
    override fun enableTunnelingV21() = Unit
    override fun disableTunneling() = Unit
    override fun setVolume(volume: Float) = Unit
    override fun pause() = Unit
    override fun flush() { ended = false }
    override fun reset() = Unit
}
