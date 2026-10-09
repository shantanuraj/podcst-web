package app.podcst.model

import java.io.File
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Test

class FeedContractTest {
    @Test fun importBatchesBoundEncodedBytesAndPreserveOrder() {
        val feeds = (0..<45).map { "https://example.invalid/$it?token=" + "音".repeat(4000) }
        val batches = FeedImportRequest.batches("synthetic", "17adbd84-d0e4-4e2d-ad9f-b084efee3211", feeds)
        assertEquals(feeds, batches.flatten())
        org.junit.Assert.assertTrue(batches.size > 3)
        batches.forEach {
            org.junit.Assert.assertTrue(it.size <= FeedLimits.IMPORT_ITEMS)
            val bytes = Json.encodeToString(FeedImportRequest.serializer(), FeedImportRequest(1, "synthetic", "17adbd84-d0e4-4e2d-ad9f-b084efee3211", it)).toByteArray(Charsets.UTF_8)
            org.junit.Assert.assertTrue(bytes.size <= FeedLimits.BODY_BYTES)
        }
    }

    @Test fun sharedFreshnessAndImportFixtures() {
        val root = File(checkNotNull(System.getProperty("podcst.contracts")))
        val fixtures = Json.parseToJsonElement(File(root, "feeds/fixtures.json").readText()).jsonArray
        fixtures.forEach { value ->
            val fixture = value.jsonObject
            val body = fixture.getValue("value").toString()
            val outcome = runCatching {
                when (val shape = fixture.getValue("shape").jsonPrimitive.content) {
                    "freshness" -> Json.decodeFromString<FeedFreshness>(body)
                    "refreshResponse" -> Json.decodeFromString<FeedRefreshResponse>(body)
                    "resolutionItem" -> Json.decodeFromString<FeedResolutionItem>(body)
                    else -> error("Unknown feed shape $shape")
                }
            }
            assertEquals(fixture.getValue("name").jsonPrimitive.content, fixture.getValue("valid").jsonPrimitive.boolean, outcome.isSuccess)
        }
    }
}
