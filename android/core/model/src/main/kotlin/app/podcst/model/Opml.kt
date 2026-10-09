package app.podcst.model

import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.io.StringReader
import javax.xml.parsers.SAXParserFactory
import org.xml.sax.Attributes
import org.xml.sax.InputSource
import org.xml.sax.SAXException
import org.xml.sax.SAXParseException
import org.xml.sax.ext.DefaultHandler2

object Opml {
    private val entities = listOf("&" to "&amp;", "\"" to "&quot;", "'" to "&apos;", "<" to "&lt;", ">" to "&gt;")
    private const val ERROR = "Invalid or oversized OPML. Existing imports retained."

    fun document(podcasts: List<Podcast>): String {
        val rows = podcasts.joinToString("") { "<outline type=\"rss\" text=\"${escape(it.title)}\" xmlUrl=\"${escape(it.feed)}\"/>" }
        return "<?xml version=\"1.0\" encoding=\"utf-8\"?><opml version=\"1.0\"><head><title>Podcst Subscriptions</title></head><body>$rows</body></opml>"
    }

    fun read(stream: InputStream): String {
        val bytes = ByteArrayOutputStream()
        val buffer = ByteArray(8192)
        while (true) {
            val count = stream.read(buffer, 0, minOf(buffer.size, FeedLimits.OPML_BYTES + 1 - bytes.size()))
            if (count == -1) break
            bytes.write(buffer, 0, count)
            require(bytes.size() <= FeedLimits.OPML_BYTES) { ERROR }
        }
        return bytes.toByteArray().decodeToString(throwOnInvalidSequence = true)
    }

    fun feeds(document: String): List<String> {
        require(document.toByteArray(Charsets.UTF_8).size <= FeedLimits.OPML_BYTES) { ERROR }
        val feeds = linkedSetOf<String>()
        var depth = 0
        var outlines = 0
        val handler = object : DefaultHandler2() {
            override fun startDTD(name: String?, publicId: String?, systemId: String?) { throw SAXException(ERROR) }
            override fun resolveEntity(publicId: String?, systemId: String?): InputSource { throw SAXException(ERROR) }
            override fun error(error: SAXParseException) { throw SAXException(ERROR) }
            override fun fatalError(error: SAXParseException) { throw SAXException(ERROR) }
            override fun startElement(uri: String?, localName: String?, qName: String, attributes: Attributes) {
                require(++depth <= FeedLimits.OPML_DEPTH) { ERROR }
                if (qName != "outline") return
                require(++outlines <= FeedLimits.OPML_OUTLINES) { ERROR }
                val url = (0 until attributes.length).firstOrNull { attributes.getQName(it).equals("xmlUrl", true) }
                    ?.let { attributes.getValue(it).trim() }?.takeIf { it.isNotEmpty() } ?: return
                require(url.length <= 4096) { ERROR }
                feeds.add(url)
                require(feeds.size <= FeedLimits.OPML_FEEDS) { ERROR }
            }
            override fun endElement(uri: String?, localName: String?, qName: String?) { depth-- }
        }
        try {
            SAXParserFactory.newInstance().newSAXParser().xmlReader.apply {
                contentHandler = handler
                errorHandler = handler
                entityResolver = handler
                setProperty("http://xml.org/sax/properties/lexical-handler", handler)
                parse(InputSource(StringReader(document)))
            }
        } catch (_: Exception) { throw IllegalArgumentException(ERROR) }
        return feeds.toList()
    }

    private fun escape(value: String) = entities.fold(value) { text, (raw, entity) -> text.replace(raw, entity) }
}
