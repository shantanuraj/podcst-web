package app.podcst.playback

import android.content.Context
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import app.podcst.model.Episode
import app.podcst.playback.media.MediaStore
import kotlin.time.Duration
import kotlin.time.Duration.Companion.milliseconds
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

class ClipPreview(private val context: Context, private val media: MediaStore, private val scope: CoroutineScope) {
    private var player: ExoPlayer? = null
    private var ticker: Job? = null
    private val mutable = MutableStateFlow<Duration?>(null)
    val position: StateFlow<Duration?> = mutable.asStateFlow()

    fun play(episode: Episode, start: Duration, end: Duration) {
        stop()
        val preview = ExoPlayer.Builder(context)
            .setMediaSourceFactory(DefaultMediaSourceFactory(media.dataSource))
            .setAudioAttributes(AudioAttributes.Builder().setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_SPEECH).build(), true)
            .build()
        preview.setMediaItem(MediaStore.item(episode).build(), start.inWholeMilliseconds)
        preview.prepare()
        preview.play()
        player = preview
        mutable.value = start
        ticker = scope.launch {
            while (isActive) {
                val position = preview.currentPosition.coerceAtLeast(0).milliseconds
                if (position >= end || preview.playbackState == Player.STATE_ENDED || preview.playerError != null) return@launch stop()
                if (preview.isPlaying) mutable.value = position
                delay(TICK)
            }
        }
    }

    fun stop() {
        ticker?.cancel()
        ticker = null
        player?.release()
        player = null
        mutable.value = null
    }

    private companion object {
        const val TICK = 100L
    }
}
