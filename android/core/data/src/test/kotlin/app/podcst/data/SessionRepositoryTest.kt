package app.podcst.data

import app.podcst.database.PodcstDatabase
import app.podcst.network.testing.FakeServer
import app.podcst.network.testing.Reply
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.async
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
            suspendAccountWork = scopes::suspendSync
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
}
