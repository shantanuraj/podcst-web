package app.podcst.destinations

import androidx.compose.runtime.getValue
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation3.runtime.EntryProviderScope
import androidx.navigation3.runtime.NavKey
import app.podcst.AppGraph
import app.podcst.EpisodeRoute
import app.podcst.Navigator
import app.podcst.PodcastRoute
import app.podcst.designsystem.EpisodeActions
import app.podcst.feature.player.ShareRequest
import app.podcst.feature.podcast.EpisodeScreen
import app.podcst.feature.podcast.EpisodeViewModel
import app.podcst.feature.podcast.PodcastScreen
import app.podcst.feature.podcast.PodcastViewModel

fun EntryProviderScope<NavKey>.podcastEntries(graph: AppGraph, navigator: Navigator, actions: EpisodeActions, share: (ShareRequest) -> Unit) {
    entry<PodcastRoute> { route ->
        val viewModel = viewModel {
            PodcastViewModel(route.podcast, graph.catalog, graph.library, graph.progress, graph.stars, graph.downloads, graph.playback)
        }
        val state by viewModel.state.collectAsStateWithLifecycle()
        val query by viewModel.query.collectAsStateWithLifecycle()
        PodcastScreen(state, query, viewModel, actions, onBack = { navigator.back() }, onShare = { share(ShareRequest(state.podcast)) })
    }
    entry<EpisodeRoute> { route ->
        val viewModel = viewModel {
            EpisodeViewModel(route.episode, graph.catalog, graph.progress, graph.stars, graph.downloads, graph.playback)
        }
        val state by viewModel.state.collectAsStateWithLifecycle()
        EpisodeScreen(state, viewModel, actions, onBack = { navigator.back() }, onOpenPodcast = { navigator.podcast(state.episode.podcast) })
    }
}

