package app.podcst.data

import app.podcst.database.PodcstDatabase
import app.podcst.database.SubscriptionEntity
import app.podcst.database.entity
import app.podcst.model.*
import app.podcst.network.testing.FakeServer
import app.podcst.network.testing.Reply
import java.io.IOException
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import org.junit.After
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class LibraryRepositoryTest {
    private val context = RuntimeEnvironment.getApplication()
    private val scopes = Scopes(context, null)
    private val generation = "17adbd84-d0e4-4e2d-ad9f-b084efee3211"
    private val guest = Podcast(id = 9007199254740993, feed = "https://guest.test/rss", title = "Guest")
    private val json = Json { encodeDefaults = true }
    @After fun close() { val owner = scopes.current.value; scopes.close(); PodcstDatabase.delete(context, owner.key) }
    private fun library(server: FakeServer) = LibraryRepository(server.api, scopes, CatalogRepository(server.api, scopes))

    @Test fun automaticGuestUnionAndOfflineUnfollowSurviveAccountRoundTripWithoutUploadingCachedShows() = runTest {
        scopes.durable.guestFollow(guest, true)
        scopes.switch("owner"); scopes.resumeSync("owner")
        val cached = Podcast(id = 2, feed = "https://cache.test/rss", title = "Not intent")
        scopes.database.podcasts().upsert(listOf(cached.entity(null, false)))
        scopes.database.subscriptions().insert(SubscriptionEntity(cached.feed, 1))
        var followed = false
        var revision = 0L
        var offline = false
        val server = FakeServer { call ->
            if (offline) throw IOException("offline")
            if (call.body.isNotEmpty()) {
                val batch = json.decodeFromString<StateBatch<StateFollowChange>>(call.body)
                assertTrue(batch.changes.all { it.podcastId.value == guest.id.toString() })
                followed = batch.changes.last().followed; revision++
                Reply(json.encodeToString(StateAcknowledgement(1, "owner", generation, batch.clientId, batch.sequence, StateRevision(revision.toString()), batch.changes.map { StateFollowResult(it.podcastId, StateResult.applied) })))
            } else if (call.query == "view=membership") Reply(json.encodeToString(StateSnapshot(1, "owner", generation, StateRevision(revision.toString()), if (followed) listOf(StateFollowItem(StateID(guest.id.toString()), StateID(revision.toString()), null, StateAvailability.available)) else emptyList())))
            else Reply("[]")
        }
        val library = library(server)
        library.refresh()
        assertTrue(followed)
        assertTrue(scopes.durable.guestFollows().isEmpty())
        library.refresh()
        assertEquals(1, server.calls.count { it.body.isNotEmpty() })
        offline = true
        library.toggle(guest, subscribed = true)
        assertFalse(scopes.durable.account("owner").followed().contains(guest.id))
        assertTrue(scopes.durable.status.value.pending)
        scopes.switch("other"); scopes.resumeSync("other")
        assertFalse(scopes.durable.status.value.pending)
        scopes.switch("owner"); scopes.resumeSync("owner")
        assertTrue(scopes.durable.status.value.pending)
        scopes.switch(null); scopes.resumeSync(null)
        library(FakeServer { Reply("[]") }).refresh()
        assertTrue(scopes.database.podcasts().subscribed().isEmpty())
    }

    @Test fun failedMembershipReadIsNotEmptyTruthAndUnavailableRowsNeverExposeCachedMetadata() = runTest {
        scopes.switch("owner"); scopes.resumeSync("owner")
        scopes.database.podcasts().upsert(listOf(guest.entity(null, false)))
        scopes.database.subscriptions().insert(SubscriptionEntity(guest.feed, 1))
        scopes.durable.installFollows("owner", StateSnapshot(1, "owner", generation, StateRevision("1"), listOf(StateFollowItem(StateID(guest.id.toString()), StateID("1"), null, StateAvailability.available))))
        val failed = library(FakeServer { throw IOException("offline") })
        assertTrue(runCatching { failed.refresh() }.isFailure)
        assertTrue(scopes.durable.account("owner").followed().isNotEmpty())
        assertNotNull(failed.status.value.error)
        scopes.durable.installFollows("owner", StateSnapshot(1, "owner", generation, StateRevision("1"), listOf(StateFollowItem(StateID(guest.id.toString()), StateID("1"), null, StateAvailability.unavailable))))
        assertTrue(failed.podcasts.first().isEmpty())
        assertEquals(listOf(guest.id), failed.unavailable.first())
    }

    @Test fun opmlResolutionQueuesOnlySuccessfulIdsAndRetainsFailuresForRetry() = runTest {
        scopes.switch("owner"); scopes.resumeSync("owner")
        val server = FakeServer { call ->
            if (call.path.endsWith("resolve")) Reply(json.encodeToString(FollowResolution(1, "owner", generation, listOf(FollowResolutionItem(0, StateID("9007199254740993"), "resolved"), FollowResolutionItem(1, null, "unavailable")))))
            else Reply(json.encodeToString(StateSnapshot<StateFollowItem>(1, "owner", generation, StateRevision("0"), emptyList())))
        }
        val result = library(server).import(listOf("https://ok.test/rss", "https://bad.test/rss"))
        assertEquals(ImportResult(1, 1), result)
        assertEquals(listOf("https://bad.test/rss"), scopes.durable.account("owner").importFeeds)
        assertEquals("9007199254740993", scopes.durable.account("owner").followQueued.single().podcastId.value)
        assertTrue(server.calls.none { it.path == "/api/subscriptions" && it.body.isNotEmpty() })
    }
}
