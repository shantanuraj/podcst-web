package app.podcst.feature.settings

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Checkbox
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.text.input.KeyboardType
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.podcst.data.AccountDeletionRepository
import app.podcst.model.AccountDeletion
import app.podcst.model.User
import kotlinx.coroutines.launch

@Composable
fun AccountDeletionDialog(deletion: AccountDeletionRepository, user: User?, onSignIn: () -> Unit, onDismiss: () -> Unit) {
    val records by deletion.records.collectAsStateWithLifecycle()
    val busy by deletion.busy.collectAsStateWithLifecycle()
    val error by deletion.error.collectAsStateWithLifecycle()
    val scope = rememberCoroutineScope()
    val links = LocalUriHandler.current
    var code by remember { mutableStateOf("") }
    var confirmed by remember { mutableStateOf(false) }
    LaunchedEffect(user?.id, records.firstOrNull { it.accountId == user?.id }?.preparation?.operationId) { code = ""; confirmed = false }
    LaunchedEffect(deletion) { deletion.resume() }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Delete account") },
        text = { Column(Modifier.verticalScroll(rememberScrollState())) {
            Text("Permanently delete your Podcst account, credentials, follows, listening history, Starred episodes, preferences and private feeds. This cannot be undone.")
            Text("This device removes the account’s saved data after confirmation. Other devices and exported copies may retain data. Publisher subscriptions are unaffected.")
            TextButton(onClick = { links.openUri("https://www.podcst.app/privacy#deletion") }) { Text("Data retention details") }
            if (user != null && !deletion.blocked(user.id)) {
                TextButton(enabled = !busy, onClick = { scope.launch { deletion.prepare(user.id) } }) { Text("Send deletion code") }
            } else if (user == null) {
                TextButton(onClick = onSignIn) { Text("Sign in to delete your account") }
            }
            records.forEach { record ->
                Text(when {
                    record.cleanup == AccountDeletion.Cleanup.Complete -> "Your account has been deleted and its saved data removed from this device."
                    record.outcome == "completed" -> "Your account has been deleted. Cleanup on this device still needs to finish."
                    record.outcome == "pending" -> "Your deletion request has been accepted. Check for completion."
                    record.outcome == "unknown" -> "Deletion is not confirmed. Check its status. Your saved data is retained."
                    else -> "Enter the deletion code sent to your account email. It expires after five minutes."
                })
                if (user?.id == record.accountId && record.preparation != null && record.cleanup == null && record.outcome in setOf(null, "unknown")) {
                    OutlinedTextField(value = code, onValueChange = { if (it.length <= 6) code = it }, label = { Text("Deletion code") }, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword), enabled = !busy)
                    Row {
                        Checkbox(checked = confirmed, onCheckedChange = { confirmed = it }, enabled = !busy)
                        Text("Permanently delete ${user.email} and its data")
                    }
                    TextButton(enabled = !busy && confirmed && code.matches(Regex("[0-9]{6}")), onClick = { scope.launch { deletion.submit(record.accountId, code) } }) { Text("Delete account permanently") }
                }
                if (record.outcome == null) {
                    TextButton(enabled = !busy, onClick = { scope.launch { deletion.cancel(record.accountId) } }) { Text("Cancel") }
                } else if (record.cleanup != AccountDeletion.Cleanup.Complete) {
                    TextButton(enabled = !busy, onClick = { scope.launch { deletion.check(record.accountId) } }) { Text(if (record.outcome == "completed") "Retry cleanup" else "Check deletion status") }
                }
                if (record.outcome == "unknown" && user?.id == record.accountId) {
                    TextButton(enabled = !busy, onClick = { scope.launch { deletion.prepare(record.accountId) } }) { Text("Request a new deletion code") }
                }
            }
            error?.let { Text(it) }
        } },
        confirmButton = { TextButton(onClick = onDismiss) { Text("Done") } },
    )
}
