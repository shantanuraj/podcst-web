package app.podcst

import android.content.Context
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalContext
import app.podcst.database.entity
import app.podcst.designsystem.EpisodeActions
import app.podcst.designsystem.PodcstIcons
import app.podcst.designsystem.ToastAction
import app.podcst.designsystem.ToastMessage
import app.podcst.designsystem.Toaster
import app.podcst.designsystem.share
import app.podcst.model.Episode
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch

class AppEpisodeActions(
    private val context: Context,
    private val graph: AppGraph,
    private val navigator: Navigator,
    private val toaster: Toaster,
    private val chooseList: (Episode) -> Unit,
) : EpisodeActions {
    override fun open(episode: Episode) = navigator.episode(episode)

    override fun play(episode: Episode) {
        val playback = graph.playback
        val state = playback.state.value
        if (state.episode?.identity == episode.identity && state.active) {
            playback.toggle()
            return
        }
        graph.scope.launch {
            val saved = graph.progress.progress.first()[episode.identity.value]
            playback.play(episode, saved?.takeIf { it.started }?.position)
        }
    }

    override fun playNext(episode: Episode) {
        graph.playback.enqueue(episode, next = true)
        toaster.show(context.getString(R.string.playing_next), episode.title)
    }

    override fun enqueue(episode: Episode) {
        graph.playback.enqueue(episode)
        toaster.show(context.getString(R.string.added_to_queue), episode.title)
    }

    override fun star(episode: Episode, starred: Boolean) {
        graph.scope.launch {
            val saved = if (starred) graph.stars.star(episode) else graph.stars.unstar(episode)
            if (!saved) {
                toaster.show(graph.stars.status.value.error ?: "Unable to save this change")
                return@launch
            }
            val accountId = graph.stars.status.value.accountId
            val undo = ToastAction(context.getString(R.string.undo), emphasized = false) {
                if (graph.stars.status.value.accountId == accountId) star(episode, !starred)
            }
            toaster.show(
                if (starred) {
                    ToastMessage(
                        context.getString(R.string.starred),
                        icon = PodcstIcons.StarFilled,
                        actions = listOf(ToastAction(context.getString(R.string.add_to_list)) {
                            if (graph.stars.status.value.accountId == accountId) chooseList(episode)
                        }, undo),
                    )
                } else {
                    ToastMessage(context.getString(R.string.unstarred), icon = PodcstIcons.Star, actions = listOf(undo))
                },
            )
        }
    }

    override fun addToList(episode: Episode) = chooseList(episode)

    override fun download(episode: Episode) {
        graph.scope.launch { graph.scopes.database.episodes().upsert(listOf(episode.entity())) }
        graph.downloads.download(episode)
        toaster.show(context.getString(R.string.downloading_episode), episode.title)
    }

    override fun removeDownload(episode: Episode) {
        graph.downloads.remove(episode)
        toaster.show(context.getString(R.string.download_removed), episode.title)
    }

    override fun markPlayed(episode: Episode) {
        val playback = graph.playback
        if (playback.state.value.episode?.identity == episode.identity && playback.state.value.active) {
            playback.markPlayed()
        } else {
            graph.scope.launch { graph.progress.record(episode, episode.duration ?: kotlin.time.Duration.ZERO, completed = true) }
        }
    }

    override fun share(episode: Episode) {
        val url = episode.shareUrl ?: return
        context.share(url, episode.title)
    }
}

@Composable
fun rememberEpisodeActions(graph: AppGraph, navigator: Navigator, toaster: Toaster, chooseList: (Episode) -> Unit): EpisodeActions {
    val context = LocalContext.current
    return remember(graph, navigator, toaster) { AppEpisodeActions(context, graph, navigator, toaster, chooseList) }
}
