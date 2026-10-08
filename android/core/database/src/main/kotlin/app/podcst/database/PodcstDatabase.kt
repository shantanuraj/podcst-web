package app.podcst.database

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.TypeConverters

@Database(
    entities = [
        PodcastEntity::class,
        EpisodeEntity::class,
        SubscriptionEntity::class,
        ChartEntity::class,
        ChartRefreshEntity::class,
        QueueEntity::class,
        PlayerEntity::class,
        ProgressEntity::class,
        OutboxEntity::class,
        StarEntity::class,
    ],
    version = 3,
)
@TypeConverters(Converters::class)
abstract class PodcstDatabase : RoomDatabase() {
    abstract fun podcasts(): PodcastDao
    abstract fun episodes(): EpisodeDao
    abstract fun subscriptions(): SubscriptionDao
    abstract fun charts(): ChartDao
    abstract fun player(): PlayerDao
    abstract fun progress(): ProgressDao
    abstract fun outbox(): OutboxDao
    abstract fun stars(): StarDao

    companion object {
        val IDENTITY_MIGRATION = object : androidx.room.migration.Migration(1, 2) {
            override fun migrate(db: androidx.sqlite.db.SupportSQLiteDatabase) {
                db.execSQL("CREATE TABLE legacy_episode_source AS SELECT * FROM episodes WHERE id <= 0 OR id > 9007199254740991 OR podcastId <= 0 OR podcastId > 9007199254740991 OR id IN (SELECT id FROM episodes GROUP BY id HAVING COUNT(*) > 1) OR id IN (SELECT episodeId FROM progress_outbox)")
                db.execSQL("CREATE TABLE legacy_podcast_source AS SELECT * FROM podcasts WHERE id <= 0 OR id > 9007199254740991 OR itunesId <= 0 OR itunesId > 9007199254740991 OR id IN (SELECT id FROM podcasts GROUP BY id HAVING COUNT(*) > 1)")
                db.execSQL("ALTER TABLE episodes ADD COLUMN mediaIdentity TEXT")
                db.execSQL("ALTER TABLE episodes ADD COLUMN mediaReferenceIdentity TEXT")
                db.execSQL("UPDATE episodes SET mediaReferenceIdentity = identity")
                db.execSQL("UPDATE episodes SET mediaIdentity = CASE WHEN id IS NOT NULL THEN 'episode:' || id WHEN podcastId IS NOT NULL THEN 'podcast:' || podcastId || ':' || guid ELSE identity END")
                db.execSQL("CREATE TABLE identity_migration AS SELECT identity AS old, CASE WHEN id BETWEEN 1 AND 9007199254740991 AND id NOT IN (SELECT id FROM episodes WHERE id IS NOT NULL GROUP BY id HAVING COUNT(*) > 1) THEN 'episode:' || id ELSE 'local:' || identity END AS new FROM episodes")
                for ((table, column) in listOf("queue" to "identity", "player" to "current", "progress" to "identity", "stars" to "identity")) {
                    db.execSQL("UPDATE $table SET $column = COALESCE((SELECT new FROM identity_migration WHERE old = $table.$column), $column)")
                }
                db.execSQL("UPDATE episodes SET identity = (SELECT new FROM identity_migration WHERE old = episodes.identity)")
                db.execSQL("DROP TABLE identity_migration")
                db.execSQL("UPDATE episodes SET id = NULL WHERE identity LIKE 'local:%'")
                db.execSQL("UPDATE episodes SET podcastId = NULL WHERE podcastId <= 0 OR podcastId > 9007199254740991")
                db.execSQL("UPDATE podcasts SET id = NULL WHERE id <= 0 OR id > 9007199254740991 OR id IN (SELECT id FROM podcasts WHERE id IS NOT NULL GROUP BY id HAVING COUNT(*) > 1)")
                db.execSQL("UPDATE podcasts SET itunesId = NULL WHERE itunesId <= 0 OR itunesId > 9007199254740991")
            }
        }

        val PROGRESS_SOURCE_MIGRATION = object : androidx.room.migration.Migration(2, 3) {
            override fun migrate(db: androidx.sqlite.db.SupportSQLiteDatabase) {
                db.execSQL("ALTER TABLE progress ADD COLUMN sourceToken TEXT NOT NULL DEFAULT ''")
                db.execSQL("UPDATE progress SET sourceToken = lower(hex(randomblob(16)))")
            }
        }

        fun name(scope: String) = "podcst-$scope.db"

        fun open(context: Context, scope: String): PodcstDatabase =
            Room.databaseBuilder(context, PodcstDatabase::class.java, name(scope)).addMigrations(IDENTITY_MIGRATION, PROGRESS_SOURCE_MIGRATION).build()

        fun delete(context: Context, scope: String) {
            val removed = context.deleteDatabase(name(scope))
            check(removed || !context.getDatabasePath(name(scope)).exists()) { "Retained account data could not be erased" }
        }
    }
}
