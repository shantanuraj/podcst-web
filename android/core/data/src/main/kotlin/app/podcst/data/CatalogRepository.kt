package app.podcst.data

import androidx.room.withTransaction
import kotlinx.coroutines.CancellationException
import app.podcst.database.PodcastEntity
import app.podcst.database.domain
import app.podcst.database.entity
import app.podcst.model.Episode
import app.podcst.model.EpisodePage
import app.podcst.model.EpisodeQuery
import app.podcst.model.EpisodeChapters
import app.podcst.model.FeedFreshness
import app.podcst.model.PlaybackRules
import app.podcst.model.Podcast
import app.podcst.model.Region
import app.podcst.network.PodcstApi
import app.podcst.network.ApiException
import java.io.IOException
import kotlin.time.Duration.Companion.hours
import kotlin.time.Duration.Companion.minutes
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive

class CatalogRepository(
    private val api: PodcstApi,
    private val scopes: Scopes,
    private val clock: () -> Long = System::currentTimeMillis,
) {
    private data class Seen(val owner: Scope, val epoch: Long, val values: Map<Long, FeedFreshness>)
    private val seen = MutableStateFlow<Seen?>(null)
    private data class DetailPages(val owner: Scope, val epoch: Long, val pages: Map<Long, EpisodePage>, val denied: Set<Long> = emptySet())
    private val detailPages = MutableStateFlow<DetailPages?>(null)
    val freshness: Flow<Map<Long, FeedFreshness>> = combine(scopes.current, scopes.verification, seen) { owner, verified, snapshot ->
        if (snapshot?.owner === owner && snapshot.epoch == scopes.epoch && (owner.accountId == null || verified)) snapshot.values else emptyMap()
    }

    fun readerActive(): () -> Boolean {
        val owner = scopes.current.value
        val epoch = scopes.epoch
        return { scopes.current.value === owner && scopes.epoch == epoch && (owner.accountId == null || scopes.verified) }
    }

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
        combine(scope.database.podcasts().observe(feed), scope.database.episodes().observeCatalog(feed), freshness) { podcast, episodes, freshness ->
            podcast?.domain(episodes.map { it.domain() })?.let { it.copy(freshness = freshness[it.id]) }
        }
    }

    fun episode(identity: String): Flow<Episode?> = scopes.current.flatMapLatest { scope ->
        scope.database.episodes().observe(identity).map { it?.domain() }
    }

    suspend fun info(podcast: Podcast): Podcast {
        val id = podcast.id?.takeIf { it > 0 } ?: return podcast
        val active = readerActive()
        if (!active() || podcast.isPrivate && scopes.current.value.accountId == null) throw CancellationException("Account changed")
        val result = api.podcastInfo(id)
        currentCoroutineContext().ensureActive()
        if (!active() || result.isPrivate && scopes.current.value.accountId == null) throw CancellationException("Account changed")
        return result
    }

    suspend fun latest(podcast: Podcast): Episode? {
        val id = podcast.id?.takeIf { it > 0 } ?: return null
        val active = readerActive()
        if (!active() || podcast.isPrivate && scopes.current.value.accountId == null) throw CancellationException("Account changed")
        val result = api.episodes(id, limit = 1).episodes.firstOrNull()
        currentCoroutineContext().ensureActive()
        if (!active() || result?.isPrivate == true && scopes.current.value.accountId == null) throw CancellationException("Account changed")
        return result?.copy(
            feed = result.feed.ifEmpty { podcast.feed },
            podcastTitle = result.podcastTitle ?: podcast.title,
            cover = result.cover.ifEmpty { podcast.cover },
        )
    }

    suspend fun cachedDetail(podcast: Podcast): Podcast? {
        val owner = scopes.current.value
        val active = readerActive()
        checkDetail(active, podcast)
        if (detailPages.value?.takeIf { it.owner === owner && it.epoch == scopes.epoch }?.denied?.contains(podcast.id) == true) return null
        val row = podcast.id?.let { owner.database.podcasts().byId(it) } ?: owner.database.podcasts().get(podcast.feed)
        checkDetail(active, podcast)
        val snapshot = detailPages.value?.takeIf { it.owner === owner && it.epoch == scopes.epoch }?.pages?.get(podcast.id)
        val membership = row?.detailEpisodeIds?.split(',')?.filter { it.isNotEmpty() }
        val persisted = membership?.let { ids ->
            val episodes = ids.chunked(400).flatMap { owner.database.episodes().get(it) }.associateBy { it.identity }
            ids.takeIf { ids.all(episodes::containsKey) }?.map { episodes.getValue(it).domain() }
        }
        val episodes = if (row?.complete == true) owner.database.episodes().recent(row.feed, Int.MAX_VALUE).map { it.domain() }
            else persisted ?: snapshot?.episodes.orEmpty()
        val cached = row?.domain(episodes) ?: snapshot?.let { podcast.copy(episodes = episodes, episodeCount = it.total) }
        checkDetail(active, cached ?: podcast)
        return cached?.copy(freshness = snapshot?.freshness)
    }

    suspend fun resolveDetail(podcast: Podcast): Podcast {
        val owner = scopes.current.value
        val active = readerActive()
        checkDetail(active, podcast)
        if ((podcast.id ?: 0) > 0) return podcast
        val resolved = podcast.itunesId?.let {
            podcast.copy(id = api.resolve(it, podcast.itunesLocale ?: Region.DEFAULT.code))
        } ?: api.podcast(podcast.feed)
        checkDetail(active, resolved)
        if (resolved.feed.isNotEmpty()) store(listOf(resolved), complete = false, owner = owner)
        checkDetail(active, resolved)
        return resolved
    }

    suspend fun detailInfo(podcast: Podcast): Podcast {
        val owner = scopes.current.value
        val active = readerActive()
        checkDetail(active, podcast)
        val info = detailRequest(podcast) { api.podcastInfo(requireNotNull(podcast.id)) }
        checkDetail(active, info)
        val snapshot = detailPages.value?.takeIf { it.owner === owner && it.epoch == scopes.epoch }?.pages?.get(info.id)
        val episodes = snapshot?.episodes.orEmpty().map { it.detailContext(info) }
        store(listOf(info.copy(episodes = episodes)), owner = owner)
        checkDetail(active, info)
        if (snapshot != null) rememberDetailWindow(owner, requireNotNull(info.id), episodes, prepend = true)
        checkDetail(active, info)
        return info
    }

    suspend fun detailPage(podcast: Podcast, query: EpisodeQuery, cursor: Int?): EpisodePage {
        val owner = scopes.current.value
        val active = readerActive()
        checkDetail(active, podcast)
        val page = detailRequest(podcast) { api.episodes(requireNotNull(podcast.id), cursor, query.search, query.sort, query.direction, 30, query.unplayed) }
        checkDetail(active, podcast)
        val context = owner.database.podcasts().byId(requireNotNull(podcast.id))?.domain() ?: podcast
        checkDetail(active, context)
        val episodes = page.episodes.map { it.detailContext(context) }
        if (episodes.any { it.isPrivate } && owner.accountId == null) throw CancellationException("Private catalogue requires a verified account")
        if (context.feed.isNotEmpty() && page.freshness?.content != FeedFreshness.Content.missing) store(listOf(context.copy(
            episodes = episodes,
            episodeCount = if (query == EpisodeQuery()) page.total else context.episodeCount,
            freshness = page.freshness,
        )), complete = false, owner = owner)
        checkDetail(active, podcast)
        val result = page.copy(episodes = episodes)
        if (query == EpisodeQuery() && page.freshness?.content != FeedFreshness.Content.missing) {
            val epoch = scopes.epoch
            val id = requireNotNull(podcast.id)
            if (context.feed.isNotEmpty()) rememberDetailWindow(owner, id, episodes, prepend = cursor == null)
            checkDetail(active, podcast)
            detailPages.update { previous ->
                val current = previous?.takeIf { it.owner === owner && it.epoch == epoch }
                val existing = current?.pages?.get(id)
                if (cursor != null && existing == null) current
                else {
                    val rows = if (cursor == null) episodes + existing?.episodes.orEmpty() else existing?.episodes.orEmpty() + episodes
                    DetailPages(owner, epoch,
                        ((current?.pages.orEmpty() - id) + (id to result.copy(episodes = rows.distinctBy { it.identity }))).entries.toList().takeLast(40).associate { it.toPair() },
                        current?.denied.orEmpty() - id,
                    )
                }
            }
        }
        return result
    }

    private suspend fun rememberDetailWindow(owner: Scope, id: Long, episodes: List<Episode>, prepend: Boolean) {
        owner.database.withTransaction {
            val row = owner.database.podcasts().byId(id) ?: return@withTransaction
            val known = if (row.complete) owner.database.episodes().recent(row.feed, Int.MAX_VALUE).map { it.identity }
                else row.detailEpisodeIds?.split(',')?.filter { it.isNotEmpty() }
            if (prepend || known != null) {
                val incoming = episodes.map { it.identity.value }
                val identities = if (prepend) incoming + known.orEmpty() else known.orEmpty() + incoming
                owner.database.podcasts().detailPage(id, identities.distinct().joinToString(","))
            }
        }
    }

    suspend fun refreshDetail(podcast: Podcast): FeedFreshness {
        val active = readerActive()
        checkDetail(active, podcast)
        val freshness = detailRequest(podcast) { api.refresh(requireNotNull(podcast.id)).freshness }
        checkDetail(active, podcast)
        return freshness
    }

    private suspend fun <T> detailRequest(podcast: Podcast, request: suspend () -> T): T {
        val owner = scopes.current.value
        val epoch = scopes.epoch
        val active = readerActive()
        return try { request() } catch (failure: ApiException) {
            checkDetail(active, podcast)
            if (failure.status in listOf(401, 403, 404)) {
                val id = requireNotNull(podcast.id)
                detailPages.update { previous ->
                    val current = previous?.takeIf { it.owner === owner && it.epoch == epoch }
                    DetailPages(owner, epoch, current?.pages.orEmpty() - id, (current?.denied.orEmpty() + id).toList().takeLast(40).toSet())
                }
                owner.database.podcasts().byId(id)?.let { owner.database.podcasts().upsert(listOf(it.copy(complete = false, detailEpisodeIds = null))) }
                checkDetail(active, podcast)
            }
            throw failure
        }
    }

    private fun Episode.detailContext(podcast: Podcast) = copy(
        feed = feed.ifEmpty { podcast.feed },
        podcastTitle = podcastTitle ?: podcast.title,
        cover = cover.ifEmpty { podcast.cover },
        isPrivate = isPrivate || podcast.isPrivate,
    )

    private suspend fun checkDetail(active: () -> Boolean, podcast: Podcast) {
        currentCoroutineContext().ensureActive()
        if (!active() || podcast.isPrivate && scopes.current.value.accountId == null) throw CancellationException("Account changed")
    }

    suspend fun chapters(episode: Episode): EpisodeChapters {
        val active = readerActive()
        if (!active() || episode.isPrivate && scopes.current.value.accountId == null) throw CancellationException("Account changed")
        val result = api.episodeChapters(episode)
        currentCoroutineContext().ensureActive()
        if (!active()) throw CancellationException("Account changed")
        return result
    }

    suspend fun related(podcast: Podcast, region: Region): List<Podcast> {
        if (podcast.isPrivate || (podcast.id ?: 0) <= 0) return emptyList()
        val active = readerActive()
        if (!active()) throw CancellationException("Account changed")
        val result = api.related(podcast, region.code)
        currentCoroutineContext().ensureActive()
        if (!active()) throw CancellationException("Account changed")
        return result
    }

    fun episodes(identities: List<String>): Flow<List<Episode>> = scopes.current.flatMapLatest { scope ->
        scope.database.episodes().observe(identities).map { rows -> rows.map { it.domain() } }
    }

    suspend fun load(podcast: Podcast, force: Boolean = false, recheck: Boolean = false, refreshIfStale: Boolean = false, onRead: (Podcast) -> Unit = {}): Podcast {
        val owner = scopes.current.value
        val epoch = scopes.epoch
        podcast.id?.let { id -> return load(id, force, recheck, refreshIfStale, onRead) }
        podcast.itunesId?.let { itunesId ->
            val id = api.resolve(itunesId, podcast.itunesLocale ?: Region.DEFAULT.code)
            if (scopes.current.value !== owner || scopes.epoch != epoch) throw CancellationException("Account changed")
            return load(id, force, recheck, refreshIfStale, onRead)
        }
        val resolved = api.podcast(podcast.feed)
        if (scopes.current.value !== owner || scopes.epoch != epoch) throw CancellationException("Account changed")
        resolved.id?.let { id -> return load(id, force, recheck, refreshIfStale, onRead) }
        store(listOf(resolved), complete = resolved.episodes.isNotEmpty(), owner = owner)
        onRead(resolved)
        return resolved
    }

    suspend fun load(id: Long, force: Boolean = false, recheck: Boolean = false, refreshIfStale: Boolean = false, onRead: (Podcast) -> Unit = {}): Podcast {
        val owner = scopes.current.value
        val epoch = scopes.epoch
        suspend fun checkReader() {
            currentCoroutineContext().ensureActive()
            if (scopes.current.value !== owner || scopes.epoch != epoch || owner.accountId != null && !scopes.verified) throw CancellationException("Account changed")
        }
        val existing = owner.database.podcasts().byId(id)
        checkReader()
        if (!force && !recheck && !refreshIfStale && existing != null && existing.complete && fresh(existing)) {
            val cached = existing.domain(owner.database.episodes().catalog(existing.feed).map { it.domain() })
            checkReader()
            onRead(cached)
            return cached
        }
        if (force) api.refresh(id)
        checkReader()
        var podcast = complete(id)
        checkReader()
        // Publish playable episodes before waiting for refresh admission.
        store(listOf(podcast), complete = podcast.freshness?.content == FeedFreshness.Content.cached, owner = owner)
        val available = podcast.copy(episodes = owner.database.episodes().catalog(podcast.feed).map { it.domain() })
        checkReader()
        onRead(available)
        if (refreshIfStale && !force && podcast.freshness?.state == FeedFreshness.State.stale) {
            try {
                val admitted = api.refresh(id).freshness
                checkReader()
                podcast = if (admitted.content == FeedFreshness.Content.cached && admitted.checkedAtMs != podcast.freshness?.checkedAtMs) {
                    // A worker may have finished after our first catalogue read.
                    complete(id)
                } else podcast.copy(freshness = admitted)
                checkReader()
                store(listOf(podcast), complete = podcast.freshness?.content == FeedFreshness.Content.cached, owner = owner)
            } catch (failure: ApiException) {
                if (failure.status != 429 && failure.status < 500) throw failure
            } catch (_: IOException) {
                // Refresh outages do not invalidate successfully read episodes.
            }
        }
        checkReader()
        val result = podcast.copy(episodes = owner.database.episodes().catalog(podcast.feed).map { it.domain() })
        checkReader()
        return result
    }

    internal suspend fun store(podcasts: List<Podcast>, complete: Boolean? = null, owner: Scope = scopes.current.value) {
        val epoch = scopes.epoch
        if (scopes.current.value !== owner) throw CancellationException("Account changed")
        if (owner.accountId != null && !scopes.verified) throw CancellationException("Account is not verified")
        if (owner.accountId == null && podcasts.any { it.isPrivate || it.episodes.any { episode -> episode.isPrivate } }) throw CancellationException("Private catalogue requires a verified account")
        val database = owner.database
        database.withTransaction {
            if (scopes.current.value !== owner) throw CancellationException("Account changed")
            for (podcast in podcasts) {
                val previous = podcast.id?.let { database.podcasts().byId(it) }
                if (previous != null && previous.feed != podcast.feed) {
                    val db = database.openHelper.writableDatabase
                    db.execSQL("UPDATE OR IGNORE subscriptions SET feed = ? WHERE feed = ?", arrayOf(podcast.feed, previous.feed))
                    db.execSQL("UPDATE charts SET feed = ? WHERE feed = ?", arrayOf(podcast.feed, previous.feed))
                    db.execSQL("UPDATE episodes SET feed = ? WHERE podcastId = ?", arrayOf<Any?>(podcast.feed, podcast.id))
                    db.execSQL("DELETE FROM podcasts WHERE feed = ?", arrayOf(previous.feed))
                }
                val existing = previous ?: database.podcasts().get(podcast.feed)
                val membership = if (complete == false && existing?.complete == true) database.episodes().recent(podcast.feed, Int.MAX_VALUE).joinToString(",") { it.identity }
                    else existing?.detailEpisodeIds
                database.podcasts().upsert(listOf(merged(existing, podcast, complete).copy(detailEpisodeIds = membership)))
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
            if (scopes.current.value !== owner || scopes.epoch != epoch || owner.accountId != null && !scopes.verified) throw CancellationException("Account changed")
        }
        if (scopes.current.value !== owner || scopes.epoch != epoch) throw CancellationException("Account changed")
        seen.update { previous -> Seen(owner, epoch, (previous?.takeIf { it.owner === owner && it.epoch == epoch }?.values.orEmpty()) + podcasts.mapNotNull { podcast -> podcast.id?.let { id -> podcast.freshness?.let { id to it } } }.toMap()) }
    }

    private suspend fun complete(id: Long): Podcast {
        val info = api.podcastInfo(id)
        val episodes = mutableListOf<Episode>()
        var cursor: Int? = null
        var total = 0
        var freshness: FeedFreshness? = null
        do {
            val page = api.episodes(id, cursor = cursor, limit = PAGE_SIZE)
            episodes += page.episodes
            total = maxOf(total, page.total)
            freshness = page.freshness
            val next = page.nextCursor?.takeIf { page.hasMore && it != cursor }
            cursor = next
        } while (next != null)
        return info.copy(episodeCount = maxOf(info.episodeCount, total), episodes = episodes, freshness = freshness)
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
            detailEpisodeIds = existing.detailEpisodeIds,
        )
    }

    private companion object {
        const val PAGE_SIZE = 200
        val CHART_LIFETIME = 1.hours.inWholeMilliseconds
        val DETAIL_LIFETIME = 5.minutes.inWholeMilliseconds
    }
}
