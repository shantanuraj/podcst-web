package app.podcst.data

import android.content.Context
import app.podcst.database.PodcstDatabase
import java.security.MessageDigest
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

class Scopes(private val context: Context, accountId: String?) {
    private val state = MutableStateFlow(open(accountId))
    val current: StateFlow<Scope> = state.asStateFlow()
    val database: PodcstDatabase get() = state.value.database

    fun switch(accountId: String?) {
        val previous = state.value
        if (previous.accountId == accountId) return
        state.value = open(accountId)
        previous.database.close()
        if (previous.accountId != null) PodcstDatabase.delete(context, previous.key)
    }

    private fun open(accountId: String?) = Scope(accountId, PodcstDatabase.open(context, Scope.key(accountId)))
}
