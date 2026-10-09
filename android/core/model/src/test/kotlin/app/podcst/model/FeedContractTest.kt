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
