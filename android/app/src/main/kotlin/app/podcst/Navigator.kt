package app.podcst

import androidx.compose.runtime.Composable
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.navigation3.runtime.NavBackStack
import androidx.navigation3.runtime.NavKey
import androidx.navigation3.runtime.rememberNavBackStack
import app.podcst.model.Episode
import app.podcst.model.Podcast

enum class Tab(val root: Route) { Discover(DiscoverRoute), Library(LibraryRoute), Queue(QueueRoute) }

@Stable
class Navigator(
    private val stacks: Map<Tab, NavBackStack<NavKey>>,
    initial: Tab,
) {
    var tab by mutableStateOf(initial)
        private set
    var nowPlaying by mutableStateOf(false)
    var signIn by mutableStateOf(false)

    val stack: NavBackStack<NavKey> get() = stacks.getValue(tab)

    fun select(target: Tab) {
        if (tab == target) {
            while (stack.size > 1) stack.removeAt(stack.lastIndex)
        } else {
            tab = target
        }
    }

    fun push(route: Route) {
        nowPlaying = false
        stack.add(route)
    }

    fun podcast(podcast: Podcast) = push(PodcastRoute(podcast.copy(episodes = emptyList())))

    fun episode(episode: Episode) = push(EpisodeRoute(episode))

    fun back(): Boolean = when {
        signIn -> { signIn = false; true }
        nowPlaying -> { nowPlaying = false; true }
        stack.size > 1 -> { stack.removeAt(stack.lastIndex); true }
        tab != Tab.Discover -> { tab = Tab.Discover; true }
        else -> false
    }
}

@Composable
fun rememberNavigator(): Navigator {
    val discover = rememberNavBackStack(DiscoverRoute)
    val library = rememberNavBackStack(LibraryRoute)
    val queue = rememberNavBackStack(QueueRoute)
    val tab by rememberSaveable { mutableStateOf(Tab.Discover) }
    return androidx.compose.runtime.remember(discover, library, queue) {
        Navigator(mapOf(Tab.Discover to discover, Tab.Library to library, Tab.Queue to queue), tab)
    }
}
