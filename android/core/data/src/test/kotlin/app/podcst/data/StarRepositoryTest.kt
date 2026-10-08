package app.podcst.data

import app.podcst.model.*
import app.podcst.network.ApiException
import java.io.File
import java.io.IOException
import java.util.UUID
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
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
class StarRepositoryTest {
    private val directory = File(RuntimeEnvironment.getApplication().noBackupFilesDir, UUID.randomUUID().toString()).apply { mkdirs() }
    private val file = File(directory, "stars.json")
    @After fun clean() { directory.deleteRecursively() }
    private fun TestScope.repository(remote: Remote = Remote(), account: String? = "owner", writer: ((ByteArray) -> Unit)? = null) =
        StarRepository(file, remote, backgroundScope, account, io = UnconfinedTestDispatcher(testScheduler), write = writer).also { it.resumeSync(account) }
    private fun seed(legacy: Boolean = false, ack: Boolean = false) {
        val scope = StarScope(listId = LIST, accountId = if (legacy) null else "owner", generation = if (legacy) null else GENERATION)
        scope.enqueue(1, ListChange.Operation.Add, 1, episode(1))
        if (legacy) {
            val intents = scope.queued
            val batch = ListBatch(scope.clientId, "1", intents.map { it.change })
            scope.sequence = 1
            scope.queued = emptyList()
            scope.flight = StarFlight(batch, intents, if (ack) ListAcknowledgement(scope.clientId, "1", LIST, "1", listOf(ListChangeResult(1, ListChangeResult.Status.Applied))) else null)
        }
        file.writeText(Json { encodeDefaults = true }.encodeToString(mapOf(Scope.key("owner") to scope)))
    }

    @Test fun lostAckAndRemoteRemovalReplayIdenticallyAcrossAtomicFileRestart() = runTest {
        seed()
        val remote = Remote().apply { loseReply = true }
        repository(remote).refresh()
        remote.members = snapshot(emptyList(), "2")
        val restarted = repository(remote)
        restarted.refresh()
        assertEquals(2, remote.sent.size)
        assertEquals(remote.sent[0], remote.sent[1])
        assertTrue(restarted.status.value.items.isEmpty())
        assertFalse(restarted.status.value.pending)
    }

    @Test fun acceptedLegacyFlightStillUsesBridgeAndKeepsOriginalNumericRequestAndAckUntilRead() = runTest {
        seed(legacy = true, ack = true)
        val original = Json.decodeFromString<Map<String, StarScope>>(file.readText()).getValue(Scope.key("owner")).flight!!
        val remote = Remote().apply { failSnapshot = true }
        repository(remote).refresh()
        assertEquals(listOf(true), remote.legacy)
        assertEquals(original.batch, remote.sent.single())
        val saved = Json.decodeFromString<Map<String, StarScope>>(file.readText()).getValue(Scope.key("owner")).flight!!
        assertEquals(original.acknowledgement, saved.legacyAcknowledgement)
        assertFalse(saved.legacy)
        remote.failSnapshot = false
        repository(remote).refresh()
        assertEquals(1, remote.sent.size)
    }

    @Test fun bridgeAckWriteFailureReplaysOriginalFlightWithoutPromotingToNewSequence() = runTest {
        seed(legacy = true, ack = true)
        val original = file.readText()
        val remote = Remote()
        val failed = repository(remote, writer = { bytes ->
            val scopes = Json.decodeFromString<Map<String, StarScope>>(bytes.decodeToString())
            if (scopes.getValue(Scope.key("owner")).flight?.legacy == false) throw IOException("ack write denied")
            file.writeBytes(bytes)
        })
        failed.refresh()
        assertTrue(failed.status.value.pending)
        assertTrue(File(file.path + ".migration-source").exists())
        assertEquals(original, File(file.path + ".migration-source").readText())
        val restarted = repository(remote)
        restarted.refresh()
        assertEquals(listOf(true, true), remote.legacy)
        assertEquals(remote.sent[0], remote.sent[1])
        assertFalse(restarted.status.value.pending)
    }

    @Test fun recoveryConflictPreservesLegacyRequestWithoutNewStreamOrGeneration() = runTest {
        seed(legacy = true)
        val remote = Remote().apply { reject = 409 }
        val repository = repository(remote)
        repository.refresh()
        val bytes = file.readBytes()
        val restarted = repository(remote)
        restarted.refresh()
        assertArrayEquals(bytes, file.readBytes())
        assertEquals(listOf(true), remote.legacy)
        assertNotNull(restarted.status.value.error)
    }

    @Test fun guestUnionWaitsForVerificationAndConsumesExactlyOnce() = runTest {
        val remote = Remote()
        val stars = repository(remote, null)
        assertTrue(stars.star(episode(1)))
        stars.switchAccount("owner", activate = false)
        assertTrue(repository(remote, null).status.value.items.isNotEmpty())
        stars.resumeSync("owner")
        stars.refresh()
        assertEquals(listOf(1L), stars.status.value.items.map { it.id })
        assertTrue(repository(remote, null).status.value.items.isEmpty())
        stars.refresh()
        assertEquals(1, remote.sent.size)
    }

