package app.podcst

import android.content.Context
import android.content.Intent
import app.podcst.database.domain
import app.podcst.designsystem.Format
import app.podcst.designsystem.ToastAction
import app.podcst.designsystem.ToastMessage
import app.podcst.designsystem.Toaster
import app.podcst.model.Episode
import app.podcst.model.Moment
import app.podcst.model.Opml
import app.podcst.model.Podcast
import app.podcst.model.SharedLink
import app.podcst.network.await
import kotlin.coroutines.cancellation.CancellationException
import kotlin.time.Duration
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.filter
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.merge
import kotlinx.coroutines.withContext
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.Request

fun Intent.incoming(): Incoming? {
    if (action != Intent.ACTION_VIEW) return null
    val uri = data ?: return null
    if (uri.scheme == "content") return Incoming.Opml(uri)
    return Incoming.link(uri.toString())
}

class IncomingHandler(private val context: Context, private val graph: AppGraph) {
    suspend fun handle(incoming: Incoming, navigator: Navigator, toaster: Toaster) {
        when (incoming) {
            is Incoming.Shared -> open(incoming.link, navigator, toaster)
            is Incoming.Show -> navigator.podcast(incoming.podcast)
            is Incoming.Short -> resolve(incoming.slug)?.let { handle(it, navigator, toaster) }
            is Incoming.Opml -> {
                val text = withContext(Dispatchers.IO) {
                    runCatching { context.contentResolver.openInputStream(incoming.uri)?.use { it.reader().readText() } }.getOrNull()
                } ?: return
                val result = graph.library.import(Opml.feeds(text))
                toaster.show(
                    context.getString(R.string.imported, result.succeeded),
                    context.getString(R.string.import_failed, result.failed).takeIf { result.failed > 0 },
                )
            }
        }
    }

    private suspend fun open(link: SharedLink, navigator: Navigator, toaster: Toaster) {
        val unavailable = { toaster.show(context.getString(R.string.moment_unavailable)) }
        val episodeId = link.episodeId ?: run {
            navigator.podcast(Podcast(id = link.podcastId, feed = "", title = ""))
            if (link.invalidMoment) unavailable()
            return
        }
        val episode = lookup(episodeId, link.podcastId) ?: return
        val found = episode.getOrElse { failure ->
            if (failure is CancellationException) throw failure
            toaster.show(context.getString(R.string.link_failed))
            return
        }
        val moment = link.moment
        when {
            moment == null || !playable(found, moment) -> {
                navigator.episode(found)
                if (link.invalidMoment || moment != null) unavailable()
            }
            moment is Moment.Time -> {
                graph.playback.open(found, moment)
                toaster.show(
                    ToastMessage(
                        context.getString(R.string.started_from_link, Format.clock(moment.start)),
                        actions = listOf(ToastAction(context.getString(R.string.start_over)) {
                            if (graph.playback.state.value.episode?.identity == found.identity) graph.playback.seek(Duration.ZERO)
                        }),
                    ),
                )
            }
            else -> {
                graph.playback.open(found, moment)
                navigator.nowPlaying = true
            }
        }
    }

    private suspend fun lookup(episodeId: Long, podcastId: Long): Result<Episode>? {
        val owner = graph.scopes.current.value
        return merge<Result<Episode>?>(
            flow {
                emit(
                    runCatching {
                        val episode = graph.api.publicEpisode(episodeId, podcastId)
                        owner.database.episodes().get(episode.identity.value)?.domain() ?: episode
                    },
                )
            },
            graph.scopes.current.filter { it !== owner }.map { null },
        ).first()
    }

    private fun playable(episode: Episode, moment: Moment): Boolean {
        val state = graph.playback.state.value
        val measured = state.duration.takeIf { state.episode?.identity == episode.identity && it.isPositive() }
        val known = measured ?: episode.duration
        return known == null || moment.start < known
    }

    private suspend fun resolve(slug: String): Incoming? {
        val client = graph.client.newBuilder().followRedirects(false).build()
        val request = Request.Builder().url("https://www.podcst.app/s/$slug").build()
        val location = runCatching { client.newCall(request).await().use { it.header("Location") } }.getOrNull() ?: return null
        val url = "https://www.podcst.app/".toHttpUrlOrNull()?.resolve(location) ?: return null
        return Incoming.link(url.toString())
    }
}
