package app.podcst

import android.net.Uri
import app.podcst.model.Podcast
import app.podcst.model.ShareLinks
import app.podcst.model.SharedLink
import java.net.URI

sealed interface Incoming {
    data class Shared(val link: SharedLink) : Incoming
    data class Show(val podcast: Podcast) : Incoming
    data class Short(val slug: String) : Incoming
    data class Opml(val uri: Uri) : Incoming

    companion object {
        private val hosts = setOf("podcst.app", "www.podcst.app")

        fun link(url: String): Incoming? {
            ShareLinks.parse(url)?.let { return Shared(it) }
            val uri = runCatching { URI(url) }.getOrNull() ?: return null
            if (uri.scheme != "https" || uri.host !in hosts) return null
            val segments = uri.path.orEmpty().split('/').filter { it.isNotEmpty() }
            return when (segments.firstOrNull()) {
                "itunes" -> segments.getOrNull(1)?.toLongOrNull()?.let { Show(Podcast(itunesId = it, itunesLocale = "us", feed = "", title = "")) }
                "s" -> segments.getOrNull(1)?.takeIf { it.isNotBlank() }?.let(::Short)
                else -> null
            }
        }
    }
}
