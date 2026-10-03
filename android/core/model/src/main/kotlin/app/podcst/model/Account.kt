package app.podcst.model

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
