package app.podcst.audio

import java.lang.ref.Reference
import java.nio.ByteBuffer
import java.nio.ByteOrder

internal class NativeHandle(created: Long, release: (Long) -> Unit, private val destroy: (Long) -> Int) {
    val address = NativeAudio.created(created)

    init {
        val address = address
        NativeAudio.cleaner.register(this) { release(address) }
    }

    inline fun <T> use(block: (Long) -> T): T =
        try {
            block(address)
        } finally {
            Reference.reachabilityFence(this)
        }

    fun close() = use { NativeAudio.verify(destroy(it)) }
}

internal fun ByteBuffer.advance(bytes: Int) {
    position(position() + bytes)
}

internal fun nativeBuffer(bytes: Int): ByteBuffer = ByteBuffer.allocateDirect(bytes).order(ByteOrder.nativeOrder())