    @Test fun failedIntentWriteAndCorruptReadNeverReportSaved() = runTest {
        val stars = repository(account = null, writer = { throw IOException("full") })
        assertFalse(stars.star(episode(1)))
        assertTrue(stars.status.value.items.isEmpty())
        file.writeText("broken")
        val corrupt = repository(account = null)
        assertFalse(corrupt.star(episode(1)))
        assertFalse(corrupt.status.value.ready)
        assertEquals("broken", file.readText())
    }

    @Test fun newerIntentWhileSendingSurvivesAndUsesNextSequence() = runTest {
        seed()
        val arrived = CompletableDeferred<Unit>(); val release = CompletableDeferred<Unit>()
        val remote = Remote().apply { beforeChange = { arrived.complete(Unit); release.await() } }
        val stars = repository(remote)
        val sending = launch { stars.refresh() }
        arrived.await()
        stars.unstar(episode(1))
        remote.beforeChange = null
        release.complete(Unit)
        sending.join()
        testScheduler.runCurrent()
        assertEquals(listOf("1", "2"), remote.sent.map { it.sequence })
        assertTrue(stars.status.value.items.isEmpty())
    }

    @Test fun pendingSurvivesAccountRoundTripButOtherScopeDoesNotExposeMetadata() = runTest {
        seed()
        val remote = Remote().apply { reject = 409 }
        val stars = repository(remote)
        stars.refresh()
        stars.switchAccount("other", activate = false)
        assertTrue(stars.status.value.items.isEmpty())
        stars.switchAccount("owner", activate = false)
        stars.resumeSync("owner")
        stars.refresh()
        assertTrue(stars.status.value.pending)
        assertEquals(1, remote.sent.size)
    }

    @Test fun unavailableMembershipHidesPrivateMetadataWithoutRevisionChange() = runTest {
        seed()
        val remote = Remote()
        val stars = repository(remote); stars.refresh()
        assertNotNull(stars.status.value.items.single().episode)
        remote.members = remote.members.copy(items = remote.members.items.map { it.copy(availability = ListAvailability.Unavailable) })
        stars.refresh()
        assertNull(stars.status.value.items.single().episode)
    }

    @Test fun exactInt64IdsAndBoundedSequencesDoNotDependOnFeedOrGuid() {
        val state = StarScope(listId = LIST, accountId = "owner", generation = GENERATION, sequence = 9007199254740992)
        (1L..101).forEach { state.enqueue(it, ListChange.Operation.Add, it) }
        state.enqueue(Long.MAX_VALUE, ListChange.Operation.Add, 102)
        state.freeze()
        assertEquals("9007199254740993", state.flight?.batch?.sequence)
        assertEquals(100, state.flight?.batch?.changes?.size)
        assertEquals(2, state.queued.size)
        assertTrue(state.project().any { it.id == Long.MAX_VALUE })
    }

    private class Remote : StarRemote {
        var members = snapshot(emptyList(), "0")
        var loseReply = false
        var failSnapshot = false
        var reject: Int? = null
        var beforeChange: (suspend () -> Unit)? = null
        val sent = mutableListOf<ListBatch>()
        val legacy = mutableListOf<Boolean>()
        val ledger = mutableMapOf<Pair<String, String>, ListAcknowledgement>()
        override suspend fun accountId() = "owner"
        override suspend fun lists() = AccountLists(1, "owner", GENERATION, listOf(AccountEpisodeList(LIST, "starred", null, members.revision, members.items.size)))
        override suspend fun membership(id: String): ListSnapshot { if (failSnapshot) throw IOException("offline"); return members }
        override suspend fun episodes(id: String, cursor: String?) = ListEpisodePage(LIST, members.revision, members.items.map { ListEpisodeItem(it, episode(it.episodeId)) }, null, 1, "owner", GENERATION)
        override suspend fun change(id: String, batch: ListBatch, accountId: String, generation: String, legacy: Boolean): ListAcknowledgement {
            sent += batch; this.legacy += legacy
            beforeChange?.invoke()
            reject?.let { throw ApiException(it, "blocked") }
            val key = batch.clientId to batch.sequence
            ledger[key]?.let { return it }
            val ids = members.items.mapTo(mutableSetOf()) { it.episodeId }
            batch.changes.forEach { if (it.op == ListChange.Operation.Add) ids.add(it.episodeId) else ids.remove(it.episodeId) }
            members = snapshot(ids.toList(), (members.revision.toLong() + 1).toString())
            val ack = ListAcknowledgement(batch.clientId, batch.sequence, LIST, members.revision, batch.changes.map { ListChangeResult(it.episodeId, ListChangeResult.Status.Applied) }, 1, accountId, generation)
            ledger[key] = ack
            if (loseReply) { loseReply = false; throw IOException("lost ack") }
            return ack
        }
    }
    companion object {
        private const val LIST = "0c339753-cb50-477c-843e-e641b414a060"
        private const val GENERATION = "17adbd84-d0e4-4e2d-ad9f-b084efee3211"
        private fun episode(id: Long) = Episode(id = id, guid = "same", feed = "https://test/feed", title = "Episode $id", file = EpisodeFile("https://test/audio"))
        private fun snapshot(ids: List<Long>, revision: String) = ListSnapshot(LIST, revision, ids.map { ListMembership(it, it, ListAvailability.Available) }, 1, "owner", GENERATION)
    }
}
