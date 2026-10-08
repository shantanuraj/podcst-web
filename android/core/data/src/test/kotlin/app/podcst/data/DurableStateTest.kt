package app.podcst.data

import app.podcst.model.*
import java.io.File
import java.io.IOException
import java.util.UUID
import org.junit.After
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class DurableStateTest {
    private val dir = File(RuntimeEnvironment.getApplication().noBackupFilesDir, UUID.randomUUID().toString()).apply { mkdirs() }
    private val file = File(dir, "state.json")
    private val generation = "17adbd84-d0e4-4e2d-ad9f-b084efee3211"
    private val id = StateID("9007199254740993")
    @After fun clean() { dir.deleteRecursively() }
    private fun open() = DurableState(file).also { it.activate("a") }
    private fun bootstrap(store: DurableState) = store.installProgress("a", StateSnapshot<StateProgressItem>(1, "a", generation, StateRevision("0"), emptyList()))
    private fun snapshot(position: Int, revision: String) = StateSnapshot(1, "a", generation, StateRevision(revision), listOf(StateProgressItem(id, StateProgress(position, false, StateID(revision), null))))
    private fun ack(flight: ProgressFlight, revision: String = "1") = StateAcknowledgement(1, "a", generation, flight.batch.clientId, flight.batch.sequence, StateRevision(revision), listOf(StateProgressResult(id, StateResult.applied)))

    @Test fun lostAckRestartAndOppositeRemoteActionRetireOnlyAfterAuthoritativeRead() {
        val store = open(); bootstrap(store)
        store.queueProgress("a", StateProgressChange(id, 90, false))
        val flight = store.freezeProgress("a").progressFlight!!
        val restarted = open()
        assertEquals(flight, restarted.freezeProgress("a").progressFlight)
        restarted.acknowledgeProgress("a", ack(flight))
        assertEquals(90, restarted.account("a").progressOverlay().getValue(id.value.toLong()).positionSeconds)
        val acknowledged = open()
        acknowledged.installProgress("a", snapshot(12, "2"), listOf(id.value.toLong()))
        assertNull(acknowledged.account("a").progressFlight)
        assertEquals(12, open().account("a").progress[id.value.toLong()]?.positionSeconds)
        assertEquals(1L, open().account("a").progressSequence)
    }

    @Test fun newerIntentDuringFlightSurvivesOldAckAndRead() {
        val store = open(); bootstrap(store)
        store.queueProgress("a", StateProgressChange(id, 90, false))
        val flight = store.freezeProgress("a").progressFlight!!
        store.queueProgress("a", StateProgressChange(id, 0, true))
        store.acknowledgeProgress("a", ack(flight))
        store.installProgress("a", snapshot(12, "2"), listOf(id.value.toLong()))
        assertTrue(open().account("a").progressOverlay().getValue(id.value.toLong()).completed)
        assertEquals("2", store.freezeProgress("a").progressFlight?.batch?.sequence?.value)
    }

    @Test fun failureAtEveryCommitBoundaryPreservesFrozenBytes() {
        val store = open(); bootstrap(store)
        store.queueProgress("a", StateProgressChange(id, 90, false))
        val beforeFreeze = file.readBytes()
        val failing = DurableState(file) { throw IOException("disk full") }
        assertTrue(runCatching { failing.freezeProgress("a") }.isFailure)
        assertArrayEquals(beforeFreeze, file.readBytes())
        val flight = store.freezeProgress("a").progressFlight!!
        val beforeAck = file.readBytes()
        assertTrue(runCatching { DurableState(file) { throw IOException("denied") }.acknowledgeProgress("a", ack(flight)) }.isFailure)
        assertArrayEquals(beforeAck, file.readBytes())
        store.acknowledgeProgress("a", ack(flight))
        val beforeRead = file.readBytes()
        assertTrue(runCatching { DurableState(file) { throw IOException("denied") }.installProgress("a", snapshot(12, "2"), listOf(id.value.toLong())) }.isFailure)
        assertArrayEquals(beforeRead, file.readBytes())
        assertNotNull(open().account("a").progressFlight?.ack)
    }

    @Test fun atomicFileBackupRecoveryAndRealWriteFailureAreNotEmptySuccess() {
        val store = open(); bootstrap(store)
        store.queueProgress("a", StateProgressChange(id, 4, false))
        file.renameTo(File(file.path + ".bak"))
        file.writeText("torn write")
        assertEquals(4, open().account("a").progressOverlay().getValue(id.value.toLong()).positionSeconds)
        val parentFile = File(dir, "not-directory").apply { writeText("preserve") }
        val denied = DurableState(File(parentFile, "state"))
        assertTrue(runCatching { denied.queueProgress("a", StateProgressChange(id, 4, false)) }.isFailure)
        assertEquals("preserve", parentFile.readText())
        assertNotNull(denied.status.value.error)
    }

    @Test fun generationAndOrderedAckMismatchNeverResetStream() {
        val store = open(); bootstrap(store)
        store.queueProgress("a", StateProgressChange(id, 10, false))
        val flight = store.freezeProgress("a").progressFlight!!
        val bytes = file.readBytes()
        assertTrue(runCatching { store.acknowledgeProgress("a", ack(flight).copy(results = listOf(StateProgressResult(StateID("1"), StateResult.applied)))) }.isFailure)
        assertTrue(runCatching { store.installProgress("a", snapshot(12, "2").copy(generation = UUID.randomUUID().toString()), listOf(id.value.toLong())) }.isFailure)
        assertArrayEquals(bytes, file.readBytes())
        assertEquals(flight, open().account("a").progressFlight)
    }

    @Test fun followsUnionConsumesOnlyGuestIntentAtomicallyAcrossAccountsAndRestart() {
        val guest = Podcast(id = 1, feed = "https://guest.test/rss", title = "Guest")
        val store = open()
        store.guestFollow(guest, true)
        store.installFollows("a", StateSnapshot(1, "a", generation, StateRevision("0"), emptyList()))
        val failing = DurableState(file) { throw IOException("full") }
        assertTrue(runCatching { failing.unionGuest("a", listOf(guest)) }.isFailure)
        assertEquals(listOf(guest), open().guestFollows())
        store.unionGuest("a", listOf(guest))
        val restarted = open()
        restarted.unionGuest("a", listOf(guest))
        assertEquals(1, restarted.account("a").followQueued.size)
        restarted.activate("b")
        assertFalse(restarted.status.value.pending)
        assertTrue(restarted.account("b").followQueued.isEmpty())
        restarted.activate("a")
        assertTrue(restarted.status.value.pending)
        restarted.erase("a")
        assertTrue(open().account("a").followQueued.isEmpty())
    }

    @Test fun followsLostAckCannotResurrectAndNewerUnfollowRemains() {
        val store = open()
        store.installFollows("a", StateSnapshot(1, "a", generation, StateRevision("0"), emptyList()))
        store.queueFollow("a", StateFollowChange(id, true))
        val flight = store.freezeFollows("a").followFlight!!
        assertEquals(flight, open().freezeFollows("a").followFlight)
        store.acknowledgeFollows("a", StateAcknowledgement(1, "a", generation, flight.batch.clientId, flight.batch.sequence, StateRevision("1"), listOf(StateFollowResult(id, StateResult.applied))))
        assertTrue(store.account("a").followed().contains(id.value.toLong()))
        store.installFollows("a", StateSnapshot(1, "a", generation, StateRevision("2"), emptyList()))
        assertTrue(open().account("a").followed().isEmpty())
    }

    @Test fun corruptSourceStaysBlockedAndByteIdentical() {
        file.writeText("{}")
        val store = open()
        assertTrue(store.status.value.blocked)
        assertTrue(runCatching { store.queueProgress("a", StateProgressChange(id, 10, false)) }.isFailure)
        assertEquals("{}", file.readText())
    }
}
