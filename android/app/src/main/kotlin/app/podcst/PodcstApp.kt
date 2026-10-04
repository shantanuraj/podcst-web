package app.podcst

import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.isImeVisible
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.navigation3.rememberViewModelStoreNavEntryDecorator
import androidx.navigation3.runtime.NavKey
import androidx.navigation3.runtime.entryProvider
import androidx.navigation3.runtime.rememberSaveableStateHolderNavEntryDecorator
import androidx.navigation3.ui.NavDisplay
import app.podcst.designsystem.Format
import app.podcst.designsystem.LocalToaster
import app.podcst.designsystem.Podcst
import app.podcst.designsystem.PodcstIcons
import app.podcst.designsystem.ToastAction
import app.podcst.designsystem.ToastHost
import app.podcst.designsystem.ToastMessage
import app.podcst.designsystem.Toaster
import app.podcst.destinations.AddToListSheet
import app.podcst.destinations.Onboarding
import app.podcst.destinations.SignIn
import app.podcst.destinations.discoverEntries
import app.podcst.destinations.libraryEntries
import app.podcst.destinations.podcastEntries
import app.podcst.destinations.playerEntries
import app.podcst.destinations.settingsEntries
import app.podcst.feature.player.MiniPlayer
import app.podcst.feature.player.NowPlayingScreen
import app.podcst.feature.player.PlayerViewModel
import app.podcst.model.Episode

@Composable
fun PodcstApp(graph: AppGraph) {
    val onboarded by graph.preferences.onboarded.collectAsStateWithLifecycle(initialValue = null)
    Box(Modifier.fillMaxSize().background(Podcst.colors.paper)) {
        when (onboarded) {
            null -> Unit
            false -> Onboarding(graph)
            true -> Shell(graph)
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun Shell(graph: AppGraph) {
    val context = LocalContext.current
    val navigator = rememberNavigator()
    val toaster = remember { Toaster() }
    var listTarget by remember { mutableStateOf<Episode?>(null) }
    val actions = rememberEpisodeActions(graph, navigator, toaster) { listTarget = it }
    val player: PlayerViewModel = viewModel { PlayerViewModel(graph.playback, graph.stars, graph.downloads) }
    val playerState by player.state.collectAsStateWithLifecycle()
    val openPodcast: (Episode) -> Unit = { navigator.podcast(it.podcast) }
    val stop = {
        val state = graph.playback.state.value
        val saved = Format.clock(state.position)
        val left = state.queue.upNext.size
        navigator.nowPlaying = false
        graph.playback.stop()
        toaster.show(
            ToastMessage(
                context.getString(R.string.playback_stopped),
                context.getString(R.string.saved_at, saved, left),
                actions = listOf(ToastAction(context.getString(R.string.undo)) { graph.playback.reopen() }),
            ),
        )
    }

    BackHandler(enabled = navigator.nowPlaying || navigator.signIn) { navigator.back() }

    val handler = remember(graph) { IncomingHandler(context, graph) }
    LaunchedEffect(graph) {
        graph.incoming.collect { incoming ->
            graph.incoming.resetReplayCache()
            handler.handle(incoming, navigator, toaster)
        }
    }

    CompositionLocalProvider(LocalToaster provides toaster) {
        Box(Modifier.fillMaxSize().background(Podcst.colors.paper)) {
            val typing = WindowInsets.isImeVisible
            Column(Modifier.fillMaxSize()) {
                Box(Modifier.weight(1f).fillMaxWidth().imePadding()) {
                    NavDisplay(
                        backStack = navigator.stack,
                        onBack = { navigator.back() },
                        entryDecorators = listOf(
                            rememberSaveableStateHolderNavEntryDecorator(),
                            rememberViewModelStoreNavEntryDecorator(),
                        ),
                        entryProvider = entryProvider<NavKey> {
                            discoverEntries(graph, navigator)
                            podcastEntries(graph, navigator, actions)
                            libraryEntries(graph, navigator, actions)
                            playerEntries(graph, navigator, actions, player)
                            settingsEntries(graph, navigator)
                        },
                    )
                }
                AnimatedVisibility(playerState.player.active && !typing) {
                    MiniPlayer(
                        playerState,
                        actions,
                        onOpen = { navigator.nowPlaying = true },
                        onToggle = player::toggle,
                        onNext = player::next,
                        onPrevious = player::previous,
                        onStop = stop,
                    )
                }
                AnimatedVisibility(!typing) { Bar(navigator) }
            }
            ToastHost(toaster, Modifier.align(Alignment.BottomCenter).padding(bottom = if (playerState.player.active) 160.dp else 96.dp))
            AnimatedVisibility(
                navigator.nowPlaying && playerState.episode != null,
                enter = slideInVertically(tween(320)) { it } + fadeIn(),
                exit = slideOutVertically(tween(260)) { it } + fadeOut(),
            ) {
                NowPlayingScreen(playerState, player, actions, onDismiss = { navigator.nowPlaying = false }, onStop = stop, onOpenPodcast = openPodcast)
            }
            listTarget?.let { episode -> AddToListSheet(graph, episode, onDismiss = { listTarget = null }) }
            if (navigator.signIn) SignIn(graph, onDismiss = { navigator.signIn = false })
        }
    }
}

@Composable
private fun Bar(navigator: Navigator) {
    val colors = Podcst.colors
    NavigationBar(containerColor = colors.navigation, contentColor = colors.secondary) {
        Tab.entries.forEach { tab ->
            val selected = navigator.tab == tab
            NavigationBarItem(
                selected = selected,
                onClick = { navigator.select(tab) },
                icon = { Icon(tab.icon, null, Modifier.size(22.dp)) },
                label = { Text(stringResource(tab.label), style = if (selected) Podcst.type.navigation.copy(fontWeight = androidx.compose.ui.text.font.FontWeight.SemiBold) else Podcst.type.navigation) },
                colors = NavigationBarItemDefaults.colors(
                    selectedIconColor = colors.accent,
                    selectedTextColor = colors.ink,
                    indicatorColor = colors.accentSubtle,
                    unselectedIconColor = colors.secondary,
                    unselectedTextColor = colors.secondary,
                ),
            )
        }
    }
}

private val Tab.icon
    get() = when (this) {
        Tab.Discover -> PodcstIcons.Discover
        Tab.Library -> PodcstIcons.Library
        Tab.Queue -> PodcstIcons.Queue
    }

private val Tab.label
    get() = when (this) {
        Tab.Discover -> R.string.discover
        Tab.Library -> R.string.library
        Tab.Queue -> R.string.queue
    }
