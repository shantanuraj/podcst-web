package app.podcst.model

import kotlin.time.Instant
import kotlinx.serialization.Serializable

@Serializable
data class Podcast(
    val id: Long? = null,
    val itunesId: Long? = null,
    val itunesLocale: String? = null,
    val feed: String,
    val title: String,
    val author: String = "",
    val cover: String = "",
    val thumbnail: String = "",
    val description: String = "",
    val link: String? = null,
    val published: Instant? = null,
    val explicit: Boolean = false,
    val keywords: List<String> = emptyList(),
    val episodeCount: Int = 0,
    val episodes: List<Episode> = emptyList(),
    val isPrivate: Boolean = false,
) {
    val identity: String get() = id?.let { "podcast:$it" } ?: "local:$feed"
    val shareUrl: String? get() = if (isPrivate) null else shareableWebpage(link, excluding = listOf(feed))
}

@Serializable
data class EpisodePage(
    val episodes: List<Episode>,
    val total: Int,
    val hasMore: Boolean,
    val nextCursor: Int? = null,
)

enum class EpisodeSort(val field: String) {
    Published("published"),
    Title("title"),
    Duration("duration"),
}

enum class SortDirection(val value: String) {
    Ascending("asc"),
    Descending("desc"),
}
