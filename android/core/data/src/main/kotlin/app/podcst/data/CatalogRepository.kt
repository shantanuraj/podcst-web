package app.podcst.data

import androidx.room.withTransaction
import kotlinx.coroutines.CancellationException
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
        val owner = scopes.current.value
        val charts = owner.database.charts()
        val refreshedAt = charts.refreshedAt(region.code)
        if (!force && refreshedAt != null && clock() - refreshedAt < CHART_LIFETIME) return
        val podcasts = api.top(region.code, PlaybackRules.CHART_LIMIT)
        if (scopes.current.value !== owner) throw CancellationException("Account changed")
        store(podcasts, owner = owner)
        charts.replace(region.code, podcasts.map { it.feed }, clock())
    }

    suspend fun search(term: String, region: Region): List<Podcast> {
        val owner = scopes.current.value
        val epoch = scopes.epoch
        val result = api.search(term, region.code)
        if (scopes.current.value !== owner || scopes.epoch != epoch || owner.accountId != null && !scopes.verified) throw CancellationException("Account changed")
        return if (owner.accountId == null) result.filterNot { it.isPrivate } else result
    }

    fun podcast(feed: String): Flow<Podcast?> = scopes.current.flatMapLatest { scope ->
        combine(scope.database.podcasts().observe(feed), scope.database.episodes().observeCatalog(feed)) { podcast, episodes ->
            podcast?.domain(episodes.map { it.domain() })
        }
    }

    fun episode(identity: String): Flow<Episode?> = scopes.current.flatMapLatest { scope ->
        scope.database.episodes().observe(identity).map { it?.domain() }
    }

    fun episodes(identities: List<String>): Flow<List<Episode>> = scopes.current.flatMapLatest { scope ->
        scope.database.episodes().observe(identities).map { rows -> rows.map { it.domain() } }
    }

    suspend fun load(podcast: Podcast, force: Boolean = false): Podcast {
        podcast.id?.let { id -> return load(id, force) }
        podcast.itunesId?.let { itunesId ->
            return load(api.resolve(itunesId, podcast.itunesLocale ?: Region.DEFAULT.code), force)
        }
        val owner = scopes.current.value
        val resolved = api.podcast(podcast.feed)
        if (scopes.current.value !== owner) throw CancellationException("Account changed")
        resolved.id?.let { id -> return load(id, force) }
        store(listOf(resolved), complete = resolved.episodes.isNotEmpty(), owner = owner)
        return resolved
    }

    suspend fun load(id: Long, force: Boolean = false): Podcast {
        val owner = scopes.current.value
        val existing = owner.database.podcasts().byId(id)
        if (!force && existing != null && existing.complete && fresh(existing)) {
            return existing.domain(scopes.database.episodes().catalog(existing.feed).map { it.domain() })
        }
        val podcast = if (force) api.refresh(id) else complete(id)
        if (scopes.current.value !== owner) throw CancellationException("Account changed")
        store(listOf(podcast), complete = true, owner = owner)
        return podcast.copy(episodes = owner.database.episodes().catalog(podcast.feed).map { it.domain() })
    }

    internal suspend fun store(podcasts: List<Podcast>, complete: Boolean? = null, owner: Scope = scopes.current.value) {
        if (scopes.current.value !== owner) throw CancellationException("Account changed")
        if (owner.accountId != null && !scopes.verified) throw CancellationException("Account is not verified")
        if (owner.accountId == null && podcasts.any { it.isPrivate || it.episodes.any { episode -> episode.isPrivate } }) throw CancellationException("Private catalogue requires a verified account")
        val database = owner.database
        database.withTransaction {
            if (scopes.current.value !== owner) throw CancellationException("Account changed")
            for (podcast in podcasts) {
                val previous = podcast.id?.let { database.podcasts().byId(it) }
                if (previous != null && previous.feed != podcast.feed) {
                    // Feed URLs are lookup aliases, not synchronized identity. Move local references
                    // alongside metadata in the same Room transaction. Persisted routes retain the canonical ID.
                    val db = database.openHelper.writableDatabase
                    db.execSQL("UPDATE OR IGNORE subscriptions SET feed = ? WHERE feed = ?", arrayOf(podcast.feed, previous.feed))
                    db.execSQL("UPDATE charts SET feed = ? WHERE feed = ?", arrayOf(podcast.feed, previous.feed))
                    db.execSQL("UPDATE episodes SET feed = ? WHERE podcastId = ?", arrayOf<Any?>(podcast.feed, podcast.id))
                    db.execSQL("DELETE FROM podcasts WHERE feed = ?", arrayOf(previous.feed))
                }
                database.podcasts().upsert(listOf(merged(previous ?: database.podcasts().get(podcast.feed), podcast, complete)))
                database.episodes().upsert(podcast.episodes.map { it.entity() })
                val db = database.openHelper.writableDatabase
                val archived = db.query("SELECT name FROM sqlite_master WHERE type='table' AND name='legacy_episode_source'").use { it.moveToFirst() }
                if (archived) {
                    for (episode in podcast.episodes.filter { it.id != null }) db.execSQL(
                        "DELETE FROM legacy_episode_source WHERE feed = ? AND guid = ? AND id NOT IN (SELECT episodeId FROM progress_outbox)", arrayOf(episode.feed, episode.guid),
                    )
                    if (podcast.id != null) db.execSQL("DELETE FROM legacy_podcast_source WHERE feed = ?", arrayOf(podcast.feed))
                }
            }
        }
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
