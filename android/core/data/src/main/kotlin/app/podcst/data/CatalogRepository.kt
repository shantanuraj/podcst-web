package app.podcst.data

import app.podcst.database.PodcastEntity
import app.podcst.database.domain
import app.podcst.database.entity
import app.podcst.model.Episode
import app.podcst.model.PlaybackRules
import app.podcst.model.Podcast
import app.podcst.model.Region
import app.podcst.network.PodcstApi
import kotlin.time.Duration.Companion.hours
import kotlin.time.Duration.Companion.minutes
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.map

class CatalogRepository(
    private val api: PodcstApi,
    private val scopes: Scopes,
    private val clock: () -> Long = System::currentTimeMillis,
) {
    fun chart(region: Region): Flow<List<Podcast>> = scopes.current.flatMapLatest { scope ->
        scope.database.podcasts().observeChart(region.code).map { rows -> rows.map { it.domain() } }
    }

    suspend fun refreshChart(region: Region, force: Boolean = false) {
        val charts = scopes.database.charts()
        val refreshedAt = charts.refreshedAt(region.code)
        if (!force && refreshedAt != null && clock() - refreshedAt < CHART_LIFETIME) return
        val podcasts = api.top(region.code, PlaybackRules.CHART_LIMIT)
        store(podcasts)
        charts.replace(region.code, podcasts.map { it.feed }, clock())
    }

    suspend fun search(term: String, region: Region): List<Podcast> = api.search(term, region.code)

    fun podcast(feed: String): Flow<Podcast?> = scopes.current.flatMapLatest { scope ->
        combine(scope.database.podcasts().observe(feed), scope.database.episodes().observeCatalog(feed)) { podcast, episodes ->
            podcast?.domain(episodes.map { it.domain() })
        }
    }

    fun episode(identity: String): Flow<Episode?> = scopes.current.flatMapLatest { scope ->
        scope.database.episodes().observe(identity).map { it?.domain() }
    }

    suspend fun load(podcast: Podcast, force: Boolean = false): Podcast {
        podcast.id?.let { id -> return load(id, force) }
        podcast.itunesId?.let { itunesId ->
            return load(api.resolve(itunesId, podcast.itunesLocale ?: Region.DEFAULT.code), force)
        }
        val resolved = api.podcast(podcast.feed)
        resolved.id?.let { id -> return load(id, force) }
        store(listOf(resolved), complete = resolved.episodes.isNotEmpty())
        return resolved
    }

    suspend fun load(id: Long, force: Boolean = false): Podcast {
        val existing = scopes.database.podcasts().byId(id)
        if (!force && existing != null && existing.complete && fresh(existing)) {
            return existing.domain(scopes.database.episodes().catalog(existing.feed).map { it.domain() })
        }
        val podcast = if (force) api.refresh(id) else complete(id)
        store(listOf(podcast), complete = true)
        return podcast
    }

    internal suspend fun store(podcasts: List<Podcast>, complete: Boolean? = null) {
        val database = scopes.database
        val existing = podcasts.associate { it.feed to database.podcasts().get(it.feed) }
        database.podcasts().upsert(podcasts.map { merged(existing[it.feed], it, complete) })
        database.episodes().upsert(podcasts.flatMap { podcast -> podcast.episodes.map { it.entity() } })
    }

    private suspend fun complete(id: Long): Podcast {
        val info = api.podcastInfo(id)
        val episodes = mutableListOf<Episode>()
        var cursor: Int? = null
        var total = 0
        do {
            val page = api.episodes(id, cursor = cursor, limit = PAGE_SIZE)
            episodes += page.episodes
            total = maxOf(total, page.total)
            val next = page.nextCursor?.takeIf { page.hasMore && it != cursor }
            cursor = next
        } while (next != null)
        return info.copy(episodeCount = maxOf(info.episodeCount, total), episodes = episodes)
    }

    private fun fresh(podcast: PodcastEntity) = podcast.refreshedAt?.let { clock() - it < DETAIL_LIFETIME } ?: false

    private fun merged(existing: PodcastEntity?, incoming: Podcast, complete: Boolean?): PodcastEntity {
        val refreshedAt = if (complete == true) clock() else existing?.refreshedAt
        val entity = incoming.entity(refreshedAt, complete ?: existing?.complete ?: false)
        existing ?: return entity
        return entity.copy(
            id = entity.id ?: existing.id,
            itunesId = entity.itunesId ?: existing.itunesId,
            title = entity.title.ifEmpty { existing.title },
            author = entity.author.ifEmpty { existing.author },
            cover = entity.cover.ifEmpty { existing.cover },
            thumbnail = entity.thumbnail.ifEmpty { existing.thumbnail },
            description = entity.description.ifEmpty { existing.description },
            link = entity.link ?: existing.link,
            published = entity.published ?: existing.published,
            keywords = entity.keywords.ifEmpty { existing.keywords },
            episodeCount = maxOf(entity.episodeCount, existing.episodeCount),
        )
    }

    private companion object {
        const val PAGE_SIZE = 200
        val CHART_LIFETIME = 1.hours.inWholeMilliseconds
        val DETAIL_LIFETIME = 5.minutes.inWholeMilliseconds
    }
}
