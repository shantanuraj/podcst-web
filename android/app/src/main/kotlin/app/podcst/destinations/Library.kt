package app.podcst.destinations

import android.os.StatFs
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.compose.LifecycleResumeEffect
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation3.runtime.EntryProviderScope
import androidx.navigation3.runtime.NavKey
import app.podcst.AppGraph
import app.podcst.EpisodeListRoute
import app.podcst.LibraryRoute
import app.podcst.Navigator
import app.podcst.SettingsRoute
import app.podcst.designsystem.EpisodeActions
import app.podcst.feature.library.EpisodeListScreen
import app.podcst.feature.library.EpisodeListViewModel
import app.podcst.feature.library.LibraryScreen
import app.podcst.feature.library.LibraryViewModel
import app.podcst.feature.library.Storage
import app.podcst.model.Episode
import kotlinx.coroutines.launch
import app.podcst.feature.library.AddToListSheet as ListSheet

fun EntryProviderScope<NavKey>.libraryEntries(graph: AppGraph, navigator: Navigator, actions: EpisodeActions) {
    entry<LibraryRoute> {
        val model = viewModel { LibraryViewModel(graph.library, graph.progress, graph.stars, graph.downloads, graph.playback) }
        val state by model.state.collectAsStateWithLifecycle()
        LifecycleResumeEffect(model) {
            model.refreshProgress()
            onPauseOrDispose { }
        }
        LibraryScreen(
            state,
            actions,
            onRefresh = model::refresh,
            onRecheck = model::recheckContent,
            onSettings = { navigator.push(SettingsRoute) },
            onList = { list -> navigator.push(EpisodeListRoute(list)) },
            onPodcast = navigator::podcast,
            onRemoveUnavailable = model::removeUnavailable,
            onTransferGuestProgress = model::transferGuestProgress,
        )
    }
    entry<EpisodeListRoute> { route ->
        val media = LocalContext.current.noBackupFilesDir
        val model = viewModel {
            EpisodeListViewModel(
                route.list,
                graph.catalog,
                graph.library,
                graph.progress,
                graph.stars,
                graph.downloads,
                graph.playback,
                storage = { StatFs(media.path).let { Storage(graph.media.usedBytes(), it.availableBytes, it.totalBytes) } },
            )
        }
        val state by model.state.collectAsStateWithLifecycle()
        LifecycleResumeEffect(model) {
            model.refreshProgress()
            onPauseOrDispose { }
        }
        EpisodeListScreen(state, model, actions, onBack = { navigator.back() })
    }
}

@Composable
fun AddToListSheet(graph: AppGraph, episode: Episode, onDismiss: () -> Unit) {
    val starred by graph.stars.episodeIds.collectAsStateWithLifecycle(emptySet())
    ListSheet(
        episode,
        starred = episode.id in starred,
        starredCount = starred.size,
        onStar = { star -> graph.scope.launch { if (star) graph.stars.star(episode) else graph.stars.unstar(episode) } },
        onDismiss = onDismiss,
    )
}
