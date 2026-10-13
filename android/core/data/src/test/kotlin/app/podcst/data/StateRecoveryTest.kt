package app.podcst.data

import app.podcst.database.PodcstDatabase
import app.podcst.model.*
import app.podcst.network.testing.FakeServer
import app.podcst.network.testing.Reply
import java.io.File
import java.io.IOException
import java.util.UUID
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.async
import kotlinx.coroutines.runBlocking
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
class StateRecoveryTest {
    private val application = RuntimeEnvironment.getApplication()
    private val file = File(application.noBackupFilesDir, UUID.randomUUID().toString())
    private val durable = DurableState(file)
    private val scopes = Scopes(application, "owner", durable).also { it.resumeSync("owner") }
    private val old = "17adbd84-d0e4-4e2d-ad9f-b084efee3211"
    private val next = "17adbd84-d0e4-4e2d-ad9f-b084efee3212"
    private val id = StateID("152")
    private val json = Json { encodeDefaults = true }
    private val progress = StateSnapshot(1, "owner", next, StateRevision("1"), listOf(StateProgressItem(id, StateProgress(66, false, StateID("1"), null))))
    private val follows = StateSnapshot(1, "owner", next, StateRevision("1"), listOf(StateFollowItem(id, StateID("1"), null, StateAvailability.available)))
    private fun snapshots() = RecoverySnapshots(listOf(progress), follows, listOf(152L))
    private fun bootstrap(pending: Boolean = false) {
        durable.installProgress("owner", progress.copy(generation = old, revision = StateRevision("25")))
        durable.installFollows("owner", follows.copy(generation = old, revision = StateRevision("25")))
        if (pending) {
            durable.queueProgress("owner", StateProgressChange(id, 30, null))
            durable.freezeProgress("owner")
            durable.queueFollow("owner", StateFollowChange(id, false))
        }
        durable.change("owner") { it.copy(progressBlocked = "stale generation", followBlocked = "stale generation", importFeeds = listOf("https://example.test/rss"), importRetryAt = mapOf("https://example.test/rss" to 123L)) }
    }
    private fun server() = FakeServer { call -> Reply(if (call.path == "/api/progress") json.encodeToString(progress) else json.encodeToString(follows)) }
    @After fun clean() { scopes.close(); PodcstDatabase.delete(application, Scope.key("owner")); file.delete() }

    @Test fun idleRecoveryInstallsBothResourcesAndPreservesImportSourcesAcrossRestart() = runTest {
        bootstrap()
        val before = durable.account("owner")
        val server = server()
        StateRecovery(server.api, scopes).progress(scopes.current.value, scopes.epoch)
        val recovered = DurableState(file).account("owner")
        assertEquals(next, recovered.generation)
        assertEquals(66, recovered.progress[152L]?.positionSeconds)
        assertEquals(setOf(152L), recovered.followed())
        assertEquals(before.importFeeds, recovered.importFeeds)
        assertEquals(before.importRetryAt, recovered.importRetryAt)
        assertNotEquals(before.progressClient, recovered.progressClient)
        assertNotEquals(before.followClient, recovered.followClient)
        assertNull(recovered.progressBlocked)
        assertNull(recovered.followBlocked)
        assertTrue(server.calls.all { it.body.isEmpty() })
    }

    @Test fun failedCompanionSnapshotLeavesBothCachedResourcesAndScopeUntouched() = runTest {
        bootstrap()
        val before = file.readBytes()
        val server = FakeServer { call -> if (call.path == "/api/progress") Reply(json.encodeToString(progress)) else throw IOException("offline") }
        assertTrue(runCatching { StateRecovery(server.api, scopes).progress(scopes.current.value, scopes.epoch) }.isFailure)
        assertArrayEquals(before, file.readBytes())
    }

    @Test fun queuedAndFrozenWorkRequiresExplicitChoiceAndThenUsesServerPositions() = runTest {
        bootstrap(pending = true)
        val before = durable.account("owner")
        val server = server()
        val recovery = StateRecovery(server.api, scopes)
        assertTrue(runCatching { recovery.progress(scopes.current.value, scopes.epoch) }.isFailure)
        assertEquals(before, durable.account("owner"))
        val choice = checkNotNull(recovery.prepare())
        assertEquals(before, durable.account("owner"))
        assertEquals(mapOf(152L to 66), recovery.useSyncedVersion(choice))
        val recovered = DurableState(file).account("owner")
        assertEquals(next, recovered.generation)
        assertEquals(66, recovered.progress[152L]?.positionSeconds)
        assertEquals(setOf(152L), recovered.followed())
        assertFalse(recovered.pending)
        assertEquals(before.importFeeds, recovered.importFeeds)
        assertEquals(before.importRetryAt, recovered.importRetryAt)
        assertTrue(server.calls.all { it.body.isEmpty() })
    }

