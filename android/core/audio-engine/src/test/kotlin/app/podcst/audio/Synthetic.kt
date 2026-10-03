package app.podcst.audio

import java.nio.ByteBuffer
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.sin

fun speechPattern(sampleRate: Int, channels: Int, seconds: Int, amplitude: Float = 0.12f): ByteBuffer {
    val frames = sampleRate * seconds
    val buffer = direct(frames * channels * 4)
    for (frame in 0 until frames) {
        val time = frame.toDouble() / sampleRate
        val cycle = time % 5.0
        val value = if (cycle in 2.2..3.3) {
            0.00001 * sin(2 * PI * 97 * time)
        } else {
            amplitude * (0.25 + 0.75 * abs(sin(PI * time * 4))) * (sin(2 * PI * 180 * time) + 0.35 * sin(2 * PI * 510 * time))
        }
        repeat(channels) { channel -> buffer.putFloat((value * (1 - 0.3 * channel)).toFloat()) }
    }
    return buffer.flip() as ByteBuffer
}
