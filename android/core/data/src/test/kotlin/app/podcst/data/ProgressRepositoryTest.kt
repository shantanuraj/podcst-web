package app.podcst.data

import app.podcst.database.*
import app.podcst.model.StateProgressEvent
import app.podcst.network.testing.*
import app.podcst.network.testing.PlaybackFixtures.episode
import app.podcst.network.testing.PlaybackFixtures.progress
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
    private val scopes = Scopes(application, "owner").also { it.resumeSync("owner") }
    private val scheduler = object : WorkScheduler { override fun syncProgress() = Unit; override fun refreshFeeds() = Unit }
    private val phone = episode(1)
    private val web = episode(2)
    @After fun close() { val current = scopes.current.value; scopes.close(); PodcstDatabase.delete(application, current.key) }
    private fun repository(server: FakeServer) = ProgressRepository(server.api, scopes, scheduler) { 1000 }
    private fun server() = FakeServer(StateFixtures { progress(web, 12.0) }::route)

    @Test fun explicitEventsNotThresholdsDetermineCompletionIncludingPlayedAtZero() = runTest {
        val repository = repository(server())
        val short = phone.copy(duration = 100.seconds)
        for (position in listOf(94, 95, 100)) {
            repository.record(short, position.seconds, false)
            assertFalse(scopes.database.progress().get(short.identity.value)!!.completed)
        }
        repository.event(short, 0.seconds, StateProgressEvent.played)
        assertTrue(scopes.database.progress().get(short.identity.value)!!.completed)
        repository.record(short, 0.seconds, false)
        assertTrue(scopes.database.progress().get(short.identity.value)!!.completed)
        repository.event(short, 12.seconds, StateProgressEvent.replay)
        assertFalse(scopes.database.progress().get(short.identity.value)!!.completed)
        repository.event(short, 100.seconds, StateProgressEvent.unplayed)
        assertEquals(0L, scopes.database.progress().get(short.identity.value)!!.positionMs)
    }

    @Test fun currentPlaybackReconcilesBackwardWithoutCreatingIntent() = runTest {
        val server = server()
        val repository = repository(server)
        scopes.database.progress().upsert(ProgressEntity(web.identity.value, 100000, 200000, true, 1))
        val latest = repository.restoreLatest()
        assertEquals(web.identity, latest?.episode?.identity)
        assertEquals(12.0, latest?.position)
        assertEquals(12000L, scopes.database.progress().get(web.identity.value)?.positionMs)
        assertFalse(scopes.database.progress().get(web.identity.value)!!.completed)
        assertTrue(server.calls.all { it.body.isEmpty() })
    }

    @Test fun ambiguousLegacyWritesRequireExplicitReapplyAndKeepTheirSource() = runTest {
        val server = server()
        val repository = repository(server)
        scopes.database.episodes().upsert(listOf(phone.entity()))
        scopes.database.outbox().enqueue(OutboxEntity(1, 9.0, true, 1))
        repository.sync()
        assertTrue(server.calls.all { it.body.isEmpty() })
        assertEquals(1, scopes.database.outbox().pending().size)
        assertNotNull(repository.status.value.error)
        repository.reapplyLegacy(phone)
        repository.sync()
        val body = server.calls.single { it.body.isNotEmpty() }.body
        assertTrue(body.contains("\"episodeId\":\"1\""))
        assertTrue(body.contains("\"completed\":true"))
        assertTrue(scopes.database.outbox().pending().isEmpty())
    }

    @Test fun logoutAndAccountRoundTripRetainFrozenProgressOutsideDisposableCaches() = runTest {
        val remote = StateFixtures { progress(web, 12.0) }
        var offline = true
        val server = FakeServer { if (it.body.isNotEmpty() && offline) throw IOException("offline") else remote.route(it) }
        var repository = repository(server)
        repository.record(phone, 9.seconds, false)
        assertEquals(SyncOutcome.Retry, repository.sync())
        val frozen = scopes.durable.account("owner").progressFlight
        scopes.switch("other"); scopes.resumeSync("other")
        assertFalse(scopes.durable.status.value.pending)
        scopes.switch("owner"); scopes.resumeSync("owner")
        repository = repository(server)
        offline = false
        assertEquals(SyncOutcome.Done, repository.sync())
        assertEquals(2, server.calls.count { it.body.isNotEmpty() })
        assertEquals(server.calls.filter { it.body.isNotEmpty() }.first().body, server.calls.filter { it.body.isNotEmpty() }.last().body)
        assertEquals(frozen?.batch?.clientId, scopes.durable.account("owner").progressClient)
    }

    @Test fun expiredAuthenticationPausesAndProtocolConflictsBlockWithoutResetting() = runTest {
        val remote = StateFixtures { progress(web, 12.0) }
        var code = 401
        val server = FakeServer { if (it.body.isNotEmpty()) Reply("""{"code":"unauthenticated","message":"expired"}""", code) else remote.route(it) }
        val repository = repository(server)
        repository.record(phone, 9.seconds, false)
        repository.sync()
        assertFalse(scopes.verified)
        val flight = scopes.durable.account("owner").progressFlight
        scopes.resumeSync("owner")
        code = 409
        repository.sync()
        assertNotNull(scopes.durable.account("owner").progressBlocked)
        assertEquals(flight, scopes.durable.account("owner").progressFlight)
        val count = server.calls.size
        repository.sync()
        assertEquals(count, server.calls.size)
    }

    @Test fun accountChangeFencesInflightReads() = runTest {
        val arrived = CompletableDeferred<Unit>(); val release = CompletableDeferred<Unit>()
        val server = FakeServer(StateFixtures {
            arrived.complete(Unit); runBlocking { release.await() }; progress(web, 12.0)
        }::route)
        val repository = repository(server)
        val reading = async { repository.restoreLatest() }
        arrived.await()
        scopes.switch("other"); scopes.resumeSync("other")
        release.complete(Unit)
        assertNull(reading.await())
        assertNull(scopes.database.progress().get(web.identity.value))
    }
}
