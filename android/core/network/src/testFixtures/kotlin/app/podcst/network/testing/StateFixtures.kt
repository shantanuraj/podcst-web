package app.podcst.network.testing

import app.podcst.model.*
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.*

class StateFixtures(private val account: String = "owner", private val presentation: (Call) -> Reply) {
    val generation = "17adbd84-d0e4-4e2d-ad9f-b084efee3211"
    private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true }
    private var revision = 0L
    private val rows = mutableMapOf<Long, StateProgress>()
    private val acknowledgements = mutableMapOf<Pair<String, String>, Reply>()
    fun saveFromAnotherDevice(episodeId: Long, positionSeconds: Int, completed: Boolean) {
        revision++
        rows[episodeId] = StateProgress(positionSeconds, completed, StateID(revision.toString()), null)
    }

    fun route(call: Call): Reply {
        if (call.path != "/api/progress") return presentation(call)
        if (call.body.isNotEmpty()) {
            val batch = json.decodeFromString<StateBatch<StateProgressChange>>(call.body)
            val key = batch.clientId to batch.sequence.value
            acknowledgements[key]?.let { return it }
            val result = batch.changes.map { change ->
                revision++
                rows[change.episodeId.value.toLong()] = StateProgress(change.positionSeconds, change.completed ?: rows[change.episodeId.value.toLong()]?.completed ?: false, StateID(revision.toString()), null)
                StateProgressResult(change.episodeId, StateResult.applied)
            }
            return Reply(json.encodeToString(StateAcknowledgement(1, account, generation, batch.clientId, batch.sequence, StateRevision(revision.toString()), result))).also { acknowledgements[key] = it }
        }
        if (call.query?.contains("view=state") == true) {
            val ids = call.query.substringAfter("episodeIds=", "").substringBefore('&').replace("%2C", ",", true).takeIf { it.isNotEmpty() }?.split(',')?.map { it.toLong() }.orEmpty()
            return Reply(json.encodeToString(StateSnapshot(1, account, generation, StateRevision(revision.toString()), ids.map { StateProgressItem(StateID(it.toString()), rows[it]) })))
        }
        return presentation(call).also { reply ->
            if (reply.code == 200) {
                val root = json.parseToJsonElement(reply.body)
                if (root is JsonObject && root["episode"] is JsonObject) {
                    val id = root.getValue("episode").jsonObject.getValue("id").jsonPrimitive.content.toLong()
                    revision++
                    rows[id] = StateProgress(root.getValue("position").jsonPrimitive.double.toInt(), false, StateID(revision.toString()), null)
                }
            }
        }
    }
}
