package app.podcst.audio

const val MAX_BLOCK_FRAMES = 8192

enum class AudioStatus {
    OK,
    OUTPUT_FULL,
    FINISHED,
    INVALID_ARGUMENT,
    INVALID_CONFIG,
    INVALID_STATE,
    INTERNAL_ERROR,
    BUSY,
    CLOSED,
}

class AudioEngineException internal constructor(val status: AudioStatus) : RuntimeException(status.name)

@JvmInline
value class AudioReport internal constructor(private val packed: Long) {
    internal val code: Int get() = (packed and 0xFF).toInt()
    val status: AudioStatus get() = AudioStatus.entries[code]
    val consumedFrames: Int get() = (packed ushr 8 and 0xFFFF).toInt()
    val emittedFrames: Int get() = (packed ushr 24 and 0xFFFF).toInt()
    val spanCount: Int get() = (packed ushr 40 and 0xFFFF).toInt()
    val outputFull: Boolean get() = code == AudioStatus.OUTPUT_FULL.ordinal
    val finished: Boolean get() = code == AudioStatus.FINISHED.ordinal
}
