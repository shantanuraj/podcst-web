package app.podcst

import android.content.Context
import android.content.Intent
import app.podcst.designsystem.Toaster
import app.podcst.model.Opml
import app.podcst.network.await
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.Request

fun Intent.incoming(): Incoming? {
    if (action != Intent.ACTION_VIEW) return null
    val uri = data ?: return null
    if (uri.scheme == "content") return Incoming.Opml(uri)
    return Incoming.link(uri.scheme, uri.host, uri.pathSegments)
}

class IncomingHandler(private val context: Context, private val graph: AppGraph) {
    suspend fun handle(incoming: Incoming, navigator: Navigator, toaster: Toaster) {
        when (incoming) {
            is Incoming.Show -> navigator.podcast(incoming.podcast)
            is Incoming.Item -> {
                val podcast = runCatching { graph.catalog.load(incoming.podcast) }.getOrNull() ?: return navigator.podcast(incoming.podcast)
                podcast.episodes.firstOrNull { (incoming.episodeId != null && it.id == incoming.episodeId) || it.guid == incoming.guid }
                    ?.let(navigator::episode)
                    ?: navigator.podcast(podcast)
            }
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

    private suspend fun resolve(slug: String): Incoming? {
        val client = graph.client.newBuilder().followRedirects(false).build()
        val request = Request.Builder().url("https://www.podcst.app/s/$slug").build()
        val location = runCatching { client.newCall(request).await().use { it.header("Location") } }.getOrNull() ?: return null
        val url = "https://www.podcst.app/".toHttpUrlOrNull()?.resolve(location) ?: return null
        return Incoming.link(url.scheme, url.host, url.pathSegments.filter { it.isNotEmpty() })
    }
}
