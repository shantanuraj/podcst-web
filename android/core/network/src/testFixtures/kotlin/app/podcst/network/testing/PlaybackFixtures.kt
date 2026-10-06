package app.podcst.network.testing

import app.podcst.model.Episode
import app.podcst.model.EpisodeFile
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.encodeToJsonElement
import kotlinx.serialization.json.jsonObject
import kotlin.time.Duration.Companion.seconds

object PlaybackFixtures {
    fun episode(id: Long) = Episode(
        id = id,
        guid = "episode-$id",
        feed = "https://example.test/feed-$id",
        title = "Episode $id",
        duration = 4000.seconds,
        file = EpisodeFile("https://example.test/$id.mp3"),
    )

    fun progress(episode: Episode, position: Double): Reply {
        val fields = Json.encodeToJsonElement(episode.copy(duration = null)).jsonObject.toMutableMap()
        episode.duration?.let { fields["duration"] = JsonPrimitive(it.inWholeMilliseconds / 1000.0) }
        return Reply(JsonObject(mapOf("episode" to JsonObject(fields), "position" to JsonPrimitive(position))).toString())
    }
}
