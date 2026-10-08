package app.podcst.model

import kotlinx.serialization.KSerializer
import kotlinx.serialization.Serializable
import kotlinx.serialization.SerializationException
import kotlinx.serialization.descriptors.PrimitiveKind
import kotlinx.serialization.descriptors.PrimitiveSerialDescriptor
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.JsonDecoder
import kotlinx.serialization.json.jsonPrimitive

private fun stateDecimal(value: String, allowsZero: Boolean): Boolean =
    value.length in 1..19 && value.all { it in '0'..'9' } &&
        value.toLongOrNull()?.let { it >= (if (allowsZero) 0 else 1) && it.toString() == value } == true

private fun decimalString(decoder: Decoder): String {
    if (decoder is JsonDecoder) {
        val value = decoder.decodeJsonElement().jsonPrimitive
        if (!value.isString) throw SerializationException("State decimals must be strings")
        return value.content
    }
    return decoder.decodeString()
}

@Serializable(with = StateIDSerializer::class)
@JvmInline
value class StateID(val value: String) {
    init { require(stateDecimal(value, false)) { "Invalid state identity" } }
}

object StateIDSerializer : KSerializer<StateID> {
    override val descriptor = PrimitiveSerialDescriptor("StateID", PrimitiveKind.STRING)
    override fun serialize(encoder: Encoder, value: StateID) = encoder.encodeString(value.value)
    override fun deserialize(decoder: Decoder) = StateID(decimalString(decoder))
}

@Serializable(with = StateRevisionSerializer::class)
@JvmInline
value class StateRevision(val value: String) {
    init { require(stateDecimal(value, true)) { "Invalid state revision" } }
}

object StateRevisionSerializer : KSerializer<StateRevision> {
    override val descriptor = PrimitiveSerialDescriptor("StateRevision", PrimitiveKind.STRING)
    override fun serialize(encoder: Encoder, value: StateRevision) = encoder.encodeString(value.value)
    override fun deserialize(decoder: Decoder) = StateRevision(decimalString(decoder))
}

object StateCompletionSerializer : KSerializer<Boolean> {
    override val descriptor = PrimitiveSerialDescriptor("StateCompletion", PrimitiveKind.BOOLEAN)
    override fun serialize(encoder: Encoder, value: Boolean) = encoder.encodeBoolean(value)
    override fun deserialize(decoder: Decoder): Boolean {
        if (decoder !is JsonDecoder) return decoder.decodeBoolean()
        val value = decoder.decodeJsonElement() as? JsonPrimitive
        if (value == null || value.isString) throw SerializationException("Completion must be a boolean")
        return value.booleanOrNull ?: throw SerializationException("Completion must be a boolean")
    }
}

@Serializable
data class StateProgressChange(val episodeId: StateID, val positionSeconds: Int, @Serializable(StateCompletionSerializer::class) val completed: Boolean?)

@Serializable
data class StateFollowChange(val podcastId: StateID, val followed: Boolean)

@Serializable
data class StateBatch<Change>(
    val protocol: Int,
    val accountId: String,
    val generation: String,
    val clientId: String,
    val sequence: StateID,
    val changes: List<Change>,
)

@Serializable
enum class StateResult { applied, unchanged, not_found }

@Serializable
data class StateProgressResult(val episodeId: StateID, val status: StateResult)

@Serializable
data class StateFollowResult(val podcastId: StateID, val status: StateResult)

@Serializable
data class StateAcknowledgement<Result>(
    val protocol: Int,
    val accountId: String,
    val generation: String,
    val clientId: String,
    val sequence: StateID,
    val revision: StateRevision,
    val results: List<Result>,
)

@Serializable
data class StateProgress(val positionSeconds: Int, @Serializable(StateCompletionSerializer::class) val completed: Boolean, val revision: StateID, val updatedAtMs: Long?)

@Serializable
data class StateProgressItem(val episodeId: StateID, val progress: StateProgress?)

@Serializable
enum class StateAvailability { available, unavailable }

@Serializable
data class StateFollowItem(val podcastId: StateID, val revision: StateID, val followedAtMs: Long?, val availability: StateAvailability)

@Serializable
data class StateSnapshot<Item>(
    val protocol: Int,
    val accountId: String,
    val generation: String,
    val revision: StateRevision,
    val items: List<Item>,
)

@Serializable
data class StateErrorBody(val code: String, val message: String)

enum class StateProgressEvent {
    checkpoint, ended, played, unplayed, replay;

    val requestCompletion: Boolean? get() = when (this) {
        checkpoint -> null
        ended, played -> true
        unplayed, replay -> false
    }

    fun intent(positionSeconds: Int, previousCompleted: Boolean): Pair<Int, Boolean> {
        require(positionSeconds >= 0) { "Invalid source position" }
        return (if (this == unplayed) 0 else positionSeconds) to
            (this == ended || this == played || (this == checkpoint && previousCompleted))
    }
}

@Serializable
data class FollowResolution(val protocol: Int, val accountId: String, val generation: String, val items: List<FollowResolutionItem>)
@Serializable
data class FollowResolutionItem(val index: Int, val podcastId: StateID?, val status: String)

fun validateStateScope(protocol: Int, accountId: String, generation: String, expectedAccount: String, expectedGeneration: String? = null) {
    check(protocol == 1 && accountId == expectedAccount && accountId.length in 1..128)
    check(Regex("[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}").matches(generation))
    check(expectedGeneration == null || generation == expectedGeneration) { "Recovery generation changed; pending work retained" }
}
