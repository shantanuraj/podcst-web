package app.podcst.model

object Opml {
    private val outline = Regex("xmlUrl\\s*=\\s*[\"']([^\"']+)[\"']", RegexOption.IGNORE_CASE)
    private val entities = listOf("&" to "&amp;", "\"" to "&quot;", "'" to "&apos;", "<" to "&lt;", ">" to "&gt;")

    fun document(podcasts: List<Podcast>): String {
        val rows = podcasts.joinToString("") { "<outline type=\"rss\" text=\"${escape(it.title)}\" xmlUrl=\"${escape(it.feed)}\"/>" }
        return "<?xml version=\"1.0\" encoding=\"utf-8\"?><opml version=\"1.0\"><head><title>Podcst Subscriptions</title></head><body>$rows</body></opml>"
    }

    fun feeds(document: String): List<String> = outline.findAll(document).map { unescape(it.groupValues[1]) }.toList()

    private fun escape(value: String) = entities.fold(value) { text, (raw, entity) -> text.replace(raw, entity) }

    private fun unescape(value: String) = entities.reversed().fold(value) { text, (raw, entity) -> text.replace(entity, raw) }
}
