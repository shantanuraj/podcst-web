package app.podcst.destinations

import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.rememberViewModelStoreOwner
import androidx.lifecycle.viewmodel.compose.viewModel
import app.podcst.AppGraph
import app.podcst.feature.auth.OnboardingScreen
import app.podcst.feature.auth.OnboardingViewModel
import app.podcst.feature.auth.SignInSheet
import app.podcst.feature.auth.SignInViewModel
import app.podcst.feature.auth.rememberPasskeys

@Composable
fun Onboarding(graph: AppGraph) {
    val viewModel = viewModel(rememberViewModelStoreOwner()) { OnboardingViewModel(graph.catalog, graph.preferences, graph.session) }
    val state by viewModel.state.collectAsStateWithLifecycle()
    val passkeys = rememberPasskeys()
    OnboardingScreen(
        state,
        onRegion = viewModel::setRegion,
        onPasskey = { viewModel.signIn(passkeys::authenticate) },
        onStart = viewModel::start,
    )
}

@Composable
fun SignIn(graph: AppGraph, onDismiss: () -> Unit) {
    val viewModel = viewModel(rememberViewModelStoreOwner()) { SignInViewModel(graph.session) }
    val state by viewModel.state.collectAsStateWithLifecycle()
    val passkeys = rememberPasskeys()
    SignInSheet(
        state,
        onEmail = viewModel::setEmail,
        onCode = viewModel::setCode,
        onPasskey = { viewModel.passkey(passkeys::authenticate) },
        onSubmit = viewModel::submit,
        onDismiss = onDismiss,
    )
}
