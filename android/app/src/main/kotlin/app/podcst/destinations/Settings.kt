package app.podcst.destinations

import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation3.runtime.EntryProviderScope
import androidx.navigation3.runtime.NavKey
import app.podcst.AppGraph
import app.podcst.BuildConfig
import app.podcst.Navigator
import app.podcst.SettingsRoute
import app.podcst.feature.auth.rememberPasskeys
import app.podcst.feature.settings.SettingsScreen
import app.podcst.feature.settings.SettingsViewModel

fun EntryProviderScope<NavKey>.settingsEntries(graph: AppGraph, navigator: Navigator) {
    entry<SettingsRoute> {
        val passkeys = rememberPasskeys()
        SettingsScreen(
            viewModel { SettingsViewModel(graph.session, graph.preferences, graph.library, graph.account) },
            version = BuildConfig.VERSION_NAME,
            onBack = { navigator.back() },
            onSignIn = { navigator.signIn = true },
            createPasskey = passkeys::create,
        )
    }
}
