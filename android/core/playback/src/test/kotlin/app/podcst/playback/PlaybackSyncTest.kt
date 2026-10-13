package app.podcst.playback

import app.podcst.network.testing.Call
import app.podcst.network.testing.PlaybackFixtures.progress
import app.podcst.network.testing.Reply
import kotlinx.serialization.json.Json
import app.podcst.model.StateBatch
import app.podcst.model.StateProgressChange
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.async
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import kotlin.time.Duration.Companion.seconds

@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class PlaybackSyncTest {
    private val harness = PlaybackHarness()
    private val scopes = harness.scopes
    private val phone = harness.phone
    private val web = harness.web
    private val queued = harness.queued

    @After
    fun close() = harness.close()

    @Test
    fun coldLaunchWaitsForLocalHydrationThenReplacesCachedPlaybackWithoutWrites() = runTest {
        val fixture = fixture()
        fixture.coordinator.restoreProgress()
        fixture.settle()
        val current = fixture.coordinator.state.value
        assertEquals(web.identity, current.episode?.identity)
        assertEquals(1271.seconds, current.position)
        assertEquals(listOf(phone, queued, web).map { it.identity }, current.queue.episodes.map { it.identity })
        assertEquals(PlaybackStatus.Paused, current.status)
        assertFalse(current.requested)
        assertEquals(0, fixture.player.mediaItemCount)
        fixture.coordinator.checkpoint()
        fixture.coordinator.pause()
        fixture.coordinator.stop()
        fixture.settle()
        assertTrue(scopes.database.outbox().pending().isEmpty())
        assertTrue(fixture.server.calls.all { it.body.isEmpty() })
        assertEquals(web.identity.value, scopes.database.player().player()?.current)
        assertEquals(1271000L, scopes.database.player().player()?.positionMs)
    }

    @Test
    fun cachedPausedPlaybackIsNotUploadedWhenTheAppBackgrounds() = runTest {
        val fixture = fixture()
        fixture.hydrated()
        fixture.coordinator.checkpoint()
        fixture.coordinator.pause()
        fixture.coordinator.checkpoint()
        fixture.settle()
        assertTrue(scopes.database.outbox().pending().isEmpty())
        assertTrue(fixture.server.calls.isEmpty())
    }

    @Test
    fun foregroundRestoresAnotherDeviceWithoutSavingThePausedOutgoingEpisode() = runTest {
        val fixture = fixture()
        fixture.hydrated()
        fixture.coordinator.resume()
        fixture.player.setPosition(3672000)
        fixture.coordinator.pause()
        fixture.settle()
        fixture.coordinator.restoreProgress()
        fixture.settle()
        fixture.coordinator.checkpoint()
        fixture.settle()
        assertEquals(web.identity, fixture.coordinator.state.value.episode?.identity)
        assertFalse(fixture.coordinator.state.value.requested)
        assertTrue(fixture.server.calls.all { it.body.isEmpty() })
    }

    @Test
    fun changedPlaybackIsSavedOnceAndAcknowledgedCheckpointsStayReadOnly() = runTest {
        val fixture = fixture()
        fixture.hydrated()
        fixture.coordinator.resume()
        fixture.player.setPosition(3673000)
        fixture.coordinator.pause()
        fixture.settle()
        assertTrue(scopes.durable.status.value.pending)
        assertEquals(3673000L, scopes.database.progress().get(phone.identity.value)?.positionMs)
        fixture.progress.sync()
        fixture.coordinator.checkpoint()
        fixture.coordinator.pause()
        fixture.coordinator.checkpoint()
        fixture.settle()
        assertTrue(scopes.database.outbox().pending().isEmpty())
        assertEquals(1, fixture.server.calls.count { it.body.isNotEmpty() })
    }

    @Test
    fun unsavedReplayIsNotLostOrPromotedToPlayedByItsFollowingCheckpoint() = runTest {
        val fixture = fixture()
        fixture.hydrated()
        fixture.coordinator.play(phone, 0.seconds)
        fixture.player.setPosition(9000)
        fixture.coordinator.pause()
        fixture.settle()
        fixture.progress.sync()
        val changes = fixture.server.calls.filter { it.body.isNotEmpty() }.flatMap { Json.decodeFromString<StateBatch<StateProgressChange>>(it.body).changes }
        assertEquals(listOf(false, null), changes.map { it.completed })
        assertEquals(9, changes.last().positionSeconds)
        assertFalse(scopes.database.progress().get(phone.identity.value)!!.completed)
    }

    @Test
    fun remoteBackwardSeekReconcilesTheSameEpisodeWithoutDuplicatingTheQueue() = runTest {
        val fixture = fixture { progress(phone, 1200.0) }
        fixture.coordinator.restoreProgress()
        fixture.settle()
        assertEquals(1200.seconds, fixture.coordinator.state.value.position)
        assertEquals(listOf(phone, queued).map { it.identity }, fixture.coordinator.state.value.queue.episodes.map { it.identity })
        assertTrue(scopes.database.outbox().pending().isEmpty())
    }

    @Test
    fun unchangedProgressDoesNotReopenAStoppedSession() = runTest {
        val fixture = fixture { progress(phone, 3672.0) }
        fixture.hydrated()
        fixture.coordinator.stop()
        fixture.coordinator.restoreProgress()
        fixture.settle()
        assertEquals(PlaybackStatus.Idle, fixture.coordinator.state.value.status)
        assertFalse(fixture.coordinator.state.value.active)
        assertEquals(3672.seconds, fixture.coordinator.state.value.position)
    }

    @Test
    fun serverLookupDoesNotInterruptActivePlayback() = runTest {
        val fixture = fixture()
        fixture.hydrated()
        fixture.coordinator.resume()
        fixture.coordinator.restoreProgress()
        assertEquals(phone.identity, fixture.coordinator.state.value.episode?.identity)
        assertTrue(fixture.coordinator.state.value.requested)
        fixture.coordinator.pause()
        fixture.settle()
    }

    @Test
    fun playThenPauseWhileLoadingProgressFencesTheLateResponse() = rejectsLateRestore {
        it.resume()
        it.pause()
    }

    @Test
    fun seekWhileLoadingProgressFencesTheLateResponse() = rejectsLateRestore { it.seek(120.seconds) }

    @Test
    fun stoppingWhileLoadingProgressFencesTheLateResponse() = rejectsLateRestore { it.stop() }

    @Test
    fun clearingWhileLoadingProgressFencesTheLateResponse() = rejectsLateRestore { it.clear() }

    @Test
    fun completionWhileLoadingProgressFencesTheLateResponse() = rejectsLateRestore { it.markPlayed() }

    @Test
    fun accountSwitchWhileLoadingProgressFencesTheLateResponse() = rejectsLateRestore {
        it.beginAccountChange()
        scopes.switch("other")
        it.switchAccount()
    }

    @Test
    fun cancellationWhenTheActivityStopsLeavesCachedPlaybackIntact() = runTest {
        val started = CompletableDeferred<Unit>()
        val release = CompletableDeferred<Unit>()
        val fixture = fixture {
            started.complete(Unit)
            runBlocking { release.await() }
            progress(web, 1271.0)
        }
        val request = async { fixture.coordinator.restoreProgress() }
        try {
            started.await()
            request.cancelAndJoin()
        } finally {
            release.complete(Unit)
        }
        assertEquals(phone.identity, fixture.coordinator.state.value.episode?.identity)
    }

    @Test
    fun localActionsBeforeDiskHydrationCannotBeReplacedByCachedPlayback() = runTest {
        val fixture = fixture()
        fixture.coordinator.play(web, 123.seconds)
        fixture.coordinator.restoreProgress()
        assertEquals(web.identity, fixture.coordinator.state.value.episode?.identity)
        fixture.coordinator.pause()
        fixture.settle()
        assertEquals(web.identity, fixture.coordinator.state.value.episode?.identity)
        assertEquals(123.seconds, fixture.coordinator.state.value.position)
    }

    @Test
    fun queuedWritesCannotEnterANewAccount() = runTest {
        val fixture = fixture()
        fixture.hydrated()
        fixture.coordinator.seek(120.seconds)
        fixture.coordinator.beginAccountChange()
        scopes.switch("other")
        fixture.coordinator.switchAccount()
        fixture.settle()
        assertTrue(fixture.coordinator.state.value.queue.episodes.isEmpty())
        assertTrue(scopes.database.outbox().pending().isEmpty())
        assertNull(scopes.database.progress().get(phone.identity.value))
    }

    @Test
    fun usingSyncedVersionUpdatesPausedPlayerWithoutReuploadingItsOldPosition() = runTest {
        val fixture = fixture()
        fixture.hydrated()
        fixture.progress.sync()
        fixture.coordinator.seek(30.seconds)
        fixture.settle()
        val server = recoveryServer()
        val repository = app.podcst.data.ProgressRepository(server.api, scopes, object : app.podcst.data.WorkScheduler {
            override fun syncProgress() = Unit
            override fun refreshFeeds() = Unit
        })
        repository.sync()
        assertTrue(scopes.durable.status.value.blocked)
        val recovery = app.podcst.data.StateRecovery(server.api, scopes)
        val choice = checkNotNull(fixture.coordinator.prepareSyncedVersion(recovery))
        fixture.coordinator.useSyncedVersion(recovery, choice)
        fixture.settle()
        assertEquals(phone.identity, fixture.coordinator.state.value.episode?.identity)
        assertEquals(66.seconds, fixture.coordinator.state.value.position)
        fixture.coordinator.checkpoint()
        fixture.coordinator.pause()
        fixture.settle()
        assertFalse(scopes.durable.status.value.pending)
        assertEquals(66000L, scopes.database.player().player()?.positionMs)
        assertTrue(server.calls.all { it.body.isEmpty() })
    }

    @Test
    fun seekingAfterReviewingSyncedVersionPreventsReplacingNewPlaybackIntent() = runTest {
        val fixture = fixture()
        fixture.hydrated()
        fixture.progress.sync()
        fixture.coordinator.seek(30.seconds)
        fixture.settle()
        val server = recoveryServer()
        app.podcst.data.ProgressRepository(server.api, scopes, object : app.podcst.data.WorkScheduler {
            override fun syncProgress() = Unit
            override fun refreshFeeds() = Unit
        }).sync()
        val recovery = app.podcst.data.StateRecovery(server.api, scopes)
        val choice = checkNotNull(fixture.coordinator.prepareSyncedVersion(recovery))
        fixture.coordinator.seek(90.seconds)
        fixture.settle()
        assertTrue(runCatching { fixture.coordinator.useSyncedVersion(recovery, choice) }.isFailure)
        assertEquals(90.seconds, fixture.coordinator.state.value.position)
        assertTrue(scopes.durable.status.value.pending)
    }

    @Test
    fun resumingDuringSyncedVersionFetchPreservesCurrentPlaybackAndPendingWork() = runTest {
        val fixture = fixture()
        fixture.hydrated()
        fixture.progress.sync()
        fixture.coordinator.seek(30.seconds)
        fixture.settle()
        val initial = recoveryServer()
        app.podcst.data.ProgressRepository(initial.api, scopes, object : app.podcst.data.WorkScheduler {
            override fun syncProgress() = Unit
            override fun refreshFeeds() = Unit
        }).sync()
        val initialRecovery = app.podcst.data.StateRecovery(initial.api, scopes)
        val choice = checkNotNull(fixture.coordinator.prepareSyncedVersion(initialRecovery))
        val started = CompletableDeferred<Unit>()
        val release = CompletableDeferred<Unit>()
        val server = recoveryServer {
            started.complete(Unit)
            runBlocking { release.await() }
        }
        val request = async { runCatching { fixture.coordinator.useSyncedVersion(app.podcst.data.StateRecovery(server.api, scopes), choice) } }
        started.await()
        fixture.coordinator.resume()
        release.complete(Unit)
        assertTrue(request.await().isFailure)
        assertTrue(fixture.coordinator.state.value.requested)
        assertEquals(30.seconds, fixture.coordinator.state.value.position)
        assertTrue(scopes.durable.status.value.pending)
        fixture.coordinator.pause()
        fixture.settle()
    }

    private fun recoveryServer(beforeReply: () -> Unit = {}) = app.podcst.network.testing.FakeServer { call ->
        beforeReply()
        val generation = "17adbd84-d0e4-4e2d-ad9f-b084efee3212"
        if (call.path == "/api/progress") Reply("""{"protocol":1,"accountId":"owner","generation":"$generation","revision":"1","items":[{"episodeId":"1","progress":{"positionSeconds":66,"completed":false,"revision":"1","updatedAtMs":null}}]}""")
        else Reply("""{"protocol":1,"accountId":"owner","generation":"$generation","revision":"1","items":[]}""")
    }

    private fun rejectsLateRestore(action: suspend (PlaybackCoordinator) -> Unit) = runTest {
        val started = CompletableDeferred<Unit>()
        val release = CompletableDeferred<Unit>()
        val fixture = fixture {
            started.complete(Unit)
            runBlocking { release.await() }
            progress(web, 1271.0)
        }
        val request = async { fixture.coordinator.restoreProgress() }
        try {
            started.await()
            action(fixture.coordinator)
        } finally {
            release.complete(Unit)
        }
        request.await()
        fixture.coordinator.pause()
        fixture.settle()
        assertNotEquals(web.identity, fixture.coordinator.state.value.episode?.identity)
        assertNotEquals(1271.seconds, fixture.coordinator.state.value.position)
    }

    private suspend fun TestScope.fixture() = harness.fixture(this)

    private suspend fun TestScope.fixture(route: (Call) -> Reply) = harness.fixture(this, route)
}
