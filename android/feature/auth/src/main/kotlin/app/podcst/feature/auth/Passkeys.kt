package app.podcst.feature.auth

import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalContext
import androidx.credentials.CreatePublicKeyCredentialRequest
import androidx.credentials.CreatePublicKeyCredentialResponse
import androidx.credentials.CredentialManager
import androidx.credentials.GetCredentialRequest
import androidx.credentials.GetPublicKeyCredentialOption
import androidx.credentials.PublicKeyCredential
import androidx.credentials.exceptions.CreateCredentialCancellationException
import androidx.credentials.exceptions.GetCredentialCancellationException
import androidx.credentials.exceptions.NoCredentialException
import kotlin.coroutines.cancellation.CancellationException

class Passkeys internal constructor(private val context: Context) {
    suspend fun authenticate(requestJson: String): String {
        val activity = context.activity
        return try {
            val response = CredentialManager.create(activity)
                .getCredential(activity, GetCredentialRequest(listOf(GetPublicKeyCredentialOption(requestJson))))
            (response.credential as PublicKeyCredential).authenticationResponseJson
        } catch (cancelled: GetCredentialCancellationException) {
            throw CancellationException(cancelled.message)
        } catch (missing: NoCredentialException) {
            throw IllegalStateException(activity.getString(R.string.no_passkey), missing)
        }
    }

    suspend fun create(requestJson: String): String {
        val activity = context.activity
        return try {
            val response = CredentialManager.create(activity).createCredential(activity, CreatePublicKeyCredentialRequest(requestJson))
            (response as CreatePublicKeyCredentialResponse).registrationResponseJson
        } catch (cancelled: CreateCredentialCancellationException) {
            throw CancellationException(cancelled.message)
        }
    }
}

@Composable
fun rememberPasskeys(): Passkeys {
    val context = LocalContext.current
    return remember(context) { Passkeys(context) }
}

private val Context.activity: Activity
    get() = generateSequence(this) { (it as? ContextWrapper)?.baseContext }.filterIsInstance<Activity>().first()
