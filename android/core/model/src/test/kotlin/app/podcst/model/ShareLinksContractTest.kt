package app.podcst.model

import kotlin.time.Duration
import kotlin.time.Duration.Companion.seconds
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.double
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class ShareLinksContractTest {
    private val links = Contracts.read("sharing/links.json")

    @Test
    fun rulesAreGeneratedFromTheContract() {
        assertEquals(links.getValue("origin").string, ShareRules.ORIGIN)
        assertEquals(links.getValue("maxSeconds").jsonPrimitive.long.seconds, ShareRules.maxTime)
    }

    @Test
    fun timesFormatLikeEveryClient() {
        links.getValue("format").jsonArray.map { it.jsonObject }.forEach { case ->
            val seconds = case.getValue("seconds").jsonPrimitive.double
            assertEquals("$seconds", case.getValue("expected").string, ShareLinks.format(seconds.seconds))
        }
    }

    @Test
    fun linksGenerateLikeEveryClient() {
        links.getValue("generate").jsonArray.map { it.jsonObject }.forEach { case ->
            val name = case.getValue("name").string
            val expected = case.getValue("expected").takeUnless { it is JsonNull }?.string
            assertEquals(name, expected, target(case.getValue("target").jsonObject)?.let(ShareLinks::url))
        }
    }

    @Test
    fun linksParseLikeEveryClient() {
        links.getValue("parse").jsonArray.map { it.jsonObject }.forEach { case ->
            val url = case.getValue("url").string
            val expected = case.getValue("expected")
            val parsed = ShareLinks.parse(url)
            if (expected is JsonNull) {
                assertNull(url, parsed)
                return@forEach
            }
            val fields = expected.jsonObject
            assertEquals(
                url,
                SharedLink(
                    fields.getValue("podcastId").string.toLong(),
                    fields.getValue("episodeId").takeUnless { it is JsonNull }?.string?.toLong(),
                    fields.getValue("moment").takeUnless { it is JsonNull }?.jsonObject?.let(::moment),
                    fields.getValue("invalidMoment").jsonPrimitive.boolean,
                ),
                parsed,
            )
        }
    }

    private fun target(fields: JsonObject): ShareTarget? {
        val podcastId = canonicalId(fields.getValue("podcastId").string) ?: return null
        val episodeId = fields["episodeId"]?.let { canonicalId(it.string) ?: return null }
        return ShareTarget(podcastId, episodeId, fields["moment"]?.jsonObject?.let(::moment))
    }

    private fun moment(fields: JsonObject): Moment {
        val start = time(fields.getValue("start"))
        return when (fields.getValue("kind").string) {
            "time" -> Moment.Time(start)
            "clip" -> Moment.Clip(start, time(fields.getValue("end")))
            "chapter" -> Moment.Chapter(fields.getValue("chapter").jsonPrimitive.int, start, time(fields.getValue("end")))
            else -> error("Unknown moment ${fields.getValue("kind")}")
        }
    }

    private fun time(value: JsonElement): Duration =
        if (value.jsonPrimitive.isString && value.string == "NaN") Duration.INFINITE else value.jsonPrimitive.double.seconds
}
