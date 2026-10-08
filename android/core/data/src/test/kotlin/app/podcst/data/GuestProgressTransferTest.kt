package app.podcst.data

import android.util.AtomicFile
import androidx.room.withTransaction
import app.podcst.database.PodcstDatabase
import app.podcst.database.ProgressEntity
import app.podcst.database.entity
import app.podcst.model.StateID
import app.podcst.model.StateProgressChange
import app.podcst.network.testing.FakeServer
import app.podcst.network.testing.PlaybackFixtures.episode
import java.io.File
import java.io.IOException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.async
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import kotlin.time.Duration.Companion.seconds

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class GuestProgressTransferTest {
    private val context = RuntimeEnvironment.getApplication()
    private val file = File(context.noBackupFilesDir, "guest-transfer-test.json")
    private val deniedParent = File(context.noBackupFilesDir, "denied-parent").apply { writeText("preserve") }
    private var denyWrite = false
    private fun store() = DurableState(file) { bytes ->
        val target = if (denyWrite) AtomicFile(File(deniedParent, "state")) else AtomicFile(file)
        val output = target.startWrite()
        try { output.write(bytes); output.fd.sync(); target.finishWrite(output) }
        catch (failure: Exception) { target.failWrite(output); throw failure }
    }
    private var scopes = Scopes(context, null, store())
    private val server = FakeServer { throw IOException("offline") }
    private var scheduled = 0
    private val scheduler = object : WorkScheduler {
        override fun syncProgress() { scheduled++ }
        override fun refreshFeeds() = Unit
    }
    private var repository = ProgressRepository(server.api, scopes, scheduler) { 1000 }
    private val guest = episode(9007199254740993)

    @After fun close() {
        scopes.close()
        for (account in listOf(null, "a", "b")) PodcstDatabase.delete(context, Scope.key(account))
        file.delete(); File(file.path + ".bak").delete(); deniedParent.delete()
    }

    private suspend fun select(position: Int = 94, completed: Boolean = false): GuestProgressSelection {
        repository.record(guest, position.seconds, completed)
        scopes.switch("a")
        assertTrue(repository.guestProgress.first().isEmpty())
        scopes.resumeSync("a")
        return repository.guestProgress.first().single { it.episode.id == guest.id }
    }
    private fun restart(account: String) {
        scopes.close()
        scopes = Scopes(context, account, store()).also { it.resumeSync(account) }
        repository = ProgressRepository(server.api, scopes, scheduler) { 1000 }
    }
    private fun denyCleanup() {
        scopes.guestDatabase.openHelper.writableDatabase.execSQL("CREATE TRIGGER deny_guest_cleanup BEFORE DELETE ON progress BEGIN SELECT RAISE(ABORT, 'guest cleanup denied'); END")
    }
    private fun allowCleanup() {
        scopes.guestDatabase.openHelper.writableDatabase.execSQL("DROP TRIGGER deny_guest_cleanup")
    }

    @Test fun selectionIsExplicitVerifiedAndCopiesOnlyTheChosenPosition() = runTest {
        repository.record(episode(2), 100.seconds, false)
        val selected = select()
        assertEquals(94L, selected.positionSeconds)
        assertFalse(selected.completed)
        assertTrue(scopes.durable.account("a").progressQueued.isEmpty())
        assertTrue(scopes.durable.account("a").guestProgressTransfers.isEmpty())
        assertTrue(server.calls.isEmpty())
        repository.transferGuestProgress(selected)
        val state = scopes.durable.account("a")
        assertEquals(listOf(StateProgressChange(StateID("9007199254740993"), 94, false)), state.progressQueued)
        assertEquals(selected.source, state.guestProgressTransfers[selected.sourceToken])
        assertNull(scopes.guestDatabase.progress().get(guest.identity.value))
        assertEquals(100000L, scopes.guestDatabase.progress().get(episode(2).identity.value)?.positionMs)
        assertEquals(94000L, scopes.database.progress().get(guest.identity.value)?.positionMs)
        assertEquals(listOf(2L), repository.guestProgress.first().map { it.episode.id })
        assertTrue(server.calls.isEmpty())
        assertEquals(1, scheduled)
    }

    @Test fun actualAtomicWriteFailureLeavesSourceAndIntentUnconsumedAcrossRestart() = runTest {
        val selected = select(position = 0, completed = true)
        val originalBytes = file.readBytes()
        denyWrite = true
        assertTrue(runCatching { repository.transferGuestProgress(selected) }.isFailure)
        assertArrayEquals(originalBytes, file.readBytes())
        assertEquals(selected.sourceToken, scopes.guestDatabase.progress().get(guest.identity.value)?.sourceToken)
        assertTrue(scopes.durable.account("a").progressQueued.isEmpty())
        assertNotNull(scopes.durable.status.value.error)
        denyWrite = false
        restart("a")
        val restored = repository.guestProgress.first().single()
        repository.transferGuestProgress(restored)
        assertEquals(StateProgressChange(StateID("9007199254740993"), 0, true), scopes.durable.account("a").progressQueued.single())
        assertEquals(selected.source, scopes.durable.account("a").guestProgressTransfers[selected.sourceToken])
    }

    @Test fun roomCleanupRollbackRetainsEvidenceAndRestartRetriesWithoutRequeueing() = runTest {
        val selected = select()
        denyCleanup()
        repository.transferGuestProgress(selected)
        assertNotNull(scopes.durable.status.value.error)
        assertEquals(selected.sourceToken, scopes.guestDatabase.progress().get(guest.identity.value)?.sourceToken)
        assertTrue(repository.guestProgress.first().isEmpty())
        scopes.durable.queueProgress("a", StateProgressChange(StateID("9007199254740993"), 12, false))
        repository.transferGuestProgress(selected)
        assertEquals(12, scopes.durable.account("a").progressQueued.single().positionSeconds)
        assertTrue(file.renameTo(File(file.path + ".bak")))
        file.writeText("torn AtomicFile activation")
        restart("a")
        assertEquals(selected.source, scopes.durable.account("a").guestProgressTransfers[selected.sourceToken])
        assertTrue(repository.guestProgress.first().isEmpty())
        allowCleanup()
        repository.cleanupGuestProgress()
        repository.cleanupGuestProgress()
        assertNull(scopes.guestDatabase.progress().get(guest.identity.value))
        assertEquals(12, scopes.durable.account("a").progressQueued.single().positionSeconds)
        assertEquals(selected.source, scopes.durable.account("a").guestProgressTransfers[selected.sourceToken])
    }

    @Test fun newerIdenticalGuestEditHasANewTokenAndSurvivesOldCleanup() = runTest {
        val selected = select()
        denyCleanup()
        repository.transferGuestProgress(selected)
        scopes.switch(null); scopes.resumeSync(null)
        repository.record(guest, 94.seconds, false)
        val newer = scopes.database.progress().get(guest.identity.value)!!
        assertEquals(selected.source.positionMs, newer.positionMs)
        assertEquals(selected.source.updatedAt, newer.updatedAt)
        assertNotEquals(selected.sourceToken, newer.sourceToken)
        scopes.switch("a"); scopes.resumeSync("a")
        allowCleanup()
        repository.cleanupGuestProgress()
        assertEquals(newer, scopes.guestDatabase.progress().get(guest.identity.value))
        assertEquals(newer.sourceToken, repository.guestProgress.first().single().sourceToken)
        assertTrue(runCatching { repository.transferGuestProgress(selected) }.isFailure)
    }

    @Test fun newerGuestEditBeforeCommitRejectsTheStaleSelection() = runTest {
        val selected = select()
        val original = scopes.guestDatabase.progress().get(guest.identity.value)!!
        val newer = ProgressEntity(original.identity, 12000, original.durationMs, false, original.updatedAt)
        scopes.guestDatabase.progress().upsert(newer)
        assertTrue(runCatching { repository.transferGuestProgress(selected) }.isFailure)
        assertTrue(scopes.durable.account("a").progressQueued.isEmpty())
        assertTrue(scopes.durable.account("a").guestProgressTransfers.isEmpty())
        assertEquals(newer, scopes.guestDatabase.progress().get(guest.identity.value))
    }

    @Test fun accountSwitchWhileRoomReadWaitsFencesBothIntentAndConsumption() = runTest {
        val selected = select()
        val entered = CompletableDeferred<Unit>(); val release = CompletableDeferred<Unit>()
        val holding = async {
            scopes.guestDatabase.withTransaction { entered.complete(Unit); release.await() }
        }
        entered.await()
        val transfer = async(start = CoroutineStart.UNDISPATCHED) { runCatching { repository.transferGuestProgress(selected) } }
        scopes.switch("b"); scopes.resumeSync("b")
        release.complete(Unit)
        holding.await()
        assertTrue(transfer.await().isFailure)
        assertTrue(scopes.durable.account("a").progressQueued.isEmpty())
        assertTrue(scopes.durable.account("b").progressQueued.isEmpty())
        assertEquals(selected.sourceToken, scopes.guestDatabase.progress().get(guest.identity.value)?.sourceToken)
        assertTrue(runCatching { repository.transferGuestProgress(selected) }.isFailure)
        scopes.switch("a"); scopes.resumeSync("a")
        assertTrue(runCatching { repository.transferGuestProgress(selected) }.isFailure)
        repository.transferGuestProgress(repository.guestProgress.first().single())
        assertEquals(1, scopes.durable.account("a").progressQueued.size)
        assertTrue(scopes.durable.account("b").progressQueued.isEmpty())
    }

    @Test fun anotherAccountCannotSeeClaimOrCleanUpAnAlreadyConsumedSource() = runTest {
        val selected = select()
        denyCleanup()
        repository.transferGuestProgress(selected)
        scopes.switch("b"); scopes.resumeSync("b")
        allowCleanup()
        assertTrue(repository.guestProgress.first().isEmpty())
        repository.cleanupGuestProgress()
        assertNotNull(scopes.guestDatabase.progress().get(guest.identity.value))
        assertTrue(runCatching { repository.transferGuestProgress(selected.copy(accountId = "b", epoch = scopes.epoch)) }.isFailure)
        assertTrue(scopes.durable.account("b").progressQueued.isEmpty())
        assertTrue(scopes.durable.account("b").guestProgressTransfers.isEmpty())
        restart("a")
        repository.cleanupGuestProgress()
        assertNull(scopes.guestDatabase.progress().get(guest.identity.value))
    }

    @Test fun terminalEraseCannotForgetAClaimBeforeConditionalCleanupAndKeepsNewerGuestEdits() = runTest {
        val selected = select()
        denyCleanup()
        repository.transferGuestProgress(selected)
        scopes.switch("b"); scopes.resumeSync("b")
        assertTrue(runCatching { scopes.erase("a") }.isFailure)
        assertEquals(selected.source, scopes.durable.account("a").guestProgressTransfers[selected.sourceToken])
        allowCleanup()
        val newer = ProgressEntity(guest.identity.value, 12000, null, false, 1000)
        scopes.guestDatabase.progress().upsert(newer)
        scopes.erase("a")
        assertTrue(scopes.durable.account("a").guestProgressTransfers.isEmpty())
        assertTrue(scopes.durable.account("a").progressQueued.isEmpty())
        assertEquals(newer, scopes.guestDatabase.progress().get(guest.identity.value))
        assertEquals(newer.sourceToken, repository.guestProgress.first().single().sourceToken)
    }

    @Test fun signedInProgressIsNeverAnImportSourceAndUnresolvedGuestIdsStayLocal() = runTest {
        val unresolved = guest.copy(id = null, guid = "unresolved")
        repository.record(unresolved, 100.seconds, false)
        scopes.switch("a"); scopes.resumeSync("a")
        repository.record(episode(9), 19.seconds, false)
        val choices = repository.guestProgress.first()
        assertEquals(listOf(unresolved.identity), choices.map { it.episode.identity })
        assertFalse(choices.single().canTransfer)
        assertTrue(runCatching { repository.transferGuestProgress(choices.single()) }.isFailure)
        assertTrue(scopes.durable.account("a").guestProgressTransfers.isEmpty())
        scopes.suspendSync()
        assertTrue(repository.guestProgress.first().isEmpty())
        assertNotNull(scopes.guestDatabase.progress().get(unresolved.identity.value))
    }
}
