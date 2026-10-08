package app.podcst.network

import app.podcst.model.*
import app.podcst.network.testing.FakeServer
import app.podcst.network.testing.Reply
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Test

class DurableWireTest {
    private val account = "owner"
    private val generation = "17adbd84-d0e4-4e2d-ad9f-b084efee3211"
    private val client = "a7a2e014-b64f-4487-9c92-71cd59fc0cf7"
    private val episode = """{"id":"9007199254740993","podcastId":"9223372036854775807","guid":"same","title":"Episode","file":{"url":"https://test/audio","length":9007199254740993}}"""

    @Test fun catalogueWireNeverAcceptsNumbersAndRetainsInt64Precisely() {
        val decoded = PodcstApi.json.decodeFromString<WireEpisode>(episode).domain()
        assertEquals(9007199254740993L, decoded.id)
        assertEquals(Long.MAX_VALUE, decoded.podcastId)
        assertEquals(9007199254740993L, decoded.file.length)
        assertEquals("episode:9007199254740993", decoded.identity.value)
        assertEquals(decoded.identity, decoded.copy(feed = "moved", guid = "changed", file = EpisodeFile("moved")).identity)
        assertNotEquals(decoded.identity, decoded.copy(id = 1).identity)
        assertNotEquals(decoded.copy(id = null, feed = "a").identity, decoded.copy(id = null, feed = "b").identity)
        for (value in listOf("9007199254740993", "1.0", "null", "\"01\"", "\"9223372036854775808\"")) {
            val raw = episode.replace("\"id\":\"9007199254740993\"", "\"id\":$value")
            if (value != "null") assertTrue(value, runCatching { PodcstApi.json.decodeFromString<WireEpisode>(raw) }.isFailure)
        }
    }

    @Test fun exactNewStarBatchAndNumericLegacyBridgeStayDistinct() = runTest {
        val response = """{"protocol":1,"accountId":"$account","generation":"$generation","clientId":"$client","sequence":"9007199254740993","listId":"list","revision":"0","results":[{"episodeId":"9007199254740993","status":"applied"}]}"""
        val server = FakeServer { Reply(response) }
        val batch = ListBatch(client, "9007199254740993", listOf(ListChange(ListChange.Operation.Add, 9007199254740993)))
        server.api.changeList("list", batch, account, generation, false)
        server.api.changeList("list", batch, account, generation, true)
        val normal = Json.parseToJsonElement(server.calls[0].body).jsonObject
        val bridge = Json.parseToJsonElement(server.calls[1].body).jsonObject
        assertTrue(normal.getValue("changes").jsonArray.single().jsonObject.getValue("episodeId").jsonPrimitive.isString)
        assertEquals("/api/lists/list/migration", server.calls[1].path)
        assertEquals(Json.parseToJsonElement(Json.encodeToString(ListBatch.serializer(), batch)), bridge.getValue("batch"))
        assertFalse(bridge.getValue("batch").jsonObject.getValue("changes").jsonArray.single().jsonObject.getValue("episodeId").jsonPrimitive.isString)
    }

    @Test fun checkpointRequestEncodesLiteralNullAndRejectsAnOmittedCompletion() = runTest {
        val response = """{"protocol":1,"accountId":"$account","generation":"$generation","clientId":"$client","sequence":"1","revision":"1","results":[{"episodeId":"9007199254740993","status":"applied"}]}"""
        val server = FakeServer { Reply(response) }
        val batch = StateBatch(1, account, generation, client, StateID("1"), listOf(StateProgressChange(StateID("9007199254740993"), 94, null)))
        server.api.changeProgress(batch)
        val completed = Json.parseToJsonElement(server.calls.single().body).jsonObject.getValue("changes").jsonArray.single().jsonObject.getValue("completed")
        assertEquals(JsonNull, completed)
        val missing = server.calls.single().body.replace(",\"completed\":null", "")
        assertTrue(runCatching { PodcstApi.json.decodeFromString<StateBatch<StateProgressChange>>(missing) }.isFailure)
    }

    @Test fun resolveAndStateReadsUseStringIdsAndStrictRequiredNulls() = runTest {
        val server = FakeServer { call ->
            if (call.path.endsWith("resolve")) Reply("""{"id":"9223372036854775807"}""")
            else Reply("""{"protocol":1,"accountId":"$account","generation":"$generation","revision":"0","items":[{"episodeId":"9007199254740993","progress":null}]}""")
        }
        assertEquals(Long.MAX_VALUE, server.api.resolve(9007199254740993, "us"))
        assertTrue(Json.parseToJsonElement(server.calls.first().body).jsonObject.getValue("itunes_id").jsonPrimitive.isString)
        assertNull(server.api.progressState(listOf(9007199254740993)).items.single().progress)
        val malformed = FakeServer { Reply("""{"protocol":1,"accountId":"$account","generation":"$generation","revision":"0","items":[{"episodeId":"1"}]}""") }
        assertEquals("invalid_response", (runCatching { malformed.api.progressState(listOf(1)) }.exceptionOrNull() as ApiException).code)
    }
}
