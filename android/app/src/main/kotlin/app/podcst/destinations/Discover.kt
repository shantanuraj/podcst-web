package app.podcst.destinations

import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation3.runtime.EntryProviderScope
import androidx.navigation3.runtime.NavKey
import app.podcst.AppGraph
import app.podcst.DiscoverRoute
import app.podcst.Navigator
import app.podcst.SearchRoute
import app.podcst.SettingsRoute
import app.podcst.designsystem.EpisodeActions
import app.podcst.feature.discover.Discover
import app.podcst.feature.discover.DiscoverViewModel
import app.podcst.feature.discover.Search
import app.podcst.feature.discover.SearchViewModel

fun EntryProviderScope<NavKey>.discoverEntries(graph: AppGraph, navigator: Navigator, actions: EpisodeActions) {
    entry<DiscoverRoute> {
        val context = LocalContext.current
        Discover(
            viewModel { DiscoverViewModel(graph.catalog, graph.library, graph.preferences, graph.session) },
            onSearch = { navigator.push(SearchRoute) },
            onAccount = { navigator.push(SettingsRoute) },
            onPodcast = navigator::podcast,
            onPlay = { podcast ->
                val episode = graph.catalog.latest(podcast) ?: error(context.getString(app.podcst.feature.discover.R.string.no_episodes))
                actions.play(episode)
            },
        )
    }
    entry<SearchRoute> {
        Search(
            viewModel { SearchViewModel(graph.catalog, graph.preferences, graph.session) },
            onBack = { navigator.back() },
            onSignIn = { navigator.signIn = true },
            onPodcast = navigator::podcast,
        )
    }
}
