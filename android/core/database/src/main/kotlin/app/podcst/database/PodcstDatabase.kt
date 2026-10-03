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
    version = 1,
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
        fun name(scope: String) = "podcst-$scope.db"

        fun open(context: Context, scope: String): PodcstDatabase =
            Room.databaseBuilder(context, PodcstDatabase::class.java, name(scope)).build()

        fun delete(context: Context, scope: String) {
            context.deleteDatabase(name(scope))
        }
    }
}
