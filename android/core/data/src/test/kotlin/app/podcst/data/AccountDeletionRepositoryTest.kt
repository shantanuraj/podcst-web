package app.podcst.data

import app.podcst.model.AccountDeletion
import app.podcst.model.DeletionPreparation
import app.podcst.network.testing.FakeServer
import app.podcst.network.testing.Reply
import java.io.File
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class AccountDeletionRepositoryTest {
    private val application = RuntimeEnvironment.getApplication()
    private val file get() = File(application.noBackupFilesDir, "account-deletions.json")
    private val fixtures = Json.parseToJsonElement(File(System.getProperty("podcst.contracts"), "deletion/fixtures.json").readText()).jsonObject
    private val preparation get() = fixtures.getValue("prepared").toString().replace("\"a\"", "\"u1\"")

    @Before fun reset() { file.delete(); File(file.path + ".bak").delete() }

    @Test fun sharedPreparationRejectsAnotherAccount() {
        val value = Json.decodeFromString<DeletionPreparation>(preparation)
        value.validate("u1")
        assertTrue(runCatching { value.validate("other") }.isFailure)
    }

    @Test fun lostResponseSurvivesRestartAndCleansOnlyAfterConfirmation() = runTest {
        var checking = "statusUnknown"
        val server = FakeServer { call -> when {
            call.path == "/api/auth/session" -> Reply(FakeServer.USER)
            call.path.endsWith("/status") -> Reply(fixtures.getValue(checking).toString())
            call.body.contains("confirmed") -> Reply("{}", 503)
            else -> Reply(preparation)
        } }
        val session = SessionRepository(application, server.api)
        session.restore()
        val deletion = AccountDeletionRepository(application, server.api, session)
        deletion.suspend = {}
        val steps = mutableListOf<AccountDeletion.Cleanup>()
        deletion.clean = { _, step -> steps += step }
        awaitPrepare(deletion)
        deletion.submit("u1", "123456")
        assertEquals("unknown", deletion.records.value.single().outcome)
        assertTrue(steps.isEmpty())
        assertFalse(file.readText().contains("123456"))
        val restarted = AccountDeletionRepository(application, server.api, session)
        restarted.clean = { account, step -> assertEquals("u1", account); steps += step }
        restarted.resume()
        assertTrue(steps.isEmpty())
        checking = "statusCompleted"
        restarted.resume()
        assertEquals(AccountDeletion.Cleanup.Complete, restarted.records.value.single().cleanup)
        assertEquals(AccountDeletion.Cleanup.entries.dropLast(1), steps)
        assertNull(restarted.records.value.single().preparation?.receipt)
    }

    @Test fun cleanupFailureKeepsConfirmationAndResumesOfflineAtFailedStep() = runTest {
        var statusCalls = 0
        val server = FakeServer { call -> when {
            call.path == "/api/auth/session" -> Reply(FakeServer.USER)
            call.path.endsWith("/status") -> { statusCalls++; Reply("{}", 503) }
            call.body.contains("confirmed") -> Reply(fixtures.getValue("completed").toString())
            else -> Reply(preparation)
        } }
        val session = SessionRepository(application, server.api)
        session.restore()
        val deletion = AccountDeletionRepository(application, server.api, session)
        deletion.suspend = {}
        deletion.clean = { _, step -> check(step != AccountDeletion.Cleanup.Media) { "Storage failure" } }
        awaitPrepare(deletion)
        deletion.submit("u1", "123456")
        assertEquals("completed", deletion.records.value.single().outcome)
        assertEquals(AccountDeletion.Cleanup.Media, deletion.records.value.single().cleanup)
        val retried = mutableListOf<AccountDeletion.Cleanup>()
        val restarted = AccountDeletionRepository(application, server.api, session)
        restarted.clean = { _, step -> retried += step }
        restarted.resume()
        assertEquals(AccountDeletion.Cleanup.entries.slice(2..3), retried)
        assertEquals(0, statusCalls)
    }

    @Test fun invalidProofCanBeCancelledButUnauthorizedSubmissionCannot() = runTest {
        var status = 422
        val server = FakeServer { call -> when {
            call.path == "/api/auth/session" -> Reply(FakeServer.USER)
            call.body.contains("confirmed") -> Reply("""{"message":"Refused"}""", status)
            else -> Reply(preparation)
        } }
        val session = SessionRepository(application, server.api)
        session.restore()
        val deletion = AccountDeletionRepository(application, server.api, session)
        deletion.suspend = {}
        awaitPrepare(deletion)
        deletion.submit("u1", "123456")
        assertNull(deletion.records.value.single().outcome)
        deletion.cancel("u1")
        assertTrue(deletion.records.value.isEmpty())
        awaitPrepare(deletion)
        status = 401
        deletion.submit("u1", "123456")
        deletion.cancel("u1")
        assertEquals("unknown", deletion.records.value.single().outcome)
    }

    @Test fun corruptDeletionFileIsPreservedAndBlocksAccountWork() = runTest {
        file.writeText("not json")
        val server = FakeServer { Reply(FakeServer.USER) }
        val session = SessionRepository(application, server.api)
        session.restore()
        val deletion = AccountDeletionRepository(application, server.api, session)
        assertTrue(deletion.blocked("u1"))
        deletion.prepare("u1")
        assertEquals("not json", file.readText())
    }

    @Test fun malformedCompletionCannotAuthorizeCleanup() = runTest {
        val content = """[{"accountId":"u1","outcome":"completed","cleanup":"Retire"}]"""
        file.writeText(content)
        val server = FakeServer { Reply(FakeServer.USER) }
        val session = SessionRepository(application, server.api)
        val deletion = AccountDeletionRepository(application, server.api, session)
        deletion.clean = { _, _ -> fail("Malformed confirmation must not erase data") }
        deletion.resume()
        assertTrue(deletion.blocked("u1"))
        assertEquals(content, file.readText())
    }

    @Test fun unknownSubmissionRequiresServerPreparationBeforeItCanBeCancelled() = runTest {
        var refusePreparation = false
        val server = FakeServer { call -> when {
            call.path == "/api/auth/session" -> Reply(FakeServer.USER)
            call.body.contains("confirmed") -> Reply("{}", 503)
            refusePreparation -> Reply("{}", 401)
            else -> Reply(preparation)
        } }
        val session = SessionRepository(application, server.api)
        session.restore()
        val deletion = AccountDeletionRepository(application, server.api, session)
        deletion.suspend = {}
        awaitPrepare(deletion)
        deletion.submit("u1", "123456")
        refusePreparation = true
        deletion.prepare("u1")
        assertEquals("unknown", deletion.records.value.single().outcome)
        refusePreparation = false
        awaitPrepare(deletion)
        assertNull(deletion.records.value.single().outcome)
        deletion.cancel("u1")
        assertTrue(deletion.records.value.isEmpty())
    }

    private suspend fun awaitPrepare(deletion: AccountDeletionRepository) {
        deletion.prepare("u1")
        assertNull(deletion.error.value)
        assertNotNull(deletion.records.value.single().preparation)
    }
}
