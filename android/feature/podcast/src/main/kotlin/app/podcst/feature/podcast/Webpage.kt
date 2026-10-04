package app.podcst.feature.podcast

import java.net.URI

internal data class Webpage(val url: String, val host: String)

internal fun webpage(link: String?): Webpage? {
    val uri = link?.let { runCatching { URI(it) }.getOrNull() } ?: return null
    if (uri.scheme?.lowercase() !in setOf("http", "https")) return null
    val host = uri.host?.takeIf { it.isNotEmpty() } ?: return null
    return Webpage(link, host.removePrefix("www."))
}
