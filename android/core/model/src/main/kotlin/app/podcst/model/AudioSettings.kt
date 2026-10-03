package app.podcst.model

import java.security.MessageDigest
import kotlinx.serialization.Serializable

@Serializable
data class AudioEffects(
    val volumeBoost: Boolean = false,
    val trimSilence: Boolean = false,
) {
    val enabled: Boolean get() = volumeBoost || trimSilence
}

@Serializable
data class AudioOptions(
    val speed: Double = 1.0,
    val effects: AudioEffects = AudioEffects(),
)

@Serializable
data class AudioSettings(
    val defaults: AudioOptions = AudioOptions(),
    val overrides: Map<String, AudioOptions> = emptyMap(),
) {
    fun options(feed: String?): AudioOptions = feed?.let { overrides[key(it)] } ?: defaults

    fun hasOverride(feed: String): Boolean = key(feed) in overrides

    fun with(options: AudioOptions, feed: String? = null): AudioSettings {
        val valid = validated(options)
        return if (feed == null) copy(defaults = valid) else copy(overrides = overrides + (key(feed) to valid))
    }

    fun withSpeed(speed: Double, feed: String?): AudioSettings {
        if (PlaybackRules.speeds.none { kotlin.math.abs(it - speed) < 0.0001 }) return this
        val target = feed?.takeIf(::hasOverride)
        return with(options(feed).copy(speed = speed), target)
    }

    fun usingDefaults(feed: String): AudioSettings = copy(overrides = overrides - key(feed))

    fun validated(): AudioSettings = AudioSettings(validated(defaults), overrides.mapValues { validated(it.value) })

    private fun validated(options: AudioOptions) =
        if (options.speed in PlaybackRules.speeds) options else options.copy(speed = 1.0)

    companion object {
        fun key(feed: String): String =
            MessageDigest.getInstance("SHA-256").digest(feed.toByteArray()).joinToString("") { "%02x".format(it) }
    }
}
