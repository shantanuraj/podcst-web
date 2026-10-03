package app.podcst.playback.audio

import androidx.media3.common.audio.AudioProcessor
import app.podcst.audio.RustEffectsAudioProcessor
import app.podcst.audio.RustLimiterAudioProcessor
import app.podcst.model.AudioEffects

object RustAudioStages : AudioStages {
    override fun effects(timeline: SourceTimeline): EffectsStage = RustEffectsStage(RustEffectsAudioProcessor(timeline::span))

    override fun limiter(): LimiterStage = RustLimiterStage(RustLimiterAudioProcessor())
}

private class RustEffectsStage(private val processor: RustEffectsAudioProcessor) : EffectsStage, AudioProcessor by processor {
    override fun setEffects(effects: AudioEffects) = processor.setEffects(effects.volumeBoost, effects.trimSilence)

    override fun flush(streamMetadata: AudioProcessor.StreamMetadata) = processor.flush(streamMetadata)
}

private class RustLimiterStage(private val processor: RustLimiterAudioProcessor) : LimiterStage, AudioProcessor by processor {
    override val latencyFrames: Int get() = processor.latencyFrames

    override fun flush(streamMetadata: AudioProcessor.StreamMetadata) = processor.flush(streamMetadata)
}
