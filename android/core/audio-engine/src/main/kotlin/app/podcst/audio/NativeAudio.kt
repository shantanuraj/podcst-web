package app.podcst.audio

import java.lang.ref.Cleaner
import java.nio.ByteBuffer

internal object NativeAudio {
    val cleaner: Cleaner = Cleaner.create()

    init {
        System.loadLibrary("podcst_audio_jni")
    }

    fun created(address: Long): Long {
        if (address < 0) throw AudioEngineException(AudioStatus.entries[(-address).toInt()])
        return address
    }

    fun verify(status: Int) {
        if (status >= AudioStatus.INVALID_ARGUMENT.ordinal) {
            throw AudioEngineException(AudioStatus.entries[status])
        }
    }

    fun report(packed: Long): AudioReport = AudioReport(packed).also { verify(it.code) }

    @JvmStatic external fun effectsCreate(sampleRate: Int, channels: Int, boost: Boolean, trim: Boolean): Long

    @JvmStatic external fun effectsConfigure(address: Long, boost: Boolean, trim: Boolean, revision: Long): Int

    @JvmStatic external fun effectsProcess(
        address: Long,
        input: ByteBuffer,
        inputOffset: Int,
        inputBytes: Int,
        output: ByteBuffer,
        outputOffset: Int,
        outputBytes: Int,
        spans: ByteBuffer,
        spanBytes: Int,
    ): Long

    @JvmStatic external fun effectsFinish(
        address: Long,
        output: ByteBuffer,
        outputOffset: Int,
        outputBytes: Int,
        spans: ByteBuffer,
        spanBytes: Int,
    ): Long

    @JvmStatic external fun effectsReset(address: Long, origin: Long): Int

    @JvmStatic external fun effectsInfo(address: Long, info: ByteBuffer): Int

    @JvmStatic external fun effectsClose(address: Long): Int

    @JvmStatic external fun effectsRelease(address: Long)

    @JvmStatic external fun limiterCreate(sampleRate: Int, channels: Int): Long

    @JvmStatic external fun limiterProcess(
        address: Long,
        input: ByteBuffer,
        inputOffset: Int,
        inputBytes: Int,
        output: ByteBuffer,
        outputOffset: Int,
        outputBytes: Int,
    ): Long

    @JvmStatic external fun limiterFinish(address: Long, output: ByteBuffer, outputOffset: Int, outputBytes: Int): Long

    @JvmStatic external fun limiterReset(address: Long): Int

    @JvmStatic external fun limiterInfo(address: Long, info: ByteBuffer): Int

    @JvmStatic external fun limiterClose(address: Long): Int

    @JvmStatic external fun limiterRelease(address: Long)
}
