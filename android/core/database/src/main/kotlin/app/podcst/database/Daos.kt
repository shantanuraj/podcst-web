package app.podcst.database

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.RewriteQueriesToDropUnusedColumns
import androidx.room.Transaction
import androidx.room.Upsert
import kotlinx.coroutines.flow.Flow

@Dao
interface PodcastDao {
    @Query("SELECT * FROM podcasts WHERE id IS NULL")
    fun observeUnresolved(): Flow<List<PodcastEntity>>
    @Query("SELECT * FROM podcasts WHERE id IS NULL")
    suspend fun unresolved(): List<PodcastEntity>

    @Query("SELECT * FROM podcasts")
    fun observeAll(): Flow<List<PodcastEntity>>

    @Query("SELECT * FROM podcasts WHERE feed = :feed")
    fun observe(feed: String): Flow<PodcastEntity?>

    @Query("SELECT * FROM podcasts WHERE feed = :feed")
    suspend fun get(feed: String): PodcastEntity?

    @Query("SELECT * FROM podcasts WHERE id = :id")
    suspend fun byId(id: Long): PodcastEntity?

    @Upsert
    suspend fun upsert(podcasts: List<PodcastEntity>)

    @Query("SELECT p.* FROM podcasts p JOIN subscriptions s ON s.feed = p.feed ORDER BY s.subscribedAt DESC")
    fun observeSubscribed(): Flow<List<PodcastEntity>>

    @Query("SELECT p.* FROM podcasts p JOIN subscriptions s ON s.feed = p.feed ORDER BY s.subscribedAt DESC")
    suspend fun subscribed(): List<PodcastEntity>

    @Query("SELECT p.* FROM charts c JOIN podcasts p ON p.feed = c.feed WHERE c.locale = :locale ORDER BY c.rank")
    fun observeChart(locale: String): Flow<List<PodcastEntity>>
}

@Dao
interface EpisodeDao {
    @Query("SELECT e.* FROM episodes e JOIN progress_outbox o ON e.id = o.episodeId OR e.mediaIdentity = 'episode:' || o.episodeId")
    fun observeLegacyProgress(): Flow<List<EpisodeEntity>>

    @Query("SELECT * FROM episodes WHERE id IS NULL")
    fun observeUnresolved(): Flow<List<EpisodeEntity>>
    @Query("SELECT * FROM episodes WHERE id IS NULL")
    suspend fun unresolved(): List<EpisodeEntity>

    @Query("SELECT * FROM episodes WHERE feed = :feed")
    fun observeCatalog(feed: String): Flow<List<EpisodeEntity>>

    @Query("SELECT * FROM episodes WHERE feed = :feed")
    suspend fun catalog(feed: String): List<EpisodeEntity>

    @Query("SELECT * FROM episodes WHERE identity = :identity")
    fun observe(identity: String): Flow<EpisodeEntity?>

    @Query("SELECT * FROM episodes WHERE identity = :identity")
    suspend fun get(identity: String): EpisodeEntity?

    @Query("SELECT * FROM episodes WHERE identity IN (:identities) OR mediaReferenceIdentity IN (:identities)")
    suspend fun get(identities: List<String>): List<EpisodeEntity>

    @Query("SELECT * FROM episodes WHERE identity IN (:identities) OR mediaReferenceIdentity IN (:identities)")
    fun observe(identities: List<String>): Flow<List<EpisodeEntity>>

    @Upsert
    suspend fun writeEpisodes(episodes: List<EpisodeEntity>)

    @Query("SELECT * FROM episodes WHERE feed = :feed AND guid = :guid")
    suspend fun source(feed: String, guid: String): List<EpisodeEntity>

    @Query("UPDATE queue SET identity = :new WHERE identity = :old")
    suspend fun moveQueue(old: String, new: String)
    @Query("UPDATE player SET current = :new WHERE current = :old")
    suspend fun movePlayer(old: String, new: String)
    @Query("UPDATE OR IGNORE progress SET identity = :new WHERE identity = :old")
    suspend fun moveProgress(old: String, new: String)
    @Query("UPDATE OR IGNORE stars SET identity = :new WHERE identity = :old")
    suspend fun moveStars(old: String, new: String)
    @Query("DELETE FROM episodes WHERE identity = :identity")
    suspend fun remove(identity: String)

    @Transaction
    suspend fun upsert(episodes: List<EpisodeEntity>) {
        for (episode in episodes) {
            val existing = get(episode.identity)
            // Only an exact source-scoped observation may resolve an old local reference.
            val source = source(episode.feed, episode.guid).singleOrNull()?.takeIf { it.id == null && episode.id != null }
            val media = existing?.mediaIdentity ?: source?.mediaIdentity ?: episode.mediaIdentity
            if (source != null && source.identity != episode.identity) {
                moveQueue(source.identity, episode.identity)
                movePlayer(source.identity, episode.identity)
                moveProgress(source.identity, episode.identity)
                moveStars(source.identity, episode.identity)
                // Keep conflicting old progress/source rows; they are not new upload intent.
                remove(source.identity)
            }
            writeEpisodes(listOf(episode.copy(mediaIdentity = media, mediaReferenceIdentity = existing?.mediaReferenceIdentity ?: source?.mediaReferenceIdentity ?: episode.mediaReferenceIdentity)))
        }
    }

