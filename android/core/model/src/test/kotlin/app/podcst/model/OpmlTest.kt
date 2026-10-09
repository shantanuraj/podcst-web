package app.podcst.model

import java.io.File
import java.io.InputStream
import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Test

class OpmlTest {
    @Test fun sharedBoundedDocumentFixtures() {
        val cases = Json.parseToJsonElement(File(System.getProperty("podcst.contracts"), "feeds/opml.json").readText()).jsonObject.getValue("cases").jsonArray
        for (value in cases) {
            val item = value.jsonObject
            fun text(key: String) = item[key]?.jsonPrimitive?.content ?: ""
            fun count(key: String) = item[key]?.jsonPrimitive?.int ?: 0
            val document = item["xml"]?.jsonPrimitive?.content ?: (text("prefix") + (0 until count("repeat")).joinToString("") { text("fragment").replace("{i}", "$it") } + text("suffix").repeat(count("closeRepeat")) + text("tail"))
            val result = runCatching { Opml.feeds(document) }
            assertEquals(text("name"), item.getValue("valid").jsonPrimitive.boolean, result.isSuccess)
            if (result.isSuccess) {
                assertEquals(text("name"), count("count"), result.getOrThrow().size)
                item["feeds"]?.let { assertEquals(it.jsonArray.map { it.jsonPrimitive.content }, result.getOrThrow()) }
            }
        }
    }

    @Test fun boundsStreamsAndRejectsInvalidEncoding() {
        var consumed = 0
        val stream = object : InputStream() { override fun read(): Int { consumed++; return 32 } }
        assertTrue(runCatching { Opml.read(stream) }.isFailure)
        assertEquals(FeedLimits.OPML_BYTES + 1, consumed)
        assertTrue(runCatching { Opml.read(byteArrayOf(0xff.toByte()).inputStream()) }.isFailure)
    }
}
