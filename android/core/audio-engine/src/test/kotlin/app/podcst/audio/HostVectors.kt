package app.podcst.audio

import java.io.File

val hostVectors: List<VectorCase> by lazy {
    val directory = File(checkNotNull(System.getProperty("podcst.audio.vectors")))
    loadVectors { File(directory, it).readBytes() }
}

fun hostVector(name: String): VectorCase = hostVectors.single { it.name == name }

inline fun failure(block: () -> Unit): AudioStatus {
    try {
        block()
    } catch (error: AudioEngineException) {
        return error.status
    }
    throw AssertionError("expected an AudioEngineException")
}
