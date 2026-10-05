package app.podcst.model

import kotlin.time.Instant
import kotlinx.serialization.Serializable

@Serializable
data class User(
    val id: String,
    val email: String,
    val name: String? = null,
    val image: String? = null,
    val hasPasskey: Boolean = false,
)

@Serializable
data class PlaybackProgress(
    val episode: Episode,
    val position: Double,
)

@Serializable
data class ImportResult(
    val succeeded: Int,
    val failed: Int,
)

data class Passkey(
    val id: String,
    val provider: String?,
    val created: Instant,
    val lastUsed: Instant?,
)

data class Account(
    val created: Instant?,
    val passkeys: List<Passkey>,
    val preferences: AudioOptions?,
)