    @RewriteQueriesToDropUnusedColumns
    @Query(
        """
        SELECT * FROM (
            SELECT e.*, ROW_NUMBER() OVER (PARTITION BY e.feed ORDER BY e.published DESC) AS recency
            FROM episodes e JOIN subscriptions s ON s.feed = e.feed
        ) WHERE recency <= :perPodcast ORDER BY published DESC
        """,
    )
    fun observeNewReleases(perPodcast: Int): Flow<List<EpisodeEntity>>

    @Query("SELECT e.* FROM queue q JOIN episodes e ON e.identity = q.identity ORDER BY q.position")
    fun observeQueue(): Flow<List<EpisodeEntity>>

    @Query("SELECT e.* FROM queue q JOIN episodes e ON e.identity = q.identity ORDER BY q.position")
    suspend fun queue(): List<EpisodeEntity>

    @Query("SELECT e.* FROM stars s JOIN episodes e ON e.identity = s.identity ORDER BY s.starredAt DESC")
    fun observeStarred(): Flow<List<EpisodeEntity>>

    @Query(
        """
        SELECT e.* FROM progress p JOIN episodes e ON e.identity = p.identity
        WHERE p.completed = 0 AND p.positionMs > 0 ORDER BY p.updatedAt DESC LIMIT :limit
        """,
    )
    fun observeUnfinished(limit: Int): Flow<List<EpisodeEntity>>
}

@Dao
interface SubscriptionDao {
    @Query("SELECT feed FROM subscriptions")
    fun observeFeeds(): Flow<List<String>>

    @Insert(onConflict = OnConflictStrategy.IGNORE)
    suspend fun insert(subscription: SubscriptionEntity)

    @Query("DELETE FROM subscriptions WHERE feed = :feed")
    suspend fun delete(feed: String)

    @Query("DELETE FROM subscriptions")
    suspend fun clear()

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insert(subscriptions: List<SubscriptionEntity>)

    @Transaction
    suspend fun replace(subscriptions: List<SubscriptionEntity>) {
        clear()
        insert(subscriptions)
    }
}

@Dao
interface ChartDao {
    @Query("SELECT refreshedAt FROM chart_refreshes WHERE locale = :locale")
    suspend fun refreshedAt(locale: String): Long?

    @Query("DELETE FROM charts WHERE locale = :locale")
    suspend fun clear(locale: String)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insert(entries: List<ChartEntity>)

    @Upsert
    suspend fun refreshed(refresh: ChartRefreshEntity)

    @Transaction
    suspend fun replace(locale: String, feeds: List<String>, refreshedAt: Long) {
        clear(locale)
        insert(feeds.mapIndexed { rank, feed -> ChartEntity(locale, rank, feed) })
        refreshed(ChartRefreshEntity(locale, refreshedAt))
    }
}


@Dao
interface PlayerDao {
    @Query("SELECT identity FROM queue ORDER BY position")
    suspend fun queue(): List<String>

    @Query("SELECT * FROM player WHERE slot = 0")
    suspend fun player(): PlayerEntity?

    @Query("DELETE FROM queue")
    suspend fun clearQueue()

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertQueue(entries: List<QueueEntity>)

    @Upsert
    suspend fun setPlayer(player: PlayerEntity)

    @Transaction
    suspend fun save(queue: List<String>, player: PlayerEntity) {
        clearQueue()
        insertQueue(queue.mapIndexed { position, identity -> QueueEntity(position, identity) })
        setPlayer(player)
    }
}

@Dao
interface ProgressDao {
    @Query("SELECT * FROM progress")
    fun observeAll(): Flow<List<ProgressEntity>>

    @Query("SELECT * FROM progress WHERE identity = :identity")
    suspend fun get(identity: String): ProgressEntity?

    @Upsert
    suspend fun upsert(progress: ProgressEntity)

    @Upsert
    suspend fun upsert(progress: List<ProgressEntity>)

    @Query("DELETE FROM progress WHERE identity = :identity")
    suspend fun delete(identity: String)
}

@Dao
interface OutboxDao {
    @Query("SELECT * FROM progress_outbox ORDER BY queuedAt")
    fun observePending(): Flow<List<OutboxEntity>>

    @Query("SELECT * FROM progress_outbox ORDER BY queuedAt")
    suspend fun pending(): List<OutboxEntity>

    @Query("SELECT * FROM progress_outbox WHERE episodeId = :episodeId")
    suspend fun get(episodeId: Long): OutboxEntity?

    @Upsert
    suspend fun enqueue(update: OutboxEntity)

    @Query("DELETE FROM progress_outbox WHERE episodeId = :episodeId AND queuedAt = :queuedAt")
    suspend fun sent(episodeId: Long, queuedAt: Long)
}

@Dao
interface StarDao {
    @Query("SELECT identity FROM stars")
    fun observeIdentities(): Flow<List<String>>

    @Insert(onConflict = OnConflictStrategy.IGNORE)
    suspend fun star(star: StarEntity)

    @Query("DELETE FROM stars WHERE identity = :identity")
    suspend fun unstar(identity: String)

    @Query("SELECT EXISTS(SELECT 1 FROM stars WHERE identity = :identity)")
    suspend fun contains(identity: String): Boolean
}
