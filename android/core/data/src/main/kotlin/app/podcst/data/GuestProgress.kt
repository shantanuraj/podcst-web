package app.podcst.data

import app.podcst.database.ProgressEntity
import app.podcst.model.Episode
import app.podcst.model.StateID
import app.podcst.model.StateProgressChange
import kotlinx.serialization.Serializable

@Serializable
data class GuestProgressSource(
    val identity: String,
    val sourceToken: String,
    val episodeId: Long?,
    val positionMs: Long,
    val durationMs: Long?,
    val completed: Boolean,
    val updatedAt: Long,
) {
    internal fun change(): StateProgressChange {
        require(sourceToken.isNotBlank() && positionMs >= 0 && positionMs / 1000 <= Int.MAX_VALUE)
        return StateProgressChange(StateID(checkNotNull(episodeId) { "Resolve the guest episode before transferring its position" }.toString()), (positionMs / 1000).toInt(), completed)
    }
}

data class GuestProgressSelection internal constructor(
    val accountId: String,
    internal val epoch: Long,
    val episode: Episode,
    internal val source: GuestProgressSource,
) {
    val sourceToken: String get() = source.sourceToken
    val positionSeconds: Long get() = source.positionMs / 1000
    val completed: Boolean get() = source.completed
    val canTransfer: Boolean get() = source.episodeId != null
}

internal fun ProgressEntity.guestSource(episode: Episode) = GuestProgressSource(
    identity, sourceToken, episode.id, positionMs, durationMs, completed, updatedAt,
)
