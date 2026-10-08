package app.podcst.model

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class StateContractTest {
    private val fixtures = Contracts.read("state/fixtures.json")
    private val json = Json { ignoreUnknownKeys = true }

    private inline fun <reified T> roundTrip(key: String): T {
        val original = fixtures.getValue(key)
        val value = json.decodeFromString<T>(original.toString())
        assertEquals(key, original, json.parseToJsonElement(json.encodeToString(value)))
        return value
    }

    @Test
    fun wireFixturesPreserveExactIDsRevisionsAndNulls() {
        val progress = roundTrip<StateBatch<StateProgressChange>>("progressBatch")
        assertEquals("9007199254740993", progress.changes.first().episodeId.value)
        assertEquals("9223372036854775807", progress.changes.last().episodeId.value)
        roundTrip<StateBatch<StateFollowChange>>("followBatch")
        val acknowledgement = roundTrip<StateAcknowledgement<StateProgressResult>>("progressAcknowledgement")
        assertEquals("9007199254740993", acknowledgement.sequence.value)
        assertEquals("9007199254740994", acknowledgement.revision.value)
        roundTrip<StateAcknowledgement<StateFollowResult>>("followAcknowledgement")
        assertNull(roundTrip<StateSnapshot<StateProgressItem>>("progressSnapshot").items.last().progress)
        roundTrip<StateSnapshot<StateFollowItem>>("followSnapshot")
        roundTrip<StateErrorBody>("error")
        for (entry in fixtures.getValue("scalars").jsonArray) {
            val vector = entry.jsonObject
            val value = vector.getValue("value").toString()
            assertEquals(value, vector.getValue("id").jsonPrimitive.boolean, runCatching { json.decodeFromString<StateID>(value) }.isSuccess)
            assertEquals(value, vector.getValue("revision").jsonPrimitive.boolean, runCatching { json.decodeFromString<StateRevision>(value) }.isSuccess)
        }
        assertTrue(runCatching { json.decodeFromString<StateProgressItem>("""{"episodeId":"1"}""") }.isFailure)
    }

    @Test
    fun checkpointCompletionIsRequiredNullableWhileSnapshotsStayConcrete() {
        for (value in listOf<Boolean?>(null, false, true)) {
            val change = StateProgressChange(StateID("9007199254740993"), 94, value)
            val encoded = json.encodeToString(StateProgressChange.serializer(), change)
            assertTrue(encoded.contains("\"completed\":${value ?: "null"}"))
            assertEquals(change, json.decodeFromString<StateProgressChange>(encoded))
        }
        val missing = """{"episodeId":"1","positionSeconds":94}"""
        assertTrue(runCatching { json.decodeFromString<StateProgressChange>(missing) }.isFailure)
        for (value in listOf("0", "\"false\"", "{}", "[]")) {
            assertTrue(value, runCatching { json.decodeFromString<StateProgressChange>("""{"episodeId":"1","positionSeconds":94,"completed":$value}""") }.isFailure)
        }
        for (suffix in listOf("", ",\"completed\":null", ",\"completed\":\"false\"")) {
            assertTrue(runCatching { json.decodeFromString<StateProgress>("""{"positionSeconds":94,"revision":"1","updatedAtMs":null$suffix}""") }.isFailure)
        }
        assertNull(StateProgressEvent.checkpoint.requestCompletion)
        assertEquals(true, StateProgressEvent.played.requestCompletion)
        assertEquals(true, StateProgressEvent.ended.requestCompletion)
        assertEquals(false, StateProgressEvent.replay.requestCompletion)
        assertEquals(false, StateProgressEvent.unplayed.requestCompletion)
        assertEquals(true, StateProgressEvent.checkpoint.intent(94, true).second)
    }

    @Test
    fun explicitCompletionMatchesSharedVectors() {
        for (entry in fixtures.getValue("completion").jsonArray) {
            val vector = entry.jsonObject
            val event = StateProgressEvent.valueOf(vector.getValue("event").string)
            val intent = event.intent(vector.getValue("positionSeconds").jsonPrimitive.int, vector.getValue("previousCompleted").jsonPrimitive.boolean)
            assertEquals(vector.getValue("name").string, vector.getValue("expectedPositionSeconds").jsonPrimitive.int, intent.first)
            assertEquals(vector.getValue("name").string, vector.getValue("expectedCompleted").jsonPrimitive.boolean, intent.second)
        }
        assertTrue(runCatching { StateProgressEvent.checkpoint.intent(-1, false) }.isFailure)
        assertFalse(StateProgressEvent.checkpoint.intent(Int.MAX_VALUE, false).second)
    }
}
