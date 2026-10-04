package app.podcst.feature.auth

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.podcst.data.SessionRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class SignInState(
    val email: String = "",
    val code: String = "",
    val codeSent: Boolean = false,
    val working: Boolean = false,
    val signedIn: Boolean = false,
    val error: String? = null,
) {
    val address: String get() = email.trim()
    val canSubmit: Boolean get() = !working && address.isNotEmpty() && (!codeSent || code.isNotEmpty())
}

class SignInViewModel(private val session: SessionRepository) : ViewModel() {
    private val form = MutableStateFlow(SignInState())

    val state: StateFlow<SignInState> = combine(form, session.session) { form, session -> form.copy(error = session.error) }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), form.value)

    init {
        session.dismissError()
    }

    fun setEmail(value: String) = form.update { it.copy(email = value) }

    fun setCode(value: String) = form.update { it.copy(code = value.filter(Char::isDigit).take(CODE_LENGTH)) }

    fun submit() {
        val current = form.value
        if (!current.canSubmit) return
        working {
            if (current.codeSent) {
                val signedIn = session.signIn(current.address, current.code)
                form.update { it.copy(signedIn = signedIn) }
            } else {
                val sent = session.sendCode(current.address)
                form.update { it.copy(codeSent = sent) }
            }
        }
    }

    fun passkey(authenticate: suspend (String) -> String) {
        val current = form.value
        if (current.working) return
        working {
            val signedIn = session.signInWithPasskey(current.address.ifEmpty { null }, authenticate)
            form.update { it.copy(signedIn = signedIn) }
        }
    }

    private fun working(block: suspend () -> Unit) {
        form.update { it.copy(working = true) }
        viewModelScope.launch {
            try {
                block()
            } finally {
                form.update { it.copy(working = false) }
            }
        }
    }

    private companion object {
        const val CODE_LENGTH = 6
    }
}
