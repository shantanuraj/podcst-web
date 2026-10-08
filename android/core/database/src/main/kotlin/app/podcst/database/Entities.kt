package app.podcst.database

import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

@Entity(tableName = "podcasts", indices = [Index("id")])
data class PodcastEntity(
    @PrimaryKey val feed: String,
    val id: Long?,
    val itunesId: Long?,
    val title: String,
    val author: String,
    val cover: String,
    val thumbnail: String,
    val description: String,
    val link: String?,
    val published: Long?,
    val explicit: Boolean,
    val keywords: List<String>,
    val episodeCount: Int,
    val isPrivate: Boolean,
    val refreshedAt: Long?,
    val complete: Boolean,
)

@Entity(tableName = "episodes", indices = [Index("feed", "published"), Index("id")])
data class EpisodeEntity(
    @PrimaryKey val identity: String,
    val id: Long?,
    val podcastId: Long?,
    val guid: String,
    val feed: String,
    val podcastTitle: String?,
    val title: String,
    val summary: String?,
    val published: Long?,
    val cover: String,
    val explicit: Boolean,
    val durationMs: Long?,
    val link: String?,
    val episodeArt: String?,
    val showNotes: String,
    val author: String?,
    val fileUrl: String,
    val fileLength: Long,
    val fileType: String,
    val isPrivate: Boolean,
    val mediaIdentity: String? = null,
    val mediaReferenceIdentity: String? = null,
)

@Entity(tableName = "subscriptions")
data class SubscriptionEntity(
    @PrimaryKey val feed: String,
    val subscribedAt: Long,
)

@Entity(tableName = "charts", primaryKeys = ["locale", "rank"])
data class ChartEntity(
    val locale: String,
    val rank: Int,
    val feed: String,
)

@Entity(tableName = "chart_refreshes")
data class ChartRefreshEntity(
    @PrimaryKey val locale: String,
    val refreshedAt: Long,
)

@Entity(tableName = "queue")
data class QueueEntity(
    @PrimaryKey val position: Int,
    val identity: String,
)

@Entity(tableName = "player")
data class PlayerEntity(
    @PrimaryKey val slot: Int = 0,
    val current: String?,
    val positionMs: Long,
    val active: Boolean,
)

@Entity(tableName = "progress", indices = [Index("updatedAt")])
data class ProgressEntity(
    @PrimaryKey val identity: String,
    val positionMs: Long,
    val durationMs: Long?,
    val completed: Boolean,
    val updatedAt: Long,
)

@Entity(tableName = "progress_outbox")
data class OutboxEntity(
    @PrimaryKey val episodeId: Long,
    val position: Double,
    val completed: Boolean,
    val queuedAt: Long,
)

@Entity(tableName = "stars")
data class StarEntity(
    @PrimaryKey val identity: String,
    val starredAt: Long,
)
