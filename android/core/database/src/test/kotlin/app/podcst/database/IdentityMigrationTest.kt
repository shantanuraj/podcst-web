package app.podcst.database

import android.database.sqlite.SQLiteDatabase
import app.podcst.model.Episode
import app.podcst.model.EpisodeFile
import java.io.File
import java.util.UUID
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.*
import org.junit.After
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class IdentityMigrationTest {
    private val context = RuntimeEnvironment.getApplication()
    private val key = UUID.randomUUID().toString()
    private var opened: PodcstDatabase? = null
    @After fun close() { opened?.close(); PodcstDatabase.delete(context, key) }

    private fun oldDatabase(version: Int = 1): SQLiteDatabase {
        val path = context.getDatabasePath(PodcstDatabase.name(key)).also { it.parentFile!!.mkdirs() }
        val db = SQLiteDatabase.openOrCreateDatabase(path, null)
        val schema = Json.parseToJsonElement(File(checkNotNull(System.getProperty("podcst.schemas")), "app.podcst.database.PodcstDatabase/$version.json").readText()).jsonObject.getValue("database").jsonObject
        schema.getValue("entities").jsonArray.forEach { value ->
            val entity = value.jsonObject
            db.execSQL(entity.getValue("createSql").jsonPrimitive.content.replace("\${TABLE_NAME}", entity.getValue("tableName").jsonPrimitive.content))
            entity["indices"]?.jsonArray?.forEach { index -> db.execSQL(index.jsonObject.getValue("createSql").jsonPrimitive.content.replace("\${TABLE_NAME}", entity.getValue("tableName").jsonPrimitive.content)) }
        }
        schema.getValue("setupQueries").jsonArray.forEach { db.execSQL(it.jsonPrimitive.content) }
        db.version = version
        return db
    }
    private fun insert(db: SQLiteDatabase, feed: String, guid: String, id: Long) {
        db.execSQL("INSERT INTO episodes(identity,id,podcastId,guid,feed,podcastTitle,title,summary,published,cover,explicit,durationMs,link,episodeArt,showNotes,author,fileUrl,fileLength,fileType,isPrivate) VALUES(?,?,?,?,?,NULL,'Episode',NULL,1,'',0,100000,NULL,NULL,'',NULL,'https://test/audio',0,'audio/mpeg',0)", arrayOf<Any>("$feed\u001F$guid", id, 1L, guid, feed))
    }
    @Test fun roomMigrationRekeysReferencesAndPreservesUnsafeSourceAndMediaBytesAcrossRestart() = runTest {
        val oldSafe = "https://one.test/rss\u001Fsame"
        val oldUnsafe = "https://two.test/rss\u001Fsame"
        oldDatabase().use { db ->
            insert(db, "https://one.test/rss", "same", 42)
            insert(db, "https://two.test/rss", "same", 9007199254740993)
            db.execSQL("INSERT INTO queue VALUES(0, ?), (1, ?)", arrayOf(oldSafe, oldUnsafe))
            db.execSQL("INSERT INTO player VALUES(0, ?, 12000, 1)", arrayOf(oldSafe))
            db.execSQL("INSERT INTO progress VALUES(?, 12000, 100000, 0, 1)", arrayOf(oldSafe))
            db.execSQL("INSERT INTO progress_outbox VALUES(42,12,0,1)")
        }
        var db = PodcstDatabase.open(context, key).also { opened = it }
        assertEquals(listOf("episode:42", "local:$oldUnsafe"), db.player().queue())
        assertEquals("episode:42", db.player().player()?.current)
        assertEquals(12000L, db.progress().get("episode:42")?.positionMs)
        assertEquals("episode:9007199254740993", db.episodes().get("local:$oldUnsafe")?.domain()?.mediaIdentity)
        assertNull(db.episodes().get("local:$oldUnsafe")?.id)
        assertEquals(1, db.outbox().pending().size)
        db.openHelper.readableDatabase.query("SELECT id FROM legacy_episode_source WHERE feed = 'https://two.test/rss'").use { cursor -> assertTrue(cursor.moveToFirst()); assertEquals(9007199254740993L, cursor.getLong(0)) }
        db.close()
        db = PodcstDatabase.open(context, key).also { opened = it }
        assertEquals(2, db.episodes().queue().size)
        assertEquals(3, db.openHelper.readableDatabase.version)
    }

    @Test fun exactSourceResolutionMovesQueueProgressAndPreservesFallbackMediaWithoutCrossGuidGuess() = runTest {
        val db = PodcstDatabase.open(context, key).also { opened = it }
        val local = Episode(guid = "same", feed = "https://one.test/rss", title = "one", file = EpisodeFile("https://one.test/audio"), mediaIdentity = "https://one.test/rss\u001Fsame")
        val other = local.copy(feed = "https://two.test/rss", title = "two", mediaIdentity = "other")
        db.episodes().upsert(listOf(local.entity(), other.entity()))
        db.player().save(listOf(local.identity.value, other.identity.value), PlayerEntity(current = local.identity.value, positionMs = 12000, active = false))
        db.progress().upsert(ProgressEntity(local.identity.value, 12000, null, false, 1))
        val exact = local.copy(id = 9007199254740993, mediaIdentity = null, file = EpisodeFile("https://moved.test/audio"))
        db.episodes().upsert(listOf(exact.entity()))
        assertEquals(listOf(exact.identity.value, other.identity.value), db.player().queue())
        assertEquals(local.mediaIdentity, db.episodes().get(exact.identity.value)?.domain()?.mediaIdentity)
        assertEquals(12000L, db.progress().get(exact.identity.value)?.positionMs)
        assertNull(db.episodes().get(other.identity.value)?.id)
        db.episodes().upsert(listOf(exact.copy(feed = "https://moved.test/rss").entity()))
        assertEquals(2, db.episodes().queue().size)
        assertEquals(local.mediaIdentity, db.episodes().get(exact.identity.value)?.mediaIdentity)
    }

    @Test fun referenceWriteFailureRollsBackSourceResolution() = runTest {
        val db = PodcstDatabase.open(context, key).also { opened = it }
        val local = Episode(guid = "same", feed = "https://one.test", title = "Episode", file = EpisodeFile("https://one.test/audio"))
        db.episodes().upsert(listOf(local.entity()))
        db.player().save(listOf(local.identity.value), PlayerEntity(current = local.identity.value, positionMs = 9000, active = false))
        db.openHelper.writableDatabase.execSQL("CREATE TRIGGER deny_reference BEFORE UPDATE ON queue BEGIN SELECT RAISE(ABORT, 'synthetic reference write failure'); END")
        assertTrue(runCatching { db.episodes().upsert(listOf(local.copy(id = 42).entity())) }.isFailure)
        assertEquals(listOf(local.identity.value), db.player().queue())
        assertNotNull(db.episodes().get(local.identity.value))
        assertNull(db.episodes().get("episode:42"))
        db.openHelper.writableDatabase.execSQL("DROP TRIGGER deny_reference")
        db.episodes().upsert(listOf(local.copy(id = 42).entity()))
        assertEquals(listOf("episode:42"), db.player().queue())
    }

    @Test fun failedRoomActivationRollsBackAndCanRestartConversion() = runTest {
        oldDatabase().use { insert(it, "https://a.test", "one", 42) }
        val failed = androidx.room.Room.databaseBuilder(context, PodcstDatabase::class.java, PodcstDatabase.name(key))
            .addMigrations(object : androidx.room.migration.Migration(1, 2) {
                override fun migrate(db: androidx.sqlite.db.SupportSQLiteDatabase) {
                    PodcstDatabase.IDENTITY_MIGRATION.migrate(db)
                    throw java.io.IOException("synthetic activation failure")
                }
            }, PodcstDatabase.PROGRESS_SOURCE_MIGRATION).build()
        assertTrue(runCatching { failed.episodes().catalog("https://a.test") }.isFailure)
        failed.close()
        SQLiteDatabase.openDatabase(context.getDatabasePath(PodcstDatabase.name(key)).path, null, SQLiteDatabase.OPEN_READONLY).use { db ->
            assertEquals(1, db.version)
            db.rawQuery("SELECT identity FROM episodes", null).use { row -> assertTrue(row.moveToFirst()); assertEquals("https://a.test\u001Fone", row.getString(0)) }
        }
        val restarted = PodcstDatabase.open(context, key).also { opened = it }
        assertEquals("episode:42", restarted.episodes().catalog("https://a.test").single().identity)
    }

    @Test fun guestSourceTokenMigrationRollsBackAndRestartsWithoutChangingProgress() = runTest {
        oldDatabase(2).use { db ->
            db.execSQL("INSERT INTO progress VALUES('episode:42', 95000, 100000, 0, 1000)")
        }
        val failed = androidx.room.Room.databaseBuilder(context, PodcstDatabase::class.java, PodcstDatabase.name(key))
            .addMigrations(object : androidx.room.migration.Migration(2, 3) {
                override fun migrate(db: androidx.sqlite.db.SupportSQLiteDatabase) {
                    PodcstDatabase.PROGRESS_SOURCE_MIGRATION.migrate(db)
                    throw java.io.IOException("source token activation denied")
                }
            }).build()
        assertTrue(runCatching { failed.progress().get("episode:42") }.isFailure)
        failed.close()
        SQLiteDatabase.openDatabase(context.getDatabasePath(PodcstDatabase.name(key)).path, null, SQLiteDatabase.OPEN_READONLY).use { db ->
            assertEquals(2, db.version)
            db.rawQuery("SELECT * FROM progress", null).use { row ->
                assertTrue(row.moveToFirst())
                assertEquals(-1, row.getColumnIndex("sourceToken"))
                assertEquals(95000L, row.getLong(row.getColumnIndexOrThrow("positionMs")))
            }
        }
        val migrated = PodcstDatabase.open(context, key).also { opened = it }
        val source = migrated.progress().get("episode:42")!!
        assertEquals(95000L, source.positionMs)
        assertFalse(source.completed)
        assertTrue(source.sourceToken.isNotBlank())
        migrated.close()
        val restarted = PodcstDatabase.open(context, key).also { opened = it }
        assertEquals(source, restarted.progress().get("episode:42"))
        val newer = ProgressEntity(source.identity, source.positionMs, source.durationMs, source.completed, source.updatedAt)
        restarted.progress().upsert(newer)
        assertNotEquals(source.sourceToken, restarted.progress().get("episode:42")!!.sourceToken)
    }

    @Test fun conflictingLegacyIdsRemainExplicitlyLocalInsteadOfCollapsingQueue() = runTest {
        oldDatabase().use { db ->
            insert(db, "https://a.test", "one", 42); insert(db, "https://b.test", "two", 42)
            db.execSQL("INSERT INTO queue VALUES(0, 'https://a.test' || char(31) || 'one'), (1, 'https://b.test' || char(31) || 'two')")
        }
        val db = PodcstDatabase.open(context, key).also { opened = it }
        assertEquals(2, db.episodes().queue().size)
        assertTrue(db.episodes().queue().all { it.id == null && it.identity.startsWith("local:") })
    }
}