    @Test fun invalidOrMixedSnapshotsCannotReplacePendingState() {
        bootstrap(pending = true)
        val expected = durable.account("owner")
        val before = file.readBytes()
        for (snapshots in listOf(
            snapshots().copy(follows = follows.copy(accountId = "other")),
            snapshots().copy(follows = follows.copy(generation = old)),
            snapshots().copy(progress = listOf(progress.copy(generation = old))),
            snapshots().copy(progress = listOf(progress.copy(items = progress.items + progress.items))),
            snapshots().copy(progress = listOf(progress.copy(revision = StateRevision("0")))),
            snapshots().copy(requested = listOf(9L)),
        )) {
            assertTrue(runCatching { durable.recover("owner", expected, snapshots, discardPending = true) }.isFailure)
            assertArrayEquals(before, file.readBytes())
        }
    }

    @Test fun failedRecoveryWritePreservesFrozenJournalAndReportsStorageError() {
        bootstrap(pending = true)
        val before = file.readBytes()
        val failing = DurableState(file) { throw IOException("disk full") }.also { it.activate("owner") }
        assertTrue(runCatching { failing.recover("owner", failing.account("owner"), snapshots(), discardPending = true) }.isFailure)
        assertArrayEquals(before, file.readBytes())
        assertTrue(failing.status.value.error!!.contains("Unable to save state"))
    }

    @Test fun editsAfterChoicePreventReplacementAndRetainNewWork() = runTest {
        bootstrap(pending = true)
        val recovery = StateRecovery(server().api, scopes)
        val choice = checkNotNull(recovery.prepare())
        durable.queueProgress("owner", StateProgressChange(id, 91, null))
        val before = file.readBytes()
        assertTrue(runCatching { recovery.useSyncedVersion(choice) }.isFailure)
        assertArrayEquals(before, file.readBytes())
        assertEquals(91, durable.account("owner").progressOverlay()[152L]?.positionSeconds)
    }

    @Test fun editsWhileFetchingPreventReplacement() = runTest {
        bootstrap(pending = true)
        val arrived = CompletableDeferred<Unit>()
        val release = CompletableDeferred<Unit>()
        var waiting = false
        val server = FakeServer { call ->
            if (waiting && call.path == "/api/progress") { arrived.complete(Unit); runBlocking { release.await() } }
            Reply(if (call.path == "/api/progress") json.encodeToString(progress) else json.encodeToString(follows))
        }
        val recovery = StateRecovery(server.api, scopes)
        val choice = checkNotNull(recovery.prepare())
        waiting = true
        val applying = async { runCatching { recovery.useSyncedVersion(choice) } }
        arrived.await()
        durable.queueFollow("owner", StateFollowChange(StateID("5"), true))
        val before = file.readBytes()
        release.complete(Unit)
        assertTrue(applying.await().isFailure)
        assertArrayEquals(before, file.readBytes())
    }

    @Test fun accountChangeRejectsPreparedRecovery() = runTest {
        bootstrap(pending = true)
        val recovery = StateRecovery(server().api, scopes)
        val choice = checkNotNull(recovery.prepare())
        scopes.switch("other")
        scopes.resumeSync("other")
        val saved = durable.account("owner")
        assertTrue(runCatching { recovery.useSyncedVersion(choice) }.isFailure)
        assertEquals(saved, durable.account("owner"))
        assertNull(durable.account("other").generation)
    }

    @Test fun sameGenerationBlockCannotOfferReplacement() = runTest {
        bootstrap(pending = true)
        val server = FakeServer { call -> Reply(if (call.path == "/api/progress") json.encodeToString(progress.copy(generation = old)) else json.encodeToString(follows.copy(generation = old))) }
        assertNull(StateRecovery(server.api, scopes).prepare())
        assertTrue(durable.account("owner").pending)
    }
}
