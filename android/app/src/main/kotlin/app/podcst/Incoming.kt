package app.podcst

import android.net.Uri
import app.podcst.model.Podcast
import java.net.URLDecoder

sealed interface Incoming {
    data class Show(val podcast: Podcast) : Incoming
    data class Item(val podcast: Podcast, val episodeId: Long?, val guid: String?) : Incoming
    data class Short(val slug: String) : Incoming
    data class Opml(val uri: Uri) : Incoming

    companion object {
        private val hosts = setOf("podcst.app", "www.podcst.app")

        fun link(scheme: String?, host: String?, segments: List<String>): Incoming? {
            if (scheme != "https" || host !in hosts) return null
            return when (segments.firstOrNull()) {
                "episodes" -> episodes(segments.drop(1))
                "itunes" -> segments.getOrNull(1)?.toLongOrNull()?.let { Show(Podcast(itunesId = it, itunesLocale = "us", feed = "", title = "")) }
                "s" -> segments.getOrNull(1)?.takeIf { it.isNotBlank() }?.let(::Short)
                else -> null
            }
        }

        private fun episodes(parts: List<String>): Incoming? {
            val show = parts.firstOrNull()?.let(::decode)?.takeIf { it.isNotBlank() } ?: return null
            val id = show.toLongOrNull()
            val podcast = Podcast(id = id, feed = if (id == null) show else "", title = "")
            val episode = parts.getOrNull(1)?.let(::decode) ?: return Show(podcast)
            return if (id != null) Item(podcast, episode.toLongOrNull(), null) else Item(podcast, null, episode)
        }

        private fun decode(value: String) = URLDecoder.decode(value, Charsets.UTF_8)
    }
}
