package app.podcst.database

import app.podcst.model.Episode
import app.podcst.model.EpisodeFile
import app.podcst.model.Podcast
import kotlin.time.Duration.Companion.milliseconds
import kotlin.time.Instant

fun Episode.entity() = EpisodeEntity(
    identity = identity.value,
    id = id,
    podcastId = podcastId,
    guid = guid,
    feed = feed,
    podcastTitle = podcastTitle,
    title = title,
    summary = summary,
    published = published?.toEpochMilliseconds(),
    cover = cover,
    explicit = explicit,
    durationMs = duration?.inWholeMilliseconds,
    link = link,
    episodeArt = episodeArt,
    showNotes = showNotes,
    author = author,
    fileUrl = file.url,
    fileLength = file.length,
    fileType = file.type,
    mediaIdentity = mediaIdentity ?: id?.let { "episode:$it" } ?: podcastId?.let { "podcast:$it:$guid" } ?: "$feed\u001F$guid",
    mediaReferenceIdentity = mediaReferenceIdentity ?: identity.value,
    isPrivate = isPrivate,
)

fun EpisodeEntity.domain() = Episode(
    id = id,
    podcastId = podcastId,
    guid = guid,
    feed = feed,
    podcastTitle = podcastTitle,
    title = title,
    summary = summary,
    published = published?.let(Instant::fromEpochMilliseconds),
    cover = cover,
    explicit = explicit,
    duration = durationMs?.milliseconds,
    link = link,
    episodeArt = episodeArt,
    showNotes = showNotes,
    author = author,
    file = EpisodeFile(fileUrl, fileLength, fileType),
    mediaIdentity = mediaIdentity,
    mediaReferenceIdentity = mediaReferenceIdentity,
    localIdentity = identity.takeIf { id == null },
    isPrivate = isPrivate,
)

fun Podcast.entity(refreshedAt: Long?, complete: Boolean) = PodcastEntity(
    feed = feed,
    id = id,
    itunesId = itunesId,
    title = title,
    author = author,
    cover = cover,
    thumbnail = thumbnail,
    description = description,
    link = link,
    published = published?.toEpochMilliseconds(),
    explicit = explicit,
    keywords = keywords,
    episodeCount = episodeCount,
    isPrivate = isPrivate,
    refreshedAt = refreshedAt,
    complete = complete,
)

fun PodcastEntity.domain(episodes: List<Episode> = emptyList()) = Podcast(
    id = id,
    itunesId = itunesId,
    feed = feed,
    title = title,
    author = author,
    cover = cover,
    thumbnail = thumbnail,
    description = description,
    link = link,
    published = published?.let(Instant::fromEpochMilliseconds),
    explicit = explicit,
    keywords = keywords,
    episodeCount = episodeCount,
    episodes = episodes,
    isPrivate = isPrivate,
)
