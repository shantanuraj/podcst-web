package app.podcst.data

import android.content.Context
import app.podcst.database.PodcstDatabase
import app.podcst.database.domain
import java.security.MessageDigest
import java.io.File
import androidx.room.withTransaction
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

class Scope internal constructor(val accountId: String?, val database: PodcstDatabase) {
    val key: String = key(accountId)

    companion object {
        fun key(accountId: String?): String = accountId?.let {
            MessageDigest.getInstance("SHA-256").digest("account:$it".toByteArray()).joinToString("") { byte -> "%02x".format(byte) }
        } ?: "guest"
    }
}

class Scopes(
    private val context: Context,
    accountId: String?,
    val durable: DurableState = DurableState(File(context.noBackupFilesDir, "durable-state.json")),
) {
    private val guest = lazy { PodcstDatabase.open(context, Scope.key(null)) }
    internal val guestDatabase: PodcstDatabase get() = guest.value
    var retainedMediaIdentities: () -> Set<String> = { emptySet() }
    private val verifiedState = MutableStateFlow(false)
    val verification: StateFlow<Boolean> = verifiedState.asStateFlow()
    val verified: Boolean get() = verifiedState.value
    private val authenticationEpoch = java.util.concurrent.atomic.AtomicLong()
    val epoch: Long get() = authenticationEpoch.get()
    private val state = MutableStateFlow(open(accountId))
    val current: StateFlow<Scope> = state.asStateFlow()
    val database: PodcstDatabase get() = state.value.database

    @Synchronized fun suspendSync() { verifiedState.value = false; authenticationEpoch.incrementAndGet(); durable.activate(null) }
    @Synchronized fun resumeSync(accountId: String?) { if (accountId == current.value.accountId) { verifiedState.value = true; durable.activate(accountId) } }
    @Synchronized internal fun <T> withVerifiedAccount(owner: Scope, epoch: Long, block: () -> T): T {
        check(current.value === owner && owner.accountId != null && verified && this.epoch == epoch) { "Account verification changed; select the guest position again" }
        return block()
    }

    suspend fun checkpoint() { durable.checkpoint() }
    suspend fun erase(accountId: String) {
        check(current.value.accountId != accountId) { "Suspend and leave the erased account first" }
        val transfers = durable.account(accountId).guestProgressTransfers.values
        if (transfers.isNotEmpty()) guestDatabase.withTransaction {
            for (source in transfers) {
                guestDatabase.openHelper.writableDatabase.execSQL("DELETE FROM progress WHERE identity = ? AND sourceToken = ?", arrayOf(source.identity, source.sourceToken))
            }
        }
        durable.erase(accountId)
        PodcstDatabase.delete(context, Scope.key(accountId))
    }

    suspend fun switch(accountId: String?) {
        val previous = state.value
        if (previous.accountId == accountId) return
        suspendSync()
        if (previous.accountId == null) durable.importGuestSource(previous.database.podcasts().subscribed().map { it.domain() })
        val next = open(accountId)
        kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) { next.database.openHelper.writableDatabase }
        if (previous.accountId != null) durable.retainPending(previous.accountId)
        if (previous.accountId != null) previous.database.withTransaction {
            val db = previous.database.openHelper.writableDatabase
            db.execSQL("DELETE FROM charts")
            db.execSQL("DELETE FROM chart_refreshes")
            db.execSQL("DELETE FROM subscriptions")
            val media = retainedMediaIdentities().toList()
            val placeholders = media.joinToString(",") { "?" }
            val retained = if (media.isEmpty()) "" else " AND identity NOT IN ($placeholders) AND COALESCE(mediaReferenceIdentity, identity) NOT IN ($placeholders)"
            db.execSQL("DELETE FROM episodes WHERE identity NOT IN (SELECT identity FROM queue UNION SELECT identity FROM progress UNION SELECT identity FROM stars) AND id IS NOT NULL" + retained, (media + media).toTypedArray())
            db.execSQL("DELETE FROM podcasts WHERE feed NOT IN (SELECT feed FROM episodes) AND id IS NOT NULL")
        }
        state.value = next
        if (previous.accountId != null) previous.database.close()
    }

    fun close() {
        if (current.value.accountId != null) current.value.database.close()
        if (guest.isInitialized()) guest.value.close()
    }

    private fun open(accountId: String?) = Scope(accountId, if (accountId == null) guestDatabase else PodcstDatabase.open(context, Scope.key(accountId)))
}
