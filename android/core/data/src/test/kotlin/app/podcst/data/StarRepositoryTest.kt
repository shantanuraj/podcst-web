package app.podcst.data

import app.podcst.model.AccountEpisodeList
import app.podcst.model.Episode
import app.podcst.model.EpisodeFile
import app.podcst.model.ListAcknowledgement
import app.podcst.model.ListAvailability
import app.podcst.model.ListBatch
import app.podcst.model.ListChange
import app.podcst.model.ListChangeResult
import app.podcst.model.ListEpisodeItem
import app.podcst.model.ListEpisodePage
import app.podcst.model.ListMembership
import app.podcst.model.ListSnapshot
import app.podcst.network.ApiException
import java.io.File
import java.io.IOException
import java.util.UUID
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class StarRepositoryTest {
    private lateinit var directory: File
    private val file get() = File(directory, "lists.json")
    private val json = Json { encodeDefaults = true }

    @Before fun prepare() { directory = File(RuntimeEnvironment.getApplication().cacheDir, UUID.randomUUID().toString()).apply { mkdirs() } }
    @After fun clean() { directory.deleteRecursively() }

    private fun TestScope.repository(server: StarServer = StarServer(), account: String? = "owner", write: ((ByteArray) -> Unit)? = null) =
        StarRepository(file, server, backgroundScope, account, io = UnconfinedTestDispatcher(testScheduler), write = write)

    private fun seed(vararg ids: Long) {
        val state = StarScope()
        ids.forEach { state.enqueue(it, ListChange.Operation.Add, it, episode(it)) }
        file.writeText(json.encodeToString(mapOf(Scope.key("owner") to state)))
    }

    @Test fun canonicalIdsPersistAndDoNotDependOnGuidOrFeed() = runTest {
        val stars = repository(account = null)
        assertTrue(stars.star(episode(1)))
        assertTrue(stars.star(episode(2)))
        assertTrue(stars.star(episode(1).copy(feed = "https://changed.invalid/rss")))
        assertEquals(setOf(1L, 2L), stars.status.value.items.map { it.id }.toSet())
        assertEquals(stars.status.value.items, repository(account = null).status.value.items)
        assertFalse(stars.star(episode(1).copy(id = null)))
        assertTrue(stars.toggle(episode(1)))
        assertEquals(listOf(2L), repository(account = null).status.value.items.map { it.id })
    }

    @Test fun guestMergeIsConsumedOnceAndAccountWorkSurvivesSwitches() = runTest {
        val remote = StarServer().apply { online = false }
        val stars = repository(remote, null)
        stars.star(episode(1))
        stars.switchAccount("owner")
        stars.unstar(episode(1))
        stars.star(episode(2))
        stars.switchAccount(null)
        assertTrue(stars.status.value.items.isEmpty())
        stars.star(episode(3))
        stars.switchAccount("other")
        assertEquals(listOf(3L), stars.status.value.items.map { it.id })
        stars.switchAccount("owner")
        assertEquals(listOf(2L), stars.status.value.items.map { it.id })
        assertNull(stars.status.value.items.single().episode)
        assertTrue(stars.status.value.pending)
        assertEquals(listOf(2L), repository(remote).status.value.items.map { it.id })
        assertFalse(file.readText().contains("Episode 2"))
    }

    @Test fun failedWritesDoNotPublishATapOrConsumeGuestWork() = runTest {
        var fail = false
        val remote = StarServer().apply { online = false }
        val stars = repository(remote, null) { bytes -> if (fail) throw IOException("Disk full") else file.writeBytes(bytes) }
        stars.star(episode(1))
        fail = true
        assertFalse(stars.star(episode(2)))
        assertEquals(listOf(1L), stars.status.value.items.map { it.id })
        try { stars.switchAccount("owner"); fail("Expected a failed transfer") } catch (_: IOException) {}
        assertEquals(listOf(1L), repository(remote, null).status.value.items.map { it.id })
        assertTrue(repository(remote).status.value.items.isEmpty())
        fail = false
        stars.switchAccount("owner")
        assertEquals(listOf(1L), stars.status.value.items.map { it.id })
        assertTrue(repository(remote, null).status.value.items.isEmpty())
    }

    @Test fun lostAcknowledgementReplaysWithoutRestoringRemoteRemoval() = runTest {
        seed(1)
        val remote = StarServer().apply { loseReply = true }
        val first = repository(remote)
        first.refresh()
        assertTrue(first.status.value.pending)
        remote.members = snapshot(emptyList(), "2")
        val restored = repository(remote)
        restored.refresh()
        assertEquals(2, remote.sent.size)
        assertEquals(remote.sent[0], remote.sent[1])
        assertTrue(restored.status.value.items.isEmpty())
        assertFalse(restored.status.value.pending)
    }

    @Test fun acknowledgementSurvivesFailedSnapshotWithoutReposting() = runTest {
        seed(1)
        val remote = StarServer().apply { failSnapshot = true }
        val first = repository(remote)
        first.refresh()
        assertTrue(first.status.value.pending)
        assertEquals(listOf(1L), first.status.value.items.map { it.id })
        remote.failSnapshot = false
        val restored = repository(remote)
        restored.refresh()
        assertEquals(1, remote.sent.size)
        assertFalse(restored.status.value.pending)
        assertEquals(listOf(1L), restored.status.value.items.mapNotNull { it.episode?.id })
    }

    @Test fun conflictsStopStreamsAcrossRestartWithoutChangingRequests() = runTest {
        seed(1)
        val remote = StarServer().apply { status = 409 }
        val first = repository(remote)
        first.refresh()
        val before = file.readText()
        val restored = repository(remote)
        restored.refresh()
        assertEquals(1, remote.sent.size)
        assertTrue(restored.status.value.pending)
        assertNotNull(restored.status.value.error)
        assertEquals(before, file.readText())
    }

    @Test fun terminalFailuresDropOptimisticSuccessEvenWhenRefreshFails() = runTest {
        seed(1)
        val remote = StarServer().apply { notFound = true; failSnapshot = true }
        val first = repository(remote)
        first.refresh()
        assertTrue(first.status.value.items.isEmpty())
        assertNotNull(first.status.value.error)
        remote.failSnapshot = false
        val restored = repository(remote)
        restored.refresh()
        assertTrue(restored.status.value.items.isEmpty())
        assertFalse(restored.status.value.pending)
        assertNotNull(restored.status.value.error)
    }

    @Test fun staleSnapshotsKeepAcknowledgedOverlayAndSequence() = runTest {
        seed(1)
        val remote = StarServer().apply { snapshotRevision = "0" }
        val first = repository(remote)
        first.refresh()
        assertTrue(first.status.value.pending)
        assertEquals(listOf(1L), first.status.value.items.map { it.id })
        remote.snapshotRevision = null
        val restored = repository(remote)
        restored.refresh()
        assertFalse(restored.status.value.pending)
        assertEquals(1, remote.sent.size)
    }

    @Test fun unavailableMembershipInvalidatesMetadataWithoutRevisionChange() = runTest {
        seed(1)
        val remote = StarServer()
        val stars = repository(remote)
        stars.refresh()
        assertNotNull(stars.status.value.items.single().episode)
        remote.members = remote.members.copy(items = remote.members.items.map { it.copy(availability = ListAvailability.Unavailable) })
        stars.refresh()
        assertEquals(listOf(1L), stars.status.value.items.map { it.id })
        assertNull(stars.status.value.items.single().episode)
        assertNull(repository(remote).status.value.items.single().episode)
    }

    @Test fun frozenBatchesSurviveRapidToggles() = runTest {
        seed(1)
        val arrived = CompletableDeferred<Unit>()
        val release = CompletableDeferred<Unit>()
        val remote = StarServer().apply { beforeChange = { arrived.complete(Unit); release.await() } }
        val stars = repository(remote)
        val sending = launch { stars.refresh() }
        arrived.await()
        stars.unstar(episode(1))
        remote.beforeChange = null
        release.complete(Unit)
        sending.join()
        assertEquals(listOf("1", "2"), remote.sent.map { it.sequence })
        assertEquals(listOf(ListChange.Operation.Add, ListChange.Operation.Remove), remote.sent.map { it.changes.single().op })
        assertTrue(stars.status.value.items.isEmpty())
    }

    @Test fun lateResponsesCannotEnterAnotherAccount() = runTest {
        val arrived = CompletableDeferred<Unit>()
        val release = CompletableDeferred<Unit>()
        val remote = StarServer().apply {
            members = snapshot(listOf(1))
            beforeSnapshot = { arrived.complete(Unit); release.await() }
        }
        val stars = repository(remote)
        val reading = launch { stars.refresh() }
        arrived.await()
        stars.switchAccount("other")
        release.complete(Unit)
        reading.join()
        assertEquals("other", stars.status.value.accountId)
        assertTrue(stars.status.value.items.isEmpty())
        assertTrue(remote.sent.isEmpty())
    }

    @Test fun authenticationMustFinishBeforeTheNewScopeIsVisibleOrSends() = runTest {
        val remote = StarServer()
        val stars = repository(remote, null)
        stars.star(episode(1))
        stars.switchAccount("owner", activate = false)
        stars.refresh()
        assertFalse(stars.status.value.ready)
        assertTrue(stars.status.value.items.isEmpty())
        assertTrue(remote.sent.isEmpty())
        stars.resumeSync("other")
        stars.refresh()
        assertTrue(remote.sent.isEmpty())
        stars.resumeSync("owner")
        stars.refresh()
        assertTrue(stars.status.value.ready)
        assertEquals(listOf(1L), stars.status.value.items.map { it.id })
    }

    @Test fun unconfirmedAccountsCannotClaimGuestStars() = runTest {
        val guest = repository(account = null)
        guest.star(episode(1))
        val remote = StarServer().apply { user = "other" }
        val stars = repository(remote)
        stars.refresh()
        assertFalse(stars.status.value.ready)
        assertTrue(remote.sent.isEmpty())
        assertEquals(listOf(1L), repository(account = null).status.value.items.map { it.id })
    }

    @Test fun corruptStorageIsNotSilentlyReset() = runTest {
        file.writeText("corrupt")
        val stars = repository()
        assertFalse(stars.status.value.ready)
        assertFalse(stars.star(episode(1)))
        assertEquals("corrupt", file.readText())
    }

    @Test fun batchesAreBoundedAndSequencesNeverRound() {
        val state = StarScope(listId = ID, sequence = 9_007_199_254_740_992)
        (1L..101L).forEach { state.enqueue(it, ListChange.Operation.Add, it) }
        state.freeze()
        assertEquals("9007199254740993", state.flight?.batch?.sequence)
        assertEquals(100, state.flight?.batch?.changes?.size)
        assertEquals(1, state.queued.size)
    }

    @Test fun catalogueDatabaseDeletionDoesNotDeleteTheOutbox() = runTest {
        seed(1)
        val scopes = Scopes(RuntimeEnvironment.getApplication(), "owner")
        scopes.switch("other")
        assertTrue(file.isFile)
        assertEquals(listOf(1L), repository().status.value.items.map { it.id })
        scopes.database.close()
    }

    private companion object {
        const val ID = "0c339753-cb50-477c-843e-e641b414a060"
        fun episode(id: Long) = Episode(id = id, guid = "same-guid", feed = "https://example.invalid/rss", title = "Episode $id", file = EpisodeFile("https://example.invalid/audio.mp3"))
        fun snapshot(ids: List<Long>, revision: String = "1") = ListSnapshot(ID, revision, ids.map { ListMembership(it, it, ListAvailability.Available) })
    }

    private class StarServer : StarRemote {
        var online = true
        var user = "owner"
        var members = snapshot(emptyList(), "0")
        val sent = mutableListOf<ListBatch>()
        val accepted = mutableMapOf<String, ListAcknowledgement>()
        var loseReply = false
        var failSnapshot = false
        var notFound = false
        var snapshotRevision: String? = null
        var status: Int? = null
        var beforeChange: (suspend () -> Unit)? = null
        var beforeSnapshot: (suspend () -> Unit)? = null
        override suspend fun accountId(): String { if (!online) throw IOException("Offline"); return user }
        override suspend fun lists() = listOf(AccountEpisodeList(ID, "starred", null, members.revision, members.items.size))
        override suspend fun membership(id: String): ListSnapshot {
            beforeSnapshot?.invoke()
            if (failSnapshot) throw IOException("Offline")
            return members.copy(revision = snapshotRevision ?: members.revision)
        }
        override suspend fun episodes(id: String, cursor: String?) = ListEpisodePage(ID, members.revision, members.items.map { ListEpisodeItem(it, episode(it.episodeId).takeIf { _ -> it.availability == ListAvailability.Available }) }, null)
        override suspend fun change(id: String, batch: ListBatch): ListAcknowledgement {
            sent += batch
            beforeChange?.invoke()
            status?.let { throw ApiException(it, "Request rejected") }
            val key = "${batch.clientId}:${batch.sequence}"
            accepted[key]?.let { return it }
            for (change in batch.changes) {
                members = if (change.op == ListChange.Operation.Remove) members.copy(items = members.items.filterNot { it.episodeId == change.episodeId })
                else if (!notFound && members.items.none { it.episodeId == change.episodeId }) members.copy(items = members.items + ListMembership(change.episodeId, change.episodeId, ListAvailability.Available))
                else members
            }
            members = members.copy(revision = (members.revision.toLong() + 1).toString())
            val result = ListAcknowledgement(batch.clientId, batch.sequence, ID, members.revision, batch.changes.map { ListChangeResult(it.episodeId, if (notFound) ListChangeResult.Status.NotFound else ListChangeResult.Status.Applied) })
            accepted[key] = result
            if (loseReply) { loseReply = false; throw IOException("Lost reply") }
            return result
        }
    }
}
