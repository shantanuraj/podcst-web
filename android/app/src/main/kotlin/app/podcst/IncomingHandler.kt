package app.podcst

import android.content.Context
import android.content.Intent
import androidx.compose.runtime.snapshotFlow
import app.podcst.network.ApiException
import kotlinx.coroutines.currentCoroutineContext
import app.podcst.network.awaitFeedContent
import kotlinx.coroutines.job
import kotlinx.coroutines.launch
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
                val current = graph.library.importScope()
                val feeds = withContext(Dispatchers.IO) {
                    runCatching { context.contentResolver.openInputStream(incoming.uri)?.use { Opml.feeds(Opml.read(it)) } }.getOrNull()
                }
                if (feeds == null) {
                    toaster.show("Invalid or oversized OPML. Existing imports retained.")
                    return
                }
                if (!current()) return
                val result = try { graph.library.import(feeds, current) }
                catch (cancelled: CancellationException) { throw cancelled }
                catch (_: Exception) {
                    if (current()) toaster.show("Import paused. Pending inputs are retained.")
                    return
                }
                if (!current()) return
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
        val episode = lookup(episodeId, link.podcastId, navigator, toaster) ?: return
        val found = episode.getOrElse { failure ->
            if (failure is CancellationException) throw failure
            val freshness = (failure as? ApiException)?.freshness
            if (freshness != null) {
                toaster.show(ToastMessage(freshness.message, actions = listOf(ToastAction("Retry") {
                    if ((freshness.retryAtMs ?: 0) <= System.currentTimeMillis()) graph.scope.launch { graph.incoming.emit(Incoming.Shared(link)) }
                }), persistent = true))
            } else toaster.show(context.getString(R.string.link_failed))
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

    private suspend fun lookup(episodeId: Long, podcastId: Long, navigator: Navigator, toaster: Toaster): Result<Episode>? {
        val owner = graph.scopes.current.value
        val epoch = graph.scopes.epoch
        val navigation = navigator.tab to navigator.stack.toList()
        val playing = graph.playback.state.value.episode?.identity
        val task = currentCoroutineContext().job
        var notice = ToastMessage("Preparing episode…", actions = listOf(ToastAction("Cancel") { task.cancel() }), persistent = true)
        if (owner.accountId != null && !graph.scopes.verified) return null
        try {
            return merge<Result<Episode>?>(
                flow {
                    val result = runCatching {
                        val episode = awaitFeedContent(
                            read = { graph.api.publicEpisode(episodeId, podcastId) },
                            active = { graph.scopes.current.value === owner && graph.scopes.epoch == epoch },
                            pending = { freshness ->
                                if (notice.title != freshness.message) notice = ToastMessage(freshness.message, actions = listOf(ToastAction("Cancel") { task.cancel() }), persistent = true)
                                toaster.show(notice)
                            },
                        )
                        owner.database.episodes().get(episode.identity.value)?.domain() ?: episode
                    }
                    emit(result)
                },
                graph.scopes.current.filter { it !== owner }.map { null },
                graph.scopes.verification.filter { owner.accountId != null && !it }.map { null },
                snapshotFlow { navigator.tab to navigator.stack.toList() }.filter { it != navigation }.map { null },
                graph.playback.state.filter { it.episode?.identity != playing }.map { null },
            ).first()
        } finally { toaster.dismiss(notice) }
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
