package app.podcst.data

import app.podcst.database.PodcstDatabase
import app.podcst.database.ProgressEntity
import app.podcst.network.testing.FakeServer
import app.podcst.network.testing.PlaybackFixtures.episode
import app.podcst.network.testing.PlaybackFixtures.progress
import app.podcst.network.testing.Reply
import java.io.IOException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.async
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import kotlin.time.Duration.Companion.seconds

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class ProgressRepositoryTest {
    private val application = RuntimeEnvironment.getApplication()
    private val scopes = Scopes(application, "owner")
    private val scheduler = object : WorkScheduler {
        override fun syncProgress() = Unit
        override fun refreshFeeds() = Unit
    }
    private val phone = episode(1)
    private val web = episode(2)

    @After
    fun close() {
        val current = scopes.current.value
        current.database.close()
        PodcstDatabase.delete(application, current.key)
    }

    private fun repository(server: FakeServer) = ProgressRepository(server.api, scopes, scheduler) { 1000 }

    @Test
    fun remotePlaybackReconcilesBackwardSeeksAndPreviouslyCompletedLocalProgress() = runTest {
        val server = FakeServer { progress(web, 1200.0) }
        val repository = repository(server)
        for (completed in listOf(false, true)) {
            scopes.database.progress().upsert(ProgressEntity(web.identity.value, 3672000, 4000000, completed, 1))
            val latest = repository.restoreLatest()
            assertEquals(web.identity, latest?.episode?.identity)
            assertEquals(1200.0, latest?.position)
            val saved = scopes.database.progress().get(web.identity.value)!!
            assertEquals(1200000L, saved.positionMs)
            assertFalse(saved.completed)
            assertTrue(scopes.database.outbox().pending().isEmpty())
        }
        assertTrue(server.calls.all { it.body.isEmpty() })
    }

    @Test
    fun foregroundLookupFetchesNewerEpisodeInsteadOfReturningCachedProgress() = runTest {
        var latest = progress(phone, 3672.0)
        val repository = repository(FakeServer { latest })
        assertEquals(phone.identity, repository.restoreLatest()?.episode?.identity)
        latest = progress(web, 1271.0)
        assertEquals(web.identity, repository.restoreLatest()?.episode?.identity)
        assertEquals(1271000L, scopes.database.progress().get(web.identity.value)?.positionMs)
    }

    @Test
    fun pendingProgressIsUploadedBeforeRestoringServerPlayback() = runTest {
        val server = FakeServer { if (it.body.isNotEmpty()) Reply("""{"success":true}""") else progress(web, 1271.0) }
        val repository = repository(server)
        repository.record(phone, 123.seconds, false)
        assertEquals(web.identity, repository.restoreLatest()?.episode?.identity)
        assertEquals(listOf(true, false), server.calls.map { it.body.isNotEmpty() })
        assertTrue(scopes.database.outbox().pending().isEmpty())
    }

    @Test
    fun failedOrUnauthorizedUploadsKeepLocalProgressAndSkipRestoration() = runTest {
        for (failure in listOf(503, 401, 403, 429)) {
            val server = FakeServer {
                assertTrue(it.body.isNotEmpty())
                Reply("""{"message":"Unavailable"}""", failure)
            }
            val repository = repository(server)
            repository.record(phone, 123.seconds, false)
            assertNull(repository.restoreLatest())
            assertEquals(123000L, scopes.database.progress().get(phone.identity.value)?.positionMs)
            assertEquals(1, scopes.database.outbox().pending().size)
        }
    }

    @Test
    fun offlineProgressSurvivesARepositoryRestart() = runTest {
        val offline = repository(FakeServer { throw IOException("offline") })
        offline.record(phone, 123.seconds, false)
        assertNull(offline.restoreLatest())
        val server = FakeServer { if (it.body.isNotEmpty()) Reply("""{"success":true}""") else progress(phone, 123.0) }
        val restarted = repository(server)
        assertEquals(123.0, restarted.restoreLatest()?.position)
        assertEquals(listOf(true, false), server.calls.map { it.body.isNotEmpty() })
    }

    @Test
    fun newLocalWorkDuringLookupCannotBeOverwrittenByTheResponse() = runTest {
        val started = CompletableDeferred<Unit>()
        val release = CompletableDeferred<Unit>()
        val repository = repository(FakeServer {
            started.complete(Unit)
            runBlocking { release.await() }
            progress(phone, 10.0)
        })
        val lookup = async { repository.restoreLatest() }
        try {
            started.await()
            repository.record(phone, 120.seconds, false)
        } finally {
            release.complete(Unit)
        }
        assertNull(lookup.await())
        assertEquals(120000L, scopes.database.progress().get(phone.identity.value)?.positionMs)
        assertEquals(1, scopes.database.outbox().pending().size)
    }

    @Test
    fun delayedResponsesAndQueuedRecordsStayWithTheirOriginalAccount() = runTest {
        val owner = scopes.current.value
        val started = CompletableDeferred<Unit>()
        val release = CompletableDeferred<Unit>()
        val repository = repository(FakeServer {
            started.complete(Unit)
            runBlocking { release.await() }
            progress(phone, 10.0)
        })
        val lookup = async { repository.restoreLatest() }
        try {
            started.await()
            scopes.switch("other")
            repository.record(phone, 120.seconds, false, owner)
        } finally {
            release.complete(Unit)
        }
        assertNull(lookup.await())
        assertNull(scopes.database.progress().get(phone.identity.value))
        assertTrue(scopes.database.outbox().pending().isEmpty())
    }

    @Test
    fun concurrentSyncsDoNotReplayAnAcknowledgedPausedPosition() = runTest {
        val started = CompletableDeferred<Unit>()
        val release = CompletableDeferred<Unit>()
        val server = FakeServer {
            started.complete(Unit)
            runBlocking { release.await() }
            Reply("""{"success":true}""")
        }
        val repository = repository(server)
        repository.record(phone, 120.seconds, false)
        val first = async { repository.sync() }
        val second = async { repository.sync() }
        try {
            started.await()
        } finally {
            release.complete(Unit)
        }
        assertEquals(SyncOutcome.Done, first.await())
        assertEquals(SyncOutcome.Done, second.await())
        assertEquals(1, server.calls.size)
    }

    @Test
    fun acknowledgementDoesNotDeleteANewerWriteQueuedInTheSameMillisecond() = runTest {
        val started = CompletableDeferred<Unit>()
        val release = CompletableDeferred<Unit>()
        val repository = repository(FakeServer {
            started.complete(Unit)
            runBlocking { release.await() }
            Reply("""{"success":true}""")
        })
        repository.record(phone, 120.seconds, false)
        val sync = async { repository.sync() }
        try {
            started.await()
            repository.record(phone, 90.seconds, false)
        } finally {
            release.complete(Unit)
        }
        sync.await()
        assertEquals(90.0, scopes.database.outbox().pending().single().position, 0.0)
    }
}
