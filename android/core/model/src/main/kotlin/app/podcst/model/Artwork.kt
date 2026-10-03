package app.podcst.model

import java.net.URI

object Artwork {
    private val widths = PlaybackRules.artworkWidths
    private const val PROXY = PlaybackRules.ARTWORK_HOST
    private const val PARAMETER = PlaybackRules.ARTWORK_PARAMETER

    fun width(pixels: Int): Int = widths.firstOrNull { it >= pixels } ?: widths.last()

    fun url(source: String, pixels: Int): String {
        if (source.isBlank()) return source
        val uri = runCatching { URI(source) }.getOrNull() ?: return source
        if (!uri.host.equals(PROXY, ignoreCase = true) || uri.rawQuery?.contains("p=") != true) return source
        val query = uri.rawQuery.split('&').filterNot { it.startsWith("$PARAMETER=") } + "$PARAMETER=${width(pixels)}"
        return URI(uri.scheme, uri.rawAuthority, uri.rawPath, null, null).toString() + "?" + query.joinToString("&")
    }

    fun canonical(source: String): String {
        val uri = runCatching { URI(source) }.getOrNull() ?: return source
        if (!uri.host.equals(PROXY, ignoreCase = true)) return source
        val query = uri.rawQuery?.split('&')?.filterNot { it.startsWith("$PARAMETER=") }.orEmpty()
        return URI(uri.scheme, uri.rawAuthority, uri.rawPath, null, null).toString() + if (query.isEmpty()) "" else "?" + query.joinToString("&")
    }
}
