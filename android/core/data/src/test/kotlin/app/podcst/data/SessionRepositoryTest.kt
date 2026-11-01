package app.podcst.data

import app.podcst.database.PodcstDatabase
import app.podcst.network.testing.FakeServer
import app.podcst.network.testing.Reply
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.async
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.runTest
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class SessionRepositoryTest {
    @Test fun delayedRestorationResumesReadersBeforeAnnouncingCompletion() = runTest {
        val context = RuntimeEnvironment.getApplication()
        val scopes = Scopes(context, null)
        val arrived = CompletableDeferred<Unit>()
        val release = CompletableDeferred<Unit>()
        val server = FakeServer { call ->
            check(call.path == "/api/auth/session")
            arrived.complete(Unit)
            runBlocking { release.await() }
            Reply("""{"user":null}""")
        }
        val session = SessionRepository(context, server.api).apply {
            suspendAccountSync = scopes::suspendSync
            resumeAccountWork = scopes::resumeSync
        }
        val completed = mutableListOf<Boolean>()
        val observation = backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) {
            session.session.collect { if (!it.loading) completed += scopes.verified }
        }
        try {
            val restoring = async { session.restore() }
            arrived.await()
            assertTrue(session.session.value.loading)
            assertTrue(completed.isEmpty())
            release.complete(Unit)
            restoring.await()
            assertEquals(listOf(true), completed)
        } finally {
            release.complete(Unit)
            observation.cancel()
            scopes.close()
            PodcstDatabase.delete(context, Scope.key(null))
        }
    }

    @Test fun repeatedGuestVerificationDoesNotRetirePlayback() = verifiesWithoutRetiring("""{"user":null}""")

    @Test fun repeatedAccountVerificationDoesNotRetirePlayback() = verifiesWithoutRetiring(FakeServer.USER)

    @Test fun failedVerificationPreservesPlaybackAndSuspendsSync() = runTest {
        val context = RuntimeEnvironment.getApplication()
        var reply = Reply(FakeServer.USER)
        val session = SessionRepository(context, FakeServer { reply }.api)
        session.restore()
        var syncing = true
        session.suspendAccountSync = { syncing = false }
        session.suspendAccountWork = { fail("Revalidation must not retire playback") }
        session.accountChange = AccountChange { fail("An unavailable server cannot change the account") }
        session.resumeAccountWork = { syncing = true }
        reply = Reply("{}", 503)
        session.restore()
        assertEquals("u1", session.user?.id)
        assertNull(session.verifiedAccount)
        assertNotNull(session.session.value.error)
        assertFalse(syncing)
        assertFalse(session.session.value.loading)
    }

    @Test fun cancelledVerificationPreservesPlaybackAndSuspendsSync() = runTest {
        val arrived = CompletableDeferred<Unit>()
        val release = CompletableDeferred<Unit>()
        var delayed = false
        val session = SessionRepository(RuntimeEnvironment.getApplication(), FakeServer {
            if (delayed) { arrived.complete(Unit); runBlocking { release.await() } }
            Reply(FakeServer.USER)
        }.api)
        session.restore()
        var syncing = true
        session.suspendAccountSync = { syncing = false }
        session.suspendAccountWork = { fail("Cancelled revalidation must not retire playback") }
        session.resumeAccountWork = { syncing = true }
        delayed = true
        val restoring = async { session.restore() }
        try {
            arrived.await()
            restoring.cancelAndJoin()
            assertEquals("u1", session.user?.id)
            assertNull(session.verifiedAccount)
            assertFalse(syncing)
            assertFalse(session.session.value.loading)
        } finally { release.complete(Unit) }
    }

    @Test fun changedIdentityIsPreparedBeforeItIsPublished() = runTest {
        for (reply in listOf(Reply(FakeServer.USER.replace("u1", "u2")), Reply("""{"user":null}"""), Reply("{}", 401), Reply("{}", 403))) {
            var next = Reply(FakeServer.USER)
            val session = SessionRepository(RuntimeEnvironment.getApplication(), FakeServer { next }.api)
            session.restore()
            val prepared = mutableListOf<String?>()
            session.accountChange = AccountChange { account ->
                assertEquals("u1", session.user?.id)
                prepared += account
            }
            next = reply
            session.restore()
            assertEquals(listOf(session.user?.id), prepared)
        }
    }

    @Test fun deletionBlockedAccountRetiresPlaybackBeforeVerification() = runTest {
        var suspended = false
        var blocked = false
        val session = SessionRepository(RuntimeEnvironment.getApplication(), FakeServer {
            if (blocked) assertTrue(suspended)
            Reply(FakeServer.USER)
        }.api)
        session.restore()
        session.deletionBlocked = { blocked }
        session.suspendAccountWork = { suspended = true }
        session.resumeAccountWork = { fail("Deletion must keep account work suspended") }
        blocked = true
        session.restore()
        assertTrue(suspended)
    }

    private fun verifiesWithoutRetiring(body: String) = runTest {
        val arrived = CompletableDeferred<Unit>()
        val release = CompletableDeferred<Unit>()
        var delayed = false
        val session = SessionRepository(RuntimeEnvironment.getApplication(), FakeServer {
            if (delayed) { arrived.complete(Unit); runBlocking { release.await() } }
            Reply(body)
        }.api)
        session.restore()
        var syncing = true
        session.suspendAccountSync = { syncing = false }
        session.suspendAccountWork = { fail("Revalidation must not retire playback") }
        session.accountChange = AccountChange { fail("The same account must not be prepared again") }
        session.resumeAccountWork = { syncing = true }
        delayed = true
        val restoring = async { session.restore() }
        try {
            arrived.await()
            assertFalse(syncing)
            assertTrue(session.session.value.loading)
            release.complete(Unit)
            restoring.await()
            assertTrue(syncing)
            assertNull(session.session.value.error)
            assertFalse(session.session.value.loading)
        } finally { release.complete(Unit) }
    }
}
