package app.podcst.destinations

import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.runtime.getValue
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation3.runtime.EntryProviderScope
import androidx.navigation3.runtime.NavKey
import app.podcst.AppGraph
import app.podcst.Navigator
import app.podcst.QueueRoute
import app.podcst.designsystem.EpisodeActions
import app.podcst.feature.player.PlayerViewModel
import app.podcst.feature.player.QueueScreen

fun EntryProviderScope<NavKey>.playerEntries(graph: AppGraph, navigator: Navigator, actions: EpisodeActions, player: PlayerViewModel) {
    entry<QueueRoute> {
        val state by player.state.collectAsStateWithLifecycle()
        QueueScreen(state, player, actions, onOpenPlayer = { navigator.nowPlaying = true }, contentPadding = PaddingValues())
    }
}
