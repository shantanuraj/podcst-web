package app.podcst.audio

import java.nio.ByteBuffer

class SpanBuffer(val capacity: Int = MAX_BLOCK_FRAMES) {
    internal val buffer: ByteBuffer = nativeBuffer(capacity * SPAN_BYTES)

    fun sourceStartFrame(index: Int): Long = buffer.getLong(index * SPAN_BYTES)

    fun outputStartFrame(index: Int): Int = buffer.getInt(index * SPAN_BYTES + 8)

    fun frameCount(index: Int): Int = buffer.getInt(index * SPAN_BYTES + 12)

    private companion object {
        const val SPAN_BYTES = 16
    }
}

fun interface SourceSpanSink {
    fun onSpan(sourceStartFrame: Long, outputStartFrame: Long, frameCount: Int)
}
