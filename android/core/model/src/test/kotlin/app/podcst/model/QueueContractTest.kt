package app.podcst.model

import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Test

class QueueContractTest {
    @Test
    fun queueMatchesSharedVectors() {
        val cases = Contracts.read("playback/queue.json").getValue("cases").jsonArray
        cases.map { it.jsonObject }.forEach { case ->
            val name = case.getValue("name").string
            val result = case.getValue("steps").jsonArray.fold(initial(case.getValue("initial").jsonObject)) { queue, step ->
                apply(queue, step.jsonObject)
            }
            val expected = case.getValue("expected").jsonObject
            assertEquals(name, expected.getValue("queue").strings, result.episodes.map { it.guid })
            assertEquals(name, expected.getValue("current").jsonPrimitive.int, result.current)
            assertEquals(name, expected.getValue("active").jsonPrimitive.boolean, result.active)
        }
    }

    private fun initial(state: JsonObject): PlaybackQueue {
        val episodes = state.getValue("queue").strings
        val current = state.getValue("current").jsonPrimitive.int
        val queue = episodes.fold(PlaybackQueue()) { queue, guid -> queue.enqueue(episode(guid)) }
        return when {
            state.getValue("active").jsonPrimitive.boolean -> queue.playing(episode(episodes[current]))
            current > 0 -> queue.playing(episode(episodes[current])).stopped()
            else -> queue
        }
    }

    private fun apply(queue: PlaybackQueue, step: JsonObject): PlaybackQueue = when (step.getValue("op").string) {
        "play" -> queue.playing(episode(step.getValue("episode").string))
        "enqueue" -> queue.enqueue(episode(step.getValue("episode").string), step["next"]?.jsonPrimitive?.boolean ?: false)
        "finish" -> queue.finished()
        "markPlayed" -> queue.markedPlayed()
        "next" -> queue.next()
        "previous" -> queue.previous()
        "remove" -> queue.removing(step.getValue("indices").jsonArray.map { it.jsonPrimitive.int }.toSet())
        "removeUpNext" -> queue.removingUpNext(step.getValue("offsets").jsonArray.map { it.jsonPrimitive.int }.toSet())
        "moveUpNext" -> queue.movingUpNext(step.getValue("from").jsonPrimitive.int, step.getValue("to").jsonPrimitive.int)
        "move" -> queue.moving(step.getValue("from").jsonPrimitive.int, step.getValue("to").jsonPrimitive.int)
        "clear" -> queue.cleared()
        "stop" -> queue.stopped()
        "reopen" -> queue.reopened()
        "pause" -> queue
        else -> error("Unknown operation ${step.getValue("op")}")
    }

    private fun episode(guid: String) = Episode(guid = guid, feed = "https://example.com/feed.xml", title = guid, file = EpisodeFile(""))
}
