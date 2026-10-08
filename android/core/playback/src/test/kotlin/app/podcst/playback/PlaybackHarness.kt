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
import app.podcst.network.testing.Call
import app.podcst.network.testing.FakeServer
import app.podcst.network.testing.PlaybackFixtures.episode
import app.podcst.network.testing.PlaybackFixtures.progress
import app.podcst.network.testing.Reply
import app.podcst.network.testing.StateFixtures
import app.podcst.playback.audio.AudioStages
import app.podcst.playback.audio.SourceTimeline
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.joinAll
import kotlinx.coroutines.test.TestScope
import org.robolectric.RuntimeEnvironment

internal class PlaybackHarness {
    private val application = RuntimeEnvironment.getApplication()
    val scopes = Scopes(application, "owner").also { it.resumeSync("owner") }
    val phone = episode(1)
    val web = episode(2)
    val queued = episode(3)
    private var player: FakePlayer? = null

    fun close() {
        player?.release()
        val current = scopes.current.value
        scopes.close()
        PodcstDatabase.delete(application, current.key)
    }

    suspend fun fixture(test: TestScope, route: (Call) -> Reply = {
        if (it.body.isNotEmpty()) Reply("""{"success":true}""") else progress(web, 1271.0)
    }): PlaybackFixture {
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
        val coordinator = PlaybackCoordinator(scopes, repository, Preferences(application), renderers.sink, sessionPlayer, test.backgroundScope)
        val ongoing = test.backgroundScope.coroutineContext[Job]!!.children.toSet()
        return PlaybackFixture(coordinator, transport, repository, server, test.backgroundScope, ongoing)
    }
}

internal data class PlaybackFixture(
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
