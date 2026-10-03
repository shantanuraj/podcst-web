package app.podcst.playback

import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import app.podcst.model.AudioEffects
import app.podcst.playback.audio.EffectState
import app.podcst.playback.audio.RustAudioStages
import java.io.File
import java.io.RandomAccessFile
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlin.math.PI
import kotlin.math.sin
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class TrimmedPlaybackTest {
    private val context = InstrumentationRegistry.getInstrumentation().targetContext
    private val main = Handler(Looper.getMainLooper())

    @Test
    fun trimSilencePlaysFasterWhileReportingSourceTime() {
        val file = speechWithPauses()
        val renderers = PodcstRenderersFactory(context, RustAudioStages)
        lateinit var player: ExoPlayer
        val positions = mutableListOf<Long>()
        val ended = CountDownLatch(1)
        onMain {
            renderers.sink.setEffects(AudioEffects(trimSilence = true))
            player = ExoPlayer.Builder(context, renderers).build()
            player.volume = 0f
            player.addListener(object : Player.Listener {
                override fun onPlaybackStateChanged(state: Int) {
                    if (state == Player.STATE_ENDED) ended.countDown()
                }
            })
            player.setMediaItem(MediaItem.fromUri(file.toURI().toString()))
            player.prepare()
            player.play()
        }
        val started = SystemClock.elapsedRealtime()
        val sampler = object : Runnable {
            override fun run() {
                positions += player.currentPosition
                main.postDelayed(this, 100)
            }
        }
        main.post(sampler)
        assertTrue("playback ended", ended.await(SECONDS + 10L, TimeUnit.SECONDS))
        val elapsed = SystemClock.elapsedRealtime() - started
        onMain { main.removeCallbacks(sampler) }
        var duration = 0L
        var state: EffectState? = null
        onMain {
            duration = player.duration
            state = renderers.sink.effectState.value
            player.release()
        }
        assertEquals(SECONDS * 1_000.0, duration.toDouble(), 50.0)
        assertTrue("effects active: $state", state is EffectState.Active)
        assertTrue("trimmed playback took $elapsed ms", elapsed < SECONDS * 1_000L - 1_000)
        assertTrue("monotonic $positions", positions.zipWithNext().all { (a, b) -> b >= a - 50 })
        assertTrue("reached source end ${positions.lastOrNull()}", (positions.maxOrNull() ?: 0) > SECONDS * 1_000L - 1_500)
    }

    private fun onMain(block: () -> Unit) = InstrumentationRegistry.getInstrumentation().runOnMainSync(block)

    private fun speechWithPauses(): File {
        val rate = 48_000
        val samples = ShortArray(rate * SECONDS)
        val sections = listOf(0.0 to 2.0, 5.0 to 7.0, 10.0 to 12.0)
        for (index in samples.indices) {
            val time = index.toDouble() / rate
            val voiced = sections.any { (start, end) -> time >= start && time < end }
            val envelope = 0.4 + 0.6 * sin(2 * PI * 3 * time).let { it * it }
            samples[index] = if (voiced) (sin(2 * PI * 180 * time) * envelope * 9_000).toInt().toShort() else 0
        }
        val file = File(context.cacheDir, "speech.wav")
        RandomAccessFile(file, "rw").use { out ->
            out.setLength(0)
            val bytes = samples.size * 2
            fun int(value: Int) = out.write(byteArrayOf(value.toByte(), (value shr 8).toByte(), (value shr 16).toByte(), (value shr 24).toByte()))
            fun short(value: Int) = out.write(byteArrayOf(value.toByte(), (value shr 8).toByte()))
            out.writeBytes("RIFF"); int(36 + bytes); out.writeBytes("WAVEfmt ")
            int(16); short(1); short(1); int(rate); int(rate * 2); short(2); short(16)
            out.writeBytes("data"); int(bytes)
            val buffer = java.nio.ByteBuffer.allocate(bytes).order(java.nio.ByteOrder.LITTLE_ENDIAN)
            samples.forEach(buffer::putShort)
            out.write(buffer.array())
        }
        return file
    }

    private companion object {
        const val SECONDS = 12
    }
}
