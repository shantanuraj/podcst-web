package app.podcst.model

import java.net.URI

internal fun shareableWebpage(link: String?, excluding: List<String>): String? {
    val uri = link?.let { runCatching { URI(it) }.getOrNull() } ?: return null
    val scheme = uri.scheme?.lowercase() ?: return null
    if (scheme != "https" && scheme != "http") return null
    if (uri.host.isNullOrEmpty() || uri.userInfo != null) return null
    val sources = excluding.mapNotNull { runCatching { URI(it) }.getOrNull() }
    return if (uri in sources) null else link
}
