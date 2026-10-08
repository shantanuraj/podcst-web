package app.podcst.playback

import androidx.media3.common.ForwardingPlayer
import androidx.media3.test.utils.FakePlayer
import app.podcst.data.Preferences
import app.podcst.data.ProgressRepository
import app.podcst.data.Scopes
import app.podcst.data.WorkScheduler
import app.podcst.database.PlayerEntity
import app.podcst.database.PodcstDatabase
import app.podcst.database.entity
import app.podcst.network.testing.StateFixtures
import app.podcst.network.testing.Call
import app.podcst.network.testing.FakeServer
import app.podcst.network.testing.PlaybackFixtures.episode
import app.podcst.network.testing.PlaybackFixtures.progress
import app.podcst.network.testing.Reply
import app.podcst.playback.audio.AudioStages
import app.podcst.playback.audio.SourceTimeline
import kotlinx.serialization.json.Json
import app.podcst.model.StateBatch
import app.podcst.model.StateProgressChange
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.joinAll
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import kotlin.time.Duration.Companion.seconds

@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class PlaybackSyncTest {
    private val application = RuntimeEnvironment.getApplication()
    private val scopes = Scopes(application, "owner").also { it.resumeSync("owner") }
    private val phone = episode(1)
    private val web = episode(2)
    private val queued = episode(3)
    private var player: FakePlayer? = null

    @After
    fun close() {
        player?.release()
        val current = scopes.current.value
        scopes.close()
        PodcstDatabase.delete(application, current.key)
    }

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

    private suspend fun TestScope.fixture(route: (Call) -> Reply = {
        if (it.body.isNotEmpty()) Reply("""{"success":true}""") else progress(web, 1271.0)
    }): Fixture {
        val database = scopes.database
        database.episodes().upsert(listOf(phone.entity(), queued.entity()))
        database.player().save(listOf(phone.identity.value, queued.identity.value), PlayerEntity(current = phone.identity.value, positionMs = 3672000, active = true))
        val server = FakeServer(StateFixtures(presentation = route)::route)
        val repository = ProgressRepository(server.api, scopes, object : WorkScheduler {
            override fun syncProgress() = Unit
            override fun refreshFeeds() = Unit
        })
        val transport = FakePlayer(bufferingDelayMs = 0).also { player = it }
        val renderers = PodcstRenderersFactory(application, object : AudioStages {
            override fun effects(timeline: SourceTimeline): Nothing = error("No audio is decoded in this fixture")
            override fun limiter(): Nothing = error("No audio is decoded in this fixture")
        })
        val sessionPlayer = object : ForwardingPlayer(transport) {
            override fun clearMediaItems() = transport.setMediaItems(emptyList())
        }
        val coordinator = PlaybackCoordinator(scopes, repository, Preferences(application), renderers.sink, sessionPlayer, backgroundScope)
        val ongoing = backgroundScope.coroutineContext[Job]!!.children.toSet()
        return Fixture(coordinator, transport, repository, server, backgroundScope, ongoing)
    }

    private data class Fixture(
        val coordinator: PlaybackCoordinator,
        val player: FakePlayer,
        val progress: ProgressRepository,
        val server: FakeServer,
        val scope: CoroutineScope,
        val ongoing: Set<Job>,
    ) {
        suspend fun hydrated() {
            coordinator.state.first { it.episode != null }
        }

        suspend fun settle() {
            while (true) {
                val jobs = scope.coroutineContext[Job]!!.children.filter { it !in ongoing }.toList()
                if (jobs.isEmpty()) return
                jobs.joinAll()
            }
        }
    }
}
