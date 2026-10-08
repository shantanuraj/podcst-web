package app.podcst.playback

import app.podcst.model.Moment
import kotlin.time.Duration.Companion.seconds
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class ClipModeTest {
    private val harness = PlaybackHarness()
    private val scopes = harness.scopes
    private val phone = harness.phone
    private val web = harness.web
    private val queued = harness.queued
    private val clip = Moment.Clip(60.seconds, 120.seconds)

    @After
    fun close() = harness.close()

    @Test
    fun arrivalInsertsTheLinkedEpisodeBeforeTheCurrentOne() = runTest {
        val fixture = arrived()
        val state = fixture.coordinator.state.value
        assertEquals(listOf(web, phone, queued).map { it.identity }, state.queue.episodes.map { it.identity })
        assertEquals(web.identity, state.episode?.identity)
        assertEquals(listOf(phone, queued).map { it.identity }, state.queue.upNext.map { it.identity })
        assertEquals(60.seconds, state.position)
        assertTrue(state.requested)
        assertFalse(state.clip!!.queued)
        assertEquals(Resume(phone.identity, 3672.seconds), state.clip!!.previous)
        fixture.coordinator.pause()
        fixture.settle()
    }

    @Test
    fun clipPausesOnceAtItsEndWithoutProgressOrCompletion() = runTest {
        val fixture = arrived()
        fixture.player.setPosition(90_000)
        tick()
        assertTrue(fixture.coordinator.state.value.requested)
        fixture.player.setPosition(121_000)
        tick()
        val state = fixture.coordinator.state.value
        assertTrue(state.clip!!.ended)
        assertFalse(state.requested)
        assertEquals(PlaybackStatus.Paused, state.status)
        assertEquals(120.seconds, state.position)
        assertEquals(web.identity, state.episode?.identity)
        fixture.coordinator.checkpoint()
        fixture.settle()
        assertNoProgress(fixture)
        assertEquals(phone.identity.value, scopes.database.player().player()?.current)
    }

    @Test
    fun seeksStayInsideTheClip() = runTest {
        val fixture = arrived()
        fixture.coordinator.seek(10.seconds)
        assertEquals(60.seconds, fixture.coordinator.state.value.position)
        fixture.coordinator.seek(500.seconds)
        assertEquals(120.seconds, fixture.coordinator.state.value.position)
        fixture.coordinator.pause()
        fixture.settle()
        assertNoProgress(fixture)
    }

    @Test
    fun keepListeningLeavesClipModeAndSavesProgressAgain() = runTest {
        val fixture = arrived()
        fixture.player.setPosition(121_000)
        tick()
        fixture.player.setPosition(120_000)
        fixture.coordinator.keepClip(play = true)
        assertNull(fixture.coordinator.state.value.clip)
        assertTrue(fixture.coordinator.state.value.requested)
        fixture.coordinator.pause()
        fixture.settle()
        val saved = scopes.database.progress().get(web.identity.value)!!
        assertEquals(120_000L, saved.positionMs)
        assertFalse(saved.completed)
        assertEquals(web.identity.value, scopes.database.player().player()?.current)
    }

    @Test
    fun resumingAnEndedClipKeepsListening() = runTest {
        val fixture = arrived()
        fixture.player.setPosition(121_000)
        tick()
        fixture.player.setPosition(120_000)
        fixture.coordinator.resume()
        assertNull(fixture.coordinator.state.value.clip)
        assertTrue(fixture.coordinator.state.value.requested)
        assertEquals(web.identity, fixture.coordinator.state.value.episode?.identity)
        fixture.coordinator.pause()
        fixture.settle()
        assertEquals(120_000L, scopes.database.progress().get(web.identity.value)!!.positionMs)
    }

    @Test
    fun closeRemovesTheBorrowedEpisodeAndRestoresThePreviousOnePaused() = runTest {
        val fixture = arrived()
        fixture.coordinator.closeClip()
        val state = fixture.coordinator.state.value
        assertNull(state.clip)
        assertEquals(listOf(phone, queued).map { it.identity }, state.queue.episodes.map { it.identity })
        assertEquals(phone.identity, state.episode?.identity)
        assertEquals(3672.seconds, state.position)
        assertEquals(PlaybackStatus.Paused, state.status)
        assertFalse(state.requested)
        fixture.settle()
        assertNoProgress(fixture)
    }

    @Test
    fun closeKeepsAnEpisodeThatWasAlreadyQueued() = runTest {
        val fixture = harness.fixture(this)
        fixture.hydrated()
        fixture.coordinator.open(queued, clip)
        assertTrue(fixture.coordinator.state.value.clip!!.queued)
        fixture.coordinator.closeClip()
        val state = fixture.coordinator.state.value
        assertEquals(listOf(queued, phone).map { it.identity }, state.queue.episodes.map { it.identity })
        assertEquals(phone.identity, state.episode?.identity)
        fixture.settle()
        assertNoProgress(fixture)
    }

    @Test
    fun addToQueueMovesTheEpisodeToTheEndAndRestoresThePreviousOnePaused() = runTest {
        val fixture = arrived()
        fixture.coordinator.queueClip()
        val state = fixture.coordinator.state.value
        assertNull(state.clip)
        assertEquals(listOf(phone, queued, web).map { it.identity }, state.queue.episodes.map { it.identity })
        assertEquals(phone.identity, state.episode?.identity)
        assertEquals(3672.seconds, state.position)
        assertFalse(state.requested)
        fixture.settle()
        assertNoProgress(fixture)
        assertEquals(listOf(phone, queued, web).map { it.identity.value }, scopes.database.episodes().queue().map { it.identity })
    }

    @Test
    fun playingAnotherEpisodeLeavesClipModeAndReturnsTheQueue() = runTest {
        val fixture = arrived()
        fixture.coordinator.play(queued)
        val state = fixture.coordinator.state.value
        assertNull(state.clip)
        assertEquals(listOf(phone, queued).map { it.identity }, state.queue.episodes.map { it.identity })
        assertEquals(queued.identity, state.episode?.identity)
        fixture.coordinator.pause()
        fixture.settle()
        assertNull(scopes.database.progress().get(web.identity.value))
    }

    @Test
    fun timeLinkSeeksAndPlaysWithNormalProgress() = runTest {
        val fixture = harness.fixture(this)
        fixture.hydrated()
        fixture.coordinator.open(web, Moment.Time(600.seconds))
        val state = fixture.coordinator.state.value
        assertNull(state.clip)
        assertEquals(listOf(web, phone, queued).map { it.identity }, state.queue.episodes.map { it.identity })
        assertEquals(600.seconds, state.position)
        assertTrue(state.requested)
        fixture.player.setPosition(615_000)
        fixture.coordinator.pause()
        fixture.settle()
        assertEquals(615_000L, scopes.database.progress().get(web.identity.value)?.positionMs)
        assertEquals(web.identity.value, scopes.database.player().player()?.current)
    }

    private suspend fun TestScope.arrived(): PlaybackFixture {
        val fixture = harness.fixture(this)
        fixture.hydrated()
        fixture.coordinator.open(web, clip)
        return fixture
    }

    private fun TestScope.tick() {
        advanceTimeBy(300)
        runCurrent()
    }

    private suspend fun assertNoProgress(fixture: PlaybackFixture) {
        assertNull(scopes.database.progress().get(web.identity.value))
        assertTrue(scopes.database.outbox().pending().isEmpty())
        assertTrue(fixture.server.calls.none { it.body.isNotEmpty() })
    }
}
