package app.podcst.data

import android.content.Context
import android.util.AtomicFile
import app.podcst.model.AccountDeletion
import app.podcst.model.AccountDeletion.Cleanup
import app.podcst.model.DeletionOutcome
import app.podcst.network.PodcstApi
import java.io.File
import java.time.Instant
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

class AccountDeletionRepository(context: Context, private val api: PodcstApi, private val session: SessionRepository) {
    private val file = AtomicFile(File(context.noBackupFilesDir, "account-deletions.json"))
    private val json = Json
    private var readable = true
    private val errors = MutableStateFlow<String?>(null)
    val error = errors.asStateFlow()
    private val saved = MutableStateFlow(read())
    val records = saved.asStateFlow()
    private val working = MutableStateFlow(false)
    val busy = working.asStateFlow()
    var suspend: (suspend (String) -> Unit)? = null
    var clean: (suspend (String, Cleanup) -> Unit)? = null

    fun blocked(account: String) = !readable || saved.value.any { it.accountId == account }

    private fun read(): List<AccountDeletion> = try {
        if (!file.baseFile.exists() && !File(file.baseFile.path + ".bak").exists()) emptyList()
        else json.decodeFromString<List<AccountDeletion>>(file.readFully().decodeToString()).also { records ->
            require(records.map { it.accountId }.distinct().size == records.size)
            records.forEach { it.validate() }
        }
    } catch (failure: Exception) {
        readable = false
        errors.value = "Saved deletion status could not be read. Retained data has been preserved."
        emptyList()
    }

    private fun write(records: List<AccountDeletion>) {
        check(readable) { "Deletion storage unavailable" }
        val data = json.encodeToString(records).encodeToByteArray()
        val output = file.startWrite()
        try { output.write(data); file.finishWrite(output) }
        catch (failure: Exception) { file.failWrite(output); throw failure }
        check(file.readFully().contentEquals(data)) { "Deletion status was not saved" }
        saved.value = records
    }

    private fun save(record: AccountDeletion) = write(saved.value.filterNot { it.accountId == record.accountId } + record)

    private suspend fun attempt(work: suspend () -> Unit) {
        if (working.value) return
        working.value = true
        errors.value = null
        try { session.serializeDeletion { work() } }
        catch (cancelled: CancellationException) { throw cancelled }
        catch (failure: Exception) { errors.value = failure.message ?: "Unable to complete deletion. Try again." }
        finally { working.value = false }
    }

    suspend fun prepare(account: String) = attempt {
        val existing = saved.value.firstOrNull { it.accountId == account }
        check(readable && session.verifiedAccount == account && (existing == null || (existing.outcome == "unknown" && existing.cleanup == null))) { "Sign in to the same account again" }
        requireNotNull(suspend)(account)
        val record = existing ?: AccountDeletion(account)
        save(record)
        val preparation = api.prepareDeletion(account).also { it.validate(account) }
        save(record.copy(preparation = preparation, outcome = null))
    }

    suspend fun cancel(account: String) = attempt {
        val record = saved.value.first { it.accountId == account }
        check(record.outcome == null) { "Submitted deletion cannot be cancelled" }
        write(saved.value.filterNot { it.accountId == account })
        session.resumeAfterDeletionCancellation(account)
    }

    suspend fun submit(account: String, code: String) = attempt {
        check(session.verifiedAccount == account) { "Sign in to the same account again" }
        val record = saved.value.first { it.accountId == account }
        val preparation = requireNotNull(record.preparation)
        check(record.cleanup == null && record.outcome in setOf(null, "unknown") && Instant.parse(preparation.proofExpiresAt) > Instant.now() && code.matches(Regex("[0-9]{6}"))) { "A valid deletion code is required" }
        val pending = record.copy(outcome = "unknown")
        save(pending)
        try {
            val outcome = api.submitDeletion(preparation.operationId, code)
            check(outcome.operationId == preparation.operationId && outcome.status != "unknown") { "Invalid deletion confirmation" }
            apply(outcome, pending)
        } catch (failure: app.podcst.network.ApiException) {
            if (failure.status == 422) save(record.copy(outcome = null))
            throw failure
        }
    }

    suspend fun check(account: String) = attempt {
        val record = saved.value.first { it.accountId == account }
        if (record.outcome == "completed") cleanup(record)
        else {
            val preparation = record.preparation
            val receipt = preparation?.receipt
            if (record.outcome != null && preparation != null && receipt != null && Instant.parse(preparation.expiresAt) > Instant.now())
                apply(api.deletionStatus(receipt), record)
        }
    }

    suspend fun resume() {
        saved.value.filter { it.outcome != null && it.cleanup != Cleanup.Complete }.forEach { check(it.accountId) }
    }

    private suspend fun apply(outcome: DeletionOutcome, record: AccountDeletion) {
        outcome.validate()
        val next = record.copy(outcome = outcome.status, cleanup = if (outcome.status == "completed") Cleanup.Retire else null,
            preparation = if (outcome.status == "completed") record.preparation?.copy(receipt = null) else record.preparation)
        save(next)
        if (next.cleanup != null) cleanup(next)
    }

    private suspend fun cleanup(record: AccountDeletion) {
        var next = record
        while (next.cleanup != null && next.cleanup != Cleanup.Complete) {
            val step = requireNotNull(next.cleanup)
            requireNotNull(clean)(next.accountId, step)
            next = next.copy(cleanup = Cleanup.entries[step.ordinal + 1])
            save(next)
        }
    }
}
