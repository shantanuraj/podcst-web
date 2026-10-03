package app.podcst.model

import kotlin.time.Duration
import kotlin.time.Instant
import kotlinx.serialization.Serializable

@Serializable
data class EpisodeFile(
    val url: String,
    val length: Long = 0,
    val type: String = "audio/mpeg",
)

@Serializable
data class Episode(
    val id: Long? = null,
    val podcastId: Long? = null,
    val guid: String,
    val feed: String,
    val podcastTitle: String? = null,
    val title: String,
    val summary: String? = null,
    val published: Instant? = null,
    val cover: String = "",
    val explicit: Boolean = false,
    val duration: Duration? = null,
    val link: String? = null,
    val episodeArt: String? = null,
    val showNotes: String = "",
    val author: String? = null,
    val file: EpisodeFile,
    val isPrivate: Boolean = false,
) {
    val identity: EpisodeIdentity get() = EpisodeIdentity(feed, guid)
    val artwork: String get() = episodeArt?.takeIf { it.isNotBlank() } ?: cover
    val notes: String get() = showNotes.ifEmpty { summary.orEmpty() }
    val shareUrl: String? get() = if (isPrivate) null else shareableWebpage(link, excluding = listOf(feed, file.url))
}

@Serializable
@JvmInline
value class EpisodeIdentity(val value: String) {
    constructor(feed: String, guid: String) : this("$feed\u001F$guid")
}
