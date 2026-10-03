package app.podcst.playback.audio

import androidx.media3.common.C
import androidx.media3.common.Format
import androidx.media3.common.MimeTypes
import androidx.media3.common.PlaybackParameters
import androidx.media3.common.audio.AudioProcessor
import androidx.media3.common.audio.SonicAudioProcessor
import androidx.media3.exoplayer.audio.AudioSink
import androidx.media3.exoplayer.audio.ForwardingAudioSink
import app.podcst.model.AudioEffects
import java.nio.ByteBuffer
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

interface EffectsStage : AudioProcessor {
    fun setEffects(effects: AudioEffects)
}

interface LimiterStage : AudioProcessor {
    val latencyFrames: Int
}

interface AudioStages {
    fun effects(timeline: SourceTimeline): EffectsStage
    fun limiter(): LimiterStage
}

sealed interface EffectState {
    data object Inactive : EffectState
    data class Active(val effects: AudioEffects) : EffectState
    data class Unavailable(val reason: String) : EffectState
}

class ProcessingAudioSink(
    private val inner: AudioSink,
    private val stages: AudioStages,
) : ForwardingAudioSink(inner) {
    private val timeline = SourceTimeline()
    private val sonic = SonicAudioProcessor()
    private val state = MutableStateFlow<EffectState>(EffectState.Inactive)
    val effectState: StateFlow<EffectState> = state.asStateFlow()

    @Volatile private var requestedEffects = AudioEffects()
    @Volatile private var requestedSpeed = 1f
    private var parameters = PlaybackParameters.DEFAULT

    private var processing = false
    private var effects: EffectsStage? = null
    private var limiter: LimiterStage? = null
    private var appliedEffects: AudioEffects? = null
    private var format = AudioProcessor.AudioFormat.NOT_SET
    private var bytesPerFrame = 0

    private var effectsOutput: ByteBuffer = AudioProcessor.EMPTY_BUFFER
    private var sonicOutput: ByteBuffer = AudioProcessor.EMPTY_BUFFER
    private var limiterOutput: ByteBuffer = AudioProcessor.EMPTY_BUFFER
    private var pendingFrames = 0L
    private var pendingPresentationUs = 0L
    private var writtenFrames = 0L
    private var effectsForwarded = 0L
    private var limiterFed = 0L

    private var activeSpeed = 1f
    private var sonicInPath = false
    private var sonicDraining = false
    private var endOfStream = false
    private var limiterDraining = false
    private var anchored = false

    fun setEffects(effects: AudioEffects) {
        requestedEffects = effects
        publishState()
    }

    override fun supportsFormat(format: Format): Boolean = getFormatSupport(format) != AudioSink.SINK_FORMAT_UNSUPPORTED

    override fun getFormatSupport(format: Format): Int =
        if (processable(format)) AudioSink.SINK_FORMAT_SUPPORTED_DIRECTLY else super.getFormatSupport(format)

    override fun configure(audioSinkConfig: AudioSink.AudioSinkConfig) {
        val input = audioSinkConfig.format
        releaseStages()
        processing = processable(input)
        publishState()
        if (!processing) {
            super.setPlaybackParameters(parameters)
            super.configure(audioSinkConfig)
            return
        }
        format = AudioProcessor.AudioFormat(input.sampleRate, input.channelCount, input.pcmEncoding)
        val floatFormat = AudioProcessor.AudioFormat(input.sampleRate, input.channelCount, C.ENCODING_PCM_FLOAT)
        bytesPerFrame = floatFormat.bytesPerFrame
        effects = stages.effects(timeline).also { it.configure(format) }
        limiter = stages.limiter().also { it.configure(floatFormat) }
        super.setPlaybackParameters(PlaybackParameters.DEFAULT)
        super.configure(
            AudioSink.AudioSinkConfig.Builder(
                Format.Builder()
                    .setSampleMimeType(MimeTypes.AUDIO_RAW)
                    .setPcmEncoding(C.ENCODING_PCM_FLOAT)
                    .setSampleRate(input.sampleRate)
                    .setChannelCount(input.channelCount)
                    .build(),
            )
                .setTimeline(audioSinkConfig.timeline)
                .setMediaPeriodId(audioSinkConfig.mediaPeriodId)
                .build(),
        )
        restart()
    }

    override fun handleBuffer(buffer: ByteBuffer, presentationTimeUs: Long, encodedAccessUnitCount: Int): Boolean {
        if (!processing) return super.handleBuffer(buffer, presentationTimeUs, encodedAccessUnitCount)
        val effects = effects ?: return false
        if (!anchored) anchor(presentationTimeUs)
        applyEffects(effects)
        while (true) {
            if (!pump()) return false
            if (!buffer.hasRemaining()) return true
            val before = buffer.position()
            effects.queueInput(buffer)
            effectsOutput = effectsOutput.takeIf { it.hasRemaining() } ?: effects.output
            if (buffer.position() == before && !effectsOutput.hasRemaining()) return false
        }
    }

    override fun playToEndOfStream() {
        if (!processing) return super.playToEndOfStream()
        val effects = effects ?: return
        if (!anchored) return super.playToEndOfStream()
        if (!endOfStream) {
            endOfStream = true
            effects.queueEndOfStream()
        }
        if (!pump()) return
        if (stagesEnded()) super.playToEndOfStream()
    }

    override fun isEnded(): Boolean = if (!processing) super.isEnded() else (!anchored || stagesEnded()) && super.isEnded()

    override fun hasPendingData(): Boolean =
        if (!processing) super.hasPendingData() else limiterOutput.hasRemaining() || super.hasPendingData()

    override fun getCurrentPositionUs(sourceEnded: Boolean): Long {
        if (!processing) return super.getCurrentPositionUs(sourceEnded)
        val played = super.getCurrentPositionUs(sourceEnded)
        if (played == AudioSink.CURRENT_POSITION_NOT_SET || !anchored) return AudioSink.CURRENT_POSITION_NOT_SET
        val outputFrame = played * format.sampleRate / 1_000_000L - (limiter?.latencyFrames ?: 0)
        return timeline.positionUs(outputFrame)
    }

    override fun setPlaybackParameters(playbackParameters: PlaybackParameters) {
        parameters = PlaybackParameters(playbackParameters.speed.coerceIn(MIN_SPEED, MAX_SPEED), 1f)
        requestedSpeed = parameters.speed
        if (!processing) super.setPlaybackParameters(parameters)
    }

    override fun getPlaybackParameters(): PlaybackParameters = parameters

    override fun setSkipSilenceEnabled(skipSilenceEnabled: Boolean) = Unit

    override fun getSkipSilenceEnabled(): Boolean = false

    override fun flush() {
        super.flush()
        if (processing) restart()
    }

    override fun reset() {
        super.reset()
        releaseStages()
        processing = false
    }

    override fun release() {
        super.release()
        releaseStages()
    }

    private fun processable(format: Format): Boolean =
        MimeTypes.AUDIO_RAW == format.sampleMimeType &&
            (format.pcmEncoding == C.ENCODING_PCM_16BIT || format.pcmEncoding == C.ENCODING_PCM_FLOAT) &&
            format.channelCount in 1..2 &&
            format.sampleRate in MIN_RATE..MAX_RATE

    private fun restart() {
        anchored = false
        effectsOutput = AudioProcessor.EMPTY_BUFFER
        sonicOutput = AudioProcessor.EMPTY_BUFFER
        limiterOutput = AudioProcessor.EMPTY_BUFFER
        pendingFrames = 0
        writtenFrames = 0
        effectsForwarded = 0
        limiterFed = 0
        endOfStream = false
        limiterDraining = false
        sonicDraining = false
        sonicInPath = false
        activeSpeed = 1f
        appliedEffects = null
    }

    private fun anchor(presentationTimeUs: Long) {
        anchored = true
        timeline.reset(presentationTimeUs, format.sampleRate)
        val metadata = AudioProcessor.StreamMetadata.Builder().setPositionOffsetUs(presentationTimeUs).build()
        effects?.flush(metadata)
        limiter?.flush(metadata)
        startSegment(requestedSpeed)
    }

    private fun applyEffects(effects: EffectsStage) {
        val requested = requestedEffects
        if (appliedEffects == requested) return
        effects.setEffects(requested)
        appliedEffects = requested
    }

    private fun startSegment(speed: Float) {
        activeSpeed = speed
        sonicInPath = speed != 1f
        sonicOutput = AudioProcessor.EMPTY_BUFFER
        if (sonicInPath) {
            sonic.setSpeed(speed)
            sonic.setPitch(1f)
            sonic.configure(AudioProcessor.AudioFormat(format.sampleRate, format.channelCount, C.ENCODING_PCM_FLOAT))
            sonic.flush(AudioProcessor.StreamMetadata.DEFAULT)
        }
        timeline.speed(limiterFed, effectsForwarded, speed.toDouble())
    }

    private fun pump(): Boolean {
        val effects = effects ?: return true
        val limiter = limiter ?: return true
        while (true) {
            if (limiterOutput.hasRemaining()) {
                val presentationUs = writtenFrames * 1_000_000L / format.sampleRate
                if (pendingFrames == 0L) {
                    pendingFrames = (limiterOutput.remaining() / bytesPerFrame).toLong()
                    pendingPresentationUs = presentationUs
                }
                if (!super.handleBuffer(limiterOutput, pendingPresentationUs, 1)) return false
                writtenFrames += pendingFrames
                pendingFrames = 0
                continue
            }
            limiterOutput = limiter.output
            if (limiterOutput.hasRemaining()) continue
            if (limiterDraining) return true

            if (!endOfStream && !sonicDraining && requestedSpeed != activeSpeed) {
                if (sonicInPath) {
                    sonicDraining = true
                    sonic.queueEndOfStream()
                } else {
                    startSegment(requestedSpeed)
                }
                continue
            }

            val upstream = upstreamOutput(effects)
            if (upstream.hasRemaining()) {
                val before = upstream.position()
                limiter.queueInput(upstream)
                val frames = ((upstream.position() - before) / bytesPerFrame).toLong()
                limiterFed += frames
                if (!sonicInPath) effectsForwarded += frames
                if (frames > 0 || limiter.output.also { limiterOutput = it }.hasRemaining()) continue
                return true
            }

            if (sonicInPath && !sonicDraining && effectsOutput.hasRemaining()) {
                val before = effectsOutput.position()
                sonic.queueInput(effectsOutput)
                effectsForwarded += ((effectsOutput.position() - before) / bytesPerFrame).toLong()
                continue
            }

            if (!effectsOutput.hasRemaining()) {
                effectsOutput = effects.output
                if (effectsOutput.hasRemaining()) continue
            }

            if (sonicDraining && sonic.isEnded && !sonicOutput.hasRemaining()) {
                sonicDraining = false
                startSegment(requestedSpeed)
                continue
            }

            if (endOfStream && effects.isEnded && !effectsOutput.hasRemaining()) {
                if (sonicInPath && !sonicDraining && !sonic.isEnded) {
                    sonicDraining = true
                    sonic.queueEndOfStream()
                    continue
                }
                if (!sonicInPath || (sonic.isEnded && !sonicOutput.hasRemaining())) {
                    limiterDraining = true
                    limiter.queueEndOfStream()
                    continue
                }
            }
            return true
        }
    }

    private fun upstreamOutput(effects: EffectsStage): ByteBuffer {
        if (!sonicInPath) {
            if (!effectsOutput.hasRemaining()) effectsOutput = effects.output
            return effectsOutput
        }
        if (!sonicOutput.hasRemaining()) sonicOutput = sonic.output
        return sonicOutput
    }

    private fun stagesEnded(): Boolean = limiterDraining && limiter?.isEnded != false && !limiterOutput.hasRemaining()

    private fun publishState() {
        val requested = requestedEffects
        state.value = when {
            !requested.enabled -> EffectState.Inactive
            processing -> EffectState.Active(requested)
            else -> EffectState.Unavailable(UNSUPPORTED)
        }
    }

    private fun releaseStages() {
        effects?.reset()
        limiter?.reset()
        sonic.reset()
        effects = null
        limiter = null
    }

    private companion object {
        const val MIN_RATE = 8_000
        const val MAX_RATE = 192_000
        const val MIN_SPEED = 0.1f
        const val MAX_SPEED = 8f
        const val UNSUPPORTED = "Audio effects are unavailable for this format."
    }
}
