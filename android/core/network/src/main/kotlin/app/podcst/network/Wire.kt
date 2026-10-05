package app.podcst.network

import app.podcst.model.Account
import app.podcst.model.AudioEffects
import app.podcst.model.AudioOptions
import app.podcst.model.Episode
import app.podcst.model.EpisodeFile
import app.podcst.model.EpisodePage
import app.podcst.model.Passkey
import app.podcst.model.Podcast
import app.podcst.model.User
import kotlin.time.Duration.Companion.seconds
import kotlin.time.Instant
import kotlinx.serialization.KSerializer
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.descriptors.PrimitiveKind
import kotlinx.serialization.descriptors.PrimitiveSerialDescriptor
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder
import kotlinx.serialization.json.JsonDecoder
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull

internal object Explicitness : KSerializer<Boolean> {
    override val descriptor = PrimitiveSerialDescriptor("Explicitness", PrimitiveKind.BOOLEAN)

    override fun deserialize(decoder: Decoder): Boolean {
        val primitive = (decoder as JsonDecoder).decodeJsonElement() as? JsonPrimitive ?: return false
        return primitive.booleanOrNull ?: (primitive.content == "explicit")
    }

    override fun serialize(encoder: Encoder, value: Boolean) = encoder.encodeBoolean(value)
}

@Serializable
internal data class WireFile(val url: String, val length: Long? = null, val type: String? = null)

@Serializable
internal data class WireEpisode(
    val isPrivate: Boolean? = null,
    val id: Long? = null,
    val podcastId: Long? = null,
    val guid: String,
    val feed: String? = null,
    val podcastTitle: String? = null,
    val title: String,
    val summary: String? = null,
    val published: Double? = null,
    val cover: String? = null,
    @Serializable(Explicitness::class) val explicit: Boolean = false,
    val duration: Double? = null,
    val link: String? = null,
    val episodeArt: String? = null,
    val showNotes: String? = null,
    val author: String? = null,
    val file: WireFile,
)

@Serializable
internal data class WirePodcast(
    val isPrivate: Boolean? = null,
    val id: Long? = null,
    @SerialName("itunes_id") val itunesId: Long? = null,
    val feed: String? = null,
    @SerialName("feed_url") val feedUrl: String? = null,
    val title: String = "",
    val author: String? = null,
    val cover: String? = null,
    val thumbnail: String? = null,
    val description: String? = null,
    val link: String? = null,
    val published: Double? = null,
    @Serializable(Explicitness::class) val explicit: Boolean = false,
    val keywords: List<String>? = null,
    val episodeCount: Int? = null,
    val count: Int? = null,
    val episodes: List<WireEpisode>? = null,
)

@Serializable
internal data class WireEpisodePage(
    val episodes: List<WireEpisode>,
    val total: Int,
    val hasMore: Boolean,
    val nextCursor: Int? = null,
)

@Serializable
internal data class WireUser(
    val id: String,
    val email: String,
    val name: String? = null,
    val image: String? = null,
    val hasPasskey: Boolean = false,
)

@Serializable internal data class WireSession(val user: WireUser? = null)
@Serializable internal data class WireProgress(val episode: WireEpisode, val position: Double)
@Serializable internal data class WireIdentity(val id: Long)
@Serializable internal data class WireSuccess(val success: Boolean = false)
@Serializable internal data class WireSent(val sent: Boolean = false)
@Serializable internal data class WireVerified(val verified: Boolean = false, val userId: String? = null)
@Serializable internal data class WireRefreshStatus(val status: String)
@Serializable internal data class WireError(val message: String? = null)
@Serializable internal data class WirePreferences(val speed: Double, val volumeBoost: Boolean, val trimSilence: Boolean)
@Serializable internal data class WirePasskey(val id: String, val provider: String? = null, val createdAt: String, val lastUsedAt: String? = null)
@Serializable internal data class WireAccount(val createdAt: String? = null, val passkeys: List<WirePasskey>, val preferences: WirePreferences? = null)

@Serializable
internal data class WirePasskeyStart(
    val exists: Boolean? = null,
    val hasPasskey: Boolean? = null,
    val options: JsonObject? = null,
    val userId: String? = null,
)

private fun instant(milliseconds: Double?) = milliseconds?.let { Instant.fromEpochMilliseconds(it.toLong()) }

internal fun WireEpisode.domain(
    podcastId: Long? = null,
    feed: String? = null,
    cover: String? = null,
    podcastTitle: String? = null,
) = Episode(
    id = id,
    podcastId = this.podcastId ?: podcastId,
    guid = guid,
    feed = this.feed ?: feed.orEmpty(),
    podcastTitle = this.podcastTitle ?: podcastTitle,
    title = title,
    summary = summary,
    published = instant(published),
    cover = this.cover ?: cover.orEmpty(),
    explicit = explicit,
    duration = duration?.takeIf { it.isFinite() && it > 0 }?.seconds,
    link = link,
    episodeArt = episodeArt,
    showNotes = showNotes ?: summary.orEmpty(),
    author = author,
    file = EpisodeFile(file.url, file.length ?: 0, file.type ?: "audio/mpeg"),
    isPrivate = isPrivate ?: false,
)

internal fun WirePodcast.domain(feedFallback: String? = null, locale: String? = null): Podcast {
    val feed = feed ?: feedUrl ?: feedFallback.orEmpty()
    return Podcast(
        id = id,
        itunesId = itunesId,
        itunesLocale = locale,
        feed = feed,
        title = title,
        author = author.orEmpty(),
        cover = cover.orEmpty(),
        thumbnail = thumbnail ?: cover.orEmpty(),
        description = description.orEmpty(),
        link = link,
        published = instant(published),
        explicit = explicit,
        keywords = keywords.orEmpty(),
        episodeCount = episodeCount ?: count ?: episodes?.size ?: 0,
        episodes = episodes.orEmpty().map { it.domain(id, feed, cover, title) },
        isPrivate = isPrivate ?: false,
    )
}

internal fun WireEpisodePage.domain(podcastId: Long) =
    EpisodePage(episodes.map { it.domain(podcastId) }, total, hasMore, nextCursor)

internal fun WireUser.domain() = User(id, email, name, image, hasPasskey)

internal fun WirePreferences.domain() = AudioOptions(speed, AudioEffects(volumeBoost, trimSilence))

internal fun AudioOptions.wire() = WirePreferences(speed, effects.volumeBoost, effects.trimSilence)

internal fun WireAccount.domain() = Account(
    created = createdAt?.let(Instant::parse),
    passkeys = passkeys.map { Passkey(it.id, it.provider, Instant.parse(it.createdAt), it.lastUsedAt?.let(Instant::parse)) },
    preferences = preferences?.domain(),
)
