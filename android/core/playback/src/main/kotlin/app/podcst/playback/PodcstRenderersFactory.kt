package app.podcst.playback

import android.content.Context
import androidx.media3.exoplayer.DefaultRenderersFactory
import androidx.media3.exoplayer.audio.AudioSink
import androidx.media3.exoplayer.audio.DefaultAudioSink
import app.podcst.playback.audio.AudioStages
import app.podcst.playback.audio.ProcessingAudioSink

class PodcstRenderersFactory(context: Context, stages: AudioStages) : DefaultRenderersFactory(context) {
    val sink = ProcessingAudioSink(
        DefaultAudioSink.Builder(context)
            .setEnableFloatOutput(true)
            .setEnableAudioOutputPlaybackParameters(false)
            .build(),
        stages,
    )

    override fun buildAudioSink(context: Context, enableFloatOutput: Boolean, enableAudioOutputPlaybackParams: Boolean): AudioSink = sink
}
